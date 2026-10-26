/**
 * Turns a continuous stream of PCM blocks into speech segments using the VAD.
 * A small pre-roll is kept so segments never clip the start of a word, and
 * segments are capped at 15 s (Whisper's encoder window is 30 s — leaving
 * headroom, with a 480 000-sample absolute cap mirroring the reference workers).
 */

import { initialVadState, stepVad, frameRms, type VadState } from './vad';

export const SAMPLE_RATE = 16_000;
/** 512 samples = 32 ms analysis hop; PCM blocks arrive in multiples of this. */
export const HOP_SIZE = 512;
/** 0.4 s kept before onset — enough to not clip the attack of the first word. */
export const PRE_ROLL_SAMPLES = 6400;
/** Segments shorter than this are discarded (Whisper hallucinates on blips). */
export const MIN_SEGMENT_SAMPLES = 12_800; // 0.8 s
/** Longest segment before a forced flush; leaves headroom inside the 30 s window. */
export const MAX_SEGMENT_SAMPLES = 240_000; // 15 s
/** Absolute cap for any buffer handed to the model (MAX_SAMPLES in the reference workers). */
export const MAX_TOTAL_SAMPLES = 480_000;

export interface Segment {
  audio: Float32Array;
  /** Position in the stream where this segment starts, in samples. */
  startedAtSample: number;
  endedAtSample: number;
}

export interface SegmentBufferState {
  vad: VadState;
  /** Circular buffer of trailing pre-speech samples. */
  preRoll: Float32Array;
  /** Write index into `preRoll`. */
  preRollHead: number;
  /** Chunk list of the segment currently being recorded. */
  current: Float32Array[];
  /** Total audio samples in `current`, including pre-roll (drives the 15 s cap). */
  currentSamples: number;
  /** Running position in the stream (for segment timestamps). */
  totalSamples: number;
  /** True while VAD reports speech, across block boundaries. */
  speaking: boolean;
}

export function createSegmentBufferState(): SegmentBufferState {
  return {
    vad: initialVadState(),
    preRoll: new Float32Array(PRE_ROLL_SAMPLES),
    preRollHead: 0,
    current: [],
    currentSamples: 0,
    totalSamples: 0,
    speaking: false,
  };
}

/**
 * Processes one block, returning any completed segments (usually 0 or 1).
 * Pure w.r.t. the state passed in / returned out, so it is unit-testable
 * without any audio hardware.
 */
export function processBlock(
  prev: SegmentBufferState,
  block: Float32Array,
): { state: SegmentBufferState; segments: Segment[] } {
  const st: SegmentBufferState = { ...prev };
  const pending: Segment[] = [];
  let samplesProcessed = prev.totalSamples;

  // Walk the block in hop-sized frames: one VAD decision per 32 ms.
  for (const frame of iterateFrames(block, HOP_SIZE)) {
    const { state: vad, onset, offset } = stepVad(st.vad, frameRms(frame));
    st.vad = vad;
    samplesProcessed += frame.length;

    if (onset) {
      // Start with 0.4 s of pre-roll so the onset itself is never clipped.
      st.current = [st.preRoll.slice(), frame];
      st.currentSamples = PRE_ROLL_SAMPLES + frame.length;
      st.speaking = true;
      continue;
    }

    if (st.speaking) {
      st.current.push(frame);
      st.currentSamples += frame.length;

      if (offset) {
        // ~0.7 s of quiet now: close the segment. The 0.8 s minimum applies to the
        // speech portion only — pre-roll (0.4 s) and the trailing quiet frames
        // (st.vad.under == OFFSET_FRAMES exactly) are subtracted so short blips,
        // padded with silence, are still discarded rather than sent to Whisper.
        const speechSamples = st.currentSamples - PRE_ROLL_SAMPLES - st.vad.under * HOP_SIZE;
        const segment = takeSegment(st, samplesProcessed);
        if (segment && speechSamples >= MIN_SEGMENT_SAMPLES) pending.push(segment);
      } else if (st.currentSamples >= MAX_SEGMENT_SAMPLES) {
        // 15 s cap mid-speech: flush what we have; the tail continues in a new segment.
        const segment = takeSegment(st, samplesProcessed);
        if (segment) pending.push(segment);
      }
    }
    st.speaking = st.vad.speaking;
  }

  // Maintain the circular pre-roll with this block's samples.
  st.preRoll = appendToRing(st.preRoll, st.preRollHead, block);
  st.preRollHead = (st.preRollHead + block.length) % st.preRoll.length;
  st.totalSamples = Math.min(samplesProcessed, MAX_TOTAL_SAMPLES);

  return { state: st, segments: pending };
}

/** Flattens and clears the chunk list; `null` when nothing is being recorded. */
function takeSegment(st: SegmentBufferState, samplesProcessed: number): Segment | null {
  if (st.current.length === 0) return null;
  const audio = concatChunks(st.current);
  st.current = [];
  st.currentSamples = 0;
  return {
    audio,
    startedAtSample: samplesProcessed - audio.length,
    endedAtSample: samplesProcessed,
  };
}

/** Concatenates chunk arrays into one contiguous Float32Array. */
function concatChunks(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Wraps `block` around the ring buffer starting at `head`. */
function appendToRing(ring: Float32Array, head: number, block: Float32Array): Float32Array {
  const out = ring.slice();
  let position = head;
  for (let i = 0; i < block.length; i++) {
    out[position] = block[i];
    position = (position + 1) % out.length;
  }
  return out;
}

/** Yields `size`-sample frames; a final partial frame is skipped (blocks are aligned anyway). */
function* iterateFrames(block: Float32Array, size: number): Generator<Float32Array> {
  for (let i = 0; i + size <= block.length; i += size) yield block.subarray(i, i + size);
}