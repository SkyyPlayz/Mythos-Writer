// Unit tests for SKY-170: @mention parsing and scene_entity_links CRUD
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  openDb,
  closeDb,
  getDb,
  upsertSceneEntityLink,
  deleteSceneEntityLink,
  listSceneEntityLinks,
  listLinkedSceneIds,
  deleteStaleSceneMentionLinks,
} from './db.js';

// ─── Helpers ───

function tmpVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sel-'));
  fs.mkdirSync(path.join(dir, '.mythos'), { recursive: true });
  return dir;
}

let _seq = 0;
function uid(): string { return `test-id-${++_seq}`; }

// Pre-seed entity_index rows required by the FK on scene_entity_links.entity_id.
// Node 22 DatabaseSync enforces FKs by default, so entity_id must exist in entity_index.
function seedEntity(entityId: string): void {
  const now = '2024-01-01T00:00:00Z';
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO entity_index
         (id, type, name, aliases, tags, status, core_fields, custom_fields, notes_text, file_path, created_at, updated_at)
       VALUES (?, 'character', ?, null, null, 'active', null, null, null, 'test.md', ?, ?)`
    )
    .run(entityId, entityId, now, now);
}

// Replicate parseMentionEntityIds locally so tests do not depend on main.ts
function parseMentionEntityIds(prose: string): Set<string> {
  const ids = new Set<string>();
  const re = /\[[^\]]*\]\(entity:\/\/(ent_[^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prose)) !== null) {
    ids.add(m[1]);
  }
  return ids;
}

// ─── @mention parsing ───

describe('parseMentionEntityIds', () => {
  it('extracts a single entity ID', () => {
    const prose = 'He spoke to [Elara](entity://ent_abc123) at dawn.';
    expect([...parseMentionEntityIds(prose)]).toEqual(['ent_abc123']);
  });

  it('extracts multiple distinct entity IDs', () => {
    const prose = '[Alice](entity://ent_aaa) met [Bob](entity://ent_bbb) and [Alice](entity://ent_aaa) again.';
    const ids = parseMentionEntityIds(prose);
    expect(ids.size).toBe(2);
    expect(ids.has('ent_aaa')).toBe(true);
    expect(ids.has('ent_bbb')).toBe(true);
  });

  it('ignores regular markdown links', () => {
    const prose = 'See [the docs](https://example.com) for more.';
    expect(parseMentionEntityIds(prose).size).toBe(0);
  });

  it('ignores malformed entity URIs without ent_ prefix', () => {
    const prose = '[thing](entity://badid)';
    expect(parseMentionEntityIds(prose).size).toBe(0);
  });

  it('returns empty set for prose with no mentions', () => {
    expect(parseMentionEntityIds('No mentions here.').size).toBe(0);
  });

  it('handles empty prose', () => {
    expect(parseMentionEntityIds('').size).toBe(0);
  });
});

// ─── DB: scene_entity_links CRUD ───

describe('scene_entity_links DB operations', () => {
  let vaultDir: string;

  beforeEach(() => {
    vaultDir = tmpVault();
    openDb(vaultDir);
    // Seed entity_index rows so FK constraint is satisfied
    seedEntity('ent_a');
    seedEntity('ent_b');
    seedEntity('ent_x');
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  it('upserts and lists a link', () => {
    upsertSceneEntityLink({ id: uid(), scene_id: 'sc1', entity_id: 'ent_a', link_kind: 'mention', created_at: '2024-01-01T00:00:00Z' });
    const links = listSceneEntityLinks('sc1');
    expect(links).toHaveLength(1);
    expect(links[0].entity_id).toBe('ent_a');
    expect(links[0].link_kind).toBe('mention');
  });

  it('upsert is idempotent (INSERT OR IGNORE)', () => {
    const now = '2024-01-01T00:00:00Z';
    upsertSceneEntityLink({ id: uid(), scene_id: 'sc1', entity_id: 'ent_a', link_kind: 'mention', created_at: now });
    upsertSceneEntityLink({ id: uid(), scene_id: 'sc1', entity_id: 'ent_a', link_kind: 'mention', created_at: now });
    expect(listSceneEntityLinks('sc1')).toHaveLength(1);
  });

  it('deletes a specific link', () => {
    const now = '2024-01-01T00:00:00Z';
    upsertSceneEntityLink({ id: uid(), scene_id: 'sc1', entity_id: 'ent_a', link_kind: 'mention', created_at: now });
    upsertSceneEntityLink({ id: uid(), scene_id: 'sc1', entity_id: 'ent_b', link_kind: 'tag', created_at: now });
    deleteSceneEntityLink('sc1', 'ent_a', 'mention');
    const links = listSceneEntityLinks('sc1');
    expect(links).toHaveLength(1);
    expect(links[0].entity_id).toBe('ent_b');
  });

  it('lists linked scenes by entity', () => {
    const now = '2024-01-01T00:00:00Z';
    upsertSceneEntityLink({ id: uid(), scene_id: 'sc1', entity_id: 'ent_x', link_kind: 'mention', created_at: now });
    upsertSceneEntityLink({ id: uid(), scene_id: 'sc2', entity_id: 'ent_x', link_kind: 'tag', created_at: now });
    const rows = listLinkedSceneIds('ent_x');
    expect(rows.map((r) => r.scene_id).sort()).toEqual(['sc1', 'sc2']);
  });

  it('returns empty list when no links exist for a scene', () => {
    expect(listSceneEntityLinks('nonexistent')).toHaveLength(0);
  });
});

// ─── Stale-link cleanup ───

describe('deleteStaleSceneMentionLinks', () => {
  let vaultDir: string;

  beforeEach(() => {
    vaultDir = tmpVault();
    openDb(vaultDir);
    // Seed entity_index rows so FK constraint is satisfied
    seedEntity('ent_a');
    seedEntity('ent_b');
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  it('removes mention rows whose entityId is not in keepIds', () => {
    const now = '2024-01-01T00:00:00Z';
    upsertSceneEntityLink({ id: uid(), scene_id: 'sc1', entity_id: 'ent_a', link_kind: 'mention', created_at: now });
    upsertSceneEntityLink({ id: uid(), scene_id: 'sc1', entity_id: 'ent_b', link_kind: 'mention', created_at: now });
    // Keep only ent_a; ent_b should be removed
    deleteStaleSceneMentionLinks('sc1', ['ent_a']);
    const links = listSceneEntityLinks('sc1');
    expect(links).toHaveLength(1);
    expect(links[0].entity_id).toBe('ent_a');
  });

  it('removes all mention rows when keepIds is empty', () => {
    const now = '2024-01-01T00:00:00Z';
    upsertSceneEntityLink({ id: uid(), scene_id: 'sc1', entity_id: 'ent_a', link_kind: 'mention', created_at: now });
    upsertSceneEntityLink({ id: uid(), scene_id: 'sc1', entity_id: 'ent_b', link_kind: 'mention', created_at: now });
    deleteStaleSceneMentionLinks('sc1', []);
    expect(listSceneEntityLinks('sc1')).toHaveLength(0);
  });

  it('does not remove tag-kind rows during stale cleanup', () => {
    const now = '2024-01-01T00:00:00Z';
    upsertSceneEntityLink({ id: uid(), scene_id: 'sc1', entity_id: 'ent_a', link_kind: 'mention', created_at: now });
    upsertSceneEntityLink({ id: uid(), scene_id: 'sc1', entity_id: 'ent_b', link_kind: 'tag', created_at: now });
    // Remove all mention rows (empty keepIds); tag should survive
    deleteStaleSceneMentionLinks('sc1', []);
    const links = listSceneEntityLinks('sc1');
    expect(links).toHaveLength(1);
    expect(links[0].link_kind).toBe('tag');
  });

  it('does not affect other scenes', () => {
    const now = '2024-01-01T00:00:00Z';
    upsertSceneEntityLink({ id: uid(), scene_id: 'sc1', entity_id: 'ent_a', link_kind: 'mention', created_at: now });
    upsertSceneEntityLink({ id: uid(), scene_id: 'sc2', entity_id: 'ent_a', link_kind: 'mention', created_at: now });
    deleteStaleSceneMentionLinks('sc1', []);
    // sc2 link should be untouched
    expect(listSceneEntityLinks('sc2')).toHaveLength(1);
  });
});
