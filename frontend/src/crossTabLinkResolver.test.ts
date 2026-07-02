import { describe, expect, it, vi } from 'vitest';
import { resolveCrossTabLink, buildWikiLinkTitleIndex, isWikiLinkTargetResolved } from './crossTabLinkResolver';
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
      expect(onNotify).toHaveBeenCalledWith(expect.stringContaining('GhostNote'), 'warn');
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
