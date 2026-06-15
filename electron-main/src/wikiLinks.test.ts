import { describe, it, expect, vi, beforeEach } from 'vitest';
import { levenshtein, scanWikiLinks, acceptWikiLink, rejectWikiLink } from './wikiLinks.js';
import type { EntityEntry } from './ipc.js';

// ─── Mock DB ───

vi.mock('./db.js', () => ({
  upsertWikiLinkSuggestion: vi.fn(),
  getWikiLinkSuggestion: vi.fn(),
  updateWikiLinkSuggestionStatus: vi.fn(),
  listRejectedWikiLinks: vi.fn(() => []),
  clearWikiLinkRejection: vi.fn(),
}));

// ─── Mock vault ───

vi.mock('./vault.js', () => ({
  readSceneFile: vi.fn(),
  writeSceneFileAtomic: vi.fn(),
}));

import {
  upsertWikiLinkSuggestion,
  getWikiLinkSuggestion,
  updateWikiLinkSuggestionStatus,
  listRejectedWikiLinks,
  clearWikiLinkRejection,
} from './db.js';
import { readSceneFile, writeSceneFileAtomic } from './vault.js';

const mockedUpsert = vi.mocked(upsertWikiLinkSuggestion);
const mockedGet = vi.mocked(getWikiLinkSuggestion);
const mockedUpdateStatus = vi.mocked(updateWikiLinkSuggestionStatus);
const mockedListRejected = vi.mocked(listRejectedWikiLinks);
const mockedClearRejection = vi.mocked(clearWikiLinkRejection);
const mockedReadScene = vi.mocked(readSceneFile);
const mockedWriteScene = vi.mocked(writeSceneFileAtomic);

// ─── Fixtures ───

function makeEntity(
  overrides: Partial<EntityEntry> & { name: string; id: string },
): EntityEntry {
  return {
    type: 'character',
    path: `entities/characters/${overrides.id}.md`,
    aliases: [],
    tags: [],
    properties: {},
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ─── levenshtein ───

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('Elara', 'Elara')).toBe(0);
  });

  it('returns correct distance for single insertion', () => {
    expect(levenshtein('Elara', 'Elaraa')).toBe(1);
  });

  it('returns correct distance for single deletion', () => {
    expect(levenshtein('Elara', 'Elar')).toBe(1);
  });

  it('returns correct distance for single substitution', () => {
    expect(levenshtein('Elara', 'Alara')).toBe(1);
  });

  it('returns correct distance for two edits', () => {
    expect(levenshtein('Elara', 'Blora')).toBe(2);
  });

  it('handles empty strings', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
    expect(levenshtein('', '')).toBe(0);
  });
});

// ─── scanWikiLinks — exact match ───

