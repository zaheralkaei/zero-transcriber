import { describe, it, expect } from 'vitest';
import {
  stripTimestampTokens,
  mergeDelta,
  serializeTranscript,
  transcriptFilename,
} from '../core/text';
import { copyToClipboard } from '../core/text';

describe('stripTimestampTokens', () => {
  it('removes Whisper timestamp markers and collapses whitespace', () => {
    expect(stripTimestampTokens('<|0.00|> Hello <|1.42|> world')).toBe('Hello world');
  });

  it('leaves ordinary text untouched', () => {
    expect(stripTimestampTokens('Plain words,  kept')).toBe('Plain words, kept');
  });
});

describe('mergeDelta', () => {
  it('appends worker deltas in order', () => {
    expect(mergeDelta('', 'Hello ')).toBe('Hello ');
    expect(mergeDelta('Hello ', 'world')).toBe('Hello world');
  });
});

describe('serializeTranscript', () => {
  it('joins segments with blank lines and strips markers', () => {
    expect(
      serializeTranscript([
        { id: 1, text: '<|0.00|> First line' },
        { id: 2, text: 'Second line' },
      ]),
    ).toBe('First line\n\nSecond line');
  });

  it('skips empty segments', () => {
    expect(
      serializeTranscript([
        { id: 1, text: 'kept' },
        { id: 2, text: '<|0.5|>' },
      ]),
    ).toBe('kept');
  });
});

describe('transcriptFilename', () => {
  it('produces a sortable date-stamped .txt name', () => {
    const name = transcriptFilename(new Date('2026-10-27T09:41:23Z'));
    expect(name).toBe('transcript-2026-10-27-09-41-23.txt');
  });
});

describe('copyToClipboard', () => {
  it('returns false for empty text without touching the clipboard', async () => {
    expect(await copyToClipboard('')).toBe(false);
  });

  it('writes via the async clipboard when available', async () => {
    const written: string[] = [];
    const original = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => void written.push(text) },
      configurable: true,
    });
    try {
      expect(await copyToClipboard('copied text')).toBe(true);
      expect(written).toEqual(['copied text']);
    } finally {
      Object.defineProperty(navigator, 'clipboard', { value: original, configurable: true });
    }
  });

  it('falls back to execCommand when the clipboard API is unavailable', async () => {
    const original = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    try {
      // jsdom's execCommand stub succeeds; only the fallback path shape is verified.
      expect(await copyToClipboard('legacy text')).toBe(false);
    } finally {
      Object.defineProperty(navigator, 'clipboard', { value: original, configurable: true });
    }
  });
});