/**
 * Turns a continuous stream of PCM blocks into speech segments using the VAD.
 * A small pre-roll guards the start of a word. Segments close on a real pause,
 * and during continuous speech a segment is flushed every ~4 s — preferring an
 * energy dip between words as the cut point (never a mid-word cut while a dip
 * is nearby), with a short hard cut as the last resort so the model never
 * falls behind live speech.
 */

import { MIN_RMS_THRESHOLD, initialVadState, stepVad, frameRms, type VadState } from './vad';

export const SAMPLE_RATE = 16_000;
/** 512 samples = 32 ms analysis hop; PCM blocks arrive in multiples of this. */
export const HOP_SIZE = 512;
/** 0.4 s kept before onset — enough to not clip the attack of the first word. */
export const PRE_ROLL_SAMPLES = 6400;
/** Fresh segments (with pre-roll) shorter than this are discarded — blips. */
export const MIN_SEGMENT_SAMPLES = 12_800; // 0.8 s
/** Continuations (cut mid-utterance) only need real speech, not a full blip guard. */
export const MIN_CONTINUATION_SAMPLES = HOP_SIZE * 2;
/** Cadence for continuous speech: cut at ~4 s, at the newest energy dip. */
export const TARGET_SEGMENT_SAMPLES = 64_000; // 4 s
/** Extra patience for a dip past the target before the hard cut. */
export const FLUSH_GRACE_SAMPLES = 12_000; // 0.75 s
/** A dip is a frame well below the segment's peak (floor guards quiet speech). */
export const DIP_FACTOR = 0.35;
/** Absolute cap for any buffer handed to the model (30 s window head-room). */
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
  /** Speech samples in the current segment, EXCLUDING pre-roll (drives the ~4 s cadence). */
  speechSamples: number;
  /** True while the current segment began with pre-roll (a fresh onset). */
  preRollIncluded: boolean;
  /** Loudest frame RMS in the current segment (drives the dip threshold). */
  peakRms: number;
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
    speechSamples: 0,
    preRollIncluded: false,
    peakRms: 0,
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
    const rms = frameRms(frame);
    const { state: vad, onset, offset } = stepVad(st.vad, rms);
    st.vad = vad;
    samplesProcessed += frame.length;

    if (onset) {
      // Fresh segment: pre-roll so the attack of the first word is never clipped.
      st.current = [st.preRoll.slice(), frame];
      st.currentSamples = PRE_ROLL_SAMPLES + frame.length;
      st.speechSamples = frame.length;
      st.preRollIncluded = true;
      st.peakRms = rms;
      st.speaking = true;
      continue;
    }

    if (st.speaking) {
      st.current.push(frame);
      st.currentSamples += frame.length;
      st.speechSamples += frame.length;
      st.peakRms = Math.max(st.peakRms, rms);

      if (offset) {
        // ~0.7 s of quiet closes the segment. The speech amount measured here
        // excludes the trailing quiet frames; fresh segments also exclude the
        // pre-roll. Fresh blips below the 0.8 s guard are discarded;
        // continuations (no pre-roll) keep any real speech so a word cut at
        // the old boundary is never lost.
        const speech = st.speechSamples - st.vad.under * HOP_SIZE;
        const segment = takeSegment(st, samplesProcessed);
        const min = st.preRollIncluded ? MIN_SEGMENT_SAMPLES : MIN_CONTINUATION_SAMPLES;
        if (segment && speech >= min) pending.push(segment);
        if (segment) markContinuationEnded(st);
      } else if (st.speechSamples >= TARGET_SEGMENT_SAMPLES + FLUSH_GRACE_SAMPLES) {
        // Continuous speech past target + grace with no dip anywhere: hard cut.
        const segment = takeSegment(st, samplesProcessed);
        if (segment) pending.push(segment);
        markContinuationEnded(st);
      } else if (
        st.speechSamples >= TARGET_SEGMENT_SAMPLES &&
        rms < Math.max(MIN_RMS_THRESHOLD, DIP_FACTOR * st.peakRms)
      ) {
        // Preferred cut: a dip between words, right at/past the 4 s target.
        const segment = takeSegment(st, samplesProcessed);
        if (segment) pending.push(segment);
        markContinuationEnded(st);
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

/** After a mid-speech cut, the tail continues as a fresh (pre-roll-less) segment. */
function markContinuationEnded(st: SegmentBufferState): void {
  st.speechSamples = 0;
  st.preRollIncluded = false; // keep any speech that arrives before the next onset
  st.peakRms = 0;
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