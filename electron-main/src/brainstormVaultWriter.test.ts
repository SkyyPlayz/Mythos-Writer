// SKY-1484: Brainstorm vault-writer unit tests.
// Tests for buildFrontmatter, resolveActiveDir, assertNotInStoryVault,
// and rejectAllPendingProposals — all pure or DB-only, no Electron/IPC.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildFrontmatter,
  resolveActiveDir,
  assertNotInStoryVault,
  STORY_VAULT_GUARD_ERROR,
} from './brainstormRouting.js';
import { openDb, closeDb, upsertSuggestion, listSuggestions } from './db.js';
import { rejectAllPendingProposals } from './db.js';
import type { NoteProposal } from './brainstormAgent.js';

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vault-writer-'));
}

function makeProposal(overrides: Partial<NoteProposal> = {}): NoteProposal {
  return {
    id: 'test-id-1',
    kind: 'character',
    title: 'Aria',
    destinationPath: '',
    body: 'A brave hero.',
    frontmatter: {},
    sourceConversationTurnId: 'turn-42',
    extractionConfidence: 0.9,
    status: 'pending',
    ...overrides,
  };
}

// ─── buildFrontmatter ─────────────────────────────────────────────────────────

describe('buildFrontmatter — universal fields', () => {
  const NOW = '2026-01-01T00:00:00.000Z';

  it('includes created_by, created_at, source_turn_id for every kind', () => {
    const kinds: NoteProposal['kind'][] = [
      'character', 'location', 'item', 'faction', 'scene_card', 'inbox',
    ];
    for (const kind of kinds) {
      const fm = buildFrontmatter(makeProposal({ kind, title: 'Test' }), NOW);
      expect(fm.created_by).toBe('brainstorm_agent');
      expect(fm.created_at).toBe(NOW);
      expect(fm.source_turn_id).toBe('turn-42');
    }
  });

  it('uses the caller-supplied timestamp — not Date.now()', () => {
    const ts1 = '2026-01-01T00:00:00.000Z';
    const ts2 = '2030-06-15T12:00:00.000Z';
    expect(buildFrontmatter(makeProposal(), ts1).created_at).toBe(ts1);
    expect(buildFrontmatter(makeProposal(), ts2).created_at).toBe(ts2);
  });
});

describe('buildFrontmatter — per-kind required fields', () => {
  const NOW = '2026-01-01T00:00:00.000Z';

  it('character: name + aliases (empty array)', () => {
    const fm = buildFrontmatter(makeProposal({ kind: 'character', title: 'Aria' }), NOW);
    expect(fm.name).toBe('Aria');
    expect(fm.aliases).toEqual([]);
    expect(fm).not.toHaveProperty('title');
  });

  it('location: name only', () => {
    const fm = buildFrontmatter(makeProposal({ kind: 'location', title: 'The Forest' }), NOW);
    expect(fm.name).toBe('The Forest');
    expect(fm).not.toHaveProperty('aliases');
  });

  it('item: name only', () => {
    const fm = buildFrontmatter(makeProposal({ kind: 'item', title: 'Sword' }), NOW);
    expect(fm.name).toBe('Sword');
  });

  it('faction: name + faction_type (blank)', () => {
    const fm = buildFrontmatter(makeProposal({ kind: 'faction', title: 'The Order' }), NOW);
    expect(fm.name).toBe('The Order');
    expect(fm.faction_type).toBe('');
  });

  it('scene_card: title + act (blank)', () => {
    const fm = buildFrontmatter(makeProposal({ kind: 'scene_card', title: 'The Duel' }), NOW);
    expect(fm.title).toBe('The Duel');
    expect(fm.act).toBe('');
    expect(fm).not.toHaveProperty('name');
  });

  it('inbox: only universal fields — no extra required fields', () => {
    const fm = buildFrontmatter(makeProposal({ kind: 'inbox', title: 'Theme idea' }), NOW);
    expect(Object.keys(fm)).toEqual(['created_by', 'created_at', 'source_turn_id']);
  });
});

