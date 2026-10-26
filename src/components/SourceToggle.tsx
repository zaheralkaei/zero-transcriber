interface SourceToggleProps {
  source: 'mic' | 'tab';
  tabCaptureSupported: boolean;
  onSourceChange(source: 'mic' | 'tab'): void;
}

/** Audio source switch: your microphone, or a shared tab/call (Chrome/Edge only). */
export function SourceToggle({ source, tabCaptureSupported, onSourceChange }: SourceToggleProps) {
  return (
    <div className="segmented" role="group" aria-label="Audio source">
      <button
        type="button"
        className={`segmented__option ${source === 'mic' ? 'segmented__option--active' : ''}`}
        aria-pressed={source === 'mic'}
        onClick={() => onSourceChange('mic')}
      >
        🎙 Microphone
      </button>
      <button
        type="button"
        className={`segmented__option ${source === 'tab' ? 'segmented__option--active' : ''}`}
        aria-pressed={source === 'tab'}
        disabled={!tabCaptureSupported}
        title={tabCaptureSupported ? 'Transcribe a tab or a call you are viewing' : 'Only available in Chrome/Edge'}
        onClick={() => onSourceChange('tab')}
      >
        🔊 Tab / call
      </button>
    </div>
  );
}