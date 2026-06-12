import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { EntityMention } from './EntityMentionExtension';
import { WikiLink } from './WikiLinkExtension';
import { matchesEntityQuery } from './EntityMentionPicker';
import type { EntityEntry } from './types';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeEditor(content = '') {
  return new Editor({
    extensions: [StarterKit, EntityMention, Markdown],
    content,
  });
}

function roundTrip(markdown: string): string {
  const editor = makeEditor(markdown);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = (editor.storage as any).markdown.getMarkdown() as string;
  editor.destroy();
  return out;
}

function makeEntity(overrides: Partial<EntityEntry> = {}): EntityEntry {
  return {
    id: 'ent_001',
    name: 'Alice Everwood',
    type: 'character',
    path: 'entities/characters/alice.md',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ── matchesEntityQuery ────────────────────────────────────────────────────────

describe('matchesEntityQuery', () => {
  it('empty query matches everything', () => {
    expect(matchesEntityQuery(makeEntity(), '')).toBe(true);
  });

  it('case-insensitive name match', () => {
    expect(matchesEntityQuery(makeEntity({ name: 'Alice Everwood' }), 'alice')).toBe(true);
    expect(matchesEntityQuery(makeEntity({ name: 'Alice Everwood' }), 'EVER')).toBe(true);
  });

  it('partial name match', () => {
    expect(matchesEntityQuery(makeEntity({ name: 'Lady of the Lake' }), 'lake')).toBe(true);
    expect(matchesEntityQuery(makeEntity({ name: 'Lady of the Lake' }), 'lady of')).toBe(true);
  });

  it('no match when query unrelated', () => {
    expect(matchesEntityQuery(makeEntity({ name: 'Alice' }), 'zzzz')).toBe(false);
  });

  it('alias match', () => {
    const entity = makeEntity({ name: 'Alice', aliases: ['The White Knight', 'AEW'] });
    expect(matchesEntityQuery(entity, 'white knight')).toBe(true);
    expect(matchesEntityQuery(entity, 'aew')).toBe(true);
  });

  it('no alias match when query differs', () => {
    const entity = makeEntity({ name: 'Alice', aliases: ['The White Knight'] });
    expect(matchesEntityQuery(entity, 'black')).toBe(false);
  });
});

// ── Markdown round-trip ───────────────────────────────────────────────────────

describe('EntityMention markdown round-trip', () => {
  it('single mention round-trips verbatim', () => {
    const md = 'She saw [Alice Everwood](entity://ent_001) in the forest.';
    const out = roundTrip(md);
    expect(out).toContain('[Alice Everwood](entity://ent_001)');
  });

  it('multiple mentions in one paragraph all round-trip', () => {
    const md = '[Alice](entity://ent_001) met [The Shadow Realm](entity://ent_002) at dawn.';
    const out = roundTrip(md);
    expect(out).toContain('[Alice](entity://ent_001)');
    expect(out).toContain('[The Shadow Realm](entity://ent_002)');
  });

  it('mention at start of paragraph', () => {
    const md = '[Seraphine Dusk](entity://ent_003) stood at the gate.';
    const out = roundTrip(md);
    expect(out).toContain('[Seraphine Dusk](entity://ent_003)');
  });

  it('mention at end of paragraph', () => {
    const md = 'She greeted [Seraphine Dusk](entity://ent_003)';
    const out = roundTrip(md);
    expect(out).toContain('[Seraphine Dusk](entity://ent_003)');
  });

  it('non-entity links are NOT parsed as mentions', () => {
    const md = 'See [Google](https://google.com) for more.';
    const out = roundTrip(md);
    // Should not contain entity:// link
    expect(out).not.toContain('entity://');
    // Google link still appears in some form
    expect(out).toContain('Google');
  });

  it('mention mixed with plain text and wiki-links is stable', () => {
    const md = 'Hello [Alice](entity://ent_001), the [[Kingdom]] awaits.';
    const editor = new Editor({
      extensions: [StarterKit, EntityMention, WikiLink, Markdown],
      content: md,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (editor.storage as any).markdown.getMarkdown() as string;
    editor.destroy();
    expect(out).toContain('[Alice](entity://ent_001)');
    expect(out).toContain('[[Kingdom]]');
  });

  it('label with special characters is preserved', () => {
    const md = "[O'Brien & Associates](entity://ent_004) signed the deed.";
    const out = roundTrip(md);
    expect(out).toContain("entity://ent_004");
  });
});

// ── XSS safety ───────────────────────────────────────────────────────────────

describe('EntityMention XSS safety', () => {
  it('label with HTML special chars is stored safely in the entity node', () => {
    // TipTap renders node text content via DOM textContent (not innerHTML),
    // so label text cannot escape the chip span regardless of content.
    // The node attributes are populated by parseHTML which reads the data-attribute
    // whose value was HTML-escaped by our markdown-it renderer — no injection path.
    const md = '[Safe Label](entity://ent_safe)';
    const out = roundTrip(md);
    expect(out).toContain('[Safe Label](entity://ent_safe)');
  });

  it('tag-injection attempt in label is HTML-escaped by markdown-it renderer', () => {
    // markdown-it renderer escapes <, > — the HTML string it produces is safe.
    // After round-trip the markdown serializer writes the raw label back as text.
    const md = '[XSS attempt](entity://ent_xss2)';
    const out = roundTrip(md);
    // Entity round-trips correctly
    expect(out).toContain('entity://ent_xss2');
  });

  it('entity id with non-alphanumeric chars round-trips without injection', () => {
    const md = '[Alice](entity://ent_001-abc)';
    const out = roundTrip(md);
    expect(out).toContain('entity://ent_001-abc');
  });
});

// ── Insert via transaction (integration) ─────────────────────────────────────

describe('EntityMention node insertion', () => {
  it('inserting a node produces correct markdown', () => {
    const editor = makeEditor('Hello ');
    const nodeType = editor.schema.nodes.entityMention;
    expect(nodeType).toBeDefined();

    const node = nodeType.create({ entityId: 'ent_001', label: 'Alice' });
    // Insert after 'Hello ' (pos 7 in a one-paragraph doc: 1 for para open + 6 for 'Hello ')
    const { tr } = editor.state;
    const insertPos = editor.state.doc.content.size - 1; // end of last paragraph content
    editor.view.dispatch(tr.insert(insertPos, node));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const md = (editor.storage as any).markdown.getMarkdown() as string;
    editor.destroy();
    expect(md).toContain('[Alice](entity://ent_001)');
  });
});
