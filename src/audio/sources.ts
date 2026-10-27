/**
 * Audio source acquisition: microphone and shared-tab audio via
 * getDisplayMedia. Centralizing capability flags here keeps the
 * browser-compat UI (hints, disabled buttons) driven by one source of truth.
 */

/** Typed reason a source could not be acquired, for user-facing messaging. */
export type SourceErrorCode = 'not-supported' | 'permission-denied' | 'no-device' | 'unknown';
export class SourceError extends Error {
  code: SourceErrorCode;
  constructor(code: SourceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Acquire the microphone at a sensible quality level for speech. */
export async function acquireMicrophone(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new SourceError('not-supported', 'This browser does not support audio capture.');
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (cause) {
    throw classifyError(cause);
  }
}

/** Map DOMException names to our stable error codes for the UI. */
function classifyError(cause: unknown): SourceError {
  const name = cause instanceof DOMException ? cause.name : '';
  switch (name) {
    case 'NotAllowedError':
      return new SourceError('permission-denied', 'Audio access was denied.');
    case 'AbortError':
      // Dismissing/closing the permission prompt surfaces as AbortError.
      return new SourceError('permission-denied', 'Audio access was cancelled — accept the browser prompt to start.');
    case 'NotFoundError':
      return new SourceError('no-device', 'No audio device was found.');
    case 'NotReadableError':
      return new SourceError('no-device', 'An audio device is busy in another app.');
    default:
      // Carry the browser's own text into the UI — the generic fallback alone
      // hides the actual cause (device sample-rate limits, iframe policies…).
      const detail = cause instanceof Error ? cause.message : String(cause);
      return new SourceError('unknown', `Could not start audio capture: ${detail}`);
  }
}

/**
 * Tab / call capture: the only browser-supported way to hear "the other side
 * of an online call" locally is screen-sharing a tab (or screen) with audio.
 * Chrome requires asking for video alongside audio — audio-only tab capture
 * is not offered in the picker, and Firefox/Safari do not support tab audio
 * at all, so callers gate the feature with `supportsTabCapture()`.
 */
export function supportsTabCapture(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

/** Result of a successful tab capture — `dispose` also stops the tracks. */
export interface TabCapture {
  stream: MediaStream;
  dispose(): void;
}

/** Acquire tab/system audio; `onEnded` fires when the user stops sharing. */
export async function acquireTabAudio(onEnded: () => void): Promise<TabCapture> {
  if (!supportsTabCapture()) {
    throw new SourceError('not-supported', 'Tab capture is only available in Chrome/Edge.');
  }
  try {
    // Video is required — Chrome offers audio sharing only when video is requested.
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((track) => track.stop());
      throw new SourceError(
        'no-device',
        'That tab/screen has no audio — pick "a tab" and enable "Share tab audio".',
      );
    }

    const keeper = keepVideoTrackAlive(stream);
    const handleEnded = () => {
      stream.getTracks().forEach((track) => track.stop());
      keeper(); // release the drawn canvas loop
      onEnded(); // capture ended out-of-band (user pressed "Stop sharing")
    };
    for (const track of stream.getTracks()) track.addEventListener('ended', handleEnded, { once: true });

    return {
      stream,
      dispose() {
        keeper();
        stream.getTracks().forEach((track) => track.stop());
      },
    };
  } catch (cause) {
    if (cause instanceof SourceError) throw cause;
    throw classifyError(cause);
  }
}

/**
 * Chrome pauses (and can end) audio capture if the video track of the shared
 * surface is never consumed. Drawing frames to a hidden 2×2 canvas keeps the
 * pipeline alive at negligible cost. Returns its own disposer.
 */
function keepVideoTrackAlive(stream: MediaStream): () => void {
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) return () => undefined;

  const video = document.createElement('video');
  video.muted = true;
  video.srcObject = stream;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2;
  const context = canvas.getContext('2d');
  let drawing = true;
  const timer = window.setInterval(() => {
    if (!drawing) return;
    if (video.readyState >= 2 && context) context.drawImage(video, 0, 0, 2, 2);
  }, 250);
  // Muted → autoplay-safe; play() is not a real Promise in every environment.
  try {
    const ready = video.play() as unknown as Promise<void> | undefined;
    if (ready) ready.then(() => undefined, () => undefined);
  } catch {
    // Non-fatal: drawing still keeps the video track alive.
  }

  return () => {
    drawing = false;
    window.clearInterval(timer);
    video.srcObject = null;
  };
}