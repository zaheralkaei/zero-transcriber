import { describe, it, expect } from 'vitest';
import {
  createSegmentBufferState,
  processBlock,
  PRE_ROLL_SAMPLES,
  MIN_SEGMENT_SAMPLES,
  TARGET_SEGMENT_SAMPLES,
  FLUSH_GRACE_SAMPLES,
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

  it('flushes mid-speech and keeps recording the tail', () => {
    const { segments, state } = runStream(chunkBlocks(speech(seconds(17))));

    expect(segments.length).toBeGreaterThanOrEqual(1);
    // Segments are cut at target..target+grace (no dips in a pure tone stream).
    for (const segment of segments) {
      expect(segment.audio.length).toBeGreaterThanOrEqual(MIN_SEGMENT_SAMPLES);
      expect(segment.audio.length).toBeLessThanOrEqual(TARGET_SEGMENT_SAMPLES + FLUSH_GRACE_SAMPLES + PRE_ROLL_SAMPLES + 512);
    }
    expect(state.speaking).toBe(true); // tail is still being recorded
  });

  it('cuts continuous speech at a between-word dip, not mid-word', () => {
    // 10 s of speech with a deliberate 0.1 s quiet gap starting at 4.2 s —
    // the first cut must land inside that gap, not at target+grace.
    const gapAt = seconds(4.2);
    const stream = join(speech(gapAt), silence(seconds(0.1)), speech(seconds(5.7)));
    const { segments } = runStream(chunkBlocks(stream));

    expect(segments.length).toBeGreaterThanOrEqual(2);
    // Continuations are contiguous: each segment picks up where the previous
    // one ended (no re-buffered pre-roll gap, no lost samples).
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].startedAtSample).toBe(segments[i - 1].endedAtSample);
    }
    // First cut happened before target+grace could force it (dip was found).
    expect(segments[0].endedAtSample).toBeLessThan(seconds(4.75));
    // The dip-cut segment ends with a quiet frame (the gap between words).
    const tail = segments[0].audio.subarray(segments[0].audio.length - 512);
    let tailPeak = 0;
    for (let i = 0; i < tail.length; i += 64) tailPeak = Math.max(tailPeak, Math.abs(tail[i]));
    expect(tailPeak).toBeLessThan(0.02);
  });

  it('keeps a short continuation instead of losing the words before a pause', () => {
    // Speech cut by the cadence dip, then the utterance ends shortly after.
    const stream = join(speech(seconds(4.3)), silence(seconds(0.5)), speech(seconds(0.6)), silence(seconds(2)));
    const { segments } = runStream(chunkBlocks(stream));
    // The cut happens inside the 0.5 s gap (~4.3 s); the continuation segment
    // holds ~0.6 s of real speech + the 0.7 s closing quiet. The fresh-blip
    // guard must NOT discard it — those are real words.
    expect(segments).toHaveLength(2);
    expect(segments[1].startedAtSample).toBe(segments[0].endedAtSample);
    expect(segments[1].audio.length).toBeGreaterThanOrEqual(seconds(1.0));
    expect(segments[1].audio.length).toBeLessThanOrEqual(seconds(1.8));
  });

  it('reports sensible stream timestamps', () => {
    const { segments, state } = runStream(chunkBlocks(join(speech(seconds(3)), silence(seconds(2)))));
    const seg = segments[0];
    expect(seg.endedAtSample).toBeLessThanOrEqual(state.totalSamples);
    expect(seg.startedAtSample).toBeLessThan(seg.endedAtSample);
    expect(seg.endedAtSample - seg.startedAtSample).toBe(seg.audio.length);
  });
});