/**
 * MarkdownShielder protects markdown formatting from being mangled by
 * machine translation. It replaces markdown syntax tokens with numbered
 * XML-tag placeholders before translation and restores them after.
 *
 * Uses <md id="N"/> format because MT engines (Amazon Translate, Google,
 * DeepL) preserve XML tags as untranslatable content.
 *
 * Used by the response translation path to preserve formatting in
 * LLM responses that are post-translated via an MT backend.
 */

interface ShieldedToken {
  placeholder: string;
  original: string;
}

/**
 * Patterns to shield, ordered from most specific to least specific.
 * Each pattern captures the markdown syntax that should be preserved verbatim.
 */
const SHIELD_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // Fenced code blocks (entire block preserved)
  { name: 'fenced_code', pattern: /```[\s\S]*?```/g },
  // Headings: ### Heading text → protect the ### prefix
  { name: 'heading', pattern: /^(#{1,6})\s/gm },
  // Bold: **text** or __text__
  { name: 'bold', pattern: /(\*\*|__)(.*?)\1/g },
  // Italic: *text* or _text_ (but not inside bold)
  { name: 'italic', pattern: /(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g },
  // Strikethrough: ~~text~~
  { name: 'strikethrough', pattern: /~~(.*?)~~/g },
  // Inline code: `text`
  { name: 'inline_code', pattern: /`([^`]+)`/g },
  // Unordered list markers: - or * at line start
  { name: 'ul_marker', pattern: /^([ \t]*[-*])\s/gm },
  // Ordered list markers: 1. 2. etc at line start
  { name: 'ol_marker', pattern: /^([ \t]*\d+\.)\s/gm },
  // Horizontal rules
  { name: 'hr', pattern: /^(---+|\*\*\*+|___+)$/gm },
  // Links: [text](url)
  { name: 'link', pattern: /\[([^\]]*)\]\(([^)]+)\)/g },
  // Images: ![alt](url)
  { name: 'image', pattern: /!\[([^\]]*)\]\(([^)]+)\)/g },
];

export interface ShieldResult {
  shielded: string;
  tokens: ShieldedToken[];
}

export class MarkdownShielder {
  /**
   * Build a placeholder that MT engines will preserve.
   * Uses self-closing XML tag format: <md id="N"/>
   */
  private ph(idx: number): string {
    return `<md id="${idx}"/>`;
  }

  /**
   * Regex to match our placeholders in translated text.
   * Tolerant of spacing changes MT engines may introduce.
   */
  private phRegex(idx: number): RegExp {
    // Match variations: <md id="N"/>, <md id="N" />, <md id = "N"/>
    return new RegExp(`<md\\s+id\\s*=\\s*"${idx}"\\s*/>`, 'g');
  }

  /**
   * Replace markdown syntax with placeholders.
   * Returns the shielded text and the token map needed to restore.
   */
  shield(text: string): ShieldResult {
    const tokens: ShieldedToken[] = [];
    let result = text;

    for (const { name, pattern } of SHIELD_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);

      result = result.replace(regex, (match, ...groups) => {
        // For patterns that capture the syntax token (headings, list markers),
        // only shield the syntax part, not the content
        if (name === 'heading' || name === 'ul_marker' || name === 'ol_marker') {
          const syntaxPart = groups[0] as string;
          const idx = tokens.length;
          const placeholder = this.ph(idx);
          tokens.push({ placeholder, original: syntaxPart });
          return `${placeholder} `;
        }

        // For bold/italic/strikethrough, shield the delimiters but keep inner text translatable
        if (name === 'bold') {
          const delimiter = groups[0] as string;
          const innerText = groups[1] as string;
          const openIdx = tokens.length;
          const openPh = this.ph(openIdx);
          tokens.push({ placeholder: openPh, original: delimiter });
          const closeIdx = tokens.length;
          const closePh = this.ph(closeIdx);
          tokens.push({ placeholder: closePh, original: delimiter });
          return `${openPh}${innerText}${closePh}`;
        }

        if (name === 'italic') {
          const innerText = groups[0] as string;
          const openIdx = tokens.length;
          const openPh = this.ph(openIdx);
          tokens.push({ placeholder: openPh, original: '*' });
          const closeIdx = tokens.length;
          const closePh = this.ph(closeIdx);
          tokens.push({ placeholder: closePh, original: '*' });
          return `${openPh}${innerText}${closePh}`;
        }

        if (name === 'strikethrough') {
          const innerText = groups[0] as string;
          const openIdx = tokens.length;
          const openPh = this.ph(openIdx);
          tokens.push({ placeholder: openPh, original: '~~' });
          const closeIdx = tokens.length;
          const closePh = this.ph(closeIdx);
          tokens.push({ placeholder: closePh, original: '~~' });
          return `${openPh}${innerText}${closePh}`;
        }

        // For links, shield the syntax but keep text translatable
        if (name === 'link') {
          const linkText = groups[0] as string;
          const url = groups[1] as string;
          const urlIdx = tokens.length;
          const urlPh = this.ph(urlIdx);
          tokens.push({ placeholder: urlPh, original: `](${url})` });
          return `[${linkText}${urlPh}`;
        }

        // For images, shield the whole thing
        if (name === 'image') {
          const idx = tokens.length;
          const placeholder = this.ph(idx);
          tokens.push({ placeholder, original: match });
          return placeholder;
        }

        // Default: shield the entire match (fenced code, inline code, hr)
        const idx = tokens.length;
        const placeholder = this.ph(idx);
        tokens.push({ placeholder, original: match });
        return placeholder;
      });
    }

    return { shielded: result, tokens };
  }

  /**
   * Restore placeholders back to original markdown syntax.
   * Uses regex matching to tolerate spacing changes MT engines may introduce.
   */
  unshield(text: string, tokens: ShieldedToken[]): string {
    let result = text;
    // Restore in reverse order to handle nested placeholders correctly
    for (let i = tokens.length - 1; i >= 0; i--) {
      const { original } = tokens[i];
      result = result.replace(this.phRegex(i), original);
    }
    return result;
  }
}
