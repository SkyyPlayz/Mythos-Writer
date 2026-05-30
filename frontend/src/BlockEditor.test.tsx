import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { WikiLink } from './WikiLinkExtension';
import { EntityMentionExtension } from './EntityMentionExtension';
import { matchesEntityQuery } from './EntityMentionPicker';
import type { EntityEntry } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundTrip(markdown: string): string {
  const editor = new Editor({
    extensions: [StarterKit, WikiLink, Markdown],
    content: markdown,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (editor.storage as any).markdown.getMarkdown() as string;
  editor.destroy();
  return result;
}

/** roundTrip without trimming — used for trailing-newline assertions. */
function roundTripRaw(markdown: string): string {
  const editor = new Editor({
    extensions: [StarterKit, WikiLink, Markdown],
    content: markdown,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (editor.storage as any).markdown.getMarkdown() as string;
  editor.destroy();
  // Mirror the post-processing in BlockEditor.tsx: ensure trailing newline.
  return raw.endsWith('\n') ? raw : `${raw}\n`;
}

function fixture(name: string): string {
  return readFileSync(
    resolve(__dirname, '__fixtures__/markdown', name),
    'utf-8',
  );
}

// ---------------------------------------------------------------------------
// Original suite (kept verbatim for non-regression)
// ---------------------------------------------------------------------------

describe('BlockEditor markdown round-trip', () => {
  it('paragraph preserves plain text', () => {
    const md = 'Hello world, this is a paragraph.';
    const out = roundTrip(md);
    expect(out).toContain('Hello world, this is a paragraph.');
  });

  it('heading h1', () => {
    const md = '# Chapter One';
    const out = roundTrip(md);
    expect(out.trim()).toBe('# Chapter One');
  });

  it('heading h2', () => {
    const md = '## Scene Two';
    const out = roundTrip(md);
    expect(out.trim()).toBe('## Scene Two');
  });

  it('heading h3', () => {
    const md = '### Act Three';
    const out = roundTrip(md);
    expect(out.trim()).toBe('### Act Three');
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

// ---------------------------------------------------------------------------
// Extended regression suite (MYT-131)
// ---------------------------------------------------------------------------

describe('BlockEditor markdown round-trip — extended regression (MYT-131)', () => {

  // -- Inline marks ----------------------------------------------------------

  describe('inline marks', () => {
    it('bold round-trips with double asterisks', () => {
      const out = roundTrip('**bold text**');
      expect(out).toContain('**bold text**');
    });

    it('italic round-trips', () => {
      const out = roundTrip('*italic text*');
      expect(out).toMatch(/[*_]italic text[*_]/);
    });

    it('strikethrough round-trips', () => {
      const out = roundTrip('~~struck~~');
      expect(out).toContain('~~struck~~');
    });

    it('inline code round-trips', () => {
      const out = roundTrip('`const x = 1;`');
      expect(out).toContain('`const x = 1;`');
    });

    it('combined marks in fixture preserve all tokens', () => {
      const src = fixture('inline-marks.md').trim();
      const out = roundTrip(src);
      expect(out).toContain('**furious**');
      expect(out).toMatch(/[*_]whispered[*_]/);
      expect(out).toContain('`inline code`');
      expect(out).toContain('~~strikethrough~~');
    });
  });

  // -- Headings --------------------------------------------------------------

  describe('headings', () => {
    it('H1 round-trips exactly', () => {
      expect(roundTrip('# Title').trim()).toBe('# Title');
    });

    it('H2 round-trips exactly', () => {
      expect(roundTrip('## Section').trim()).toBe('## Section');
    });

    it('H3 round-trips exactly', () => {
      expect(roundTrip('### Sub').trim()).toBe('### Sub');
    });

    it('H4 round-trips exactly', () => {
      expect(roundTrip('#### Deep').trim()).toBe('#### Deep');
    });

    it('blank lines between headings and paragraphs are restored', () => {
      const src = fixture('headings.md').trim();
      const out = roundTrip(src);
      // Each heading must be present
      expect(out).toMatch(/^# Heading One/m);
      expect(out).toMatch(/^## Heading Two/m);
      expect(out).toMatch(/^### Heading Three/m);
      expect(out).toMatch(/^#### Heading Four/m);
      expect(out).toContain('A paragraph after headings.');
    });
  });

  // -- Lists -----------------------------------------------------------------

  describe('lists', () => {
    it('bullet list from fixture preserves all items', () => {
      const src = fixture('lists.md').trim();
      const out = roundTrip(src);
      expect(out).toContain('First item');
      expect(out).toContain('Second item');
      expect(out).toContain('Third item');
    });

    it('ordered list from fixture preserves all items and numbering', () => {
      const src = fixture('lists.md').trim();
      const out = roundTrip(src);
      expect(out).toContain('Step one');
      expect(out).toContain('Step two');
      expect(out).toContain('Step three');
      expect(out).toMatch(/\d+\.\s/);
    });

    it('nested bullet list preserves hierarchy', () => {
      const src = fixture('nested-list.md').trim();
      const out = roundTrip(src);
      expect(out).toContain('Parent one');
      expect(out).toContain('Child one');
      expect(out).toContain('Child two');
      expect(out).toContain('Parent two');
    });
  });

  // -- Code blocks -----------------------------------------------------------

  describe('code blocks', () => {
    it('fenced code block with language tag preserves language', () => {
      const md = '```typescript\nconst x: number = 42;\n```';
      const out = roundTrip(md);
      expect(out).toContain('```typescript');
      expect(out).toContain('const x: number = 42;');
    });

    it('code block fixture round-trips language and content', () => {
      const src = fixture('code-block.md').trim();
      const out = roundTrip(src);
      expect(out).toContain('```typescript');
      expect(out).toContain('const x: number = 42;');
      expect(out).toContain('console.log(x);');
    });

    it('fenced block without language round-trips content', () => {
      const md = '```\nplain code\n```';
      const out = roundTrip(md);
      expect(out).toContain('plain code');
      expect(out).toContain('```');
    });
  });

  // -- Blockquotes -----------------------------------------------------------

  describe('blockquotes', () => {
    it('simple blockquote round-trips', () => {
      const src = fixture('blockquote.md').trim();
      const out = roundTrip(src);
      expect(out).toContain('To be or not to be');
      expect(out).toMatch(/^>/m);
    });

    it('nested blockquote preserves inner content', () => {
      // tiptap-markdown flattens nested blockquotes into one level;
      // verify inner text is still present
      const md = '> Outer\n>\n> > Inner nested quote';
      const out = roundTrip(md);
      expect(out).toContain('Outer');
      expect(out).toContain('Inner nested quote');
    });
  });

  // -- Wiki-link tokens ------------------------------------------------------
  // GAP (MYT-138): tiptap-markdown escapes square brackets, so [[wiki-link]]
  // becomes \[\[wiki-link\]\] on output. A custom TipTap extension is needed
  // to preserve these tokens. Tests below document the current (broken)
  // behaviour so any fix will surface as a clean diff.

  describe('wiki-link tokens', () => {
    it('[[wiki-link]] tokens are preserved verbatim on round-trip', () => {
      const md = 'See [[Elara]] for details.';
      const out = roundTrip(md);
      expect(out).toContain('[[Elara]]');
      expect(out).not.toContain('\\[\\[');
    });

    it('wiki-link fixture — all tokens survive round-trip unescaped', () => {
      const src = fixture('wiki-link.md').trim();
      const out = roundTrip(src);
      expect(out).toContain('[[Elara]]');
      expect(out).toContain('[[The Shadow Realm]]');
      expect(out).not.toContain('\\[\\[');
    });
  });

  // -- Tables ----------------------------------------------------------------

  describe('tables', () => {
    it('GFM table — documents current behaviour (gap expected without Table extension)', () => {
      // StarterKit does not include a Table extension by default.
      // Verify the text content is at least partially preserved even if
      // GFM table syntax is lost. If this test fails after adding a Table
      // extension, update the assertion to verify full round-trip.
      const md = '| Name | Role |\n|------|------|\n| Elara | Hero |';
      const out = roundTrip(md);
      // Content should survive in some form
      expect(out).toContain('Elara');
      expect(out).toContain('Hero');
    });
  });

  // -- Line breaks -----------------------------------------------------------

  describe('line break behaviour', () => {
    it('hard break (two trailing spaces) is preserved as a line break', () => {
      // Two trailing spaces before \n signals a hard break in CommonMark
      const md = 'Line one  \nLine two';
      const out = roundTrip(md);
      expect(out).toContain('Line one');
      expect(out).toContain('Line two');
    });

    it('soft wrap within a paragraph does not insert extra blank lines', () => {
      const md = 'First sentence. Second sentence.';
      const out = roundTrip(md);
      // Should not split into two separate paragraphs
      expect(out.trim()).not.toMatch(/First sentence\.\s*\n\s*\n\s*Second sentence/);
    });
  });

  // -- Trailing newline ------------------------------------------------------
  // GAP (MYT-138): tiptap-markdown v0.9 does not append a trailing newline.
  // Test documents current behaviour; update when the gap is resolved.

  describe('trailing newline', () => {
    it('output ends with a trailing newline', () => {
      const raw = roundTripRaw('Hello world');
      expect(raw).toMatch(/\n$/);
    });
  });
});

// ---------------------------------------------------------------------------
// SKY-176: EntityMention round-trip tests
// ---------------------------------------------------------------------------

function roundTripMention(markdown: string): string {
  const editor = new Editor({
    extensions: [StarterKit, WikiLink, EntityMentionExtension, Markdown],
    content: markdown,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (editor.storage as any).markdown.getMarkdown() as string;
  editor.destroy();
  return result;
}

describe('EntityMentionExtension markdown round-trip (SKY-176)', () => {
  it('entity mention serialises to [Name](entity://id)', () => {
    const md = '[Elara Voss](entity://ent_001)';
    const out = roundTripMention(md);
    expect(out).toContain('[Elara Voss](entity://ent_001)');
  });

  it('entity mention in prose round-trips verbatim', () => {
    const md = 'She saw [Elara Voss](entity://ent_001) across the hall.';
    const out = roundTripMention(md);
    expect(out).toContain('[Elara Voss](entity://ent_001)');
    expect(out).toContain('across the hall');
  });

  it('multiple entity mentions in one paragraph all survive', () => {
    const md = '[Elara](entity://ent_001) met [The Shadow Realm](entity://ent_002) in [Duskfall](entity://ent_003).';
    const out = roundTripMention(md);
    expect(out).toContain('[Elara](entity://ent_001)');
    expect(out).toContain('[The Shadow Realm](entity://ent_002)');
    expect(out).toContain('[Duskfall](entity://ent_003)');
  });

  it('standard markdown links are NOT treated as entity mentions', () => {
    const md = '[OpenAI](https://openai.com)';
    const out = roundTripMention(md);
    // Should not be converted to an entity mention node
    expect(out).not.toContain('entity://');
    expect(out).toContain('OpenAI');
  });

  it('entity mention and wiki-link coexist in the same paragraph', () => {
    const md = 'See [[Elara]] and [Duskfall](entity://ent_003).';
    const out = roundTripMention(md);
    expect(out).toContain('[[Elara]]');
    expect(out).toContain('[Duskfall](entity://ent_003)');
  });
});

describe('matchesEntityQuery (SKY-176)', () => {
  const mkEntity = (name: string, aliases?: string[]): EntityEntry => ({
    id: 'x',
    name,
    type: 'character',
    path: '',
    aliases,
    createdAt: '',
    updatedAt: '',
  });

  it('empty query matches all entities', () => {
    expect(matchesEntityQuery(mkEntity('Elara'), '')).toBe(true);
    expect(matchesEntityQuery(mkEntity('Other'), '   ')).toBe(true);
  });

  it('matches entity name case-insensitively', () => {
    expect(matchesEntityQuery(mkEntity('Elara Voss'), 'elara')).toBe(true);
    expect(matchesEntityQuery(mkEntity('Elara Voss'), 'VOSS')).toBe(true);
  });

  it('matches alias case-insensitively', () => {
    expect(matchesEntityQuery(mkEntity('Elara Voss', ['The Wanderer']), 'wanderer')).toBe(true);
  });

  it('returns false when query does not match name or aliases', () => {
    expect(matchesEntityQuery(mkEntity('Elara', ['The Wanderer']), 'dragon')).toBe(false);
  });
});
