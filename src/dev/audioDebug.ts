/**
 * Manual checkpoint harness (Phases 2–3): `npm run dev` then open
 * `/?debug=audio` to watch live metering and emission of speech segments in
 * the console. Removed once the real UI hooks exist (Phase 4).
 */

import { acquireMicrophone, SourceError } from '../audio/sources';
import { AudioEngine } from '../audio/AudioEngine';
import {
  createSegmentBufferState,
  processBlock,
  SAMPLE_RATE,
  type Segment,
} from '../core/SegmentBuffer';

const log = (...parts: unknown[]) => console.log('[audio-debug]', ...parts);
const seconds = (samples: number) => `${(samples / SAMPLE_RATE).toFixed(2)}s`;

function logSegment(segment: Segment): void {
  log(
    `segment ${seconds(segment.audio.length)} ` +
      `[${segment.startedAtSample} → ${segment.endedAtSample}]`,
  );
}

export function startAudioDebug(): void {
  const engine = new AudioEngine();
  let state = createSegmentBufferState();

  acquireMicrophone()
    .then(async (stream) => {
      await engine.start(stream, {
        onMeter: (rms) => log('meter', rms.toFixed(4)),
        onBlock: (pcm) => {
          const result = processBlock(state, pcm);
          state = result.state;
          result.segments.forEach(logSegment);
        },
      });
      log('listening — stop via the browser tab or the stop button');
    })
    .catch((error: SourceError) => log('capture failed:', error.code, error.message));
}