describe('scanWikiLinks — exact match', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedListRejected.mockReturnValue([]);
  });

  it('returns no suggestions when entity is not mentioned', () => {
    const entities = [makeEntity({ id: 'e1', name: 'Elara' })];
    const result = scanWikiLinks('sc1', 'A stranger arrived at the inn.', entities);
    expect(result).toHaveLength(0);
  });

  it('returns a suggestion with confidence 0.9 for an exact match', () => {
    const entities = [makeEntity({ id: 'e1', name: 'Elara' })];
    const result = scanWikiLinks('sc1', 'Elara stepped into the room.', entities);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.9);
    expect(result[0].entityName).toBe('Elara');
    expect(result[0].proposedLink).toBe('[[Elara]]');
    expect(result[0].sceneId).toBe('sc1');
    expect(result[0].status).toBe('proposed');
  });

  it('returns position at the correct character offset', () => {
    const entities = [makeEntity({ id: 'e1', name: 'Elara' })];
    const text = 'Once upon a time, Elara arrived.';
    const result = scanWikiLinks('sc1', text, entities);
    expect(result).toHaveLength(1);
    const pos = result[0].position;
    expect(text.slice(pos, pos + 'Elara'.length)).toBe('Elara');
  });

  it('is case-insensitive on match', () => {
    const entities = [makeEntity({ id: 'e1', name: 'Elara' })];
    const result = scanWikiLinks('sc1', 'elara stepped into the room.', entities);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.9);
  });

  it('returns only the first unlinked occurrence per entity', () => {
    const entities = [makeEntity({ id: 'e1', name: 'Elara' })];
    const text = 'Elara smiled. Later, Elara waved goodbye.';
    const result = scanWikiLinks('sc1', text, entities);
    expect(result).toHaveLength(1);
    expect(result[0].position).toBe(0);
  });

  it('does not suggest when entity is already wiki-linked', () => {
    const entities = [makeEntity({ id: 'e1', name: 'Elara' })];
    const result = scanWikiLinks('sc1', '[[Elara]] stepped into the room.', entities);
    expect(result).toHaveLength(0);
  });

  it('skips entity linked via alias wiki-link', () => {
    const entities = [makeEntity({ id: 'e1', name: 'Elara Moonwhisper', aliases: ['El'] })];
    const result = scanWikiLinks('sc1', '[[El]] crossed the bridge.', entities);
    expect(result).toHaveLength(0);
  });

  it('matches via alias term', () => {
    const entities = [makeEntity({ id: 'e1', name: 'Elara Moonwhisper', aliases: ['El'] })];
    const result = scanWikiLinks('sc1', 'El crossed the bridge.', entities);
    expect(result).toHaveLength(1);
    expect(result[0].entityName).toBe('Elara Moonwhisper');
    expect(result[0].proposedLink).toBe('[[Elara Moonwhisper]]');
    expect(result[0].confidence).toBe(0.9);
  });

  it('returns separate suggestions for different entities in same scene', () => {
    const entities = [
      makeEntity({ id: 'e1', name: 'Elara' }),
      makeEntity({ id: 'e2', name: 'Kira' }),
    ];
    const result = scanWikiLinks('sc1', 'Elara and Kira walked together.', entities);
    expect(result).toHaveLength(2);
    const names = result.map((r) => r.entityName).sort();
    expect(names).toEqual(['Elara', 'Kira']);
  });

  it('persists each suggestion via upsertWikiLinkSuggestion', () => {
    const entities = [makeEntity({ id: 'e1', name: 'Elara' })];
    scanWikiLinks('sc1', 'Elara stepped in.', entities);
    expect(mockedUpsert).toHaveBeenCalledOnce();
    const arg = mockedUpsert.mock.calls[0][0];
    expect(arg.scene_id).toBe('sc1');
    expect(arg.entity_name).toBe('Elara');
    expect(arg.status).toBe('proposed');
    expect(arg.confidence).toBe(0.9);
  });

  it('returns a stable UUID as suggestion id', () => {
    const entities = [makeEntity({ id: 'e1', name: 'Elara' })];
    const result = scanWikiLinks('sc1', 'Elara stepped in.', entities);
    expect(result[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

// ─── scanWikiLinks — fuzzy match ───

describe('scanWikiLinks — fuzzy match (Levenshtein ≤ 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedListRejected.mockReturnValue([]);
  });

  it('returns a suggestion with confidence 0.7 for a 1-edit-distance word', () => {
    const entities = [makeEntity({ id: 'e1', name: 'Elara' })];
    // "Elrar" is distance 2 from "Elara", "Elara" would be exact…
    // Use "Elarm" — distance 1 (substitute 'a'→'m')
    const result = scanWikiLinks('sc1', 'Elarm stepped into the room.', entities);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.7);
    expect(result[0].entityName).toBe('Elara');
  });

  it('does not suggest for a word at edit distance 2', () => {
    const entities = [makeEntity({ id: 'e1', name: 'Elara' })];
    // "Ebbra": E→E(0), l→b(1 sub), a→b(1 sub), r→r(0), a→a(0) = distance 2
    const result = scanWikiLinks('sc1', 'Ebbra walked in.', entities);
    expect(result).toHaveLength(0);
  });

  it('does not return fuzzy suggestion when exact match already exists', () => {
    const entities = [makeEntity({ id: 'e1', name: 'Elara' })];
    // Text has exact match first, then typo: exact should win
    const result = scanWikiLinks('sc1', 'Elara came in. Elarm left.', entities);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.9);
  });

  it('skips short words (< 3 chars) for fuzzy matching', () => {
    const entities = [makeEntity({ id: 'e1', name: 'El' })];
    // "Ek" is distance 1 from "El" but both are < 3 chars — should skip fuzzy
    const result = scanWikiLinks('sc1', 'Ek went away.', entities);
    expect(result).toHaveLength(0);
  });
});

