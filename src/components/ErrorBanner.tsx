interface ErrorBannerProps {
  message: string | null;
  onClose(): void;
}

/** Inline, dismissible error strip (capture failures, decode errors, notices). */
export function ErrorBanner({ message, onClose }: ErrorBannerProps) {
  if (!message) return null;
  return (
    <div className="error-banner" role="alert">
      <span>{message}</span>
      <button type="button" className="error-banner__close" aria-label="Dismiss" onClick={onClose}>
        ×
      </button>
    </div>
  );
}