// ─── resolveActiveDir ────────────────────────────────────────────────────────

describe('resolveActiveDir — cascade', () => {
  let vault: string;

  beforeEach(() => { vault = makeTmp(); });
  afterEach(() => { fs.rmSync(vault, { recursive: true, force: true }); });

  it('Level 1: activeItem provided → resolved immediately without scanning', () => {
    const r = resolveActiveDir('Universes', 'Factions', vault, 'My Universe');
    expect(r.kind).toBe('resolved');
    expect(r.kind === 'resolved' && r.relativeDir).toBe('Universes/My Universe/Factions');
  });

  it('Level 1: activeItem for scene_card (no subFolder) → resolved without trailing slash', () => {
    const r = resolveActiveDir('Stories', '', vault, 'Epic Saga');
    expect(r.kind).toBe('resolved');
    expect(r.kind === 'resolved' && r.relativeDir).toBe('Stories/Epic Saga');
  });

  it('Level 2: single subfolder → auto-resolved', () => {
    fs.mkdirSync(path.join(vault, 'Universes', 'Solo Universe'), { recursive: true });
    const r = resolveActiveDir('Universes', 'Factions', vault);
    expect(r.kind).toBe('resolved');
    expect(r.kind === 'resolved' && r.relativeDir).toBe('Universes/Solo Universe/Factions');
  });

  it('Level 2: single story subfolder → auto-resolved (no subFolder)', () => {
    fs.mkdirSync(path.join(vault, 'Stories', 'My Story'), { recursive: true });
    const r = resolveActiveDir('Stories', '', vault);
    expect(r.kind).toBe('resolved');
    expect(r.kind === 'resolved' && r.relativeDir).toBe('Stories/My Story');
  });

  it('Level 3: multiple subfolders → disambiguation_needed with all options', () => {
    fs.mkdirSync(path.join(vault, 'Universes', 'Universe A'), { recursive: true });
    fs.mkdirSync(path.join(vault, 'Universes', 'Universe B'), { recursive: true });
    const r = resolveActiveDir('Universes', 'Factions', vault);
    expect(r.kind).toBe('disambiguation_needed');
    expect(r.kind === 'disambiguation_needed' && r.options).toEqual([
      'Universes/Universe A/Factions',
      'Universes/Universe B/Factions',
    ]);
  });

  it('Level 3: no subfolders (empty parent) → disambiguation_needed with empty options', () => {
    fs.mkdirSync(path.join(vault, 'Universes'), { recursive: true });
    const r = resolveActiveDir('Universes', 'Factions', vault);
    expect(r.kind).toBe('disambiguation_needed');
    expect(r.kind === 'disambiguation_needed' && r.options).toEqual([]);
  });

  it('Level 3: parent folder does not exist → disambiguation_needed with empty options', () => {
    const r = resolveActiveDir('Universes', 'Factions', vault);
    expect(r.kind).toBe('disambiguation_needed');
    expect(r.kind === 'disambiguation_needed' && r.options).toEqual([]);
  });

  it('hidden directories are excluded from auto-resolve scan', () => {
    fs.mkdirSync(path.join(vault, 'Universes', '.hidden'), { recursive: true });
    fs.mkdirSync(path.join(vault, 'Universes', 'Visible'), { recursive: true });
    const r = resolveActiveDir('Universes', 'Factions', vault);
    expect(r.kind).toBe('resolved');
    expect(r.kind === 'resolved' && r.relativeDir).toBe('Universes/Visible/Factions');
  });

  it('options are sorted alphabetically', () => {
    fs.mkdirSync(path.join(vault, 'Universes', 'Zebra'), { recursive: true });
    fs.mkdirSync(path.join(vault, 'Universes', 'Alpha'), { recursive: true });
    const r = resolveActiveDir('Universes', 'Factions', vault);
    expect(r.kind).toBe('disambiguation_needed');
    const opts = r.kind === 'disambiguation_needed' ? r.options : [];
    expect(opts[0]).toContain('Alpha');
    expect(opts[1]).toContain('Zebra');
  });
});

