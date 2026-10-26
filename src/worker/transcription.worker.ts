/**
 * Worker-side protocol server. Owns the pipeline lifecycle (one model at a
 * time, WebGPU → WASM fallback), processes ONE transcribe at a time (extra
 * requests get `busy` — the main thread queues), and treats abort as
 * "drop the result when it lands", since decoder calls are not interruptible.
 */

import {
  isToWorker,
  type Device,
  type FromWorker,
  type ModelKey,
  type ToWorker,
} from '../core/protocol';
import { MAX_TOTAL_SAMPLES } from '../core/SegmentBuffer';
import {
  createPipeline,
  type PipelineFactory,
  type PipelineProgressEvent,
} from './pipelineFactory';
import { warmUp } from './warmup';

export interface TranscriptionService {
  handle(message: unknown): Promise<void>;
}

export function createTranscriptionService(
  post: (message: FromWorker) => void,
  factory: PipelineFactory = createPipeline,
): TranscriptionService {
  let pipeline: Awaited<ReturnType<PipelineFactory>> | null = null;
  let loadedKey: ModelKey | null = null;
  let currentDevice: Device = 'wasm';
  let busy = false;
  let activeRequestId = -1;
  const droppedRequests = new Set<number>();
  /** Latest progress per file, aggregated for the UI's progress bar. */
  const progressMap = new Map<string, PipelineProgressEvent>();

  const onProgress: (event: PipelineProgressEvent) => void = (event) => {
    if (!event.file) return;
    if (event.status !== 'progress' && event.status !== 'download') return;
    progressMap.set(event.file, event);
    post({
      type: 'load-progress',
      modelKey: loadedKey ?? 'base',
      requestId: activeRequestId,
      files: [...progressMap.values()].map((f) => ({
        file: f.file,
        progress: f.progress ?? 0,
        loaded: f.loaded ?? 0,
        total: f.total ?? 0,
      })),
    });
  };

  /** Loads the pipeline; transparently retries on WASM when WebGPU config fails. */
  async function load(message: Extract<ToWorker, { type: 'load' }>): Promise<void> {
    let device = message.device;
    progressMap.clear(); // stale progress from a previous model must not linger
    const t0 = performance.now();
    try {
      pipeline = await factory({ modelKey: message.modelKey, device }, { onProgress });
    } catch (error) {
      if (device === 'wasm') {
        post({ type: 'decode-error', requestId: message.requestId, code: 'model-load', message: String(error) });
        return;
      }
      // The WebGPU configs are version-sensitive — recover on the CPU path.
      device = 'wasm';
      post({ type: 'load-fallback', modelKey: message.modelKey, device, requestId: message.requestId });
      try {
        pipeline = await factory({ modelKey: message.modelKey, device }, { onProgress });
      } catch (fallbackError) {
        post({ type: 'decode-error', requestId: message.requestId, code: 'model-load', message: String(fallbackError) });
        return;
      }
    }
    loadedKey = message.modelKey;
    currentDevice = device;
    if (device === 'webgpu') await warmUp(pipeline); // compile shaders once, before real use
    post({ type: 'load-complete', modelKey: message.modelKey, device, requestId: message.requestId, loadMs: performance.now() - t0 });
  }

  async function transcribe(message: Extract<ToWorker, { type: 'transcribe' }>): Promise<void> {
    if (!pipeline) {
      post({ type: 'decode-error', requestId: message.requestId, code: 'model-load', message: 'No model loaded.' });
      return;
    }
    if (busy) {
      post({ type: 'busy', requestId: message.requestId });
      return;
    }

    busy = true;
    activeRequestId = message.requestId;
    const t0 = performance.now();
    // Defensive cap: never hand the model more than the 30 s encoder window.
    const audio = message.audio.length > MAX_TOTAL_SAMPLES ? message.audio.subarray(0, MAX_TOTAL_SAMPLES) : message.audio;
    post({ type: 'decode-start', requestId: message.requestId });

    try {
      const result = await pipeline.transcribe(audio, {
        language: message.language,
        task: message.task,
        onPartial: (delta) => {
          if (droppedRequests.has(message.requestId)) return; // aborted mid-stream
          post({ type: 'decode-partial', requestId: message.requestId, delta });
        },
      });
      const decodeMs = performance.now() - t0;
      const rtf = decodeMs / 1000 / (audio.length / 16_000);
      if (droppedRequests.delete(message.requestId)) return; // aborted: drop the result
      post({
        type: 'decode-final',
        requestId: message.requestId,
        text: result.text,
        language: result.language,
        decodeMs,
        rtf,
      });
    } catch (error) {
      // Runtime device loss (driver reset, adapter gone) → reload on WASM once.
      const retriable = currentDevice === 'webgpu';
      if (message.requestId !== activeRequestId) return; // superseded by fallback retry
      if (retriable) {
        post({ type: 'load-fallback', modelKey: loadedKey ?? 'base', device: 'wasm', requestId: message.requestId });
        try {
          pipeline = await factory({ modelKey: loadedKey ?? 'base', device: 'wasm' }, { onProgress });
          currentDevice = 'wasm';
          const retried = await pipeline.transcribe(audio, {
            language: message.language,
            task: message.task,
            onPartial: () => undefined, // keep quiet on retries — partials were already streamed
          });
          post({ type: 'decode-final', requestId: message.requestId, text: retried.text, decodeMs: performance.now() - t0, rtf: 0 });
          return;
        } catch (retryError) {
          post({ type: 'decode-error', requestId: message.requestId, code: 'unknown', message: String(retryError) });
          return;
        }
      }
      post({
        type: 'decode-error',
        requestId: message.requestId,
        code: droppedRequests.has(message.requestId) ? 'aborted' : 'unknown',
        message: String(error),
      });
    } finally {
      busy = false;
      activeRequestId = -1;
    }
  }

  function abort(requestId: number): void {
    if (requestId !== activeRequestId) return;
    droppedRequests.add(requestId);
    post({ type: 'decode-error', requestId, code: 'aborted', message: 'Decode cancelled.' });
  }

  return {
    async handle(message: unknown): Promise<void> {
      if (!isToWorker(message)) return; // malformed messages are ignored, never crashing
      switch (message.type) {
        case 'load':
          return load(message);
        case 'transcribe':
          return transcribe(message);
        case 'abort':
          abort(message.requestId);
      }
    },
  };
}

/**
 * Worker entrypoint. Guarded so the same module can be unit-tested on the main
 * thread (jsdom) without touching real worker globals.
 */
function inWorkerScope(): boolean {
  // `self` exists in a worker; `document` does not (it does in jsdom/windows).
  return typeof document === 'undefined' && typeof self !== 'undefined';
}

export function initWorker(): void {
  if (!inWorkerScope()) return;
  const service = createTranscriptionService((message) => self.postMessage(message));
  self.onmessage = (event: MessageEvent) => {
    void service.handle(event.data).catch((error) => {
      console.error('[worker] unhandled error', error);
    });
  };
}

initWorker();