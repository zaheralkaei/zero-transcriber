/**
 * Single source of truth for main-thread ⇄ worker messages. Both sides must
 * go through `isToWorker` / payload checks before acting on any message, so a
 * malformed message can never crash a side of the bridge.
 */

export type Device = 'webgpu' | 'wasm';
export type AsrTask = 'transcribe' | 'translate';
/** Which catalog entry to run (`modelCatalog.ts` maps these to HF ids). */
export type ModelKey = 'base' | 'small';

/** Per-device quantization map (see modelCatalog.ts for why these exact values). */
/** Quantization names accepted by the transformers.js `dtype` option. */
export type DtypeName = 'auto' | 'fp32' | 'q4' | 'fp16' | 'q8' | 'int8';

/** Per-device quantization map (see modelCatalog.ts for why these exact values). */
export interface DtypeMap {
  encoder_model: DtypeName;
  decoder_model_merged: DtypeName;
  /** Index signature so the map satisfies the library's Record<string, dtype> type. */
  [key: string]: DtypeName;
}

export type ToWorker =
  | { type: 'load'; requestId: number; modelKey: ModelKey; device: Device }
  | {
      type: 'transcribe';
      requestId: number;
      audio: Float32Array;
      /** ISO language code, or 'auto' for detection (omits the arg in the pipeline call). */
      language: string;
      task: AsrTask;
    }
  | { type: 'abort'; requestId: number };

export interface LoadProgress {
  file: string;
  /** 0–100. */
  progress: number;
  loaded: number;
  total: number;
}

export type FromWorker =
  | { type: 'load-progress'; modelKey: ModelKey; requestId: number; files: LoadProgress[] }
  | { type: 'load-fallback'; modelKey: ModelKey; device: Device; requestId: number }
  | { type: 'load-complete'; modelKey: ModelKey; device: Device; requestId: number; loadMs: number }
  | { type: 'decode-start'; requestId: number }
  | { type: 'decode-partial'; requestId: number; /** New text since the previous partial. */ delta: string }
  | {
      type: 'decode-final';
      requestId: number;
      text: string;
      /** Detected language when `language === 'auto'`. */
      language?: string;
      decodeMs: number;
      /** Real-time factor: seconds of audio processed per second of compute (< 1 = faster than real time). */
      rtf: number;
    }
  | { type: 'decode-error'; requestId: number; code: DecodeErrorCode; message: string }
  | { type: 'busy'; requestId: number };

export type DecodeErrorCode = 'model-load' | 'webgpu-lost' | 'aborted' | 'unknown';

const TO_WORKER_TYPES = new Set(['load', 'transcribe', 'abort']);
const FROM_WORKER_TYPES = new Set([
  'load-progress',
  'load-fallback',
  'load-complete',
  'decode-start',
  'decode-partial',
  'decode-final',
  'decode-error',
  'busy',
]);

/** Structural guard for messages crossing into the worker. */
export function isToWorker(value: unknown): value is ToWorker {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    TO_WORKER_TYPES.has((value as { type: unknown }).type as string) &&
    typeof (value as { requestId?: unknown }).requestId === 'number'
  );
}

/** Structural guard for messages crossing back out of the worker. */
export function isFromWorker(value: unknown): value is FromWorker {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    FROM_WORKER_TYPES.has((value as { type: unknown }).type as string) &&
    typeof (value as { requestId?: unknown }).requestId === 'number'
  );
}