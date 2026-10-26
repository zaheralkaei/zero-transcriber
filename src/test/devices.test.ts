import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pickDevice, supportsWebGpu } from '../core/devices';

// `navigator.gpu` probing drives the WebGPU-vs-WASM decision; jsdom has neither.
describe('device selection', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('falls back to WASM when WebGPU is absent', async () => {
    expect(await supportsWebGpu()).toBe(false);
    expect(await pickDevice('webgpu')).toBe('wasm');
    expect(await pickDevice('wasm')).toBe('wasm');
  });

  it('prefers WebGPU when an adapter is available', async () => {
    const fakeGpu = { requestAdapter: vi.fn(async () => ({})) };
    vi.stubGlobal('navigator', { ...navigator, gpu: fakeGpu });
    expect(await supportsWebGpu()).toBe(true);
    expect(await pickDevice('webgpu')).toBe('webgpu');
  });

  it('falls back when the adapter probe throws', async () => {
    const hostileGpu = { requestAdapter: vi.fn(async () => { throw new Error('driver crash'); }) };
    vi.stubGlobal('navigator', { ...navigator, gpu: hostileGpu });
    expect(await pickDevice('webgpu')).toBe('wasm');
  });
});