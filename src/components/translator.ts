import type { TranslationResult, LanguageInstructionConfig } from '../models/types.ts';
import type { TranslatorConfig } from '../models/config.ts';
import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';
import { GlobalTranslationCache } from './global-translation-cache.ts';

/**
 * Maps BCP-47 language tags to human-readable language names
 * for use in language instruction templates.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', zh: 'Chinese', es: 'Spanish', hi: 'Hindi', ar: 'Arabic',
  pt: 'Portuguese', bn: 'Bengali', ru: 'Russian', ja: 'Japanese', de: 'German',
  fr: 'French', ko: 'Korean', it: 'Italian', nl: 'Dutch', pl: 'Polish',
  tr: 'Turkish', vi: 'Vietnamese', th: 'Thai', uk: 'Ukrainian', ro: 'Romanian',
  el: 'Greek', hu: 'Hungarian', cs: 'Czech', sv: 'Swedish', fi: 'Finnish',
  da: 'Danish', no: 'Norwegian', nb: 'Norwegian Bokmål', nn: 'Norwegian Nynorsk',
  he: 'Hebrew', id: 'Indonesian', ms: 'Malay', ca: 'Catalan', gl: 'Galician',
  eu: 'Basque', bg: 'Bulgarian', hr: 'Croatian', sr: 'Serbian', sk: 'Slovak',
  sl: 'Slovenian', lt: 'Lithuanian', lv: 'Latvian', et: 'Estonian', fa: 'Persian',
  ur: 'Urdu', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', kn: 'Kannada',
  mr: 'Marathi', gu: 'Gujarati', pa: 'Punjabi', sw: 'Swahili', af: 'Afrikaans',
  tl: 'Tagalog', fil: 'Filipino',
};

/** Placeholder token pattern used by MixedContentParser */
const PLACEHOLDER_REGEX = /\{\{__PLACEHOLDER_\d+__\}\}/g;

function getLanguageName(tag: string): string {
  return LANGUAGE_NAMES[tag] ?? tag;
}

export class Translator {
  private config: TranslatorConfig;
  private translateClient?: TranslateClient;
  private globalCache: GlobalTranslationCache;

  constructor(config: TranslatorConfig, globalCache?: GlobalTranslationCache) {
    this.config = config;
    this.globalCache = globalCache ?? new GlobalTranslationCache();
    if (config.backend === 'amazon-translate') {
      this.translateClient = new TranslateClient({
        region: config.awsRegion ?? 'us-east-1',
      });
    }
  }

  /**
   * Translates text from one language to another using the configured backend.
   * On failure, returns the original text and logs a warning (Req 5.3).
   */
  async translate(text: string, from: string, to: string): Promise<TranslationResult> {
    // Check global cache first
    const cached = this.globalCache.get(text, from, to);
    if (cached !== null) {
      return { translatedText: cached, sourceLanguage: from, targetLanguage: to };
    }

    // Extract placeholders before translation to preserve them (Req 5.2)
    const placeholders: Array<{ token: string; index: number }> = [];
    let sanitized = text;
    const matches = text.match(PLACEHOLDER_REGEX);
    if (matches) {
      for (const token of matches) {
        const idx = placeholders.length;
        placeholders.push({ token, index: idx });
        sanitized = sanitized.replace(token, `__PHTK${idx}__`);
      }
    }

    try {
      const translated = await this.callBackend(sanitized, from, to);

      // Restore placeholders in translated text
      let result = translated;
      for (const { token, index } of placeholders) {
        result = result.replace(`__PHTK${index}__`, token);
      }

      // Store in global cache
      this.globalCache.set(text, from, to, result);

      return { translatedText: result, sourceLanguage: from, targetLanguage: to };
    } catch (err) {
      console.warn(`[Translator] Translation failed (${from} → ${to}): ${err instanceof Error ? err.message : String(err)}`);
      return { translatedText: text, sourceLanguage: from, targetLanguage: to };
    }
  }

  /**
   * Translates multiple texts in a batch. Each failure is handled independently,
   * returning the original text for that entry.
   */
  async translateBatch(texts: string[], from: string, to: string): Promise<TranslationResult[]> {
    return Promise.all(texts.map(t => this.translate(t, from, to)));
  }

  /**
   * Get global translation cache statistics.
   */
  getGlobalCacheStats() {
    return this.globalCache.getStats();
  }

  /**
   * Builds a language instruction string from a configurable template (Req 7.1, 7.2, 7.4).
   * Replaces {{language}} placeholders with the human-readable language name.
   */
  buildLanguageInstruction(originalLanguage: string, config: LanguageInstructionConfig): string {
    const name = getLanguageName(originalLanguage);
    return config.template.replace(/\{\{language\}\}/g, name);
  }

  /**
   * Calls the configured translation backend.
   * Currently supports LibreTranslate; extensible for DeepL, Google, custom.
   */
  private async callBackend(text: string, from: string, to: string): Promise<string> {
    switch (this.config.backend) {
      case 'libretranslate':
        return this.callLibreTranslate(text, from, to);
      case 'amazon-translate':
        return this.callAmazonTranslate(text, from, to);
      default:
        throw new Error(`Unsupported translator backend: ${this.config.backend}`);
    }
  }

  /**
   * LibreTranslate REST API call: POST /translate
   */
  private async callLibreTranslate(text: string, from: string, to: string): Promise<string> {
    const url = `${this.config.endpoint}/translate`;
    const body: Record<string, string> = { q: text, source: from, target: to };
    if (this.config.apiKey) {
      body.api_key = this.config.apiKey;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`LibreTranslate returned HTTP ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as { translatedText: string };
    return data.translatedText;
  }

  /**
   * Amazon Translate API call via AWS SDK.
   * Uses AWS credentials from the environment (IAM role, env vars, or ~/.aws/credentials).
   */
  private async callAmazonTranslate(text: string, from: string, to: string): Promise<string> {
    if (!this.translateClient) {
      throw new Error('Amazon Translate client not initialized');
    }

    const command = new TranslateTextCommand({
      Text: text,
      SourceLanguageCode: from,
      TargetLanguageCode: to,
    });

    const response = await this.translateClient.send(command);

    if (!response.TranslatedText) {
      throw new Error('Amazon Translate returned empty response');
    }

    return response.TranslatedText;
  }
}
