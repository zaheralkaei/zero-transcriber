/**
 * Device selection: prefer WebGPU (3–15× faster decoding) and fall back to
 * WASM whenever it is unavailable — never assume, always probe the adapter.
 */

import type { Device } from './protocol';

interface GpuProbe {
  requestAdapter(): Promise<unknown>;
}

/** Async probe — true only if a usable WebGPU adapter is actually available. */
export async function supportsWebGpu(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: GpuProbe }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

/**
 * Resolves the device to load a pipeline with. `preferred` is the user's
 * choice from the UI/URL; 'webgpu' is honoured only when a probe confirms it.
 */
export async function pickDevice(preferred: Device): Promise<Device> {
  return preferred === 'webgpu' && (await supportsWebGpu()) ? 'webgpu' : 'wasm';
}