/**
 * Main-thread client for transcription.worker.ts. Lazy-creates the worker on
 * first load, queues speech segments (one in flight, capped backlog, oldest-
 * dropped with a notice for the UI), and streams partials/finals back out.
 */

import { useEffect, useRef, useState } from 'react';
import { isFromWorker, type AsrTask, type Device, type LoadProgress, type ModelKey } from '../core/protocol';
import { pickDevice } from '../core/devices';

export type TranscriberStatus = 'idle' | 'loading' | 'ready' | 'transcribing';

export interface TranscriberHandlers {
  /** Streaming text for the segment currently decoding, as deltas. */
  onPartial(requestId: number, delta: string): void;
  /** Finalized text for the segment; ordered by requestId. */
  onFinal(requestId: number, result: { text: string; language?: string; decodeMs: number; rtf: number }): void;
  onDecodeError(requestId: number, message: string): void;
  /** A queued segment was dropped to cap the backlog — show a hiccup notice. */
  onDroppedSegment(): void;
}

/** 3 × 15 s max ≈ 48 s of queued audio; more is dropped as the decoder lags. */
const MAX_QUEUED_SEGMENTS = 3;

interface QueuedSegment {
  requestId: number;
  audio: Float32Array;
  language: string;
  task: AsrTask;
}

export function useTranscriber(preferredDevice: Device = 'webgpu', handlers: TranscriberHandlers) {
  const [status, setStatus] = useState<TranscriberStatus>('idle');
  const [progress, setProgress] = useState<LoadProgress[]>([]);
  const [device, setDevice] = useState<Device | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const queueRef = useRef<QueuedSegment[]>([]);
  const inFlightRef = useRef(-1); // requestId currently decoding (-1 = none)
  const loadedRef = useRef(false);
  const droppedRef = useRef(0); // total segments dropped by backpressure
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const ensureWorker = (): Worker => {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(new URL('../worker/transcription.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event) => {
      const message = event.data;
      if (!isFromWorker(message)) return; // malformed: ignore
      switch (message.type) {
        case 'load-progress':
          setProgress(message.files);
          break;
        case 'load-fallback':
          setDevice('wasm');
          setNotice('GPU mode unavailable — running on CPU (slower).');
          break;
        case 'load-complete':
          setDevice(message.device);
          setProgress([]);
          loadedRef.current = true;
          setStatus('ready');
          drain(); // the queue may already hold segments from during the load
          break;
        case 'decode-start':
          setStatus('transcribing');
          break;
        case 'decode-partial':
          handlersRef.current.onPartial(message.requestId, message.delta);
          break;
        case 'decode-final': {
          inFlightRef.current = -1;
          handlersRef.current.onFinal(message.requestId, {
            text: message.text,
            language: message.language,
            decodeMs: message.decodeMs,
            rtf: message.rtf,
          });
          setStatus('ready');
          drain();
          break;
        }
        case 'decode-error': {
          inFlightRef.current = -1;
          setStatus('ready');
          handlersRef.current.onDecodeError(message.requestId, message.message);
          drain();
          break;
        }
      }
    };
    workerRef.current = worker;
    return worker;
  };

  /** Sends the next queued segment when the worker is idle. */
  const drain = (): void => {
    const queue = queueRef.current;
    if (!loadedRef.current || inFlightRef.current !== -1 || queue.length === 0) return;
    const next = queue.shift()!;
    inFlightRef.current = next.requestId;
    ensureWorker().postMessage({
      type: 'transcribe',
      requestId: next.requestId,
      audio: next.audio,
      language: next.language,
      task: next.task,
    });
  };

  /** Load a model. Subsequent loads swap models (base ↔ small) without a reload. */
  const load = async (modelKey: ModelKey): Promise<void> => {
    const device = await pickDevice(preferredDevice);
    setDevice(device);
    setStatus('loading');
    ensureWorker().postMessage({ type: 'load', requestId: ++requestIdRef.current, modelKey, device });
  };

  /** Enqueue a speech segment for transcription (backpressure: capped backlog). */
  const transcribe = (audio: Float32Array, language: string, task: AsrTask): void => {
    if (!loadedRef.current) return;
    const queue = queueRef.current;
    while (queue.length >= MAX_QUEUED_SEGMENTS) {
      queue.shift(); // decoder lagging: drop the oldest pending audio
      droppedRef.current += 1;
      handlersRef.current.onDroppedSegment();
    }
    queue.push({ requestId: ++requestIdRef.current, audio, language, task });
    drain();
  };

  // Terminate the worker when the app unmounts.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  return { status, device, progress, notice, load, transcribe, clearNotice: () => setNotice(null) };
}