interface RecordButtonProps {
  listening: boolean;
  onClick(): void;
}

/** The single primary action: starts/stops capture. Pulse animates while listening. */
export function RecordButton({ listening, onClick }: RecordButtonProps) {
  return (
    <button
      type="button"
      className={`record-button ${listening ? 'record-button--listening' : ''}`}
      aria-label={listening ? 'Stop transcription' : 'Start transcription'}
      onClick={onClick}
    >
      <span className="record-button__dot" aria-hidden="true" />
      <span className="record-button__label">{listening ? 'Stop' : 'Listen'}</span>
    </button>
  );
}