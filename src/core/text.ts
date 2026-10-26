/**
 * Text-level helpers: cleaning model output, joining deltas, serializing the
 * transcript for copy/download. Pure functions only.
 */

import type { TranscriptSegment } from './transcriptStore';

/**
 * Whispers sometimes emits timestamp tokens (`<|0.36|>`) or other markers in
 * streamed text; strip them and collapse the whitespace they leave behind.
 */
export function stripTimestampTokens(text: string): string {
  return text
    .replace(/<\|[^|]*\|>/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Appends worker deltas to the live text being decoded right now. */
export function mergeDelta(running: string, delta: string): string {
  return running + delta;
}

/** Full transcript as one string, one paragraph per segment. */
export function serializeTranscript(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) => stripTimestampTokens(segment.text))
    .filter((text) => text.length > 0)
    .join('\n\n');
}

/** Filename for the download button: local date, so sessions sort naturally. */
export function transcriptFilename(at: Date = new Date()): string {
  const stamp = at.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `transcript-${stamp}.txt`;
}

/** Best-effort clipboard write with a legacy fallback for non-secure contexts. */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.style.position = 'fixed';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);
    scratch.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    scratch.remove();
    return ok;
  }
}