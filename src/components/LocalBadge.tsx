interface LocalBadgeProps {
  /** Status line shown while the engine is working ("listening", "thinking", …). */
  statusText?: string;
}

/** The persistent privacy affordance: everything stays in the browser. */
export function LocalBadge({ statusText }: LocalBadgeProps) {
  return (
    <div className="local-badge" title="Transcription runs locally in your browser tab">
      <span className="local-badge__dot" aria-hidden="true" />
      <span>
        100% local — nothing recorded, nothing sent
        {statusText ? ` · ${statusText}` : ''}
      </span>
    </div>
  );
}