// @vitest-environment node
/**
 * Worker service tests against a fake pipeline factory — no network, no
 * transformers.js (mocked out), no real Web Worker. Verifies the protocol
 * sequencing guarantees the UI depends on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTranscriptionService } from '../worker/transcription.worker';
import type { AsrHandle, PipelineFactory } from '../worker/pipelineFactory';
import type { FromWorker } from '../core/protocol';

/** Fake engine: streams partials, then (optionally) fails. */
function fakeHandle(options: { text?: string; failWith?: Error; device?: 'webgpu' | 'wasm' } = {}): AsrHandle {
  return {
    device: options.device ?? 'webgpu',
    async transcribe(_audio, opts) {
      if (options.failWith) throw options.failWith;
      opts.onPartial('Hello ');
      opts.onPartial('world');
      return { text: options.text ?? 'Hello world', language: 'en' };
    },
    dispose() {},
  };
}

/** Fake factory that refuses webgpu loads (and optional per-device failures). */
function fakeFactory(options: {
  handle?: AsrHandle;
  failOnDevice?: 'webgpu' | 'wasm';
} = {}): PipelineFactory {
  return vi.fn(async (config) => {
    if (options.failOnDevice === config.device) throw new Error(`${config.device} load failed`);
    return options.handle ?? fakeHandle({ device: config.device });
  });
}

/** Drives the service and collects everything it posts back. */
async function run(messages: unknown[], factory: PipelineFactory): Promise<FromWorker[]> {
  const sent: FromWorker[] = [];
  const service = createTranscriptionService((m) => sent.push(m), factory);
  for (const message of messages) await service.handle(message);
  return sent;
}

const audio = new Float32Array(32_000); // 2 s

beforeEach(() => vi.clearAllMocks());

describe('transcription service', () => {
  it('transcribe-before-load answers with a model-load error', async () => {
    const sent = await run(
      [{ type: 'transcribe', requestId: 1, audio, language: 'auto', task: 'transcribe' }],
      fakeFactory(),
    );
    expect(sent).toEqual([
      { type: 'decode-error', requestId: 1, code: 'model-load', message: 'No model loaded.' },
    ]);
  });

  it('streams decode-start → partials → decode-final with timing', async () => {
    const sent = await run(
      [
        { type: 'load', requestId: 1, modelKey: 'base', device: 'webgpu' },
        { type: 'transcribe', requestId: 2, audio, language: 'auto', task: 'transcribe' },
      ],
      fakeFactory(),
    );
    expect(sent.map((m) => m.type)).toEqual([
      'load-complete', // no webgpu adapter in this env, factory decides — the worker only reports what it got
      'decode-start',
      'decode-partial',
      'decode-partial',
      'decode-final',
    ]);
    const final = sent.at(-1) as Extract<FromWorker, { type: 'decode-final' }>;
    expect(final.text).toBe('Hello world');
    expect(final.language).toBe('en');
    expect(final.decodeMs).toBeGreaterThan(0);
    expect(final.rtf).toBeGreaterThan(0);
  });

  it('marks a second concurrent request as busy', async () => {
    // A handle whose promise we control, so the first decode is still running.
    let release: (value: string) => void = () => undefined;
    const pending = new Promise<string>((resolve) => (release = resolve));
    const handle: AsrHandle = {
      device: 'wasm',
      transcribe: async (_audio, opts) => {
        opts.onPartial('partial-1');
        return { text: await pending };
      },
      dispose() {},
    };

    const sent: FromWorker[] = [];
    const service = createTranscriptionService((m) => sent.push(m), fakeFactory({ handle }));
    await service.handle({ type: 'load', requestId: 1, modelKey: 'base', device: 'wasm' });
    const first = service.handle({ type: 'transcribe', requestId: 2, audio, language: 'auto', task: 'transcribe' });
    await service.handle({ type: 'transcribe', requestId: 3, audio, language: 'auto', task: 'transcribe' });
    release('done');
    await first;

    expect(sent.find((m) => m.type === 'busy')?.requestId).toBe(3);
  });

  it('falls back to WASM when the WebGPU runtime fails and retries the decode', async () => {
    // Load OK, but the first decode throws; a re-load on WASM must rescue it.
    const failingGpuHandle = fakeHandle({ failWith: new Error('webgpu device lost') });
    const wasmHandle = fakeHandle({ device: 'wasm', text: 'via wasm' });
    const factory: PipelineFactory = vi.fn(async (config) =>
      config.device === 'webgpu' ? failingGpuHandle : wasmHandle,
    );

    const sent = await run(
      [
        { type: 'load', requestId: 1, modelKey: 'base', device: 'webgpu' },
        { type: 'transcribe', requestId: 2, audio, language: 'auto', task: 'transcribe' },
      ],
      factory,
    );

    expect(sent.some((m) => m.type === 'load-fallback' && m.device === 'wasm')).toBe(true);
    const final = sent.filter((m) => m.type === 'decode-final').pop() as Extract<FromWorker, { type: 'decode-final' }>;
    expect(final.text).toBe('via wasm');
    expect(factory).toHaveBeenNthCalledWith(
      2,
      { modelKey: 'base', device: 'wasm' },
      expect.anything(),
    );
  });

  it('answers abort with an aborted error and drops the late result', async () => {
    let release: (value: string) => void = () => undefined;
    const pending = new Promise<string>((resolve) => (release = resolve));
    const handle: AsrHandle = {
      device: 'wasm',
      transcribe: async () => ({ text: await pending }),
      dispose() {},
    };
    const sent: FromWorker[] = [];
    const service = createTranscriptionService((m) => sent.push(m), fakeFactory({ handle }));
    await service.handle({ type: 'load', requestId: 1, modelKey: 'base', device: 'wasm' });
    const decoding = service.handle({ type: 'transcribe', requestId: 2, audio, language: 'auto', task: 'transcribe' });
    await service.handle({ type: 'abort', requestId: 2 });
    release('too late');
    await decoding;

    const codes = sent
      .filter((m): m is Extract<FromWorker, { type: 'decode-error' }> => m.type === 'decode-error')
      .map((m) => m.code);
    expect(codes).toEqual(['aborted']);
    expect(sent.some((m) => m.type === 'decode-final')).toBe(false);
  });

  it('ignores malformed and unknown messages', async () => {
    const sent = await run(['junk', { type: 'load' }, null, 42], fakeFactory());
    expect(sent).toEqual([]);
  });
});