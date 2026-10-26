/**
 * WebGPU shader compilation runs on the first token generation — doing it once
 * with a silent 1 s sample, right after model load, keeps the first real
 * segment from stalling behind a multi-second compile.
 */

import type { AsrHandle } from './pipelineFactory';

/** Best-effort: a failed warm-up must never block transcription itself. */
export async function warmUp(handle: AsrHandle): Promise<number> {
  const started = performance.now();
  try {
    await handle.transcribe(new Float32Array(16_000), {
      language: 'en',
      task: 'transcribe',
      onPartial: () => undefined, // warm-up text is discarded
    });
  } catch {
    // Ignored by design — decode errors surface on real segments instead.
  }
  return performance.now() - started;
}