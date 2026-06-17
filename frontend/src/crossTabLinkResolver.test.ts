import { describe, expect, it } from 'vitest';
import { resolveCrossTabLink } from './crossTabLinkResolver';
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
});
