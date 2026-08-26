import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildArchiveIndex,
  detectInconsistencies,
  detectWikiLinkOpportunities,
  detectInternalContinuity,
  detectVaultGapQuestions,
  runArchiveScan,
  getArchiveStatus,
  getArchiveIndex,
} from './archiveAgent.js';
import type { Manifest } from './ipc.js';

// ─── Mocks ───

vi.mock('./entities.js', () => ({
  listEntities: vi.fn(),
}));

vi.mock('./vault.js', () => ({
  readVaultFile: vi.fn(),
}));

import { listEntities } from './entities.js';
import { readVaultFile } from './vault.js';

const mockedListEntities = vi.mocked(listEntities);
const mockedReadVaultFile = vi.mocked(readVaultFile);

// ─── Fixtures ───

const EMPTY_MANIFEST: Manifest = {
  schemaVersion: 2,
  version: '2.0.0',
  vaultRoot: '/vault',
  stories: [],
  entities: [],
  suggestions: [],
  scenes: [],
  chapters: [],
  provenance: {},
  boardReferences: [],
};

function makeEntity(
  overrides: {
    id?: string;
    name?: string;
    type?: 'character' | 'location' | 'item' | 'concept' | 'other';
    aliases?: string[];
    properties?: Record<string, unknown>;
  } = {},
) {
  return {
    id: overrides.id ?? 'ent-1',
    name: overrides.name ?? 'Elara',
    type: overrides.type ?? 'character' as const,
    path: 'entities/characters/ent-1.md',
    aliases: overrides.aliases ?? [],
    tags: [],
    properties: overrides.properties ?? {},
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

// ─── Index build tests ───

describe('buildArchiveIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty index for a vault with no entities', () => {
    mockedListEntities.mockReturnValue([]);
    const index = buildArchiveIndex('/vault', EMPTY_MANIFEST);
    expect(index.entities).toHaveLength(0);
    expect(index.builtAt).toBeTruthy();
  });

  it('builds index with entity name, aliases, and prose', () => {
    mockedListEntities.mockReturnValue([makeEntity({ name: 'Elara', aliases: ['El'] })]);
    mockedReadVaultFile.mockReturnValue({
      content: '---\nid: ent-1\nname: Elara\ntype: character\n---\nHair: blonde\nElara is brave.',
      path: 'entities/characters/ent-1.md',
    });

    const index = buildArchiveIndex('/vault', EMPTY_MANIFEST);
    expect(index.entities).toHaveLength(1);
    const rec = index.entities[0];
    expect(rec.name).toBe('Elara');
    expect(rec.aliases).toEqual(['El']);
    expect(rec.prose).toContain('Elara is brave');
    expect(rec.properties['hair']).toBe('blonde');
  });

  it('handles missing entity files gracefully (prose stays empty)', () => {
    mockedListEntities.mockReturnValue([makeEntity()]);
    mockedReadVaultFile.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const index = buildArchiveIndex('/vault', EMPTY_MANIFEST);
    expect(index.entities).toHaveLength(1);
    expect(index.entities[0].prose).toBe('');
  });

  it('extracts properties from entity.properties object', () => {
    mockedListEntities.mockReturnValue([
      makeEntity({ properties: { gender: 'female', eyes: 'blue' } }),
    ]);
    mockedReadVaultFile.mockReturnValue({ content: '---\n---\n', path: '' });

    const index = buildArchiveIndex('/vault', EMPTY_MANIFEST);
    expect(index.entities[0].properties['gender']).toBe('female');
    expect(index.entities[0].properties['eyes']).toBe('blue');
  });

  it('updates status through idle → indexing → ready', () => {
    mockedListEntities.mockReturnValue([makeEntity(), makeEntity({ id: 'ent-2', name: 'Bran' })]);
    mockedReadVaultFile.mockReturnValue({ content: '---\n---\n', path: '' });

    buildArchiveIndex('/vault', EMPTY_MANIFEST);
    const status = getArchiveStatus();
    expect(status.status).toBe('ready');
    expect(status.count).toBe(2);
    expect(status.total).toBe(2);
    expect(status.builtAt).toBeTruthy();
  });

  it('getArchiveIndex returns the most recently built index', () => {
    mockedListEntities.mockReturnValue([makeEntity()]);
    mockedReadVaultFile.mockReturnValue({ content: '---\n---\n', path: '' });
    buildArchiveIndex('/vault', EMPTY_MANIFEST);
    expect(getArchiveIndex()).not.toBeNull();
    expect(getArchiveIndex()!.entities).toHaveLength(1);
  });
});

