/**
 * Capture lifecycle: acquire a stream (microphone or shared-tab audio), run it
 * through the AudioEngine, feed PCM blocks into the pure SegmentBuffer, and
 * surface completed segments + metering to the caller. Mic and tab never mix —
 * starting the other source starts a fresh session.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine, type AudioHandlers } from '../audio/AudioEngine';
import {
  acquireMicrophone,
  acquireTabAudio,
  SourceError,
  type TabCapture,
} from '../audio/sources';
import {
  createSegmentBufferState,
  processBlock,
  type SegmentBufferState,
} from '../core/SegmentBuffer';

export type AudioSource = 'mic' | 'tab';

export interface AudioCaptureHandlers {
  onSegment(audio: Float32Array): void;
  onMeter(rms: number): void;
}

export function useAudioCapture(handlers: AudioCaptureHandlers) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const engineRef = useRef<AudioEngine | null>(null);
  const bufferRef = useRef<SegmentBufferState>(createSegmentBufferState());
  const streamRef = useRef<MediaStream | null>(null);
  const tabCaptureRef = useRef<TabCapture | null>(null);
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const audioHandlers = useCallback(
    (): AudioHandlers => ({
      onMeter: (rms) => handlersRef.current.onMeter(rms),
      onBlock: (pcm) => {
        const result = processBlock(bufferRef.current, pcm);
        bufferRef.current = result.state;
        result.segments.forEach((segment) => handlersRef.current.onSegment(segment.audio));
      },
    }),
    [],
  );

  const stop = useCallback(async (): Promise<void> => {
    await engineRef.current?.stop();
    engineRef.current = null;
    tabCaptureRef.current?.dispose(); // no-op for mic streams
    tabCaptureRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setActive(false);
  }, []);

  /** Starts capturing the given source (after the browser prompt). */
  const start = useCallback(
    async (source: AudioSource): Promise<boolean> => {
      try {
        let stream: MediaStream;
        if (source === 'tab') {
          // "Stop sharing" in the browser chrome fires onEnded → full teardown.
          const capture = await acquireTabAudio(() => {
            void stop();
          });
          tabCaptureRef.current = capture;
          stream = capture.stream;
        } else {
          stream = await acquireMicrophone();
        }
        streamRef.current = stream;
        engineRef.current = engineRef.current ?? new AudioEngine();
        bufferRef.current = createSegmentBufferState(); // fresh session
        await engineRef.current.start(stream, audioHandlers());
        setError(null);
        setActive(true);
        return true;
      } catch (cause) {
        const message = cause instanceof SourceError ? cause.message : 'Could not start capture.';
        setError(message);
        setActive(false);
        return false;
      }
    },
    [audioHandlers, stop],
  );

  // Stop on unmount so the browser capture indicator always goes dark.
  useEffect(() => {
    return () => {
      void engineRef.current?.stop();
      tabCaptureRef.current?.dispose();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return { active, error, start, stop };
}