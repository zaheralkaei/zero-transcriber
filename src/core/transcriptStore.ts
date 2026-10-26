/**
 * Pure transcript model with undo/redo. Segments arrive one at a time from
 * the worker; the user may freely edit each segment's text. Consecutive
 * typing edits to the same segment collapse into one undo step so Ctrl+Z
 * feels word-level rather than keystroke-level.
 */

export interface TranscriptSegment {
  /** Stable id — one per emitted audio segment, in capture order. */
  id: number;
  text: string;
}

export interface TranscriptState {
  segments: TranscriptSegment[];
  past: TranscriptSegment[][];
  future: TranscriptSegment[][];
  /** Bookkeeping for edit-grouping: last edit's segmentId + time. */
  lastEdit?: { id: number; at: number };
}

/** Consecutive edits to the same segment within this window become one undo step. */
const EDIT_GROUP_MS = 800;
const HISTORY_LIMIT = 200; // cap memory across long sessions

export type TranscriptAction =
  | { kind: 'segment'; id: number; text: string }
  | { kind: 'edit'; id: number; text: string; at: number }
  | { kind: 'clear' }
  | { kind: 'undo' }
  | { kind: 'redo' };

export const emptyTranscript = (): TranscriptState => ({
  segments: [],
  past: [],
  future: [],
});

/** Snapshot push helper — bounded, clears the redo branch. */
function pushHistory(state: TranscriptState): TranscriptState {
  return {
    ...state,
    past: [...state.past, state.segments].slice(-HISTORY_LIMIT),
    future: [],
    lastEdit: undefined,
  };
}

export function transcriptReducer(state: TranscriptState, action: TranscriptAction): TranscriptState {
  switch (action.kind) {
    case 'segment':
      return {
        ...pushHistory(state),
        segments: [...state.segments, { id: action.id, text: action.text }],
      };
    case 'edit': {
      const coalesce =
        state.lastEdit !== undefined &&
        state.lastEdit.id === action.id &&
        action.at - state.lastEdit.at < EDIT_GROUP_MS;
      const base = coalesce ? state : pushHistory(state);
      return {
        ...base,
        lastEdit: { id: action.id, at: action.at },
        segments: base.segments.map((segment) =>
          segment.id === action.id ? { ...segment, text: action.text } : segment,
        ),
      };
    }
    case 'clear':
      if (state.segments.length === 0) return state;
      return { ...pushHistory(state), segments: [] };
    case 'undo': {
      if (state.past.length === 0) return state;
      const past = [...state.past];
      const target = past.pop()!;
      return {
        ...state,
        lastEdit: undefined,
        segments: target,
        past,
        future: [state.segments, ...state.future].slice(0, HISTORY_LIMIT),
      };
    }
    case 'redo': {
      if (state.future.length === 0) return state;
      const [target, ...future] = state.future;
      return {
        ...state,
        lastEdit: undefined,
        segments: target,
        past: [...state.past, state.segments].slice(-HISTORY_LIMIT),
        future,
      };
    }
  }
}

/** Convenience selectors used by the hook and tests. */
export const canUndo = (state: TranscriptState): boolean => state.past.length > 0;
export const canRedo = (state: TranscriptState): boolean => state.future.length > 0;