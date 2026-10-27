import type { LoadProgress } from '../core/protocol';

interface ModelProgressProps {
  /** Per-file progress snapshots (aggregated into ONE row below). */
  files: LoadProgress[];
}

/**
 * Aggregates per-file snapshots into one byte-accurate progress. Per-file
 * percentages are never averaged. Duplicate files (same basename, e.g. our
 * sequential prefetch vs. the library's cache-hit re-report) take the higher
 * `loaded`/`total` instead of summing. Any file with an unknown size makes
 * the result indeterminate (percent = null).
 */
export function aggregateProgress(files: LoadProgress[]): {
  loaded: number;
  total: number;
  percent: number | null;
} {
  const byFile = new Map<string, LoadProgress>();
  for (const file of files) {
    const name = file.file.split('/').pop() ?? file.file;
    const kept = byFile.get(name);
    byFile.set(name, {
      file: name,
      progress: 0,
      loaded: Math.max(file.loaded, kept?.loaded ?? 0),
      total: Math.max(file.total, kept?.total ?? 0),
    });
  }
  const rows = [...byFile.values()];
  const loaded = rows.reduce((sum, row) => sum + row.loaded, 0);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const indeterminate = rows.length === 0 || rows.some((row) => row.total === 0);
  return { loaded, total, percent: indeterminate ? null : Math.min(100, (loaded / total) * 100) };
}

/**
 * THE download UI: one message, one bar — even while many model files are in
 * flight. The heavy weights download sequentially (worker/prefetch.ts), so
 * the bar mostly reflects one file at a time.
 */
export function ModelProgress({ files }: ModelProgressProps) {
  if (files.length === 0) return null;
  const { loaded, total, percent } = aggregateProgress(files);
  return (
    <div className="model-progress" role="status" aria-label="Model loading progress">
      <div className="model-progress__row">
        <span className="model-progress__message">Loading model…</span>
        <span className="model-progress__meter" aria-hidden="true">
          <span
            className={`model-progress__fill ${percent === null ? 'model-progress__fill--indeterminate' : ''}`}
            style={percent === null ? undefined : { width: `${Math.round(percent)}%` }}
          />
        </span>
        <span className="model-progress__pct">
          {percent === null
            ? megabytes(loaded) + (total > 0 ? ` / ${megabytes(total)}` : '')
            : `${Math.round(percent)}% · ${megabytes(loaded)} / ${megabytes(total)}`}
        </span>
      </div>
    </div>
  );
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}