import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildManuscriptPass, scenesBefore } from './manuscriptPass.js';
import type { Manifest } from './ipc.js';
import type { SceneFileData } from './vault.js';

vi.mock('./vault.js', () => ({
  readSceneFile: vi.fn(),
}));

import { readSceneFile } from './vault.js';

const mockedReadSceneFile = vi.mocked(readSceneFile);

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeManifest(): Manifest {
  return {
    schemaVersion: 2,
    version: '2.0.0',
    vaultRoot: '/vault',
    stories: [
      {
        id: 'story-1',
        title: 'Ash and Oath',
        path: 'Stories/Ash and Oath',
        chapters: [
          {
            id: 'ch-2',
            title: 'Fractures',
            path: 'Stories/Ash and Oath/ch2.md',
            order: 1,
            scenes: [
              { id: 'sc-3', title: 'The Undercity', path: 'sc-3.md', order: 0 },
            ],
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          {
            id: 'ch-1',
            title: 'The Quiet Before',
            path: 'Stories/Ash and Oath/ch1.md',
            order: 0,
            scenes: [
              { id: 'sc-2', title: "A City in Shadows", path: 'sc-2.md', order: 1 },
              { id: 'sc-1', title: "The Watcher's Call", path: 'sc-1.md', order: 0 },
            ],
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
    provenance: {},
    boardReferences: [],
  } as unknown as Manifest;
}

function sceneFile(prose: string): SceneFileData {
  return { id: 'x', title: 'x', prose } as unknown as SceneFileData;
}

describe('buildManuscriptPass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads scenes in chapter order then scene order, ignoring array insertion order', () => {
    mockedReadSceneFile.mockImplementation((_vaultRoot, path) => sceneFile(`prose:${path}`));

    const pass = buildManuscriptPass('/vault', makeManifest(), 'Ash and Oath');

    expect(pass.scenes.map((s) => s.sceneId)).toEqual(['sc-1', 'sc-2', 'sc-3']);
    expect(pass.scenes.map((s) => s.order)).toEqual([0, 1, 2]);
    expect(pass.scenes[0].prose).toBe('prose:sc-1.md');
    expect(pass.scenes[2].chapterTitle).toBe('Fractures');
  });

  it('returns an empty pass when the story slug is not found', () => {
    const pass = buildManuscriptPass('/vault', makeManifest(), 'nonexistent');
    expect(pass.scenes).toHaveLength(0);
  });

  it('skips scenes whose file cannot be read, without failing the whole pass', () => {
    mockedReadSceneFile.mockImplementation((_vaultRoot, path) => {
      if (path === 'sc-2.md') throw new Error('missing file');
      return sceneFile(`prose:${path}`);
    });

    const pass = buildManuscriptPass('/vault', makeManifest(), 'Ash and Oath');

    expect(pass.scenes.map((s) => s.sceneId)).toEqual(['sc-1', 'sc-3']);
  });
});

describe('scenesBefore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedReadSceneFile.mockImplementation((_vaultRoot, path) => sceneFile(`prose:${path}`));
  });

  it('returns only scenes strictly earlier in manuscript order', () => {
    const pass = buildManuscriptPass('/vault', makeManifest(), 'Ash and Oath');
    const before = scenesBefore(pass, 'sc-3');
    expect(before.map((s) => s.sceneId)).toEqual(['sc-1', 'sc-2']);
  });

  it('returns an empty array for the first scene', () => {
    const pass = buildManuscriptPass('/vault', makeManifest(), 'Ash and Oath');
    expect(scenesBefore(pass, 'sc-1')).toHaveLength(0);
  });

  it('falls back to the full pass when the scene id is not found', () => {
    const pass = buildManuscriptPass('/vault', makeManifest(), 'Ash and Oath');
    expect(scenesBefore(pass, 'unknown-scene')).toHaveLength(3);
  });
});
