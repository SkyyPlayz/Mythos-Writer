import { describe, expect, it, vi } from 'vitest';
import { resolveCrossTabLink, resolveWikiLinkTarget, parseWikiSegments, wikiLinkDisplayText, crossTabLinkMatchKey, buildWikiLinkTitleIndex, isWikiLinkTargetResolved, buildSceneWikiLinkTitleIndex, wikiLinkTargetStem, notePathForUnresolvedLink, buildUnresolvedLinkNote } from './crossTabLinkResolver';
import type { EntityEntry, Story } from './types';

const now = '2026-06-17T00:00:00.000Z';

function story(): Story {
  return {
    id: 'story-1',
    title: 'Test Story',
    path: 'Test Story',
    createdAt: now,
    updatedAt: now,
    chapters: [
      {
        id: 'chapter-1',
        title: 'Chapter One',
        path: 'Test Story/Manuscript/Chapter One',
        order: 1,
        createdAt: now,
        updatedAt: now,
        scenes: [
          {
            id: 'scene-1',
            title: 'Opening Scene',
            path: 'Test Story/Manuscript/Chapter One/Opening Scene.md',
            order: 1,
            blocks: [],
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    ],
  };
}

function entity(overrides: Partial<EntityEntry> = {}): EntityEntry {
  return {
    id: 'entity-1',
    name: 'Elara Voss',
    type: 'character',
    path: 'Characters/Elara Voss.md',
    aliases: ['Elara'],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('resolveCrossTabLink', () => {
  it('resolves [[Scene: Chapter/Scene]] links to a story scene', () => {
    const result = resolveCrossTabLink('Scene: Chapter One/Opening Scene', {
      stories: [story()],
      entities: [],
    });

    expect(result.status).toBe('single');
    expect(result.matches[0]).toMatchObject({
      kind: 'scene',
      sceneId: 'scene-1',
      chapterId: 'chapter-1',
      storyId: 'story-1',
      label: 'Chapter One / Opening Scene',
    });
  });

  it('resolves [[Character: Name]] links to a notes-vault entity note', () => {
    const result = resolveCrossTabLink('Character: Elara', {
      stories: [],
      entities: [entity()],
    });

    expect(result.status).toBe('single');
    expect(result.matches[0]).toMatchObject({
      kind: 'entity',
      entityId: 'entity-1',
      entityPath: 'Characters/Elara Voss.md',
      label: 'Character: Elara Voss',
    });
  });

  it('resolves typed entity links to matching Notes Vault files when no manifest entity exists', () => {
    const result = resolveCrossTabLink('Character: Elara', {
      stories: [],
      entities: [],
      notePaths: ['Notes/Cross Links.md', 'Characters/Elara.md'],
    });

    expect(result.status).toBe('single');
    expect(result.matches[0]).toMatchObject({
      kind: 'entity',
      entityPath: 'Characters/Elara.md',
      label: 'Character: Elara',
    });
  });

  it('falls back to conventional Notes Vault entity paths when files are not pre-indexed', () => {
    const result = resolveCrossTabLink('Character: Elara', {
      stories: [],
      entities: [],
    });

    expect(result.status).toBe('single');
    expect(result.matches[0]).toMatchObject({
      kind: 'entity',
      entityPath: 'Characters/Elara.md',
      label: 'Character: Elara',
    });
  });

  it('returns ambiguous when multiple entities match the same typed link', () => {
    const result = resolveCrossTabLink('Character: Elara', {
      stories: [],
      entities: [
        entity({ id: 'entity-1', name: 'Elara Voss' }),
        entity({ id: 'entity-2', name: 'Elara Moon', path: 'Characters/Elara Moon.md' }),
      ],
    });

    expect(result.status).toBe('ambiguous');
    expect(result.matches.map((m) => m.label)).toEqual([
      'Character: Elara Voss',
      'Character: Elara Moon',
    ]);
  });

  describe('untyped [[stem]] resolution', () => {
    it('resolves a plain stem to an entity by exact name match', () => {
      const result = resolveCrossTabLink('Elara Voss', {
        stories: [],
        entities: [entity()],
      });

      expect(result.status).toBe('single');
      expect(result.matches[0]).toMatchObject({
        kind: 'entity',
        entityId: 'entity-1',
        label: 'Character: Elara Voss',
      });
    });

    it('resolves a plain stem to an entity by alias match', () => {
      const result = resolveCrossTabLink('Elara', {
        stories: [],
        entities: [entity()],
      });

      expect(result.status).toBe('single');
      expect(result.matches[0]).toMatchObject({
        kind: 'entity',
        entityId: 'entity-1',
        label: 'Character: Elara Voss',
      });
    });

    it('resolves a plain stem to a note path when no entity matches', () => {
      const result = resolveCrossTabLink('World Notes', {
        stories: [],
        entities: [],
        notePaths: ['Misc/World Notes.md', 'Other/Another.md'],
      });

      expect(result.status).toBe('single');
      expect(result.matches[0]).toMatchObject({
        kind: 'entity',
        entityPath: 'Misc/World Notes.md',
        label: 'World Notes',
      });
    });

    it('resolves a plain stem to a scene by title match', () => {
      const result = resolveCrossTabLink('Opening Scene', {
        stories: [story()],
        entities: [],
      });

      expect(result.status).toBe('single');
      expect(result.matches[0]).toMatchObject({
        kind: 'scene',
        sceneId: 'scene-1',
        label: 'Chapter One / Opening Scene',
      });
    });

    it('resolves a plain stem to a scene by filename stem match', () => {
      const result = resolveCrossTabLink('Opening Scene', {
        stories: [story()],
        entities: [],
      });

      expect(result.status).toBe('single');
      expect(result.matches[0]).toMatchObject({
        kind: 'scene',
        sceneId: 'scene-1',
      });
    });

    it('returns ambiguous when stem matches both an entity and a scene', () => {
      const ambiguousEntity = entity({ name: 'Opening Scene', path: 'Characters/Opening Scene.md', aliases: [] });
      const result = resolveCrossTabLink('Opening Scene', {
        stories: [story()],
        entities: [ambiguousEntity],
      });

      expect(result.status).toBe('ambiguous');
      expect(result.matches).toHaveLength(2);
      expect(result.matches.some((m) => m.kind === 'entity')).toBe(true);
      expect(result.matches.some((m) => m.kind === 'scene')).toBe(true);
    });

    it('strips a heading anchor before resolution', () => {
      const result = resolveCrossTabLink('Elara Voss#background', {
        stories: [],
        entities: [entity()],
      });

      expect(result.status).toBe('single');
      expect(result.matches[0]).toMatchObject({ kind: 'entity', entityId: 'entity-1' });
    });

    it('strips an alias suffix before resolution', () => {
      const result = resolveCrossTabLink('Elara Voss|The Hero', {
        stories: [],
        entities: [entity()],
      });

      expect(result.status).toBe('single');
      expect(result.matches[0]).toMatchObject({ kind: 'entity', entityId: 'entity-1' });
    });

    it('returns status none when no entity, note, or scene matches', () => {
      const result = resolveCrossTabLink('NonExistentTarget', {
        stories: [],
        entities: [],
        notePaths: ['Misc/Other.md'],
      });

      expect(result.status).toBe('none');
      expect(result.matches).toHaveLength(0);
    });

    it('fires onNotify when unresolved stem returns status none', () => {
      const onNotify = vi.fn();
      const result = resolveCrossTabLink('GhostNote', {
        stories: [],
        entities: [],
        onNotify,
      });

      expect(result.status).toBe('none');
      expect(onNotify).toHaveBeenCalledOnce();
      expect(onNotify).toHaveBeenCalledWith('No note or scene found for "[[GhostNote]]"', 'warn');
    });

    it('does not fire onNotify when the untyped stem resolves successfully', () => {
      const onNotify = vi.fn();
      resolveCrossTabLink('Elara Voss', {
        stories: [],
        entities: [entity()],
        onNotify,
      });

      expect(onNotify).not.toHaveBeenCalled();
    });

    it('does not return a note path match when an entity already matched the stem', () => {
      const result = resolveCrossTabLink('Elara', {
        stories: [],
        entities: [entity()],
        notePaths: ['Notes/Elara.md'],
      });

      // Entity match takes priority; note path not included to avoid duplicate
      expect(result.status).toBe('single');
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]).toMatchObject({ kind: 'entity', entityId: 'entity-1' });
    });
  });
});

describe('buildWikiLinkTitleIndex / isWikiLinkTargetResolved (SKY-5702)', () => {
  it('resolves a scene title from the story vault', () => {
    const index = buildWikiLinkTitleIndex({ stories: [story()], entities: [] });
    expect(isWikiLinkTargetResolved('Opening Scene', index)).toBe(true);
  });

  it('resolves an entity name and its aliases from the notes vault', () => {
    const index = buildWikiLinkTitleIndex({ stories: [], entities: [entity()] });
    expect(isWikiLinkTargetResolved('Elara Voss', index)).toBe(true);
    expect(isWikiLinkTargetResolved('Elara', index)).toBe(true);
  });

  it('resolves a plain note path stem', () => {
    const index = buildWikiLinkTitleIndex({ stories: [], entities: [], notePaths: ['Inbox/Research Notes.md'] });
    expect(isWikiLinkTargetResolved('Research Notes', index)).toBe(true);
  });

  it('is case-insensitive', () => {
    const index = buildWikiLinkTitleIndex({ stories: [], entities: [entity()] });
    expect(isWikiLinkTargetResolved('elara voss', index)).toBe(true);
  });

  it('strips a [[Target|Alias]] pipe before matching', () => {
    const index = buildWikiLinkTitleIndex({ stories: [], entities: [entity()] });
    expect(isWikiLinkTargetResolved('Elara Voss|Voss', index)).toBe(true);
  });

  it('strips a [[Target#heading]] anchor before matching', () => {
    const index = buildWikiLinkTitleIndex({ stories: [story()], entities: [] });
    expect(isWikiLinkTargetResolved('Opening Scene#Notes', index)).toBe(true);
  });

  it('strips a typed [[character: Target]] prefix before matching', () => {
    const index = buildWikiLinkTitleIndex({ stories: [], entities: [entity()] });
    expect(isWikiLinkTargetResolved('character: Elara Voss', index)).toBe(true);
  });

  it('reports an unknown title as unresolved', () => {
    const index = buildWikiLinkTitleIndex({ stories: [story()], entities: [entity()] });
    expect(isWikiLinkTargetResolved('Nobody Here', index)).toBe(false);
  });

  it('treats an empty target as resolved (nothing to flag as broken)', () => {
    const index = buildWikiLinkTitleIndex({ stories: [], entities: [] });
    expect(isWikiLinkTargetResolved('', index)).toBe(true);
  });
});

// ─── M16 (Beta 3): scene-title index + unresolved-click note creation ───

describe('buildSceneWikiLinkTitleIndex', () => {
  it('indexes scene titles and path stems, normalized', () => {
    const index = buildSceneWikiLinkTitleIndex([story()]);
    expect(index.has('opening scene')).toBe(true);
    expect(index.size).toBeGreaterThan(0);
  });

  it('does not index chapter or story titles', () => {
    const index = buildSceneWikiLinkTitleIndex([story()]);
    expect(index.has('chapter one')).toBe(false);
    expect(index.has('test story')).toBe(false);
  });
});

describe('wikiLinkTargetStem', () => {
  it('strips anchors and aliases and trims', () => {
    expect(wikiLinkTargetStem('The Sunken Gate#Architecture')).toBe('The Sunken Gate');
    expect(wikiLinkTargetStem('The Sunken Gate|the gate')).toBe('The Sunken Gate');
    expect(wikiLinkTargetStem('  Drownlight  ')).toBe('Drownlight');
  });
});

describe('notePathForUnresolvedLink', () => {
  it('builds a vault-root .md path from the stem', () => {
    expect(notePathForUnresolvedLink('Drownlight')).toBe('Drownlight.md');
    expect(notePathForUnresolvedLink('Drownlight|glow')).toBe('Drownlight.md');
    expect(notePathForUnresolvedLink('Drownlight#legend')).toBe('Drownlight.md');
  });

  it('sanitizes filesystem-hostile characters cross-platform', () => {
    // `|j` is an alias suffix and is stripped before sanitizing.
    expect(notePathForUnresolvedLink('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i.md');
  });

  it('returns null for empty or dot-only stems', () => {
    expect(notePathForUnresolvedLink('')).toBeNull();
    expect(notePathForUnresolvedLink('   ')).toBeNull();
    expect(notePathForUnresolvedLink('..')).toBeNull();
  });

  it('preserves emoji and full Unicode in the wikilink-created note name (SKY-9027)', () => {
    expect(notePathForUnresolvedLink('🌊 Lost Civilization')).toBe('🌊 Lost Civilization.md');
    expect(notePathForUnresolvedLink('日本語のノート')).toBe('日本語のノート.md');
  });
});

describe('buildUnresolvedLinkNote', () => {
  it('writes the M15 template frontmatter contract (quoted title + createdAt)', () => {
    const md = buildUnresolvedLinkNote('Drownlight', '2026-07-07T00:00:00.000Z');
    expect(md.startsWith('---\ntitle: "Drownlight"\ncreatedAt: 2026-07-07T00:00:00.000Z\n---\n')).toBe(true);
    expect(md).toContain('# Drownlight');
  });

  it('uses the stem (alias/anchor stripped) and defuses double quotes', () => {
    const md = buildUnresolvedLinkNote('The "Deep"|deep#x', '2026-07-07T00:00:00.000Z');
    expect(md).toContain(`title: "The 'Deep'"`);
    expect(md).toContain(`# The "Deep"`);
  });
});

// ─── SKY-11615: Timeline wiki-link parsing + single-target resolution ────────

describe('parseWikiSegments', () => {
  it('splits prose into text and link segments, keeping the raw match', () => {
    expect(parseWikiSegments('Before [[Opening Scene]] after')).toEqual([
      { isLink: false, text: 'Before ' },
      { isLink: true, raw: '[[Opening Scene]]', target: 'Opening Scene' },
      { isLink: false, text: ' after' },
    ]);
  });

  it('handles back-to-back links and a link at either end', () => {
    expect(parseWikiSegments('[[A]][[B]]')).toEqual([
      { isLink: true, raw: '[[A]]', target: 'A' },
      { isLink: true, raw: '[[B]]', target: 'B' },
    ]);
  });

  it('returns nothing for empty prose and leaves link-free prose whole', () => {
    expect(parseWikiSegments('')).toEqual([]);
    expect(parseWikiSegments('no links here')).toEqual([{ isLink: false, text: 'no links here' }]);
  });

  it('is re-entrant — the shared global regex cannot leak lastIndex between calls', () => {
    const first = parseWikiSegments('[[A]] and [[B]]');
    const second = parseWikiSegments('[[A]] and [[B]]');
    expect(second).toEqual(first);
    expect(first.filter((s) => s.isLink)).toHaveLength(2);
  });
});

describe('wikiLinkDisplayText', () => {
  it('shows the alias when one is given', () => {
    expect(wikiLinkDisplayText('Opening Scene|the opening')).toBe('the opening');
  });

  it('renders a heading anchor as "Name › Heading" (mockup separator, not >)', () => {
    expect(wikiLinkDisplayText('Elara Voss#Backstory')).toBe('Elara Voss › Backstory');
  });

  it('shows just the heading for a bare in-document anchor', () => {
    expect(wikiLinkDisplayText('#Backstory')).toBe('Backstory');
  });

  it('passes a plain name through, trimmed', () => {
    expect(wikiLinkDisplayText('  Elara Voss  ')).toBe('Elara Voss');
  });
});

describe('resolveWikiLinkTarget', () => {
  const context = () => ({
    stories: [story()],
    entities: [entity()],
    notePaths: ['Characters/Elara Voss.md', 'Lore/The Drowned Gate.md'],
    folderPaths: ['Characters', 'Lore', 'Lore/Relics'],
  });

  it('resolves a scene title to the scene', () => {
    expect(resolveWikiLinkTarget('Opening Scene', context())).toMatchObject({
      kind: 'scene', sceneId: 'scene-1',
    });
  });

  it('resolves a chapter title to the chapter when no scene matches', () => {
    expect(resolveWikiLinkTarget('Chapter One', context())).toMatchObject({
      kind: 'chapter', chapterId: 'chapter-1', label: 'Chapter One',
    });
  });

  it('resolves a note to its entity', () => {
    expect(resolveWikiLinkTarget('The Drowned Gate', context())).toMatchObject({
      kind: 'entity', entityPath: 'Lore/The Drowned Gate.md',
    });
  });

  it('resolves a vault folder by name and by full path', () => {
    expect(resolveWikiLinkTarget('Relics', context())).toMatchObject({
      kind: 'folder', folderPath: 'Lore/Relics', label: 'Relics',
    });
    expect(resolveWikiLinkTarget('Lore/Relics', context())).toMatchObject({
      kind: 'folder', folderPath: 'Lore/Relics',
    });
  });

  it('is case-insensitive and strips the alias and the heading before matching', () => {
    for (const target of ['opening scene', 'Opening Scene|the start', 'OPENING SCENE#Beat 2']) {
      expect(resolveWikiLinkTarget(target, context())).toMatchObject({ kind: 'scene' });
    }
  });

  it('keeps the documented order: story beats note, note beats folder', () => {
    const ctx = {
      ...context(),
      notePaths: ['Notes/Opening Scene.md', 'Notes/Chapter One.md', 'Notes/Elara Voss.md'],
      folderPaths: ['Elara Voss', 'Chapter One'],
    };
    expect(resolveWikiLinkTarget('Opening Scene', ctx)).toMatchObject({ kind: 'scene' });
    expect(resolveWikiLinkTarget('Chapter One', ctx)).toMatchObject({ kind: 'chapter' });
    expect(resolveWikiLinkTarget('Elara Voss', ctx)).toMatchObject({ kind: 'entity' });
  });

  it('returns null for an unknown name and for a bare heading anchor', () => {
    expect(resolveWikiLinkTarget('Nothing Named This', context())).toBeNull();
    expect(resolveWikiLinkTarget('#Backstory', context())).toBeNull();
  });

  it('never resolves a folder when the caller supplies no folder paths', () => {
    expect(resolveWikiLinkTarget('Relics', { ...context(), folderPaths: undefined })).toBeNull();
  });
});

describe('crossTabLinkMatchKey', () => {
  it('gives every match kind its own key namespace', () => {
    const ctx = {
      stories: [story()],
      entities: [entity()],
      notePaths: ['Characters/Elara Voss.md'],
      folderPaths: ['Lore/Relics'],
    };
    const keys = ['Opening Scene', 'Chapter One', 'Elara Voss', 'Relics']
      .map((target) => crossTabLinkMatchKey(resolveWikiLinkTarget(target, ctx)!));
    expect(keys).toEqual(['scene-scene-1', 'chapter-chapter-1', 'entity-entity-1', 'folder-Lore/Relics']);
    expect(new Set(keys).size).toBe(4);
  });
});
