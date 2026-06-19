/**
 * suggestionApply.test.ts — SKY-2579
 *
 * Unit tests for apply / reject / rollback (undo) round-trip.
 *
 * Strategy: use a real tmp directory as the vault root and a real SQLite DB,
 * matching the pattern used in suggestions.test.ts. No Electron mocks needed —
 * applyVaultWrite / rollbackVaultWrite are pure FS+DB functions.
 *
 * Coverage:
 *   §1  apply — vault file updated, snapshot created, DB status=applied
 *   §2  reject — no vault write, DB status=rejected
 *   §3  undo (rollback) — vault file restored from snapshot, DB status=rolled_back
 *   §4  non-vault suggestion — apply returns accepted without any file write
 *   §5  apply to a new (non-existent) file — originalContent captured as empty string
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  openDb,
  closeDb,
  upsertSuggestion,
  updateSuggestionStatus,
  getSuggestion,
  insertAuditLog,
  listAuditLog,
  type DbSuggestion,
} from './db.js';
import { applyVaultWrite, rollbackVaultWrite } from './suggestionApply.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let _seq = 0;

function makeVaultSuggestion(overrides: Partial<DbSuggestion> = {}): DbSuggestion {
  const id = overrides.id ?? `sug-av-${++_seq}`;
  return {
    id,
    source_agent: 'writing-assistant',
    confidence: 0.9,
    rationale: 'test rationale',
    target_kind: 'vault',
    target_path: `scenes/target-${id}.md`,
    target_anchor: null,
    payload_json: JSON.stringify({ content: `# New content for ${id}\n` }),
    status: 'proposed',
    created_at: new Date().toISOString(),
    applied_at: null,
    applied_run_id: null,
    budget_exceeded: 0,
    category: null,
    ...overrides,
  };
}

function makeNonVaultSuggestion(overrides: Partial<DbSuggestion> = {}): DbSuggestion {
  return {
    id: `sug-nv-${++_seq}`,
    source_agent: 'writing-assistant',
    confidence: 0.7,
    rationale: 'pacing note',
    target_kind: 'manuscript',
    target_path: 'Chapter 1/Scene 1.md',
    target_anchor: 'some phrase',
    payload_json: JSON.stringify({ type: 'comment', text: 'too slow' }),
    status: 'proposed',
    created_at: new Date().toISOString(),
    applied_at: null,
    applied_run_id: null,
    budget_exceeded: 0,
    category: null,
    ...overrides,
  };
}

let tmpDir: string;
let vaultDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-apply-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-apply-vault-'));
  // Write a minimal manifest so vault read operations don't throw.
  fs.writeFileSync(
    path.join(vaultDir, 'manifest.json'),
    JSON.stringify({ schemaVersion: 1, stories: [], entities: {} }),
    'utf-8',
  );
  openDb(tmpDir);
});

afterEach(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});

// ─── §1 apply ────────────────────────────────────────────────────────────────

describe('§1 applyVaultWrite — standard vault-content suggestion', () => {
  it('writes new content to the vault file', () => {
    const s = makeVaultSuggestion({ id: 'av-1' });
    upsertSuggestion(s);

    const originalContent = 'ORIGINAL CONTENT\n';
    const targetFullPath = path.join(vaultDir, s.target_path!);
    fs.mkdirSync(path.dirname(targetFullPath), { recursive: true });
    fs.writeFileSync(targetFullPath, originalContent, 'utf-8');

    const now = new Date().toISOString();
    const result = applyVaultWrite(s, vaultDir, now);

    expect(result.finalStatus).toBe('applied');
    expect(result.snapshotPath).not.toBeNull();

    const written = fs.readFileSync(targetFullPath, 'utf-8');
    expect(written).toContain(`New content for ${s.id}`);
  });

  it('creates a snapshot file with the original content', () => {
    const s = makeVaultSuggestion({ id: 'av-2' });
    upsertSuggestion(s);

    const originalContent = 'PRE-APPLY CONTENT\n';
    const targetFullPath = path.join(vaultDir, s.target_path!);
    fs.mkdirSync(path.dirname(targetFullPath), { recursive: true });
    fs.writeFileSync(targetFullPath, originalContent, 'utf-8');

    const now = new Date().toISOString();
    const result = applyVaultWrite(s, vaultDir, now);

    expect(result.snapshotPath).not.toBeNull();
    const fullSnapshotPath = path.join(vaultDir, result.snapshotPath!);
    expect(fs.existsSync(fullSnapshotPath)).toBe(true);

    const snap = JSON.parse(fs.readFileSync(fullSnapshotPath, 'utf-8')) as {
      originalContent: string;
      path: string;
    };
    expect(snap.originalContent).toBe(originalContent);
    expect(snap.path).toBe(s.target_path);
  });

  it('caller can update DB to applied after a successful applyVaultWrite', () => {
    const s = makeVaultSuggestion({ id: 'av-3' });
    upsertSuggestion(s);

    const targetFullPath = path.join(vaultDir, s.target_path!);
    fs.mkdirSync(path.dirname(targetFullPath), { recursive: true });
    fs.writeFileSync(targetFullPath, 'original\n', 'utf-8');

    const now = new Date().toISOString();
    const { finalStatus, snapshotPath } = applyVaultWrite(s, vaultDir, now);

    updateSuggestionStatus(s.id, finalStatus, now, 'run-test');
    insertAuditLog({
      id: 'audit-av-3',
      suggestion_id: s.id,
      action: 'apply',
      snapshot_path: snapshotPath,
      actor: 'user',
      created_at: now,
    });

    const fetched = getSuggestion(s.id)!;
    expect(fetched.status).toBe('applied');
    expect(fetched.applied_run_id).toBe('run-test');

    const entries = listAuditLog(s.id);
    expect(entries[0].action).toBe('apply');
    expect(entries[0].snapshot_path).toBe(snapshotPath);
  });
});

// ─── §2 reject ───────────────────────────────────────────────────────────────

describe('§2 reject — no vault write', () => {
  it('rejecting a suggestion updates DB status without writing any file', () => {
    const s = makeVaultSuggestion({ id: 'rv-1' });
    upsertSuggestion(s);

    const targetFullPath = path.join(vaultDir, s.target_path!);

    const now = new Date().toISOString();
    updateSuggestionStatus(s.id, 'rejected');
    insertAuditLog({
      id: 'audit-rv-1',
      suggestion_id: s.id,
      action: 'reject',
      snapshot_path: null,
      actor: 'user',
      created_at: now,
    });

    expect(getSuggestion(s.id)!.status).toBe('rejected');
    expect(fs.existsSync(targetFullPath)).toBe(false);

    const entries = listAuditLog(s.id);
    expect(entries[0].action).toBe('reject');
  });

  it('rejecting a proposed suggestion does not call applyVaultWrite at all', () => {
    const s = makeVaultSuggestion({ id: 'rv-2' });
    upsertSuggestion(s);

    const targetFullPath = path.join(vaultDir, s.target_path!);

    updateSuggestionStatus(s.id, 'rejected');
    // File must not exist — no applyVaultWrite was called.
    expect(fs.existsSync(targetFullPath)).toBe(false);
    expect(getSuggestion(s.id)!.status).toBe('rejected');
  });
});

// ─── §3 undo (rollback) ──────────────────────────────────────────────────────

describe('§3 rollbackVaultWrite — restores file from snapshot', () => {
  it('restores original file content after a successful apply', () => {
    const s = makeVaultSuggestion({ id: 'rb-1' });
    upsertSuggestion(s);

    const originalContent = 'ORIGINAL BEFORE APPLY\n';
    const targetFullPath = path.join(vaultDir, s.target_path!);
    fs.mkdirSync(path.dirname(targetFullPath), { recursive: true });
    fs.writeFileSync(targetFullPath, originalContent, 'utf-8');

    const now = new Date().toISOString();
    const { finalStatus, snapshotPath } = applyVaultWrite(s, vaultDir, now);
    expect(finalStatus).toBe('applied');

    updateSuggestionStatus(s.id, 'applied', now);
    insertAuditLog({
      id: 'audit-rb-apply',
      suggestion_id: s.id,
      action: 'apply',
      snapshot_path: snapshotPath,
      actor: 'user',
      created_at: now,
    });

    // Verify apply changed the file.
    const afterApply = fs.readFileSync(targetFullPath, 'utf-8');
    expect(afterApply).not.toBe(originalContent);

    // Rollback.
    const restoredPath = rollbackVaultWrite(s.id, vaultDir, snapshotPath);
    expect(restoredPath).toBe(s.target_path);

    const afterRollback = fs.readFileSync(targetFullPath, 'utf-8');
    expect(afterRollback).toBe(originalContent);
  });

  it('updates DB to rolled_back after rollback + full audit trail', () => {
    const s = makeVaultSuggestion({ id: 'rb-2' });
    upsertSuggestion(s);

    const targetFullPath = path.join(vaultDir, s.target_path!);
    fs.mkdirSync(path.dirname(targetFullPath), { recursive: true });
    fs.writeFileSync(targetFullPath, 'ORIGINAL\n', 'utf-8');

    const now = new Date().toISOString();
    const { finalStatus, snapshotPath } = applyVaultWrite(s, vaultDir, now);

    updateSuggestionStatus(s.id, finalStatus, now);
    insertAuditLog({ id: 'audit-rb2-apply', suggestion_id: s.id, action: 'apply', snapshot_path: snapshotPath, actor: 'user', created_at: now });

    rollbackVaultWrite(s.id, vaultDir, snapshotPath);

    updateSuggestionStatus(s.id, 'rolled_back');
    insertAuditLog({ id: 'audit-rb2-rollback', suggestion_id: s.id, action: 'rollback', snapshot_path: snapshotPath, actor: 'user', created_at: now });

    expect(getSuggestion(s.id)!.status).toBe('rolled_back');

    const actions = listAuditLog(s.id).map((e) => e.action);
    expect(actions).toContain('apply');
    expect(actions).toContain('rollback');
  });

  it('returns null when snapshotPath is null and no manifest snapshot exists', () => {
    const result = rollbackVaultWrite('no-such-suggestion', vaultDir, null);
    expect(result).toBeNull();
  });
});

// ─── §4 non-vault suggestion ─────────────────────────────────────────────────

describe('§4 non-vault suggestion — applyVaultWrite is a no-op', () => {
  it('returns accepted without writing any file', () => {
    const s = makeNonVaultSuggestion({ id: 'nv-1' });
    upsertSuggestion(s);

    const now = new Date().toISOString();
    const result = applyVaultWrite(s, vaultDir, now);

    expect(result.finalStatus).toBe('accepted');
    expect(result.snapshotPath).toBeNull();
  });
});

// ─── §5 new (non-existent) file ──────────────────────────────────────────────

describe('§5 apply to new vault file — originalContent is empty string', () => {
  it('creates the file and snapshot with empty originalContent', () => {
    const s = makeVaultSuggestion({ id: 'new-1', target_path: 'new-dir/brand-new.md' });
    upsertSuggestion(s);

    // Do NOT create the target file — it does not exist yet.
    const now = new Date().toISOString();
    const result = applyVaultWrite(s, vaultDir, now);

    expect(result.finalStatus).toBe('applied');
    expect(result.snapshotPath).not.toBeNull();

    const fullSnapshotPath = path.join(vaultDir, result.snapshotPath!);
    const snap = JSON.parse(fs.readFileSync(fullSnapshotPath, 'utf-8')) as {
      originalContent: string;
      path: string;
    };
    expect(snap.originalContent).toBe('');
    expect(snap.path).toBe('new-dir/brand-new.md');

    // Vault file must now exist.
    expect(fs.existsSync(path.join(vaultDir, 'new-dir/brand-new.md'))).toBe(true);
  });
});