// ─── Inconsistency detection tests ───

describe('detectInconsistencies', () => {
  const SCENE_PATH = 'scenes/chapter1/scene1.md';

  it('returns no suggestions when entity is not mentioned', () => {
    const index = {
      entities: [
        {
          id: 'e1',
          name: 'Elara',
          type: 'character' as const,
          aliases: [],
          path: 'entities/e1.md',
          properties: { hair: 'blonde' },
          prose: '',
        },
      ],
      builtAt: new Date().toISOString(),
    };
    const result = detectInconsistencies('The knight rode off into the sunset.', index, SCENE_PATH);
    expect(result).toHaveLength(0);
  });

  it('detects hair colour contradiction', () => {
    const index = {
      entities: [
        {
          id: 'e1',
          name: 'Elara',
          type: 'character' as const,
          aliases: [],
          path: 'entities/e1.md',
          properties: { hair: 'blonde' },
          prose: '',
        },
      ],
      builtAt: new Date().toISOString(),
    };
    const scene = 'Elara shook her dark hair out of her eyes.';
    const result = detectInconsistencies(scene, index, SCENE_PATH);
    expect(result.length).toBeGreaterThan(0);
    const sug = result[0];
    expect(sug.source_agent).toBe('archive');
    expect(sug.status).toBe('proposed');
    expect(sug.target_kind).toBe('manuscript');
    expect(sug.target_path).toBe(SCENE_PATH);
    const payload = JSON.parse(sug.payload_json!);
    expect(payload.kind).toBe('inconsistency');
    expect(payload.scope).toBe('story_vault');
    expect(payload.entityName).toBe('Elara');
  });

  it('detects eye colour contradiction', () => {
    const index = {
      entities: [
        {
          id: 'e2',
          name: 'Kira',
          type: 'character' as const,
          aliases: [],
          path: 'entities/e1.md',
          properties: { eyes: 'blue' },
          prose: '',
        },
      ],
      builtAt: new Date().toISOString(),
    };
    const scene = 'Kira looked up with her brown eyes wide.';
    const result = detectInconsistencies(scene, index, SCENE_PATH);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].rationale).toContain('Kira');
    expect(result[0].rationale).toContain('blue');
  });

  it('does not flag when scene is consistent with vault', () => {
    const index = {
      entities: [
        {
          id: 'e1',
          name: 'Elara',
          type: 'character' as const,
          aliases: [],
          path: 'entities/e1.md',
          properties: { hair: 'blonde' },
          prose: '',
        },
      ],
      builtAt: new Date().toISOString(),
    };
    const scene = 'Elara tossed her blonde hair back and smiled.';
    const result = detectInconsistencies(scene, index, SCENE_PATH);
    expect(result).toHaveLength(0);
  });

  it('matches by alias', () => {
    const index = {
      entities: [
        {
          id: 'e3',
          name: 'Elara Moonwhisper',
          type: 'character' as const,
          aliases: ['El'],
          path: 'entities/e1.md',
          properties: { hair: 'blonde' },
          prose: '',
        },
      ],
      builtAt: new Date().toISOString(),
    };
    // Reference the alias in the scene with contradiction
    const scene = 'El ran past, her dark hair streaming behind her.';
    const result = detectInconsistencies(scene, index, SCENE_PATH);
    expect(result.length).toBeGreaterThan(0);
  });
});

// ─── Wiki-link suggestion tests ───

