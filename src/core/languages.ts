/**
 * Language options for multilingual Whisper, keyed by lowercase ISO-639-1/9
 * code — exactly the vocabulary the Whisper tokenizer accepts. 'auto' lets
 * the model detect the language per segment.
 */

export interface LanguageOption {
  code: string;
  label: string;
}

export const AUTO_LANGUAGE = 'auto';

// Ordered by expected usage; extend freely — codes are passed through as-is.
export const LANGUAGES: LanguageOption[] = [
  { code: AUTO_LANGUAGE, label: 'Auto-detect' },
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية (Arabic)' },
  { code: 'de', label: 'Deutsch (German)' },
  { code: 'es', label: 'Español (Spanish)' },
  { code: 'fa', label: 'فارسی (Persian)' },
  { code: 'fr', label: 'Français (French)' },
  { code: 'hi', label: 'हिन्दी (Hindi)' },
  { code: 'it', label: 'Italiano (Italian)' },
  { code: 'ja', label: '日本語 (Japanese)' },
  { code: 'ko', label: '한국어 (Korean)' },
  { code: 'nl', label: 'Nederlands (Dutch)' },
  { code: 'pl', label: 'Polski (Polish)' },
  { code: 'pt', label: 'Português (Portuguese)' },
  { code: 'ru', label: 'Русский (Russian)' },
  { code: 'sv', label: 'Svenska (Swedish)' },
  { code: 'tr', label: 'Türkçe (Turkish)' },
  { code: 'uk', label: 'Українська (Ukrainian)' },
  { code: 'ur', label: 'اردو (Urdu)' },
  { code: 'vi', label: 'Tiếng Việt (Vietnamese)' },
  { code: 'zh', label: '中文 (Chinese)' },
  { code: 'bg', label: 'Български (Bulgarian)' },
  { code: 'bn', label: 'বাংলা (Bengali)' },
  { code: 'ca', label: 'Català (Catalan)' },
  { code: 'cs', label: 'Čeština (Czech)' },
  { code: 'da', label: 'Dansk (Danish)' },
  { code: 'el', label: 'Ελληνικά (Greek)' },
  { code: 'fi', label: 'Suomi (Finnish)' },
  { code: 'he', label: 'עברית (Hebrew)' },
  { code: 'hu', label: 'Magyar (Hungarian)' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'ms', label: 'Bahasa Melayu' },
  { code: 'no', label: 'Norsk (Norwegian)' },
  { code: 'ro', label: 'Română (Romanian)' },
  { code: 'sk', label: 'Slovenčina (Slovak)' },
  { code: 'th', label: 'ไทย (Thai)' },
];

/** True when `code` is a known option (or 'auto'). Guards against bad state. */
export function isKnownLanguage(code: string): boolean {
  return LANGUAGES.some((option) => option.code === code);
}