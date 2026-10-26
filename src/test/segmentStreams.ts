/**
 * Builders for deterministic synthetic 16 kHz audio, so segmentation and VAD
 * tests never depend on real noise or a seeded flake. All functions return
 * Float32Array PCM; `chunks()` splits any waveform into capture-sized blocks.
 */

export const TEST_SAMPLE_RATE = 16_000;

/** Deterministic PRNG (mulberry32) — the same seed always yields the same signal. */
export function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Background room noise: uniform ±0.0012 (RMS ≈ 0.0007 — far below threshold). */
export function silence(samples: number, seed = 1): Float32Array {
  const rng = mulberry32(seed);
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) out[i] = rng() * 0.0024 - 0.0012;
  return out;
}

/** Speech-like signal: a 220 Hz tone at amplitude 0.15 (RMS ≈ 0.106). */
export function speech(samples: number, seed = 2, freq = 220): Float32Array {
  const rng = mulberry32(seed);
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = 0.15 * Math.sin((2 * Math.PI * freq * i) / TEST_SAMPLE_RATE) + (rng() * 0.002 - 0.001);
  }
  return out;
}

/** Seconds → sample count convenience. */
export function seconds(n: number): number {
  return Math.round(n * TEST_SAMPLE_RATE);
}

/** Splits PCM into PCM_BLOCK_SAMPLES-size blocks, zero-padding the tail. */
export function chunkBlocks(data: Float32Array): Float32Array[] {
  const block = 4096;
  const out: Float32Array[] = [];
  for (let i = 0; i < data.length; i += block) {
    const chunk = new Float32Array(block); // zero-padded partial final block
    chunk.set(data.subarray(i, i + block));
    out.push(chunk);
  }
  return out;
}

/** Concatenates parts into one continuous waveform (typed arrays, not spreads). */
export function join(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}