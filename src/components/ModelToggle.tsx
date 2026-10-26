import { MODEL_SPECS, type ModelSpec } from '../core/modelCatalog';
import type { ModelKey } from '../core/protocol';

interface ModelToggleProps {
  modelKey: ModelKey;
  disabled: boolean;
  onModelChange(modelKey: ModelKey): void;
}

/** Quality toggle between the two catalog models. */
export function ModelToggle({ modelKey, disabled, onModelChange }: ModelToggleProps) {
  const entries = Object.entries(MODEL_SPECS) as [ModelKey, ModelSpec][];
  return (
    <div className="segmented" role="group" aria-label="Model quality">
      {entries.map(([key, spec]) => (
        <button
          key={key}
          type="button"
          className={`segmented__option ${modelKey === key ? 'segmented__option--active' : ''}`}
          aria-pressed={modelKey === key}
          disabled={disabled}
          title={spec.label}
          onClick={() => onModelChange(key)}
        >
          {key === 'base' ? 'Base' : 'Small'}
        </button>
      ))}
    </div>
  );
}