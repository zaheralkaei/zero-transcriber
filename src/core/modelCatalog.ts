/**
 * The two multilingual Whisper checkpoints we expose, with the quantization
 * map per device and truthful download sizes for the model picker.
 *
 * Device/dtype provenance (official realtime-whisper-webgpu worker):
 * fp16 decoders are broken for Whisper — WebGPU uses q4 for the merged
 * decoder and fp32/fp16 for the encoder; WASM runs the whole pipeline at q8.
 */

import type { Device, DtypeMap, ModelKey } from './protocol';

export interface ModelSpec {
  /** Hugging Face checkpoint id. */
  repo: string;
  label: string;
  /** Roughly how big the download is per device, in MB (measured from the ONNX repos). */
  approxSizeMb: Record<Device, number>;
}

export const MODEL_SPECS: Record<ModelKey, ModelSpec> = {
  base: {
    repo: 'onnx-community/whisper-base',
    label: 'Base — lighter, good quality',
    approxSizeMb: { webgpu: 206, wasm: 77 },
  },
  small: {
    repo: 'onnx-community/whisper-small',
    label: 'Small — higher quality, bigger download',
    approxSizeMb: { webgpu: 410, wasm: 250 },
  },
};

export const DTYPE_BY_DEVICE: Record<Device, Record<ModelKey, DtypeMap>> = {
  webgpu: {
    base: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    small: { encoder_model: 'fp16', decoder_model_merged: 'q4' },
  },
  wasm: {
    base: { encoder_model: 'q8', decoder_model_merged: 'q8' },
    small: { encoder_model: 'q8', decoder_model_merged: 'q8' },
  },
};