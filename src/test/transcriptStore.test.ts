import { describe, it, expect } from 'vitest';
import {
  transcriptReducer,
  emptyTranscript,
  canUndo,
  canRedo,
} from '../core/transcriptStore';

/** Reducer-friendly start state. */
const start = emptyTranscript;

describe('transcriptStore', () => {
  it('starts empty with no history', () => {
    const state = start();
    expect(state.segments).toHaveLength(0);
    expect(canUndo(state)).toBe(false);
    expect(canRedo(state)).toBe(false);
  });

  it('adds finalized segments in order', () => {
    let state = transcriptReducer(start(), { kind: 'segment', id: 1, text: 'Hello' });
    state = transcriptReducer(state, { kind: 'segment', id: 2, text: 'World' });
    expect(state.segments.map((s) => s.text)).toEqual(['Hello', 'World']);
    // Each append is one undo step.
    expect(canUndo(state)).toBe(true);
  });

  it('edits update only the targeted segment', () => {
    let state = transcriptReducer(start(), { kind: 'segment', id: 1, text: 'Hello' });
    state = transcriptReducer(state, { kind: 'segment', id: 2, text: 'World' });
    state = transcriptReducer(state, { kind: 'edit', id: 2, text: 'WORLD!', at: Date.now() });
    expect(state.segments.map((s) => s.text)).toEqual(['Hello', 'WORLD!']);
  });

  it('one burst of typing to the same segment costs one undo step', () => {
    const now = Date.now();
    let state = transcriptReducer(start(), { kind: 'segment', id: 1, text: 'A' });
    state = transcriptReducer(state, { kind: 'edit', id: 1, text: 'AB', at: now });
    state = transcriptReducer(state, { kind: 'edit', id: 1, text: 'ABC', at: now + 100 });
    state = transcriptReducer(state, { kind: 'edit', id: 1, text: 'ABCD', at: now + 200 });
    // Snapshot #1: the append; #2: the whole burst (first edit opens it, the rest join).
    expect(state.past.length).toBe(2);
    // One undo lands exactly on the pre-edit text, not an intermediate keystroke.
    state = transcriptReducer(state, { kind: 'undo' });
    expect(state.segments[0].text).toBe('A');
  });

  it('splits undo steps for edits to different segments', () => {
    const now = Date.now();
    let state = transcriptReducer(start(), { kind: 'segment', id: 1, text: 'A' });
    state = transcriptReducer(state, { kind: 'edit', id: 1, text: 'A!', at: now });
    state = transcriptReducer(state, { kind: 'edit', id: 1, text: 'A!!', at: now + 10 * 1000 }); // outside window
    expect(state.past.length).toBeGreaterThan(1);
  });

  it('undoes and redos an edit round-trip', () => {
    let state = transcriptReducer(start(), { kind: 'segment', id: 1, text: 'Hi' });
    state = transcriptReducer(state, { kind: 'edit', id: 1, text: 'Hi there', at: Date.now() });
    state = transcriptReducer(state, { kind: 'undo' });
    expect(state.segments[0].text).toBe('Hi');
    state = transcriptReducer(state, { kind: 'redo' });
    expect(state.segments[0].text).toBe('Hi there');
  });

  it('clearing is undoable and restores the full previous transcript', () => {
    let state = transcriptReducer(start(), { kind: 'segment', id: 1, text: 'A' });
    state = transcriptReducer(state, { kind: 'segment', id: 2, text: 'B' });
    state = transcriptReducer(state, { kind: 'clear' });
    expect(state.segments).toHaveLength(0);
    state = transcriptReducer(state, { kind: 'undo' });
    expect(state.segments.map((s) => s.text)).toEqual(['A', 'B']);
  });

  it('clear on an empty transcript is a no-op', () => {
    const state = transcriptReducer(start(), { kind: 'clear' });
    expect(canUndo(state)).toBe(false);
  });

  it('a new transcription invalidates the redo branch', () => {
    let state = transcriptReducer(start(), { kind: 'segment', id: 1, text: 'A' });
    state = transcriptReducer(state, { kind: 'edit', id: 1, text: 'A!', at: Date.now() });
    state = transcriptReducer(state, { kind: 'undo' });
    expect(canRedo(state)).toBe(true);
    state = transcriptReducer(state, { kind: 'segment', id: 2, text: 'B' });
    expect(canRedo(state)).toBe(false);
  });

  it('undo/redo on empty history are no-ops', () => {
    let state = transcriptReducer(start(), { kind: 'undo' });
    state = transcriptReducer(state, { kind: 'redo' });
    expect(state.segments).toHaveLength(0);
  });
});