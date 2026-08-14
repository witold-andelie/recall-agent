export type ReplyLocale = {
  tag: string;
  label: string;
};

const DEFAULT_LOCALE: ReplyLocale = { tag: "en", label: "English" };

function letterCount(text: string): number {
  return [...text].filter((ch) => /\p{L}/u.test(ch)).length;
}

function countScript(text: string, script: string): number {
  return (text.match(new RegExp(`\\p{Script=${script}}`, "gu")) || []).length;
}

function latinHint(text: string, words: string[], min = 2): boolean {
  const lower = text.toLowerCase();
  let n = 0;
  for (const w of words) {
    if (new RegExp(`\\b${w}\\b`, "i").test(lower)) n += 1;
    if (n >= min) return true;
  }
  return false;
}

/**
 * Detect the language of this turn's user message.
 * Mid-thread switches follow the latest message only; default is English.
 */
export function detectReplyLocale(text: string): ReplyLocale {
  const t = text.normalize("NFC").trim();
  if (!t) return DEFAULT_LOCALE;

  const letters = letterCount(t) || 1;
  const ratio = (n: number) => n / letters;

  const hira = countScript(t, "Hiragana");
  const kata = countScript(t, "Katakana");
  const hang = countScript(t, "Hangul");
  const han = countScript(t, "Han");
  const arab = countScript(t, "Arabic");
  const cyrl = countScript(t, "Cyrillic");
  const thai = countScript(t, "Thai");
  const deva = countScript(t, "Devanagari");
  const hebr = countScript(t, "Hebrew");

  if (hira + kata >= 2 || ratio(hira + kata) > 0.08) {
    return { tag: "ja", label: "Japanese" };
  }
  if (hang >= 2 || ratio(hang) > 0.15) {
    return { tag: "ko", label: "Korean" };
  }
  if (han >= 2 || ratio(han) > 0.15) {
    return { tag: "zh", label: "Chinese" };
  }
  if (arab >= 2 || ratio(arab) > 0.15) {
    return { tag: "ar", label: "Arabic" };
  }
  if (cyrl >= 2 || ratio(cyrl) > 0.15) {
    return { tag: "ru", label: "Russian" };
  }
  if (thai >= 2) return { tag: "th", label: "Thai" };
  if (deva >= 2) return { tag: "hi", label: "Hindi" };
  if (hebr >= 2) return { tag: "he", label: "Hebrew" };

  if (latinHint(t, ["el", "la", "de", "que", "por", "una", "gracias", "hola"])) {
    return { tag: "es", label: "Spanish" };
  }
  if (latinHint(t, ["une", "des", "est", "pas", "bonjour", "merci", "vous"])) {
    return { tag: "fr", label: "French" };
  }
  if (latinHint(t, ["und", "der", "die", "das", "nicht", "bitte", "ich"])) {
    return { tag: "de", label: "German" };
  }
  if (latinHint(t, ["não", "você", "obrigado", "olá", "uma"])) {
    return { tag: "pt", label: "Portuguese" };
  }

  return DEFAULT_LOCALE;
}