describe('detectWikiLinkOpportunities', () => {
  const SCENE_PATH = 'scenes/ch1/sc1.md';

  it('returns no suggestions when entity is not mentioned', () => {
    const index = {
      entities: [
        {
          id: 'e1',
          name: 'Elara',
          type: 'character' as const,
          aliases: [],
          path: 'entities/e1.md',
          properties: {},
          prose: '',
        },
      ],
      builtAt: new Date().toISOString(),
    };
    const result = detectWikiLinkOpportunities('A stranger arrived at the inn.', index, SCENE_PATH);
    expect(result).toHaveLength(0);
  });

  it('suggests wiki-link for plain-text entity mention', () => {
    const index = {
      entities: [
        {
          id: 'e1',
          name: 'Elara',
          type: 'character' as const,
          aliases: [],
          path: 'entities/e1.md',
          properties: {},
          prose: '',
        },
      ],
      builtAt: new Date().toISOString(),
    };
    const scene = 'Elara stepped into the candlelit room.';
    const result = detectWikiLinkOpportunities(scene, index, SCENE_PATH);
    expect(result).toHaveLength(1);
    const sug = result[0];
    expect(sug.source_agent).toBe('archive');
    expect(sug.status).toBe('proposed');
    expect(sug.confidence).toBe(0.9);
    const payload = JSON.parse(sug.payload_json!);
    expect(payload.kind).toBe('wiki-link');
    expect(payload.entityName).toBe('Elara');
    expect(payload.link).toBe('[[Elara]]');
    expect(payload.anchorText).toBe('Elara');
  });

  it('does not suggest when entity is already wiki-linked', () => {
    const index = {
      entities: [
        {
          id: 'e1',
          name: 'Elara',
          type: 'character' as const,
          aliases: [],
          path: 'entities/e1.md',
          properties: {},
          prose: '',
        },
      ],
      builtAt: new Date().toISOString(),
    };
    const scene = '[[Elara]] stepped into the candlelit room.';
    const result = detectWikiLinkOpportunities(scene, index, SCENE_PATH);
    expect(result).toHaveLength(0);
  });

  it('suggests wiki-link when matched via alias', () => {
    const index = {
      entities: [
        {
          id: 'e1',
          name: 'Elara Moonwhisper',
          type: 'character' as const,
          aliases: ['El'],
          path: 'entities/e1.md',
          properties: {},
          prose: '',
        },
      ],
      builtAt: new Date().toISOString(),
    };
    const scene = 'El crossed the bridge silently.';
    const result = detectWikiLinkOpportunities(scene, index, SCENE_PATH);
    expect(result).toHaveLength(1);
    const payload = JSON.parse(result[0].payload_json!);
    expect(payload.anchorText).toBe('El');
    expect(payload.link).toBe('[[Elara Moonwhisper]]');
  });

  it('does not suggest when alias variant is wiki-linked', () => {
    const index = {
      entities: [
        {
          id: 'e1',
          name: 'Elara Moonwhisper',
          type: 'character' as const,
          aliases: ['El'],
          path: 'entities/e1.md',
          properties: {},
          prose: '',
        },
      ],
      builtAt: new Date().toISOString(),
    };
    const scene = '[[El]] crossed the bridge silently.';
    const result = detectWikiLinkOpportunities(scene, index, SCENE_PATH);
    expect(result).toHaveLength(0);
  });
});

// ─── Ignore list tests ───

