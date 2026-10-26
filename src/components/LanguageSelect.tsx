import { LANGUAGES } from '../core/languages';

interface LanguageSelectProps {
  language: string;
  disabled: boolean;
  onLanguageChange(code: string): void;
}

/** Output language selector; 'auto' lets Whisper detect per segment. */
export function LanguageSelect({ language, disabled, onLanguageChange }: LanguageSelectProps) {
  return (
    <label className="language-label">
      <span className="language-label__text">Language</span>
      <select
        className="language-select"
        value={language}
        disabled={disabled}
        onChange={(event) => onLanguageChange(event.target.value)}
      >
        {LANGUAGES.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}