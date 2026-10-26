import { describe, it, expect } from 'vitest';
import {
  initialVadState,
  stepVad,
  frameRms,
  speechThreshold,
  ONSET_FRAMES,
  OFFSET_FRAMES,
} from '../core/vad';
import { silence, speech } from './segmentStreams';

const HOP = 512;
const loud = () => speech(HOP, 3, 220);
const quiet = () => silence(HOP, 4);

describe('frameRms', () => {
  it('separates background noise from speech by two orders of magnitude', () => {
    expect(frameRms(quiet())).toBeLessThan(0.002);
    expect(frameRms(loud())).toBeGreaterThan(0.05);
  });
});

describe('speechThreshold', () => {
  it('never drops below the absolute minimum', () => {
    const veryQuietRoom = { noiseFloor: 0.0001, over: 0, under: 0, speaking: false };
    expect(speechThreshold(veryQuietRoom)).toBeGreaterThan(0.0005); // MIN wins
  });

  it('adapts to a loud room', () => {
    const noisyRoom = { noiseFloor: 0.01, over: 0, under: 0, speaking: false };
    expect(speechThreshold(noisyRoom)).toBeCloseTo(0.025);
  });
});

describe('stepVad', () => {
  it('fires onset exactly once, after N consecutive loud frames', () => {
    let state = initialVadState();
    let onset = false;
    for (let i = 0; i < ONSET_FRAMES - 1; i++) ({ state, onset } = stepVad(state, 0.05));
    expect(onset).toBe(false);
    ({ state, onset } = stepVad(state, 0.05));
    expect(onset).toBe(true);
    expect(state.speaking).toBe(true);

    // More loud frames must NOT re-fire onset while already speaking.
    ({ state, onset } = stepVad(state, 0.05));
    expect(onset).toBe(false);
  });

  it('needs quiet for OFFSET_FRAMES before closing a segment', () => {
    let state = { ...initialVadState(), speaking: true, over: 0, under: 0 };
    let offset = false;
    for (let i = 0; i < OFFSET_FRAMES - 1; i++) ({ state, offset } = stepVad(state, 0.0001));
    expect(offset).toBe(false);
    expect(state.speaking).toBe(true);

    ({ state, offset } = stepVad(state, 0.0001));
    expect(offset).toBe(true);
    expect(state.speaking).toBe(false);
  });

  it('never lets speech raise the noise floor', () => {
    let state = { noiseFloor: 0.004, over: 0, under: 0, speaking: true };
    const before = state.noiseFloor;
    for (let i = 0; i < 50; i++) state = stepVad(state, 0.2).state;
    expect(state.noiseFloor).toBe(before);
  });

  it('pulls the noise floor down toward silence during quiet frames', () => {
    let state = { noiseFloor: 0.01, over: 0, under: 0, speaking: false };
    for (let i = 0; i < 200; i++) state = stepVad(state, 0.0008).state;
    expect(state.noiseFloor).toBeLessThan(0.005);
  });
});