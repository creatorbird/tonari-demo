export type Language = {
  code: string;
  /** その言語自身での名称 */
  nativeName: string;
  /** 英語での名称 */
  englishName: string;
  /** Web Speech API 用のロケール */
  speechLocale: string;
};

export const LANGUAGES: Language[] = [
  { code: "ja", nativeName: "日本語", englishName: "Japanese", speechLocale: "ja-JP" },
  { code: "ko", nativeName: "한국어", englishName: "Korean", speechLocale: "ko-KR" },
  { code: "en", nativeName: "English", englishName: "English", speechLocale: "en-US" },
  { code: "zh", nativeName: "简体中文", englishName: "Chinese (Simplified)", speechLocale: "zh-CN" },
  { code: "zh-TW", nativeName: "繁體中文", englishName: "Chinese (Traditional)", speechLocale: "zh-TW" },
  { code: "es", nativeName: "Español", englishName: "Spanish", speechLocale: "es-ES" },
  { code: "fr", nativeName: "Français", englishName: "French", speechLocale: "fr-FR" },
  { code: "de", nativeName: "Deutsch", englishName: "German", speechLocale: "de-DE" },
  { code: "it", nativeName: "Italiano", englishName: "Italian", speechLocale: "it-IT" },
  { code: "pt", nativeName: "Português", englishName: "Portuguese", speechLocale: "pt-BR" },
  { code: "th", nativeName: "ไทย", englishName: "Thai", speechLocale: "th-TH" },
  { code: "vi", nativeName: "Tiếng Việt", englishName: "Vietnamese", speechLocale: "vi-VN" },
  { code: "id", nativeName: "Bahasa Indonesia", englishName: "Indonesian", speechLocale: "id-ID" },
];

export const DEFAULT_HOST_LANG = "ja";
export const DEFAULT_GUEST_LANG = "ko";

export function isSupportedLanguage(code: unknown): code is string {
  return typeof code === "string" && LANGUAGES.some((l) => l.code === code);
}

export function getLanguage(code: string): Language | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

/** 「한국어 (Korean)」のように、その言語の名称と英語名を併記したラベル */
export function languageLabel(code: string): string {
  const lang = getLanguage(code);
  if (!lang) return code;
  return lang.nativeName === lang.englishName
    ? lang.nativeName
    : `${lang.nativeName} (${lang.englishName})`;
}