// ─── scanWikiLinks — rejection suppression ───

describe('scanWikiLinks — rejection suppression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('suppresses a rejected entity when scene text hash matches', () => {
    const text = 'Elara stepped in.';
    // Pre-compute hash
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    mockedListRejected.mockReturnValue([{ entity_id: 'e1', scene_text_hash: hash }]);

    const entities = [makeEntity({ id: 'e1', name: 'Elara' })];
    const result = scanWikiLinks('sc1', text, entities);
    expect(result).toHaveLength(0);
    expect(mockedClearRejection).not.toHaveBeenCalled();
  });

  it('lifts suppression and re-proposes when scene text has changed', () => {
    mockedListRejected.mockReturnValue([
      { entity_id: 'e1', scene_text_hash: 'old-hash-that-differs' },
    ]);

    const entities = [makeEntity({ id: 'e1', name: 'Elara' })];
    const result = scanWikiLinks('sc1', 'Elara stepped in.', entities);
    expect(mockedClearRejection).toHaveBeenCalledWith('sc1', 'e1');
    expect(result).toHaveLength(1);
  });

  it('lifts suppression for null-hash rejections when text changes', () => {
    // A rejection stored without a hash should not suppress (null hash = never matches current hash)
    mockedListRejected.mockReturnValue([{ entity_id: 'e1', scene_text_hash: null }]);
    const entities = [makeEntity({ id: 'e1', name: 'Elara' })];
    // null hash: the condition `row.scene_text_hash !== currentHash` triggers the clear
    const result = scanWikiLinks('sc1', 'Elara stepped in.', entities);
    expect(mockedClearRejection).toHaveBeenCalledWith('sc1', 'e1');
    expect(result).toHaveLength(1);
  });
});

// ─── acceptWikiLink ───

describe('acceptWikiLink', () => {
  const VAULT = '/vault';
  const SCENE_PATH = 'scenes/ch1/sc1.md';

  interface SugRow {
    id: string; scene_id: string; position: number; anchor_text: string;
    entity_name: string; entity_id: string; proposed_link: string;
    confidence: number; status: 'proposed' | 'accepted' | 'rejected';
    scene_text_hash: string | null; created_at: string;
  }
  function makeSugRow(overrides: Partial<SugRow> = {}): SugRow {
    return {
      id: 'sug-1',
      scene_id: 'sc1',
      position: 7,
      anchor_text: 'Elara',
      entity_name: 'Elara',
      entity_id: 'e1',
      proposed_link: '[[Elara]]',
      confidence: 0.9,
      status: 'proposed',
      scene_text_hash: null,
      created_at: '2024-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockedReadScene.mockReturnValue({
      id: 'sc1',
      title: 'Scene 1',
      prose: 'Once, Elara arrived.',
    } as ReturnType<typeof readSceneFile>);
  });

  it('throws when suggestion not found', () => {
    mockedGet.mockReturnValue(null);
    expect(() =>
      acceptWikiLink('sug-1', VAULT, () => SCENE_PATH),
    ).toThrow('WikiLinkSuggestion not found');
  });

  it('throws when suggestion is already accepted', () => {
    mockedGet.mockReturnValue(makeSugRow({ status: 'accepted' }));
    expect(() =>
      acceptWikiLink('sug-1', VAULT, () => SCENE_PATH),
    ).toThrow('already accepted');
  });

  it('throws when scene path cannot be resolved', () => {
    mockedGet.mockReturnValue(makeSugRow());
    expect(() =>
      acceptWikiLink('sug-1', VAULT, () => null),
    ).toThrow('Scene not found');
  });

  it('throws on position mismatch (scene text changed)', () => {
    mockedGet.mockReturnValue(makeSugRow({ anchor_text: 'Elara', position: 0 }));
    mockedReadScene.mockReturnValue({
      id: 'sc1',
      title: 'Scene 1',
      prose: 'Someone else arrived.',
    } as ReturnType<typeof readSceneFile>);
    expect(() =>
      acceptWikiLink('sug-1', VAULT, () => SCENE_PATH),
    ).toThrow('Position mismatch');
  });

  it('inserts [[entityName]] at the correct position and writes the file', () => {
    mockedGet.mockReturnValue(makeSugRow({ position: 6, anchor_text: 'Elara' }));
    // prose: 'Once, Elara arrived.' → position 6 = 'E' of 'Elara'
    mockedReadScene.mockReturnValue({
      id: 'sc1',
      title: 'Scene 1',
      prose: 'Once, Elara arrived.',
    } as ReturnType<typeof readSceneFile>);

    acceptWikiLink('sug-1', VAULT, () => SCENE_PATH);

    expect(mockedWriteScene).toHaveBeenCalledOnce();
    const written = mockedWriteScene.mock.calls[0][2] as { prose: string };
    expect(written.prose).toBe('Once, [[Elara]] arrived.');
    expect(mockedUpdateStatus).toHaveBeenCalledWith('sug-1', 'accepted', null);
  });

  it('handles case-insensitive anchor matching', () => {
    // anchor stored as lowercase, text has uppercase
    mockedGet.mockReturnValue(makeSugRow({ position: 6, anchor_text: 'elara' }));
    mockedReadScene.mockReturnValue({
      id: 'sc1',
      title: 'Scene 1',
      prose: 'Once, Elara arrived.',
    } as ReturnType<typeof readSceneFile>);

    acceptWikiLink('sug-1', VAULT, () => SCENE_PATH);

    const written = mockedWriteScene.mock.calls[0][2] as { prose: string };
    expect(written.prose).toBe('Once, [[Elara]] arrived.');
  });
});