describe('detectInconsistencies with ignoreList', () => {
  const SCENE_PATH = 'scenes/ch1/scene1.md';
  const index = {
    entities: [
      {
        id: 'e1',
        name: 'Elara',
        type: 'character' as const,
        aliases: [],
        path: 'entities/e1.md',
        properties: { hair: 'blonde' },
        prose: '',
      },
    ],
    builtAt: new Date().toISOString(),
  };
  const scene = 'Elara shook her dark hair out of her eyes.';

  it('suppresses a finding when the entity+propKey+scenePath is in the ignore list', () => {
    const ignoreList = [{ entity_id: 'e1', prop_key: 'hair', scene_path: SCENE_PATH }];
    const result = detectInconsistencies(scene, index, SCENE_PATH, ignoreList);
    expect(result).toHaveLength(0);
  });

  it('still reports a finding when scene_path differs from the ignore entry', () => {
    const ignoreList = [{ entity_id: 'e1', prop_key: 'hair', scene_path: 'scenes/other.md' }];
    const result = detectInconsistencies(scene, index, SCENE_PATH, ignoreList);
    expect(result.length).toBeGreaterThan(0);
  });

  it('still reports a finding when prop_key differs from the ignore entry', () => {
    const ignoreList = [{ entity_id: 'e1', prop_key: 'eyes', scene_path: SCENE_PATH }];
    const result = detectInconsistencies(scene, index, SCENE_PATH, ignoreList);
    expect(result.length).toBeGreaterThan(0);
  });

  it('still reports a finding when entity_id differs from the ignore entry', () => {
    const ignoreList = [{ entity_id: 'e-other', prop_key: 'hair', scene_path: SCENE_PATH }];
    const result = detectInconsistencies(scene, index, SCENE_PATH, ignoreList);
    expect(result.length).toBeGreaterThan(0);
  });

  it('works with undefined ignoreList (no regression)', () => {
    const result = detectInconsistencies(scene, index, SCENE_PATH, undefined);
    expect(result.length).toBeGreaterThan(0);
  });
});

// ─── runArchiveScan (combined) ───

describe('runArchiveScan', () => {
  it('returns combined suggestions from both passes', () => {
    const index = {
      entities: [
        {
          id: 'e1',
          name: 'Elara',
          type: 'character' as const,
          aliases: [],
          path: 'entities/e1.md',
          properties: { hair: 'blonde' },
          prose: '',
        },
      ],
      builtAt: new Date().toISOString(),
    };
    // Scene mentions Elara (wiki-link opportunity) and contradicts hair color
    const scene = 'Elara shook her dark hair out of her eyes.';
    const result = runArchiveScan(scene, index, 'scenes/s1.md');

    expect(result.inconsistenciesFound).toBeGreaterThan(0);
    expect(result.wikiLinksFound).toBe(1);
    expect(result.suggestions.length).toBe(result.inconsistenciesFound + result.wikiLinksFound);

    for (const s of result.suggestions) {
      expect(s.status).toBe('proposed');
      expect(s.source_agent).toBe('archive');
    }
  });

  it('returns no suggestions for an unrelated scene', () => {
    const index = {
      entities: [
        {
          id: 'e1',
          name: 'Elara',
          type: 'character' as const,
          aliases: [],
          path: 'entities/e1.md',
          properties: { hair: 'blonde' },
          prose: '',
        },
      ],
      builtAt: new Date().toISOString(),
    };
    const result = runArchiveScan('The wind howled across the plain.', index, 'scenes/s2.md');
    expect(result.inconsistenciesFound).toBe(0);
    expect(result.wikiLinksFound).toBe(0);
    expect(result.suggestions).toHaveLength(0);
  });

  it('carries questionsFound in sync with questions.length', () => {
    const index = {
      entities: [
        {
          id: 'e1',
          name: 'Elara',
          type: 'character' as const,
          aliases: [],
          path: 'entities/e1.md',
          properties: {}, // no tracked details — a vault gap
          prose: '',
        },
      ],
      builtAt: new Date().toISOString(),
    };
    const result = runArchiveScan('Elara stepped into the candlelit room.', index, 'scenes/s3.md');
    expect(result.questionsFound).toBe(result.questions.length);
    expect(result.questionsFound).toBeGreaterThan(0);
  });
});

// ─── Check 1: Story internal (manuscript vs itself) ───

