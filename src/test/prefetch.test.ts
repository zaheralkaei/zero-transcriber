/**
 * Sequential weight prefetch against stubbed Cache/fetch APIs: correct HF
 * cache keys, one-file-at-a-time ordering, cached-files-are-skipped, honest
 * per-file progress snapshots, and silent fallback on any failure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prefetchWeights, weightFilenames } from '../worker/prefetch';

/* Minimal Cache stub: match/put over an in-memory Map. */
function makeCache() {
  const store = new Map<string, Response>();
  return {
    match: vi.fn(async (url: string) => store.get(url)),
    put: vi.fn(async (url: string, response: Response) => {
      store.set(url, response);
    }),
  };
}

/* Response body as an async-iterable stream from a plain buffer. */
function bodyResponse(bytes: number): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Length': String(bytes) } });
}

function stubGlobals(cache: ReturnType<typeof makeCache>) {
  const fetchMock = vi.fn();
  vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  // Silence the failure-swallowing so tests can't hide real bugs.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const dtype = { encoder_model: 'q8', decoder_model_merged: 'q8' } as const;

describe('weightFilenames', () => {
  it('maps dtypes to the exact library filenames', () => {
    expect(weightFilenames({ encoder_model: 'fp32', decoder_model_merged: 'q4' })).toEqual([
      'onnx/encoder_model.onnx',
      'onnx/decoder_model_merged_q4.onnx',
    ]);
    expect(weightFilenames({ encoder_model: 'fp16', decoder_model_merged: 'q4' })).toEqual([
      'onnx/encoder_model_fp16.onnx',
      'onnx/decoder_model_merged_q4.onnx',
    ]);
  });
});

describe('prefetchWeights', () => {
  it('downloads the two weights sequentially into the library cache with snapshots', async () => {
    const cache = makeCache();
    const fetchMock = stubGlobals(cache);
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (init?.method === 'HEAD') {
        const size = url.includes('encoder') ? 100 : 200;
        return Promise.resolve(new Response(null, { headers: { 'Content-Length': String(size) } }));
      }
      const size = url.includes('encoder') ? 100 : 200;
      return Promise.resolve(bodyResponse(size));
    });

    const events: Array<{ file: string; loaded: number; total: number }> = [];
    await prefetchWeights('onnx-community/whisper-base', dtype, {
      onFileProgress: (event) => events.push({ ...event }),
    });

    // Sequential: only encoder requests before decoder requests (default method
    // is GET — prefetch omits it).
    const getUrls = fetchMock.mock.calls
      .map(([url, init]) => [url, (init as { method?: string })?.method ?? 'GET'])
      .filter(([, method]) => method === 'GET');
    expect(getUrls[0][0]).toContain('encoder_model_quantized.onnx');
    expect(getUrls[1][0]).toContain('decoder_model_merged_quantized.onnx');

    // Cache keys match what the library reads.
    expect(cache.put.mock.calls[0][0]).toBe(
      'https://huggingface.co/onnx-community/whisper-base/resolve/main/onnx/encoder_model_quantized.onnx',
    );
    // Final snapshots: both files at 100% (one event per file, per emit()).
    expect(events.at(-2)).toEqual({ file: 'onnx/encoder_model_quantized.onnx', loaded: 100, total: 100 });
    expect(events.at(-1)).toEqual({ file: 'onnx/decoder_model_merged_quantized.onnx', loaded: 200, total: 200 });
  });

  it('reports unknown sizes with total 0 (indeterminate) when HEADs fail', async () => {
    const cache = makeCache();
    const fetchMock = stubGlobals(cache);
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (init?.method === 'HEAD') return Promise.reject(new TypeError('HEAD blocked'));
      if (url.includes('encoder')) return Promise.resolve(bodyResponse(64));
      return Promise.resolve(bodyResponse(64));
    });

    const events: Array<{ loaded: number; total: number }> = [];
    await prefetchWeights('r', dtype, {
      onFileProgress: ({ loaded, total }) => events.push({ loaded, total }),
    });
    // Mid-download snapshot had unknown sizes, finals report the real totals.
    expect(events.some((event) => event.total === 0 && event.loaded > 0)).toBe(true);
    expect(events.at(-2)).toEqual({ loaded: 64, total: 64 }); // encoder
    expect(events.at(-1)).toEqual({ loaded: 64, total: 64 }); // decoder
  });

  it('skips files already in the library cache and never re-downloads them', async () => {
    const cache = makeCache();
    await cache.put(
      'https://huggingface.co/r/resolve/main/onnx/encoder_model_quantized.onnx',
      new Response(null, { headers: { 'Content-Length': '500' } }),
    );
    const fetchMock = stubGlobals(cache);
    fetchMock.mockImplementation((_url: string, init?: { method?: string }) => {
      if (init?.method === 'HEAD') {
        return Promise.resolve(new Response(null, { headers: { 'Content-Length': '300' } }));
      }
      return Promise.resolve(bodyResponse(300));
    });

    const events: Array<{ file: string; loaded: number; total: number }> = [];
    await prefetchWeights('r', dtype, {
      onFileProgress: (event) => events.push({ ...event }),
    });

    // encoder: zero fetches (already cached, credited at 100%); decoder: one GET.
    const gets = fetchMock.mock.calls.filter(([, init]) => (init as { method?: string })?.method !== 'HEAD');
    expect(gets).toHaveLength(1);
    expect(gets[0][0]).toContain('decoder_model_merged_quantized.onnx');
    expect(events.at(-2)).toEqual({ file: 'onnx/encoder_model_quantized.onnx', loaded: 500, total: 500 });
    expect(events.at(-1)).toEqual({ file: 'onnx/decoder_model_merged_quantized.onnx', loaded: 300, total: 300 });
  });

  it('keeps the cache clean on truncated downloads and never throws', async () => {
    const cache = makeCache();
    const fetchMock = stubGlobals(cache);
    // HEAD says 100 bytes; the body delivers only 40 → truncated, must be skipped.
    fetchMock.mockImplementation((_url: string, init?: { method?: string }) => {
      if (init?.method === 'HEAD') {
        return Promise.resolve(new Response(null, { headers: { 'Content-Length': '100' } }));
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(40));
          controller.close();
        },
      });
      return Promise.resolve(new Response(stream, { headers: { 'Content-Length': '100' } }));
    });

    const events: Array<{ loaded: number; total: number }> = [];
    await expect(
      prefetchWeights('r', dtype, { onFileProgress: ({ loaded, total }) => events.push({ loaded, total }) }),
    ).resolves.toBeUndefined();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('gives up silently when the Cache API itself fails', async () => {
    vi.stubGlobal('caches', { open: vi.fn(async () => Promise.reject(new Error('storage blocked'))) });
    await expect(
      prefetchWeights('r', dtype, { onFileProgress: () => undefined }),
    ).resolves.toBeUndefined();
  });
});