// ─── assertNotInStoryVault ────────────────────────────────────────────────────

describe('assertNotInStoryVault', () => {
  const storyVault = '/home/user/Mythos/Story Vault';

  it('does not throw for a path in the Notes Vault', () => {
    expect(() =>
      assertNotInStoryVault('/home/user/Mythos/Notes Vault/Inbox/note.md', storyVault),
    ).not.toThrow();
  });

  it('throws STORY_VAULT_GUARD_ERROR when path is inside the Story Vault', () => {
    expect(() =>
      assertNotInStoryVault('/home/user/Mythos/Story Vault/Chapter 1/scene.md', storyVault),
    ).toThrow(STORY_VAULT_GUARD_ERROR);
  });

  it('throws when path equals the Story Vault root exactly', () => {
    expect(() => assertNotInStoryVault(storyVault, storyVault)).toThrow(STORY_VAULT_GUARD_ERROR);
  });

  it('does not throw for a path that shares a prefix with the Story Vault name but is not inside it', () => {
    // "/Story Vault-extra" must NOT be flagged as inside "/Story Vault".
    expect(() =>
      assertNotInStoryVault('/home/user/Mythos/Story Vault-extra/file.md', storyVault),
    ).not.toThrow();
  });
});

// ─── rejectAllPendingProposals ────────────────────────────────────────────────

describe('rejectAllPendingProposals', () => {
  let tmpDir: string;

  function makeSuggestion(
    id: string,
    status: string,
    noteKind: string | null,
  ) {
    upsertSuggestion({
      id,
      source_agent: 'brainstorm',
      confidence: 0.9,
      rationale: 'test',
      target_kind: 'vault',
      target_path: `/${id}.md`,
      target_anchor: null,
      payload_json: '{}',
      status: status as 'proposed',
      created_at: '2026-01-01T00:00:00.000Z',
      applied_at: null,
      applied_run_id: null,
      budget_exceeded: 0,
      category: null,
      extraction_confidence: 0.9,
      source_turn_id: 'turn-1',
      destination_path: null,
      frontmatter: null,
      note_kind: noteKind,
    });
  }

  beforeEach(() => {
    tmpDir = makeTmp();
    openDb(tmpDir);
    makeSuggestion('p1', 'proposed', 'character');
    makeSuggestion('p2', 'proposed', 'faction');
    makeSuggestion('p3', 'proposed', 'inbox');
    // Legacy proposal (no note_kind) — must NOT be touched.
    makeSuggestion('legacy', 'proposed', null);
    // Already confirmed — must NOT be touched.
    makeSuggestion('confirmed', 'accepted', 'item');
    // Already rejected — must NOT be touched.
    makeSuggestion('rejected', 'rejected', 'location');
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the count of rows rejected', () => {
    const count = rejectAllPendingProposals();
    expect(count).toBe(3);
  });

  it('changes status of pending Wave 3.4 proposals to rejected', () => {
    rejectAllPendingProposals();
    const pending = listSuggestions('proposed');
    const pendingIds = pending.map((s) => s.id);
    expect(pendingIds).not.toContain('p1');
    expect(pendingIds).not.toContain('p2');
    expect(pendingIds).not.toContain('p3');
  });

  it('does not touch the legacy proposed row (null note_kind)', () => {
    rejectAllPendingProposals();
    const proposed = listSuggestions('proposed');
    expect(proposed.map((s) => s.id)).toContain('legacy');
  });

  it('does not touch already-confirmed or already-rejected rows', () => {
    rejectAllPendingProposals();
    const accepted = listSuggestions('accepted');
    const rejected = listSuggestions('rejected');
    expect(accepted.map((s) => s.id)).toContain('confirmed');
    // p1/p2/p3 are now rejected, original 'rejected' row stays rejected
    expect(rejected.map((s) => s.id)).toContain('rejected');
  });

  it('returns 0 when no pending proposals exist', () => {
    rejectAllPendingProposals(); // clears Wave 3.4 pending rows
    const count = rejectAllPendingProposals();
    expect(count).toBe(0);
  });
});