describe('detectInternalContinuity', () => {
  const emptyIndex = { entities: [], builtAt: new Date().toISOString() };

  it('flags a character property drift across scenes for the same entity', () => {
    const index = {
      entities: [
        {
          id: 'e1',
          name: 'Mira',
          type: 'character' as const,
          aliases: [],
          path: 'entities/e1.md',
          properties: {},
          prose: '',
        },
      ],
      builtAt: new Date().toISOString(),
    };
    const scenes = [
      { path: 'scenes/ch1.md', text: 'Mira tossed her blonde hair back and laughed.' },
      { path: 'scenes/ch2.md', text: 'Mira brushed a strand of dark hair from her face.' },
    ];
    const result = detectInternalContinuity(scenes, index);
    expect(result).toHaveLength(1);
    const sug = result[0];
    expect(sug.source_agent).toBe('archive');
    expect(sug.status).toBe('proposed');
    expect(sug.target_path).toBe('scenes/ch2.md');
    const payload = JSON.parse(sug.payload_json!);
    expect(payload.kind).toBe('internal-inconsistency');
    expect(payload.scope).toBe('story_internal');
    expect(payload.entityName).toBe('Mira');
    expect(payload.earlierPhrase).toBe('blonde hair');
    expect(payload.laterPhrase).toBe('dark hair');
    expect(payload.earlierScenePath).toBe('scenes/ch1.md');
  });

  it('does not flag when the same phrase repeats across scenes', () => {
    const index = {
      entities: [
        { id: 'e1', name: 'Mira', type: 'character' as const, aliases: [], path: 'e1.md', properties: {}, prose: '' },
      ],
      builtAt: new Date().toISOString(),
    };
    const scenes = [
      { path: 'scenes/ch1.md', text: 'Mira tossed her blonde hair back and laughed.' },
      { path: 'scenes/ch2.md', text: 'Mira ran a hand through her blonde hair.' },
    ];
    expect(detectInternalContinuity(scenes, index)).toHaveLength(0);
  });

  it('does not flag drift across two different entities (entity-scoped)', () => {
    const index = {
      entities: [
        { id: 'e1', name: 'Mira', type: 'character' as const, aliases: [], path: 'e1.md', properties: {}, prose: '' },
        { id: 'e2', name: 'Talia', type: 'character' as const, aliases: [], path: 'e2.md', properties: {}, prose: '' },
      ],
      builtAt: new Date().toISOString(),
    };
    const scenes = [
      { path: 'scenes/ch1.md', text: 'Mira tossed her blonde hair back and laughed.' },
      { path: 'scenes/ch2.md', text: 'Talia brushed a strand of dark hair from her face.' },
    ];
    expect(detectInternalContinuity(scenes, index)).toHaveLength(0);
  });

  it('flags a world-rule drift (lantern fuel source) with no vault entity involved', () => {
    const scenes = [
      { path: 'scenes/ch1.md', text: 'The lantern in her hand was oil-lit, its flame dancing gently.' },
      { path: 'scenes/ch2.md', text: 'By the second chapter, the lantern was crystal-lit, humming faintly.' },
    ];
    const result = detectInternalContinuity(scenes, emptyIndex);
    expect(result).toHaveLength(1);
    const payload = JSON.parse(result[0].payload_json!);
    expect(payload.kind).toBe('internal-inconsistency');
    expect(payload.scope).toBe('story_internal');
    expect(payload.earlierPhrase).toBe('oil-lit');
    expect(payload.laterPhrase).toBe('crystal-lit');
    expect(result[0].target_path).toBe('scenes/ch2.md');
  });

  it('does not flag the world-rule pair when only one side appears', () => {
    const scenes = [
      { path: 'scenes/ch1.md', text: 'The lantern in her hand was oil-lit, its flame dancing gently.' },
      { path: 'scenes/ch2.md', text: 'She set the lantern down on the table.' },
    ];
    expect(detectInternalContinuity(scenes, emptyIndex)).toHaveLength(0);
  });

  it('returns no findings for a single scene (nothing to compare against)', () => {
    const scenes = [
      { path: 'scenes/ch1.md', text: 'The lantern in her hand was oil-lit, its flame dancing gently.' },
    ];
    expect(detectInternalContinuity(scenes, emptyIndex)).toHaveLength(0);
  });
});