// ─── rejectWikiLink ───

describe('rejectWikiLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when suggestion not found', () => {
    mockedGet.mockReturnValue(null);
    expect(() => rejectWikiLink('sug-1', 'some text')).toThrow('WikiLinkSuggestion not found');
  });

  it('throws when suggestion is already rejected', () => {
    mockedGet.mockReturnValue({
      id: 'sug-1',
      scene_id: 'sc1',
      position: 0,
      anchor_text: 'Elara',
      entity_name: 'Elara',
      entity_id: 'e1',
      proposed_link: '[[Elara]]',
      confidence: 0.9,
      status: 'rejected' as const,
      scene_text_hash: null,
      created_at: '2024-01-01T00:00:00.000Z',
    });
    expect(() => rejectWikiLink('sug-1', 'some text')).toThrow('already rejected');
  });

  it('marks suggestion rejected with scene text hash', () => {
    mockedGet.mockReturnValue({
      id: 'sug-1',
      scene_id: 'sc1',
      position: 0,
      anchor_text: 'Elara',
      entity_name: 'Elara',
      entity_id: 'e1',
      proposed_link: '[[Elara]]',
      confidence: 0.9,
      status: 'proposed' as const,
      scene_text_hash: null,
      created_at: '2024-01-01T00:00:00.000Z',
    });

    const crypto = require('crypto');
    const text = 'Elara stepped in.';
    const expectedHash = crypto.createHash('sha256').update(text).digest('hex');

    rejectWikiLink('sug-1', text);

    expect(mockedUpdateStatus).toHaveBeenCalledWith('sug-1', 'rejected', expectedHash);
  });
});

// ─── Reject → re-scan integration ───

describe('reject then re-scan same text', () => {
  it('does not re-propose a rejected entity on the same text (AC-6)', () => {
    const crypto = require('crypto');
    const text = 'Elara stepped in.';
    const hash = crypto.createHash('sha256').update(text).digest('hex');

    // Simulate rejected entry in DB
    mockedListRejected.mockReturnValue([{ entity_id: 'e1', scene_text_hash: hash }]);

    const entities = [makeEntity({ id: 'e1', name: 'Elara' })];
    const result = scanWikiLinks('sc1', text, entities);
    expect(result).toHaveLength(0);
    expect(mockedClearRejection).not.toHaveBeenCalled();
  });
});
