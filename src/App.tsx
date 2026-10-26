/**
 * Composition root: wires the three hooks (transcript, transcriber, capture)
 * into the presentational components. All browser/worker side effects live in
 * the hooks; this file stays declarative.
 */

import { useCallback, useState } from 'react';
import { useTranscriber } from './hooks/useTranscriber';
import { useTranscript } from './hooks/useTranscript';
import { useAudioCapture } from './hooks/useAudioCapture';
import { supportsTabCapture } from './audio/sources';
import { RecordButton } from './components/RecordButton';
import { SourceToggle } from './components/SourceToggle';
import { ModelToggle } from './components/ModelToggle';
import { LanguageSelect } from './components/LanguageSelect';
import { Visualizer } from './components/Visualizer';
import { TranscriptPanel } from './components/TranscriptPanel';
import { ModelProgress } from './components/ModelProgress';
import { LocalBadge } from './components/LocalBadge';
import { ErrorBanner } from './components/ErrorBanner';
import type { ModelKey } from './core/protocol';

export default function App() {
  const [modelKey, setModelKey] = useState<ModelKey>('base');
  const [language, setLanguage] = useState('auto');
  const [source, setSource] = useState<'mic' | 'tab'>('mic');
  const [rms, setRms] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // `?device=wasm` forces the CPU path for debugging (and the browser matrix).
  const requestedDevice = new URLSearchParams(window.location.search).get('device');
  const preferredDevice = requestedDevice === 'wasm' ? 'wasm' : 'webgpu';

  const transcript = useTranscript();

  const transcriber = useTranscriber(
    preferredDevice,
    {
      onPartial: (requestId, delta) => transcript.pushPartial(requestId, delta),
      onFinal: (requestId, result) => transcript.commitPartial(requestId, result.text),
      onDecodeError: (_requestId, message) => setError(message),
      onDroppedSegment: () => setError('Speech arrived faster than the model — a segment was skipped.'),
    },
  );

  // Language/state are read fresh on every segment thanks to the handlersRef.
  const capture = useAudioCapture({
    onMeter: setRms,
    onSegment: (audio) => transcriber.transcribe(audio, language, 'transcribe'),
  });

  const handleListen = useCallback(async () => {
    if (capture.active) {
      await capture.stop();
      return;
    }
    setError(null);
    if (transcriber.status === 'idle') await transcriber.load(modelKey); // lazy: only on first use
    const started = await capture.start(source);
    if (!started) setError(capture.error ?? 'Could not start audio capture.');
  }, [capture, transcriber, modelKey, source]);

  /** Mic and tab cannot mix: switching restarts a live capture on the new source. */
  const handleChangeSource = useCallback(
    (nextSource: 'mic' | 'tab') => {
      setSource(nextSource);
      if (capture.active) {
        void (async () => {
          await capture.stop();
          const started = await capture.start(nextSource);
          if (!started) setError(capture.error ?? 'Could not start audio capture.');
        })();
      }
    },
    [capture],
  );

  const handleChangeModel = useCallback(
    (nextModelKey: ModelKey) => {
      setModelKey(nextModelKey);
      void transcriber.load(nextModelKey);
    },
    [transcriber],
  );

  const statusText =
    transcriber.status === 'loading'
      ? 'loading model…'
      : capture.active
        ? source === 'tab'
          ? 'listening to tab'
          : 'listening'
        : undefined;
  const tabCaptureSupported = supportsTabCapture();

  return (
    <main className="app">
      <header className="app__header">
        <h1>Transcriper</h1>
        <LocalBadge statusText={statusText} />
      </header>

      <section className="control" aria-label="Controls">
        <RecordButton listening={capture.active} onClick={() => void handleListen()} />
        <Visualizer rms={rms} listening={capture.active} />
        <div className="control__options">
          <SourceToggle
            source={source}
            tabCaptureSupported={tabCaptureSupported}
            onSourceChange={handleChangeSource}
          />
          <ModelToggle modelKey={modelKey} disabled={transcriber.status === 'loading'} onModelChange={handleChangeModel} />
          <LanguageSelect language={language} disabled={false} onLanguageChange={setLanguage} />
        </div>
      </section>

      <ModelProgress files={transcriber.progress} />
      <ErrorBanner
        message={transcriber.notice ?? error}
        onClose={() => {
          transcriber.clearNotice();
          setError(null);
        }}
      />

      <TranscriptPanel
        segments={transcript.segments}
        liveText={transcript.live?.text ?? ''}
        newestSegmentId={transcript.segments.at(-1)?.id ?? -1}
        onEdit={transcript.edit}
        onUndo={transcript.undo}
        onRedo={transcript.redo}
        canUndo={transcript.canUndo}
        canRedo={transcript.canRedo}
        onClear={transcript.clear}
      />
    </main>
  );
}