/**
 * Sequential weight prefetcher. transformers.js downloads a model's files in
 * parallel; this module fetches the big ONNX weights one at a time into the
 * same Cache Storage the library reads (`transformers-cache`, keyed by the
 * full HF URL) with exactly matching filenames, so the library's own load is
 * an instant cache hit. One-at-a-time keeps the network calm for slow
 * connections; the UI aggregates the per-file snapshots into a single bar.
 */

import type { DtypeMap } from '../core/protocol';

/** Suffix each dtype adds to a weight file name (mirrors transformers.js). */
const DTYPE_SUFFIX: Partial<Record<string, string>> = {
  fp32: '', // fp32 is the library's default → no suffix
  fp16: '_fp16',
  q8: '_quantized',
  q4: '_q4',
  int8: '_int8',
};

const HF_HOST = 'https://huggingface.co/';

/** The two weight files a dtype map implies, in download order. */
export function weightFilenames(dtype: DtypeMap): string[] {
  return [
    `onnx/encoder_model${DTYPE_SUFFIX[dtype.encoder_model]}.onnx`,
    `onnx/decoder_model_merged${DTYPE_SUFFIX[dtype.decoder_model_merged]}.onnx`,
  ];
}

/** Per-file progress snapshot, keyed to what transformers.js later reports. */
export interface PrefetchFileEvent {
  file: string;
  loaded: number;
  /** 0 while the size is unknown → the UI shows an indeterminate bar. */
  total: number;
}

export interface PrefetchHooks {
  onFileProgress(event: PrefetchFileEvent): void;
}

/**
 * Downloads the weight files one at a time into the library's browser cache.
 * Any failure is swallowed: transformers.js' own downloader is the fallback
 * path, so prefetch is a UX optimization, never a correctness requirement.
 */
export async function prefetchWeights(
  repo: string,
  dtype: DtypeMap,
  hooks: PrefetchHooks,
): Promise<void> {
  try {
    const cache = await caches.open('transformers-cache');
    // file (the event key, exactly as transformers.js reports it) + url + size.
    const targets = weightFilenames(dtype).map((file) => ({
      file,
      url: `${HF_HOST}${repo}/resolve/main/${file}`,
      loaded: 0,
      total: 0, // 0 = unknown until the HEAD pass (or the download) resolves it
    }));

    const emit = () => {
      for (const target of targets) {
        hooks.onFileProgress({ file: target.file, loaded: target.loaded, total: target.total });
      }
    };

    // Bytes already cached count without being re-downloaded; the rest are
    // sized with a cheap sequential HEAD pass so the bar shows an honest %.
    for (const target of targets) {
      const cached = await cache.match(target.url);
      if (cached) {
        target.loaded = Number(cached.headers.get('Content-Length') ?? 0);
        target.total = target.loaded;
      } else {
        try {
          const head = await fetch(target.url, { method: 'HEAD' });
          if (head.ok) target.total = Number(head.headers.get('Content-Length') ?? 0);
        } catch {
          // Sizes are best-effort; an unknown total makes the bar indeterminate.
        }
      }
    }
    emit();

    // The actual work: strictly one weight file at a time.
    for (const target of targets) {
      if (target.loaded >= target.total && target.total > 0) continue; // fully cached
      const response = await fetch(target.url, { mode: 'cors' });
      if (!response.ok) continue; // the library will surface real errors
      const buffer = await readAll(response, (bytes) => {
        target.loaded += bytes;
        emit();
      });
      if (target.total === 0) target.total = buffer.length; // sizes never arrived
      if (buffer.length !== target.total) continue; // truncated download: don't poison the cache
      // Mirror transformers.js: rewrap the buffer so the cached Response is
      // self-contained (its original body was fully consumed). The Uint8Array
      // type param from @types/node doesn't line up with lib.dom's BodyInit.
      await cache
        .put(target.url, new Response(buffer as unknown as BodyInit, { headers: response.headers }))
        .catch(() => undefined); // quota errors are non-fatal here
      target.loaded = buffer.length;
      emit();
    }
  } catch {
    // No Cache API, blocked HEAD, or network hiccup → library downloads as before.
  }
}

/** Reads a streamed response to a single buffer, reporting chunk sizes. */
async function readAll(
  response: Response,
  onBytes: (bytes: number) => void,
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer());
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    onBytes(value.length);
  }
  const all = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return all;
}