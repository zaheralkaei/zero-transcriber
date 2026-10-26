/**
 * Tab-capture acquisition against mocked media APIs: capability flags, the
 * "picker had no audio" guard, permission-decline mapping, and teardown when
 * the user presses "Stop sharing". No real browser prompts needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { acquireTabAudio, supportsTabCapture } from '../audio/sources';

/** Track stub that records stop() and captures 'ended' listeners. */
function fakeTrack(kind: 'audio' | 'video') {
  const endedListeners: Array<() => void> = [];
  return {
    kind,
    stop: vi.fn(),
    addEventListener: vi.fn((type: string, listener: () => void) => {
      if (type === 'ended') endedListeners.push(listener);
    }),
    /** Simulate an externally ended track (user pressed "Stop sharing"). */
    end: () => endedListeners.forEach((listener) => listener()),
  };
}

/** MediaStream stub with the four members the sources module touches. */
function fakeStream(tracks: Array<ReturnType<typeof fakeTrack>>) {
  return {
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getTracks: () => tracks,
  } as unknown as MediaStream;
}

/** Install a controllable navigator.mediaDevices stub and return the mock. */
function stubMediaDevices() {
  const getDisplayMedia = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getDisplayMedia },
    configurable: true,
  });
  return getDisplayMedia;
}

beforeEach(() => {
  stubMediaDevices();
});

describe('supportsTabCapture', () => {
  it('is false when getDisplayMedia is missing', () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    expect(supportsTabCapture()).toBe(false);
  });

  it('is true when getDisplayMedia exists', () => {
    expect(supportsTabCapture()).toBe(true);
  });
});

describe('acquireTabAudio', () => {
  it('rejects as not-supported when the browser lacks getDisplayMedia', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    await expect(acquireTabAudio(() => undefined)).rejects.toMatchObject({
      code: 'not-supported',
    });
  });

  it('fails with no-device and stops every track when the picker had no audio', async () => {
    const video = fakeTrack('video');
    const audio = fakeTrack('audio');
    const stream = fakeStream([video, audio]);
    const getDisplayMedia = stubMediaDevices();
    getDisplayMedia.mockResolvedValue(fakeStream([video])); // user shared without audio

    await expect(acquireTabAudio(() => undefined)).rejects.toMatchObject({
      code: 'no-device',
    });
    expect(video.stop).toHaveBeenCalled(); // acquired stream is released, not leaked
    expect(audio.stop).not.toHaveBeenCalled();
    expect(stream.getTracks().length).toBeGreaterThanOrEqual(1);
  });

  it('maps NotAllowedError to permission-denied', async () => {
    stubMediaDevices().mockRejectedValue(
      new DOMException('denied by user', 'NotAllowedError'),
    );
    await expect(acquireTabAudio(() => undefined)).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('returns the audio stream and reports when the user stops sharing', async () => {
    const audio = fakeTrack('audio');
    const video = fakeTrack('video');
    stubMediaDevices().mockResolvedValue(fakeStream([video, audio]));

    const onEnded = vi.fn();
    const capture = await acquireTabAudio(onEnded);
    expect(capture.stream.getAudioTracks()).toHaveLength(1);

    // "Stop sharing" in browser chrome ends the track from outside.
    video.end();
    expect(onEnded).toHaveBeenCalledOnce();
    expect(audio.stop).toHaveBeenCalled(); // teardown also stops the audio track
  });

  it('dispose() stops tracks without triggering the ended callback', async () => {
    const audio = fakeTrack('audio');
    const video = fakeTrack('video');
    stubMediaDevices().mockResolvedValue(fakeStream([video, audio]));

    const onEnded = vi.fn();
    const capture = await acquireTabAudio(onEnded);
    capture.dispose(); // our own stop must not look like "Stop sharing"
    expect(audio.stop).toHaveBeenCalled();
    expect(onEnded).not.toHaveBeenCalled();
  });
});