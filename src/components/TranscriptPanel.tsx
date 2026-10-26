import { useCallback, useEffect, useRef, useState } from 'react';
import { serializeTranscript, copyToClipboard, transcriptFilename } from '../core/text';
import type { TranscriptSegment } from '../core/transcriptStore';

interface TranscriptPanelProps {
  segments: TranscriptSegment[];
  /** Text of the segment currently decoding (still streaming). */
  liveText: string;
  /** Only the newest segment gets the highlight animation. */
  newestSegmentId: number;
  onEdit(id: number, text: string): void;
  onUndo(): void;
  onRedo(): void;
  canUndo: boolean;
  canRedo: boolean;
  onClear(): void;
}

/** The transcript: toolbar + per-segment editable lines + live partial. */
export function TranscriptPanel(props: TranscriptPanelProps) {
  const {
    segments,
    liveText,
    newestSegmentId,
    onEdit,
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    onClear,
  } = props;
  const [copied, setCopied] = useState(false);
  const [merged, setMerged] = useState(false);
  const listRef = useRef<HTMLOListElement | null>(null);
  const mergedRef = useRef<HTMLTextAreaElement | null>(null);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(serializeTranscript(segments));
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500); // transient confirmation
    }
  }, [segments]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([serializeTranscript(segments)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = transcriptFilename();
    link.click();
    URL.revokeObjectURL(url);
  }, [segments]);

  /** Select-all: a merged, read-only view with its text pre-selected for Ctrl+C. */
  const handleSelectAll = useCallback(() => {
    setMerged(true);
  }, []);
  const handleBackToLines = useCallback(() => setMerged(false), []);

  // The merged view exists to hand the user a ready selection.
  useEffect(() => {
    const element = mergedRef.current;
    if (merged && element) {
      element.focus();
      element.select();
    }
  }, [merged]);

  const empty = segments.length === 0 && liveText === '';

  return (
    <section className="transcript" aria-label="Transcript">
      <div className="transcript__toolbar">
        <button type="button" className="tool" disabled={empty} onClick={handleCopy}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        <button type="button" className="tool" disabled={empty} onClick={merged ? handleBackToLines : handleSelectAll}>
          {merged ? 'Edit lines' : 'Select all'}
        </button>
        <button type="button" className="tool" disabled={empty} onClick={handleDownload}>
          Download .txt
        </button>
        <span className="transcript__toolbar-spacer" />
        <button type="button" className="tool" disabled={!canUndo} onClick={onUndo} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button type="button" className="tool" disabled={!canRedo} onClick={onRedo} title="Redo (Ctrl+Shift+Z)">
          Redo
        </button>
        <button type="button" className="tool" disabled={empty} onClick={onClear}>
          Clear
        </button>
      </div>

      {empty ? (
        <p className="transcript__empty">Press Listen and start speaking — text appears here, live.</p>
      ) : merged ? (
        <>
          <textarea
            ref={mergedRef}
            className="transcript__merged"
            value={serializeTranscript(segments)}
            readOnly
            rows={8}
            aria-label="Full transcript"
          />
          {liveText !== '' && (
            <p className="transcript__live" aria-live="polite">
              {liveText}
              <span className="transcript__caret" aria-hidden="true" />
            </p>
          )}
        </>
      ) : (
        <ol className="transcript__list" ref={listRef}>
          {segments.map((segment) => (
            <li key={segment.id}>
              <TranscriptLine
                segment={segment}
                isNewest={segment.id === newestSegmentId}
                onEdit={onEdit}
                onUndo={onUndo}
                onRedo={onRedo}
              />
            </li>
          ))}
          {liveText !== '' && (
            <li className="transcript__live" aria-live="polite">
              {liveText}
              <span className="transcript__caret" aria-hidden="true" />
            </li>
          )}
        </ol>
      )}
    </section>
  );
}

/** One segment: borderless auto-growing editable line. */
function TranscriptLine({
  segment,
  isNewest,
  onEdit,
  onUndo,
  onRedo,
}: {
  segment: TranscriptSegment;
  isNewest: boolean;
  onEdit(id: number, text: string): void;
  onUndo(): void;
  onRedo(): void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Auto-size to content on every value change.
  useEffect(() => {
    const element = ref.current;
    if (element) {
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight}px`;
    }
  }, [segment.text]);

  return (
    <textarea
      ref={ref}
      className={`transcript__line ${isNewest ? 'transcript__line--newest' : ''}`}
      value={segment.text}
      rows={1}
      spellCheck={false}
      aria-label={`Transcript part ${segment.id}`}
      onChange={(event) => onEdit(segment.id, event.target.value)}
      onKeyDown={(event) => {
        // Native textarea undo would fight our segment history — take over.
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
          event.preventDefault();
          if (event.shiftKey) onRedo();
          else onUndo();
        }
      }}
    />
  );
}