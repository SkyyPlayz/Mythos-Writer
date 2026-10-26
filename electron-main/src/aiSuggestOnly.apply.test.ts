import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('./vault.js', () => ({
  writeVaultFileAtomic: vi.fn(),
  writeVaultFileAtomicAbs: vi.fn(),
  writeFileAtomic: vi.fn(),
  writeSceneFile: vi.fn(),
  writeSceneFileAtomic: vi.fn(),
  readVaultFile: vi.fn(),
  readManifest: vi.fn(),
  writeManifest: vi.fn(),
  parseFrontmatter: vi.fn(),
  mergeProvenanceFrontmatter: vi.fn(),
  composeProvenanceContent: vi.fn(),
  chapterMetaPath: (chapterRelPath: string) => `${chapterRelPath}/chapter.md`,
  NOTES_VAULT_EXAMPLE_UNIVERSE_DIRS: ['Characters', 'Locations', 'Factions', 'History', 'Systems', 'Items'],
  safePath: (root: string, rel: string) => path.join(root, rel),
}));

vi.mock('./db.js', () => ({
  insertSuggestionSnapshot: vi.fn(),
  getSuggestionSnapshot: vi.fn(),
  getSuggestion: vi.fn(),
  insertAuditLog: vi.fn(),
  updateSuggestionStatus: vi.fn(),
}));

vi.mock('./mythosFormat/mythosJson.js', () => ({
  resolveManifestPath: (root: string) => path.join(root, 'manifest.json'),
}));

vi.mock('./entities.js', () => ({
  applyTypedRelation: vi.fn(),
  updateEntity: vi.fn(),
}));

import {
  writeSceneFile,
  writeSceneFileAtomic,
  writeVaultFileAtomic,
} from './vault.js';
import { applyVaultWrite } from './suggestionApply.js';
import type { DbSuggestion } from './db.js';

const AI_SENTENCE = 'Mara waits for the dawn bells before she crosses.';

function manuscriptSuggestion(): DbSuggestion {
  return {
    id: 'sug-manuscript',
    source_agent: 'archive',
    confidence: 1,
    rationale: AI_SENTENCE,
    target_kind: 'manuscript',
    target_path: 'stories/story/chapters/ch/scenes/scene.md',
    target_anchor: 'Mara crossed the Glass Bridge under twin moons.',
    payload_json: JSON.stringify({
      kind: 'continuity_story_change',
      suggestedText: AI_SENTENCE,
    }),
    status: 'proposed',
    created_at: '2026-10-19T00:00:00.000Z',
    applied_at: null,
    applied_run_id: null,
    budget_exceeded: 0,
    category: 'other',
  };
}

describe('manuscript accept stays status-only (T4)', () => {
  beforeEach(() => {
    vi.mocked(writeVaultFileAtomic).mockClear();
    vi.mocked(writeSceneFile).mockClear();
    vi.mocked(writeSceneFileAtomic).mockClear();
  });

  it('does not write suggestedText when the suggestion targets the manuscript', () => {
    const result = applyVaultWrite(manuscriptSuggestion(), '/tmp/vault', '2026-10-19T00:00:00.000Z');
    expect(result).toEqual({ ok: true, finalStatus: 'accepted', snapshotPath: null });
    const calls = [
      ...vi.mocked(writeVaultFileAtomic).mock.calls,
      ...vi.mocked(writeSceneFile).mock.calls,
      ...vi.mocked(writeSceneFileAtomic).mock.calls,
    ];
    expect(calls).toEqual([]);
    expect(JSON.stringify(calls)).not.toContain(AI_SENTENCE);
  });

  it('the suggestions:accept handler delegates to applyVaultWrite and does not call writeSceneFile', () => {
    const main = fs.readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    const start = main.indexOf('[IPC_CHANNELS.SUGGESTIONS_ACCEPT]');
    expect(start).toBeGreaterThan(-1);
    const slice = main.slice(start, start + 900);
    expect(slice).toContain('applyVaultWrite');
    expect(slice).not.toContain('writeSceneFile');
  });
});