// ─── Vault-gap questions (Check 2 side effect) ───

describe('detectVaultGapQuestions', () => {
  const SCENE_PATH = 'scenes/ch1/scene1.md';

  it('proposes a question for an entity mentioned but with no tracked vault properties', () => {
    const index = {
      entities: [
        { id: 'e1', name: 'Elara', type: 'character' as const, aliases: [], path: 'e1.md', properties: {}, prose: '' },
      ],
      builtAt: new Date().toISOString(),
    };
    const result = detectVaultGapQuestions('Elara stepped into the candlelit room.', index, SCENE_PATH);
    expect(result).toHaveLength(1);
    expect(result[0].entityName).toBe('Elara');
    expect(result[0].scenePath).toBe(SCENE_PATH);
    expect(result[0].question).toContain('Elara');
  });

  it('does not propose a question when the vault already has tracked properties', () => {
    const index = {
      entities: [
        { id: 'e1', name: 'Elara', type: 'character' as const, aliases: [], path: 'e1.md', properties: { hair: 'blonde' }, prose: '' },
      ],
      builtAt: new Date().toISOString(),
    };
    const result = detectVaultGapQuestions('Elara stepped into the candlelit room.', index, SCENE_PATH);
    expect(result).toHaveLength(0);
  });

  it('does not propose a question when the entity is not mentioned in the scene', () => {
    const index = {
      entities: [
        { id: 'e1', name: 'Elara', type: 'character' as const, aliases: [], path: 'e1.md', properties: {}, prose: '' },
      ],
      builtAt: new Date().toISOString(),
    };
    const result = detectVaultGapQuestions('A stranger arrived at the inn.', index, SCENE_PATH);
    expect(result).toHaveLength(0);
  });
});

// ─── Check 1 / Check 2 separation — negative control (SKY-10736 verification path) ───
// Fixture manuscript plants BOTH a Story-internal error (lantern oil-lit →
// crystal-lit, no vault involved) and a Story↔Vault error (tide rule
// conflicting with the vault's "Strait" entity). Each check must catch only
// its own error, proving the split is real rather than two labels on one pass.

describe('Check 1 / Check 2 separation', () => {
  const index = {
    entities: [
      {
        id: 'e-strait',
        name: 'the Strait',
        type: 'location' as const,
        aliases: ['Strait'],
        path: 'entities/strait.md',
        properties: { tide: 'rises at dawn' },
        prose: '',
      },
    ],
    builtAt: new Date().toISOString(),
  };
  // Extend the shared PROPERTY_CONTRADICTION_PAIRS-style vault comparison
  // with a world-rule property key so the tide fixture is a genuine
  // vault-vs-scene contradiction rather than an untracked property.
  const scene1 = { path: 'scenes/ch1.md', text: 'The lantern in her hand was oil-lit, its flame dancing gently. Down at the Strait, all was calm.' };
  const scene2 = {
    path: 'scenes/ch2.md',
    text: 'By the second chapter, the lantern was crystal-lit, humming faintly. Down at the Strait, the tide is highest at dusk, contradicting everything the elders taught.',
  };

  it('Check 1 flags only the lantern drift, never the tide conflict', () => {
    const result = detectInternalContinuity([scene1, scene2], index);
    expect(result).toHaveLength(1);
    expect(result.some((s) => s.rationale.toLowerCase().includes('tide'))).toBe(false);
    const payload = JSON.parse(result[0].payload_json!);
    expect(payload.earlierPhrase).toBe('oil-lit');
  });

  it('Check 2 flags only the tide conflict, never the lantern mismatch', () => {
    const result = detectInconsistencies(scene2.text, index, scene2.path);
    expect(result.some((s) => s.rationale.toLowerCase().includes('lantern'))).toBe(false);
    for (const s of result) {
      const payload = JSON.parse(s.payload_json!);
      expect(payload.scope).toBe('story_vault');
    }
  });
});
