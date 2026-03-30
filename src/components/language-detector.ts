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

  private undetermined(): LanguageDetectionResult {
    const und: DetectedLanguage = { tag: 'und', confidence: 0 };
    return { primary: und, all: [und], isUndetermined: true };
  }
}
