/**
 * Pure voice-activity state machine — energy-based with an adaptive noise floor.
 * Chosen over Silero VAD for v1: good enough on speech/silence and adds no model
 * download. All timing below assumes 512-sample / 32 ms frames at 16 kHz.
 */

/** Never treat audio louder than this as silence, even in a quiet room. */
export const MIN_RMS_THRESHOLD = 0.004;

/** EMA decay for the noise floor: slow enough to ignore brief loud spikes. */
export const NOISE_FLOOR_ALPHA = 0.995;

/** Consecutive loud frames before speech "starts" (~96–128 ms). */
export const ONSET_FRAMES = 3;

/** Consecutive quiet frames before speech "ends" (~0.7 s). */
export const OFFSET_FRAMES = 22;

export interface VadState {
  /** Running estimate of background level (RMS) — updated only while quiet. */
  noiseFloor: number;
  /** Consecutive frames above / below threshold. */
  over: number;
  under: number;
  speaking: boolean;
}

export interface VadStep {
  /** Updated state — pass it back into the next `stepVad` call. */
  state: VadState;
  /** True exactly once, on the frame speech is detected as starting. */
  onset: boolean;
  /** True exactly once, on the frame speech is detected as ending. */
  offset: boolean;
}

/** Threshold adapts to the room: 2.5× the quiet floor, with a sane absolute minimum. */
export function speechThreshold(state: VadState): number {
  return Math.max(MIN_RMS_THRESHOLD, 2.5 * state.noiseFloor);
}

export function initialVadState(): VadState {
  return { noiseFloor: 0.004, over: 0, under: 0, speaking: false };
}

/** One hop frame in, one decision out. No mutation, no I/O — trivially testable. */
export function stepVad(prev: VadState, frameRms: number): VadStep {
  const rms = Number.isFinite(frameRms) ? frameRms : 0;
  const threshold = speechThreshold(prev);

  if (rms >= threshold) {
    const over = prev.over + 1;
    const start = !prev.speaking && over >= ONSET_FRAMES;
    return {
      state: { noiseFloor: prev.noiseFloor, over, under: 0, speaking: prev.speaking || start },
      onset: start,
      offset: false,
    };
  }

  // Quiet frame: track the floor only while not in speech, so speech never
  // drags the threshold up (and then swallows its own tail).
  const noiseFloor = prev.speaking
    ? prev.noiseFloor
    : NOISE_FLOOR_ALPHA * prev.noiseFloor + (1 - NOISE_FLOOR_ALPHA) * rms;
  const under = prev.under + 1;
  const end = prev.speaking && under >= OFFSET_FRAMES;
  return {
    state: { noiseFloor, over: 0, under, speaking: prev.speaking && !end },
    onset: false,
    offset: end,
  };
}

/** Root-mean-square of a frame — the energy metric the whole VAD runs on. */
export function frameRms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}