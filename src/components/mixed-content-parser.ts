import type { Segment, SegmentType, ParsedContent } from '../models/types.ts';

/**
 * Regex patterns for identifying non-translatable segments.
 * Order matters: fenced code blocks must be matched before inline patterns.
 */
const SEGMENT_PATTERNS: Array<{ type: SegmentType; pattern: RegExp }> = [
  // Fenced code blocks: ```lang\n...\n```
  { type: 'code_block', pattern: /```[\s\S]*?```/g },
  // Inline code: `...`
  { type: 'inline_code', pattern: /`[^`]+`/g },
  // URLs: http(s)://...
  { type: 'url', pattern: /https?:\/\/[^\s)>\]]+/g },
  // JSON blocks: { ... } with at least one "key":
  { type: 'json', pattern: /\{[^{}]*"[^"]*"\s*:[^{}]*\}/g },
  // XML tags: <tag>...</tag> or self-closing <tag />
  { type: 'xml', pattern: /<[a-zA-Z][a-zA-Z0-9-]*(?:\s[^>]*)?>[\s\S]*?<\/[a-zA-Z][a-zA-Z0-9-]*>|<[a-zA-Z][a-zA-Z0-9-]*(?:\s[^>]*)?\s*\/>/g },
  // YAML blocks: lines starting with key: value (3+ consecutive lines)
  { type: 'yaml', pattern: /(?:^|\n)([ \t]*[a-zA-Z_][a-zA-Z0-9_]*:[ \t]+[^\n]+(?:\n[ \t]*[a-zA-Z_][a-zA-Z0-9_]*:[ \t]+[^\n]+){2,})/g },
  // SQL statements
  { type: 'sql', pattern: /\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|FROM|WHERE|JOIN|GROUP BY|ORDER BY)\b[^;]*;?/gi },
];

interface MatchedRegion {
  type: SegmentType;
  start: number;
  end: number;
  content: string;
}

/**
 * Find all non-translatable regions in the prompt, resolving overlaps
 * by keeping the earliest/longest match.
 */
function findNonTranslatableRegions(prompt: string): MatchedRegion[] {
  const regions: MatchedRegion[] = [];

  for (const { type, pattern } of SEGMENT_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(prompt)) !== null) {
      regions.push({
        type,
        start: match.index,
        end: match.index + match[0].length,
        content: match[0],
      });
    }
  }

  // Sort by start position, then by length descending (longer match wins)
  regions.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  // Remove overlapping regions — keep the first (earliest start, longest)
  const merged: MatchedRegion[] = [];
  for (const region of regions) {
    const last = merged[merged.length - 1];
    if (last && region.start < last.end) {
      continue; // overlaps with previous, skip
    }
    merged.push(region);
  }

  return merged;
}


class ParsedContentImpl implements ParsedContent {
  segments: Segment[];

  constructor(segments: Segment[]) {
    this.segments = segments;
  }

  translatableSegments(): Segment[] {
    return this.segments.filter((s) => s.type === 'text');
  }

  nonTranslatableSegments(): Segment[] {
    return this.segments.filter((s) => s.type !== 'text');
  }

  /**
   * Reassemble the prompt by replacing translatable segments with their
   * translated counterparts (keyed by position), leaving non-translatable
   * segments untouched.
   */
  reassemble(translatedTexts: Map<number, string>): string {
    return this.segments
      .map((seg) => {
        if (seg.type === 'text' && translatedTexts.has(seg.position)) {
          return translatedTexts.get(seg.position)!;
        }
        return seg.content;
      })
      .join('');
  }
}

export class MixedContentParser {
  /**
   * Parse a prompt into translatable text segments and non-translatable
   * segments (code blocks, inline code, URLs, JSON, XML, YAML, SQL).
   * Preserves original ordering and positions for reassembly.
   */
  parse(prompt: string): ParsedContent {
    if (prompt.length === 0) {
      return new ParsedContentImpl([]);
    }

    const regions = findNonTranslatableRegions(prompt);
    const segments: Segment[] = [];
    let cursor = 0;

    for (const region of regions) {
      // Text before this non-translatable region
      if (region.start > cursor) {
        segments.push({
          type: 'text',
          content: prompt.slice(cursor, region.start),
          position: cursor,
        });
      }

      segments.push({
        type: region.type,
        content: region.content,
        position: region.start,
      });

      cursor = region.end;
    }

    // Trailing text after the last non-translatable region
    if (cursor < prompt.length) {
      segments.push({
        type: 'text',
        content: prompt.slice(cursor),
        position: cursor,
      });
    }

    return new ParsedContentImpl(segments);
  }
}
