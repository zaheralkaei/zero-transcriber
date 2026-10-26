import { describe, it, expect } from 'vitest';
import {
  createSegmentBufferState,
  processBlock,
  PRE_ROLL_SAMPLES,
  MIN_SEGMENT_SAMPLES,
  MAX_SEGMENT_SAMPLES,
  type SegmentBufferState,
} from '../core/SegmentBuffer';
import { silence, speech, seconds, chunkBlocks, join } from './segmentStreams';
import type { Segment } from '../core/SegmentBuffer';

/** Feeds blocks through the segmenter, returning all segments emitted. */
function runStream(blocks: Float32Array[]): { segments: Segment[]; state: SegmentBufferState } {
  const segments: Segment[] = [];
  let state = createSegmentBufferState();
  for (const block of blocks) {
    const result = processBlock(state, block);
    state = result.state;
    segments.push(...result.segments);
  }
  return { segments, state };
}

describe('SegmentBuffer', () => {
  it('emits nothing while the room is quiet', () => {
    const { segments } = runStream(chunkBlocks(silence(seconds(5))));
    expect(segments).toHaveLength(0);
  });

  it('emits one segment for speak-then-pause, with pre-roll intact', () => {
    const { segments, state } = runStream(chunkBlocks(join(speech(seconds(3)), silence(seconds(2)))));
    expect(segments).toHaveLength(1);

    const audio = segments[0].audio;
    // 3 s speech + 0.4 s pre-roll + ~0.7 s trailing quiet, ±1 block tolerance.
    expect(audio.length).toBeGreaterThanOrEqual(seconds(3.6));
    expect(audio.length).toBeLessThanOrEqual(seconds(4.4));

    // Everything before the pre-roll tail must be near-silence (no clipped word).
    const preSpeech = audio.subarray(0, PRE_ROLL_SAMPLES - 2 * 512);
    let peak = 0;
    for (let i = 0; i < preSpeech.length; i++) peak = Math.max(peak, Math.abs(preSpeech[i]));
    expect(peak).toBeLessThan(0.006);
    expect(state.speaking).toBe(false);
  });

  it('discards short blips below the minimum segment length', () => {
    const { segments } = runStream(chunkBlocks(join(speech(seconds(0.4)), silence(seconds(1.5)))));
    expect(segments).toHaveLength(0);
  });

  it('flushes at the 15 s cap mid-speech and keeps recording the tail', () => {
    const { segments, state } = runStream(chunkBlocks(speech(seconds(17))));

    expect(segments.length).toBeGreaterThanOrEqual(1);
    // Flushed chunks are (just) longer than the cap: the cap triggers after they land.
    expect(segments[0].audio.length).toBeGreaterThanOrEqual(MIN_SEGMENT_SAMPLES);
    expect(segments[0].audio.length).toBeLessThanOrEqual(MAX_SEGMENT_SAMPLES + 512);
    expect(state.speaking).toBe(true); // tail is still being recorded
  });

  it('reports sensible stream timestamps', () => {
    const { segments, state } = runStream(chunkBlocks(join(speech(seconds(3)), silence(seconds(2)))));
    const seg = segments[0];
    expect(seg.endedAtSample).toBeLessThanOrEqual(state.totalSamples);
    expect(seg.startedAtSample).toBeLessThan(seg.endedAtSample);
    expect(seg.endedAtSample - seg.startedAtSample).toBe(seg.audio.length);
  });
});