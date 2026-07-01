import { describe, it, expect } from 'vitest';
import {
  buildEntryContent,
  parseEntryFrontmatter,
  buildBrainstormMessages,
  buildPromotedNoteContent,
  buildSceneCrafterPayload,
  type EntrySourcePayload,
} from './EntriesPanel';

// ─── buildEntryContent ────────────────────────────────────────────────────────

describe('buildEntryContent', () => {
  it('produces valid frontmatter with body', () => {
    const content = buildEntryContent('A dragon appears', [], '2026-06-09T10:00:00.000Z');
    expect(content).toContain('entry: true');
    expect(content).toContain('source: quick-capture');
    expect(content).toContain('createdAt: 2026-06-09T10:00:00.000Z');
    expect(content).toContain('A dragon appears');
  });

  it('includes tags when provided', () => {
    const content = buildEntryContent('idea', ['fantasy', 'magic'], '2026-06-09T10:00:00.000Z');
    expect(content).toContain('tags: fantasy, magic');
  });

  it('omits tags line when empty', () => {
    const content = buildEntryContent('idea', [], '2026-06-09T10:00:00.000Z');
    expect(content).not.toContain('tags:');
  });

  it('includes promotedNoteId when provided', () => {
    const content = buildEntryContent('idea', [], '2026-06-09T10:00:00.000Z', 'notes/my-note.md');
    expect(content).toContain('promotedNoteId: notes/my-note.md');
  });

  it('omits promotedNoteId when absent', () => {
    const content = buildEntryContent('idea', [], '2026-06-09T10:00:00.000Z');
    expect(content).not.toContain('promotedNoteId');
  });
});

// ─── parseEntryFrontmatter ────────────────────────────────────────────────────

describe('parseEntryFrontmatter', () => {
  it('round-trips content produced by buildEntryContent', () => {
    const body = 'The castle burns at midnight';
    const tags = ['conflict', 'setting'];
    const createdAt = '2026-06-09T12:30:00.000Z';
    const content = buildEntryContent(body, tags, createdAt);
    const parsed = parseEntryFrontmatter(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.body).toBe(body);
    expect(parsed!.tags).toEqual(tags);
    expect(parsed!.createdAt).toBe(createdAt);
    expect(parsed!.promotedNoteId).toBeUndefined();
  });

  it('parses promotedNoteId correctly', () => {
    const content = buildEntryContent('idea', [], '2026-06-09T10:00:00.000Z', 'notes/brainstorm/idea-expanded.md');
    const parsed = parseEntryFrontmatter(content);
    expect(parsed!.promotedNoteId).toBe('notes/brainstorm/idea-expanded.md');
  });

  it('returns null for content without frontmatter', () => {
    expect(parseEntryFrontmatter('just plain text')).toBeNull();
  });

  it('returns null for frontmatter missing createdAt', () => {
    const bad = '---\nentry: true\n---\n\nbody';
    expect(parseEntryFrontmatter(bad)).toBeNull();
  });

  it('handles entries with no tags', () => {
    const content = buildEntryContent('quiet scene', [], '2026-06-09T08:00:00.000Z');
    const parsed = parseEntryFrontmatter(content);
    expect(parsed!.tags).toEqual([]);
  });

  it('trims whitespace from tags', () => {
    const content = '---\nentry: true\ncreatedAt: 2026-06-09T08:00:00.000Z\ntags:  hero ,  villain , magic \n---\n\nbody';
    const parsed = parseEntryFrontmatter(content);
    expect(parsed!.tags).toEqual(['hero', 'villain', 'magic']);
  });
});

// ─── buildBrainstormMessages ──────────────────────────────────────────────────

