/**
 * Transcript state for the app: finalized segments (undoable, editable) plus
 * the "live" partial text currently decoding. Partials stay outside the undo
 * history — only committed segment text is undoable, which keeps Ctrl+Z
 * meaningful while audio streams in.
 */

import { useCallback, useReducer, useState, type Dispatch, type SetStateAction } from 'react';
import {
  transcriptReducer,
  emptyTranscript,
  canUndo,
  canRedo,
  type TranscriptState,
} from '../core/transcriptStore';
import { mergeDelta, stripTimestampTokens } from '../core/text';

/** Text currently being streamed for one segment request. */
export interface LiveSegment {
  id: number;
  text: string;
}

const useLiveSegment = (): [LiveSegment | null, Dispatch<SetStateAction<LiveSegment | null>>] =>
  useState<LiveSegment | null>(null);

export function useTranscript() {
  const [state, dispatch] = useReducer(transcriptReducer, undefined, emptyTranscript);
  const [live, setLive] = useLiveSegment();

  // Deltas are id-aware: a new request's first delta replaces, later ones append,
  // so burst-delivered messages can never mix segments or lose text.
  const pushPartial = useCallback(
    (requestId: number, delta: string) => {
      setLive((previous) => {
        const running = previous && previous.id === requestId ? previous.text : '';
        const cleaned = stripTimestampTokens(mergeDelta(running, delta));
        return cleaned === '' ? previous : { id: requestId, text: cleaned };
      });
    },
    [setLive],
  );

  const commitPartial = useCallback(
    (requestId: number, text: string) => {
      dispatch({ kind: 'segment', id: requestId, text: stripTimestampTokens(text) });
      setLive((previous) => (previous && previous.id === requestId ? null : previous));
    },
    [setLive],
  );

  const clear = useCallback(() => {
    dispatch({ kind: 'clear' });
    setLive(null);
  }, [setLive]);

  return {
    segments: state.segments,
    live,
    pushPartial,
    commitPartial,
    edit: (id: number, text: string) => dispatch({ kind: 'edit', id, text, at: Date.now() }),
    clear,
    undo: () => dispatch({ kind: 'undo' }),
    redo: () => dispatch({ kind: 'redo' }),
    canUndo: canUndo(state),
    canRedo: canRedo(state),
  };
}

export type TranscriptApi = ReturnType<typeof useTranscript>;
export type { TranscriptState };