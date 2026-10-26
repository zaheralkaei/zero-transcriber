import { describe, it, expect } from 'vitest';
import {
  isToWorker,
  isFromWorker,
  type FromWorker,
  type ToWorker,
} from '../core/protocol';

describe('worker protocol guards', () => {
  const toWorker: ToWorker[] = [
    { type: 'load', requestId: 1, modelKey: 'base', device: 'webgpu' },
    { type: 'transcribe', requestId: 2, audio: new Float32Array(16), language: 'auto', task: 'transcribe' },
    { type: 'abort', requestId: 3 },
  ];

  const fromWorker: FromWorker[] = [
    { type: 'load-progress', modelKey: 'base', requestId: 1, files: [{ file: 'e.onnx', progress: 40, loaded: 1, total: 2 }] },
    { type: 'load-fallback', modelKey: 'base', device: 'wasm', requestId: 1 },
    { type: 'load-complete', modelKey: 'base', device: 'webgpu', requestId: 1, loadMs: 12000 },
    { type: 'decode-start', requestId: 2 },
    { type: 'decode-partial', requestId: 2, delta: 'Hello ' },
    { type: 'decode-final', requestId: 2, text: 'Hello world', decodeMs: 900, rtf: 0.4 },
    { type: 'decode-error', requestId: 2, code: 'webgpu-lost', message: 'device lost' },
    { type: 'busy', requestId: 5 },
  ];

  it('accepts every valid outbound message shape', () => {
    for (const message of toWorker) expect(isToWorker(message)).toBe(true);
  });

  it('accepts every valid inbound message shape', () => {
    for (const message of fromWorker) expect(isFromWorker(message)).toBe(true);
  });

  it('rejects junk, missing ids, and crossed directions', () => {
    expect(isToWorker(null)).toBe(false);
    expect(isToWorker(undefined)).toBe(false);
    expect(isToWorker({ type: 'nope', requestId: 1 })).toBe(false);
    expect(isToWorker({ type: 'load', modelKey: 'base', device: 'webgpu' })).toBe(false); // no requestId
    expect(isFromWorker('decode-final')).toBe(false);
    expect(isFromWorker(null)).toBe(false);
    expect(isFromWorker({ type: 'load', requestId: 1 })).toBe(false); // request sent outbound-only
  });
});