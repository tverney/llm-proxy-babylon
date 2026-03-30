import { describe, it, expect } from 'vitest';
import { MixedContentParser } from '../src/components/mixed-content-parser.ts';

describe('MixedContentParser', () => {
  const parser = new MixedContentParser();

  it('round-trips plain text', () => {
    const p = 'Just a normal sentence with no code.';
    const r = parser.parse(p);
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].type).toBe('text');
    expect(r.reassemble(new Map())).toBe(p);
  });

  it('round-trips empty string', () => {
    const r = parser.parse('');
    expect(r.segments).toHaveLength(0);
    expect(r.reassemble(new Map())).toBe('');
  });

  it('parses and round-trips fenced code blocks', () => {
    const p = 'Translate this:\n```js\nconsole.log("hello")\n```\nAnd explain.';
    const r = parser.parse(p);
    expect(r.nonTranslatableSegments().some(s => s.type === 'code_block')).toBe(true);
    expect(r.reassemble(new Map())).toBe(p);
  });

  it('parses and round-trips inline code', () => {
    const p = 'Use `npm install` to install packages.';
    const r = parser.parse(p);
    expect(r.nonTranslatableSegments().some(s => s.type === 'inline_code')).toBe(true);
    expect(r.reassemble(new Map())).toBe(p);
  });

  it('parses and round-trips URLs', () => {
    const p = 'Check https://example.com/path?q=1 for details.';
    const r = parser.parse(p);
    expect(r.nonTranslatableSegments().some(s => s.type === 'url')).toBe(true);
    expect(r.reassemble(new Map())).toBe(p);
  });

  it('parses and round-trips JSON', () => {
    const p = 'Send this payload: {"name": "test", "value": 42} to the API.';
    const r = parser.parse(p);
    expect(r.nonTranslatableSegments().some(s => s.type === 'json')).toBe(true);
    expect(r.reassemble(new Map())).toBe(p);
  });

  it('reassembles with translated text segments', () => {
    const p = 'Hello world `code` goodbye';
    const r = parser.parse(p);
    const translations = new Map<number, string>();
    for (const seg of r.translatableSegments()) {
      translations.set(seg.position, seg.content.toUpperCase());
    }
    expect(r.reassemble(translations)).toBe('HELLO WORLD `code` GOODBYE');
  });

  it('preserves segment ordering', () => {
    const p = 'text1 `code1` text2 `code2` text3';
    const r = parser.parse(p);
    expect(r.segments.map(s => s.type)).toEqual(['text', 'inline_code', 'text', 'inline_code', 'text']);
    expect(r.reassemble(new Map())).toBe(p);
  });
});