describe('buildBrainstormMessages', () => {
  it('returns a single user message', () => {
    const msgs = buildBrainstormMessages('A new spell', [], '', []);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
  });

  it('includes entry body in message content', () => {
    const msgs = buildBrainstormMessages('An ancient relic surfaces', [], '', []);
    expect(msgs[0].content).toContain('An ancient relic surfaces');
  });

  it('includes story name when provided', () => {
    const msgs = buildBrainstormMessages('idea', [], 'The Dark Citadel', []);
    expect(msgs[0].content).toContain('The Dark Citadel');
  });

  it('includes entity names when provided', () => {
    const msgs = buildBrainstormMessages('idea', [], '', ['Aria', 'Lord Malev']);
    expect(msgs[0].content).toContain('Aria');
    expect(msgs[0].content).toContain('Lord Malev');
  });

  it('includes tags when provided', () => {
    const msgs = buildBrainstormMessages('idea', ['magic', 'conflict'], '', []);
    expect(msgs[0].content).toContain('magic');
    expect(msgs[0].content).toContain('conflict');
  });

  it('omits Context section when all optional fields are empty', () => {
    const msgs = buildBrainstormMessages('idea', [], '', []);
    expect(msgs[0].content).not.toContain('Context:');
  });

  it('returns correct payload shape for streamStart', () => {
    const msgs = buildBrainstormMessages('test', ['a'], 'Story', ['E1']);
    for (const m of msgs) {
      expect(typeof m.role).toBe('string');
      expect(typeof m.content).toBe('string');
    }
  });
});

// ─── buildPromotedNoteContent ─────────────────────────────────────────────────

describe('buildPromotedNoteContent', () => {
  it('includes the entry body in the note', () => {
    const content = buildPromotedNoteContent('My idea', 'Entries/abc.md', 'My Story');
    expect(content).toContain('My idea');
  });

  it('includes a backlink to the source entry (quoted)', () => {
    const content = buildPromotedNoteContent('idea', 'Entries/abc.md', 'My Story');
    expect(content).toContain("sourceEntry: 'Entries/abc.md'");
  });

  it('includes story title in frontmatter (quoted)', () => {
    const content = buildPromotedNoteContent('idea', 'Entries/abc.md', 'Epic Tale');
    expect(content).toContain("story: 'Epic Tale'");
  });

  it('uses "unknown" when story title is empty', () => {
    const content = buildPromotedNoteContent('idea', 'Entries/abc.md', '');
    expect(content).toContain("story: 'unknown'");
  });

  it('escapes a colon in story title', () => {
    const content = buildPromotedNoteContent('idea', 'Entries/abc.md', 'My Story: A Novel');
    expect(content).toContain("story: 'My Story: A Novel'");
    expect(content.split('---')).toHaveLength(3);
  });

  it('prevents frontmatter injection via newline in storyTitle', () => {
    const content = buildPromotedNoteContent('idea', 'Entries/abc.md', 'Title\n---\nevil: injected');
    // Exactly one closing delimiter — no extra --- injected into the output
    expect((content.match(/\n---\n/g) ?? []).length).toBe(1);
    // evil: must not appear as a standalone YAML key line
    expect(content).not.toMatch(/^evil:/m);
  });

  it('prevents frontmatter injection via newline in entryPath', () => {
    const content = buildPromotedNoteContent('idea', 'Entries/abc.md\n---\nevil: yes', 'Story');
    expect((content.match(/\n---\n/g) ?? []).length).toBe(1);
    expect(content).not.toMatch(/^evil:/m);
  });

  it('escapes single quotes in story title', () => {
    const content = buildPromotedNoteContent('idea', 'Entries/abc.md', "It's a story");
    expect(content).toContain("story: 'It''s a story'");
  });
});

// ─── buildSceneCrafterPayload ─────────────────────────────────────────────────

describe('buildSceneCrafterPayload', () => {
  it('maps entries to payload objects', () => {
    const entries = [
      { id: 'Entries/a.md', body: 'First idea', tags: ['tag1'] },
      { id: 'Entries/b.md', body: 'Second idea', tags: [] },
    ];
    const payload: EntrySourcePayload[] = buildSceneCrafterPayload(entries);
    expect(payload).toHaveLength(2);
    expect(payload[0]).toEqual({ entryId: 'Entries/a.md', body: 'First idea', tags: ['tag1'] });
    expect(payload[1]).toEqual({ entryId: 'Entries/b.md', body: 'Second idea', tags: [] });
  });

  it('returns empty array for empty input', () => {
    expect(buildSceneCrafterPayload([])).toEqual([]);
  });

  it('produces correct payload shape (entryId, body, tags)', () => {
    const [item] = buildSceneCrafterPayload([
      { id: 'Entries/x.md', body: 'A thought', tags: ['a', 'b'] },
    ]);
    expect(Object.keys(item).sort()).toEqual(['body', 'entryId', 'tags']);
  });
});
