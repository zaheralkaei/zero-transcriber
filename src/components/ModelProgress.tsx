import type { LoadProgress } from '../core/protocol';

interface ModelProgressProps {
  /** One row per model file currently (or last seen) downloading. */
  files: LoadProgress[];
}

/** Download progress: one row per file, % and MB of MB. */
export function ModelProgress({ files }: ModelProgressProps) {
  if (files.length === 0) return null;
  return (
    <div className="model-progress" role="status" aria-label="Model download progress">
      {files.map((file) => (
        <div key={file.file} className="model-progress__row">
          <span className="model-progress__file" title={file.file}>
            {shortFileName(file.file)}
          </span>
          <span className="model-progress__meter" aria-hidden="true">
            <span className="model-progress__fill" style={{ width: `${Math.round(file.progress)}%` }} />
          </span>
          <span className="model-progress__pct">
            {Math.round(file.progress)}% · {megabytes(file.loaded)} / {megabytes(file.total)}
          </span>
        </div>
      ))}
    </div>
  );
}

function shortFileName(file: string): string {
  return file.split('/').pop() ?? file;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}