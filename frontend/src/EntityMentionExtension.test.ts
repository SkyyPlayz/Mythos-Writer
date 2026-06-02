import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { EntityMentionExtension } from './EntityMentionExtension';
import { matchesEntityQuery } from './EntityMentionPicker';
import type { EntityEntry } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundTrip(markdown: string): string {
  const editor = new Editor({
    extensions: [StarterKit, EntityMentionExtension, Markdown],
    content: markdown,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (editor.storage as any).markdown.getMarkdown() as string;
  editor.destroy();
  return result;
}

function makeEntity(overrides: Partial<EntityEntry> = {}): EntityEntry {
  return {
    id: 'ent_test',
    name: 'Test Entity',
    type: 'character',
    path: '/entities/test.md',
    aliases: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// EntityMentionExtension: markdown round-trip
// ---------------------------------------------------------------------------

describe('EntityMentionExtension markdown round-trip', () => {
  it('preserves a simple entity mention verbatim', () => {
    const md = '[Elara](entity://ent_abc123)';
    const out = roundTrip(md);
    expect(out).toContain('[Elara](entity://ent_abc123)');
  });

  it('preserves an entity mention with spaces in the label', () => {
    const md = '[Shadow Realm](entity://ent_xyz789)';
    const out = roundTrip(md);
    expect(out).toContain('[Shadow Realm](entity://ent_xyz789)');
  });

  it('preserves an entity mention embedded in prose', () => {
    const md = 'She turned to [Kael](entity://ent_kael01) and nodded.';
    const out = roundTrip(md);
    expect(out).toContain('[Kael](entity://ent_kael01)');
    expect(out).toContain('She turned to');
    expect(out).toContain('and nodded.');
  });

  it('does not misparse a regular markdown link as an entity mention', () => {
    const md = 'Visit [the website](https://example.com) for more.';
    const out = roundTrip(md);
    // Regular link should be preserved (not mangled by entity rule)
    expect(out).toContain('example.com');
    expect(out).not.toContain('entity://');
  });

  it('does not parse a link with a non-ent_ entity URL', () => {
    const md = 'A [broken link](entity://not_an_entity) here.';
    const out = roundTrip(md);
    // Should not be parsed as entityMention; content preserved in some form
    expect(out).toContain('broken link');
  });

  it('XSS: script tag in label is serialised as harmless text, never as a live element', () => {
    // TipTap's DOMOutputSpec creates a DOM text node for the third array element,
    // so no HTML parsing occurs — the browser will escape < > when serialising to HTML.
    const editor = new Editor({
      extensions: [StarterKit, EntityMentionExtension, Markdown],
      content: '',
    });
    editor.chain().focus().insertContent({
      type: 'entityMention',
      attrs: { id: 'ent_1', label: '<script>alert(1)</script>', entityType: 'other' },
    }).run();
    const html = editor.getHTML();
    editor.destroy();
    // The literal tag <script> must not appear in raw HTML (would be executable).
    expect(html).not.toContain('<script>');
    // The text content is present in escaped form (browser innerHTML encoding).
    expect(html).toContain('&lt;script&gt;');
  });

  it('XSS: escapes angle brackets in entity type', () => {
    const editor = new Editor({
      extensions: [StarterKit, EntityMentionExtension, Markdown],
      content: '',
    });
    editor.chain().focus().insertContent({
      type: 'entityMention',
      attrs: { id: 'ent_2', label: 'Safe', entityType: '<evil>' },
    }).run();
    const html = editor.getHTML();
    editor.destroy();
    expect(html).not.toContain('<evil>');
  });

  it('multiple entity mentions in one paragraph all survive', () => {
    const md = 'Between [Alice](entity://ent_a) and [Bob](entity://ent_b) stood [Carol](entity://ent_c).';
    const out = roundTrip(md);
    expect(out).toContain('[Alice](entity://ent_a)');
    expect(out).toContain('[Bob](entity://ent_b)');
    expect(out).toContain('[Carol](entity://ent_c)');
  });
});

// ---------------------------------------------------------------------------
// matchesEntityQuery
// ---------------------------------------------------------------------------

describe('matchesEntityQuery', () => {
  it('returns true for empty query (show-all)', () => {
    const e = makeEntity({ name: 'Elara Voss' });
    expect(matchesEntityQuery(e, '')).toBe(true);
    expect(matchesEntityQuery(e, '  ')).toBe(true);
  });

  it('matches on name substring (case-insensitive)', () => {
    const e = makeEntity({ name: 'Elara Voss' });
    expect(matchesEntityQuery(e, 'elara')).toBe(true);
    expect(matchesEntityQuery(e, 'VOSS')).toBe(true);
    expect(matchesEntityQuery(e, 'ara')).toBe(true);
  });

  it('matches on alias substring', () => {
    const e = makeEntity({ name: 'The Shadow', aliases: ['Shadow King', 'Dark One'] });
    expect(matchesEntityQuery(e, 'dark')).toBe(true);
    expect(matchesEntityQuery(e, 'king')).toBe(true);
  });

  it('returns false when neither name nor aliases match', () => {
    const e = makeEntity({ name: 'Elara', aliases: ['Star'] });
    expect(matchesEntityQuery(e, 'moon')).toBe(false);
  });

  it('handles entity with no aliases', () => {
    const e = makeEntity({ name: 'Solo', aliases: undefined });
    expect(matchesEntityQuery(e, 'sol')).toBe(true);
    expect(matchesEntityQuery(e, 'xyz')).toBe(false);
  });
});
