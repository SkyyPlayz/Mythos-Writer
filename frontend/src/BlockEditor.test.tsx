import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';

function roundTrip(markdown: string): string {
  const editor = new Editor({
    extensions: [StarterKit, Markdown],
    content: markdown,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (editor.storage as any).markdown.getMarkdown() as string;
  editor.destroy();
  return result.trim();
}

describe('BlockEditor markdown round-trip', () => {
  it('paragraph preserves plain text', () => {
    const md = 'Hello world, this is a paragraph.';
    const out = roundTrip(md);
    expect(out).toContain('Hello world, this is a paragraph.');
  });

  it('heading h1', () => {
    const md = '# Chapter One';
    const out = roundTrip(md);
    expect(out).toBe('# Chapter One');
  });

  it('heading h2', () => {
    const md = '## Scene Two';
    const out = roundTrip(md);
    expect(out).toBe('## Scene Two');
  });

  it('heading h3', () => {
    const md = '### Act Three';
    const out = roundTrip(md);
    expect(out).toBe('### Act Three');
  });

  it('bold preserves marked text', () => {
    const md = 'She was **furious** with him.';
    const out = roundTrip(md);
    expect(out).toContain('**furious**');
  });

  it('italic preserves marked text', () => {
    const md = 'The wind was *howling* outside.';
    const out = roundTrip(md);
    expect(out).toMatch(/[*_]howling[*_]/);
  });

  it('bullet list preserves all items', () => {
    const md = '- First item\n- Second item\n- Third item';
    const out = roundTrip(md);
    expect(out).toContain('First item');
    expect(out).toContain('Second item');
    expect(out).toContain('Third item');
    expect(out).toMatch(/[-*+]\s/);
  });

  it('ordered list preserves all items', () => {
    const md = '1. Step one\n2. Step two\n3. Step three';
    const out = roundTrip(md);
    expect(out).toContain('Step one');
    expect(out).toContain('Step two');
    expect(out).toContain('Step three');
    expect(out).toMatch(/\d+\.\s/);
  });

  it('blockquote preserves quoted text', () => {
    const md = '> To be or not to be.';
    const out = roundTrip(md);
    expect(out).toContain('To be or not to be.');
    expect(out).toContain('>');
  });

  it('inline code preserves code span', () => {
    const md = 'Call `window.api.readManifest()` to load data.';
    const out = roundTrip(md);
    expect(out).toContain('`window.api.readManifest()`');
  });

  it('code block preserves fenced content', () => {
    const md = '```\nconst x = 42;\nconsole.log(x);\n```';
    const out = roundTrip(md);
    expect(out).toContain('const x = 42;');
    expect(out).toContain('console.log(x);');
    expect(out).toContain('```');
  });
});
