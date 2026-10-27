/**
 * The only module that touches the transformers.js library, kept behind a
 * narrow injectable contract so the worker logic can be tested offline with
 * a fake implementation. The heavy library is imported dynamically so it is
 * never pulled into the main bundle.
 */

import { AUTO_LANGUAGE } from '../core/languages';
import { DTYPE_BY_DEVICE, MODEL_SPECS } from '../core/modelCatalog';
import type { AsrTask, Device, ModelKey } from '../core/protocol';
import { prefetchWeights } from './prefetch';

/** Raw progress event from the library's progress_callback. */
export interface PipelineProgressEvent {
  status: string;
  file: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

export type PipelineFactory = (config: PipelineConfig, hooks: PipelineHooks) => Promise<AsrHandle>;

export interface PipelineConfig {
  modelKey: ModelKey;
  device: Device;
}

export interface PipelineHooks {
  onProgress(event: PipelineProgressEvent): void;
}

export interface AsrOptions {
  language: string;
  task: AsrTask;
  /** Called with each newly generated text fragment (streaming deltas). */
  onPartial(text: string): void;
}

export interface AsrResult {
  text: string;
  /** Detected language when the pipeline chooses it (undefined = not reported). */
  language?: string;
}

/** The transcript engine interface the worker drives. */
export interface AsrHandle {
  transcribe(audio: Float32Array, options: AsrOptions): Promise<AsrResult>;
  device: Device;
  dispose(): void;
}

export async function createPipeline(
  config: PipelineConfig,
  hooks: PipelineHooks,
): Promise<AsrHandle> {
  // Dynamic import: keeps transformers.js + onnxruntime out of the main bundle.
  const { pipeline, TextStreamer } = await import('@huggingface/transformers');
  const spec = MODEL_SPECS[config.modelKey];
  const dtype = DTYPE_BY_DEVICE[config.device][config.modelKey];

  // Download the weights one at a time into the library's browser cache first
  // (single aggregated bar, calm network); the pipeline load itself is then an
  // instant cache hit. Failures fall back to the library's parallel downloader.
  await prefetchWeights(spec.repo, dtype, {
    onFileProgress: ({ file, loaded, total }) =>
      hooks.onProgress({
        status: 'progress',
        file, // same key transformers.js later reports → its cache-hit events replace these
        progress: total > 0 ? (loaded / total) * 100 : 0,
        loaded,
        total,
      }),
  });

  const asr = await pipeline('automatic-speech-recognition', spec.repo, {
    device: config.device,
    dtype,
    // ProgressInfo events carry a file only while a download is running; the
    // service filters those out, so the cast at this boundary is safe.
    progress_callback: (event: { file?: string } & Partial<PipelineProgressEvent>) =>
      hooks.onProgress(event as PipelineProgressEvent),
  });

  return {
    device: config.device,
    async transcribe(audio: Float32Array, options: AsrOptions): Promise<AsrResult> {
      // Streaming partials via callback deltas; timestamps tokens are stripped
      // downstream (text.ts) rather than here.
      const streamer = new TextStreamer((asr as { tokenizer: unknown }).tokenizer as never, {
        skip_prompt: true,
        callback_function: options.onPartial,
      });
      const output = await (asr as unknown as (
        audio: Float32Array,
        opts: Record<string, unknown>,
      ) => Promise<unknown>)(audio, {
        language: options.language === AUTO_LANGUAGE ? undefined : options.language,
        task: options.task,
        temperature: 0,
        max_new_tokens: 256, // hallucination guard: 15 s of speech needs far fewer
        streamer,
      });
      const result = (Array.isArray(output) ? output[0] : output) as {
        text?: string;
        language?: string;
      };
      return { text: result.text ?? '', language: result.language };
    },
    dispose() {
      // The handle's buffers are freed by GC; keep the hook for future cleanup.
    },
  };
}