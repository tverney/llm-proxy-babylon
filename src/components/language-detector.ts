import { franc, francAll } from 'franc';
import type { DetectedLanguage, LanguageDetectionResult } from '../models/types.ts';

/**
 * Maps common ISO 639-3 codes to BCP-47 tags.
 * franc returns ISO 639-3; our interface requires BCP-47.
 */
const ISO639_3_TO_BCP47: Record<string, string> = {
  eng: 'en', cmn: 'zh', zho: 'zh', spa: 'es', hin: 'hi', ara: 'ar',
  por: 'pt', ben: 'bn', rus: 'ru', jpn: 'ja', deu: 'de', fra: 'fr',
  kor: 'ko', ita: 'it', nld: 'nl', pol: 'pl', tur: 'tr', vie: 'vi',
  tha: 'th', ukr: 'uk', ron: 'ro', ell: 'el', hun: 'hu', ces: 'cs',
  swe: 'sv', fin: 'fi', dan: 'da', nor: 'no', nob: 'nb', nno: 'nn',
  heb: 'he', ind: 'id', msa: 'ms', cat: 'ca', glg: 'gl', eus: 'eu',
  bul: 'bg', hrv: 'hr', srp: 'sr', slk: 'sk', slv: 'sl', lit: 'lt',
  lav: 'lv', est: 'et', fas: 'fa', urd: 'ur', tam: 'ta', tel: 'te',
  mal: 'ml', kan: 'kn', mar: 'mr', guj: 'gu', pan: 'pa', swa: 'sw',
  afr: 'af', tgl: 'tl', fil: 'fil',
};

function toBcp47(iso639_3: string): string {
  return ISO639_3_TO_BCP47[iso639_3] ?? iso639_3;
}


export class LanguageDetector {
  private confidenceThreshold = 0.7;

  setConfidenceThreshold(threshold: number): void {
    this.confidenceThreshold = threshold;
  }

  detect(text: string): LanguageDetectionResult {
    // Requirement 1.4: short text (<10 chars) → undetermined
    const naturalText = text.replace(/\s+/g, ' ').trim();
    if (naturalText.length < 10) {
      return this.undetermined();
    }

    // Script-based pre-detection for unambiguous scripts.
    // Overrides franc when the dominant script uniquely identifies a language.
    const scriptLang = this.detectByScript(naturalText);
    if (scriptLang) {
      return {
        primary: { tag: scriptLang, confidence: 1 },
        all: [{ tag: scriptLang, confidence: 1 }],
        isUndetermined: false,
      };
    }

    const results = francAll(text);

    // franc returns [["und", 1]] when it can't determine
    if (results.length === 0 || (results.length === 1 && results[0][0] === 'und')) {
      return this.undetermined();
    }

    const detected: DetectedLanguage[] = results
      .filter(([code]) => code !== 'und')
      .map(([code, score]) => ({
        tag: toBcp47(code),
        confidence: score,
      }));

    if (detected.length === 0) {
      return this.undetermined();
    }

    // Requirement 1.3: all below threshold → undetermined
    const allBelowThreshold = detected.every(d => d.confidence < this.confidenceThreshold);
    if (allBelowThreshold) {
      return {
        primary: detected[0],
        all: detected,
        isUndetermined: true,
      };
    }

    return {
      primary: detected[0],
      all: detected,
      isUndetermined: false,
    };
  }

  /**
   * Detect language by dominant Unicode script.
   * Returns a BCP-47 tag if the text is dominated by a script that uniquely
   * identifies a language. Returns null if the script is ambiguous (e.g. Latin).
   */
  private detectByScript(text: string): string | null {
    const counts: Record<string, number> = {};
    let total = 0;

    for (const char of text) {
      const code = char.codePointAt(0) ?? 0;
      if (code <= 0x7F) continue; // skip ASCII (Latin, digits, punctuation)

      let script: string | null = null;
      if (code >= 0x0E00 && code <= 0x0E7F) script = 'th';       // Thai
      else if (code >= 0x0900 && code <= 0x097F) script = 'hi';   // Devanagari (Hindi)
      else if (code >= 0xAC00 && code <= 0xD7AF) script = 'ko';   // Korean Hangul
      else if (code >= 0x1100 && code <= 0x11FF) script = 'ko';   // Korean Jamo
      else if (code >= 0x3040 && code <= 0x309F) script = 'ja';   // Hiragana
      else if (code >= 0x30A0 && code <= 0x30FF) script = 'ja';   // Katakana
      else if (code >= 0x0600 && code <= 0x06FF) script = 'ar';   // Arabic
      else if (code >= 0x0980 && code <= 0x09FF) script = 'bn';   // Bengali
      else if (code >= 0x0A80 && code <= 0x0AFF) script = 'gu';   // Gujarati
      else if (code >= 0x0B80 && code <= 0x0BFF) script = 'ta';   // Tamil
      else if (code >= 0x0C00 && code <= 0x0C7F) script = 'te';   // Telugu
      else if (code >= 0x0400 && code <= 0x04FF) script = 'ru';   // Cyrillic (default to Russian)
      else if (code >= 0x10A0 && code <= 0x10FF) script = 'ka';   // Georgian

      if (script) {
        counts[script] = (counts[script] ?? 0) + 1;
        total++;
      }
    }

    if (total === 0) return null;

    // Find the dominant script
    let maxScript: string | null = null;
    let maxCount = 0;
    for (const [script, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        maxScript = script;
      }
    }

    // Only override if the dominant script accounts for >50% of non-ASCII chars
    if (maxScript && maxCount / total > 0.5) {
      return maxScript;
    }

    return null;
  }

  private undetermined(): LanguageDetectionResult {
    const und: DetectedLanguage = { tag: 'und', confidence: 0 };
    return { primary: und, all: [und], isUndetermined: true };
  }
}
