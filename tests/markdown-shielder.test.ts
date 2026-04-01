import { describe, it, expect } from 'vitest';
import { MarkdownShielder } from '../src/components/markdown-shielder.ts';

describe('MarkdownShielder', () => {
  const shielder = new MarkdownShielder();

  it('shields and unshields headings', () => {
    const input = '### My Heading\nSome text';
    const { shielded, tokens } = shielder.shield(input);

    expect(shielded).not.toContain('###');
    expect(shielded).toContain('My Heading');

    const restored = shielder.unshield(shielded, tokens);
    expect(restored).toBe(input);
  });

  it('shields and unshields bold text', () => {
    const input = 'This is **bold text** here';
    const { shielded, tokens } = shielder.shield(input);

    expect(shielded).not.toContain('**');
    expect(shielded).toContain('bold text');

    const restored = shielder.unshield(shielded, tokens);
    expect(restored).toBe(input);
  });

  it('shields and unshields inline code', () => {
    const input = 'Use `console.log()` for debugging';
    const { shielded, tokens } = shielder.shield(input);

    expect(shielded).not.toContain('`console.log()`');

    const restored = shielder.unshield(shielded, tokens);
    expect(restored).toBe(input);
  });

  it('shields and unshields fenced code blocks', () => {
    const input = 'Example:\n```python\ndef foo():\n  pass\n```\nDone.';
    const { shielded, tokens } = shielder.shield(input);

    expect(shielded).not.toContain('```python');
    expect(shielded).not.toContain('def foo');

    const restored = shielder.unshield(shielded, tokens);
    expect(restored).toBe(input);
  });

  it('shields and unshields ordered list markers', () => {
    const input = '1. First item\n2. Second item\n3. Third item';
    const { shielded, tokens } = shielder.shield(input);

    expect(shielded).not.toMatch(/^\d+\./m);
    expect(shielded).toContain('First item');

    const restored = shielder.unshield(shielded, tokens);
    expect(restored).toBe(input);
  });

  it('shields and unshields unordered list markers', () => {
    const input = '- First item\n- Second item';
    const { shielded, tokens } = shielder.shield(input);

    expect(shielded).not.toMatch(/^- /m);
    expect(shielded).toContain('First item');

    const restored = shielder.unshield(shielded, tokens);
    expect(restored).toBe(input);
  });

  it('shields and unshields links', () => {
    const input = 'Visit [Google](https://google.com) for more';
    const { shielded, tokens } = shielder.shield(input);

    expect(shielded).not.toContain('https://google.com');
    expect(shielded).toContain('Google');

    const restored = shielder.unshield(shielded, tokens);
    expect(restored).toBe(input);
  });

  it('shields and unshields strikethrough', () => {
    const input = 'This is ~~deleted~~ text';
    const { shielded, tokens } = shielder.shield(input);

    expect(shielded).not.toContain('~~');
    expect(shielded).toContain('deleted');

    const restored = shielder.unshield(shielded, tokens);
    expect(restored).toBe(input);
  });

  it('shields horizontal rules', () => {
    const input = 'Above\n---\nBelow';
    const { shielded, tokens } = shielder.shield(input);

    expect(shielded).not.toContain('---');

    const restored = shielder.unshield(shielded, tokens);
    expect(restored).toBe(input);
  });

  it('handles complex mixed markdown', () => {
    const input = [
      '### Overview',
      '',
      '**Bold** and `code` together:',
      '',
      '1. First point',
      '2. Second point',
      '',
      '```js',
      'const x = 1;',
      '```',
      '',
      'Visit [docs](https://example.com) for more.',
    ].join('\n');

    const { shielded, tokens } = shielder.shield(input);
    const restored = shielder.unshield(shielded, tokens);
    expect(restored).toBe(input);
  });

  it('returns text unchanged when no markdown is present', () => {
    const input = 'Just plain text with no formatting at all.';
    const { shielded, tokens } = shielder.shield(input);

    expect(shielded).toBe(input);
    expect(tokens).toHaveLength(0);
  });

  it('survives simulated translation that moves tokens around', () => {
    const input = '**Important**: Use `npm install` first.';
    const { shielded, tokens } = shielder.shield(input);

    // Simulate a translation that reorders words but keeps placeholders intact
    // (a real MT backend would do this)
    const fakeTranslated = shielded.replace('Important', 'Importante').replace('first', 'primero');
    const restored = shielder.unshield(fakeTranslated, tokens);

    expect(restored).toContain('**Importante**');
    expect(restored).toContain('`npm install`');
  });
});
