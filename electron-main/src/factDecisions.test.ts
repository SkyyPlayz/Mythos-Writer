// Fact decisions (SKY-10731 / M12.2) — real DB in a temp directory, no mocks.
// Verifies the durable-vs-derived split is load-bearing: a full derived
// rebuild wipes the vault index cache but never author decisions.
//
// The notes-sourced fact ledger (fact_ledger/fact_provenance) originally
// covered here was split out by owner ruling 2026-08-26 into SKY-11035
// (manuscript-side, CTO-owned) — see db.ts's "Fact decisions" section
// comment. This file keeps only the coverage for what stayed: vault_index_cache
// (derived) and fact_decisions (durable).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import {
  openDb,
  closeDb,
  getDb,
  factFingerprint,
  recordFactDecision,
  getFactDecision,
  listFactDecisions,
  revokeFactDecision,
  isFactSuppressed,
  upsertVaultIndexCacheRow,
  getVaultIndexCacheRows,
  rebuildDerivedFactStores,
  DERIVED_FACT_TABLES,
} from './db.js';

const NOW = '2026-08-19T12:00:00.000Z';

describe('fact decisions', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-facts-'));
    openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('migration v30 creates both buckets', () => {
    const tables = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('vault_index_cache','fact_decisions')")
      .all()
      .map((r) => (r as { name: string }).name)
      .sort();
    expect(tables).toEqual(['fact_decisions', 'vault_index_cache']);
  });

  it('tombstones decisions on revoke instead of deleting the row', () => {
    const fp = factFingerprint('Universes/Characters/Lyra.md', 'eye_color', 'green');
    recordFactDecision(fp, 'dismissed');
    expect(isFactSuppressed(fp)).toBe(true);

    revokeFactDecision(fp);

    expect(isFactSuppressed(fp)).toBe(false);
    const row = getFactDecision(fp);
    expect(row).not.toBeNull();
    expect(row?.revoked_at).not.toBeNull();
    expect(listFactDecisions(true)).toHaveLength(1);
    expect(listFactDecisions(false)).toHaveLength(0);

    // Re-dismissing reuses the tombstoned row.
    recordFactDecision(fp, 'dont_ask_again');
    expect(isFactSuppressed(fp)).toBe(true);
    expect(listFactDecisions(true)).toHaveLength(1);
  });

  // Verification path required by SKY-10731: negative control first — prove a
  // decision stored in an unprotected (derived) table is LOST by a rebuild —
  // then prove the durable bucket survives the identical rebuild unchanged.
  describe('durable/derived split under full rebuild', () => {
    it('negative control: a decision misfiled into a derived table does NOT survive rebuild', () => {
      // Misfile the dismissal as a derived cache row (the unprotected table)
      // instead of recording it as a proper fact_decisions row.
      const fp = factFingerprint('Universes/Characters/Lyra.md', 'decision:dismissed', '1');
      upsertVaultIndexCacheRow({
        file_path: `__misfiled_decision__/${fp}`,
        content_hash: 'a'.repeat(64),
        name: 'misfiled',
        aliases_json: '[]',
        type: null,
        needs_rescan: 0,
        indexed_at: NOW,
      });
      expect(getVaultIndexCacheRows()).toHaveLength(1);

      rebuildDerivedFactStores();

      // The "decision" regenerates as undecided — exactly the bug the durable
      // bucket exists to prevent.
      expect(getVaultIndexCacheRows()).toHaveLength(0);
      expect(isFactSuppressed(fp)).toBe(false);
    });

    it('durable bucket: a dismissed decision survives the identical rebuild unchanged', () => {
      const fp = factFingerprint('Universes/Characters/Lyra.md', 'eye_color', 'green');
      recordFactDecision(fp, 'dismissed', '{"reason":"author says eyes are grey"}');
      const before = getFactDecision(fp);
      upsertVaultIndexCacheRow({
        file_path: '/vault/Universes/Characters/Lyra.md',
        content_hash: 'c'.repeat(64),
        name: 'Lyra',
        aliases_json: '[]',
        type: 'Character',
        needs_rescan: 0,
        indexed_at: NOW,
      });

      rebuildDerivedFactStores();

      // Every derived store is empty…
      expect(getVaultIndexCacheRows()).toHaveLength(0);
      for (const table of DERIVED_FACT_TABLES) {
        const row = getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
        expect(row.n).toBe(0);
      }
      // …but the decision is byte-for-byte intact and still suppresses.
      expect(getFactDecision(fp)).toEqual(before);
      expect(isFactSuppressed(fp)).toBe(true);
    });
  });

  // SKY-10769 AC4/AC5: vault and fact-ledger stores are separate — no schema
  // entanglement. The checker flags any foreign key that crosses the
  // vault/ledger boundary. Negative control first: a deliberately merged
  // schema (a ledger-style row keyed by FK into a vault table) must be
  // caught, proving the checker can fail — then the real schema must pass it.
  describe('vault/ledger store separation (SKY-10769 AC5)', () => {
    const LEDGER_TABLES = ['vault_index_cache', 'fact_decisions'];

    function findStoreEntanglements(db: DatabaseSync): string[] {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all()
        .map((r) => (r as { name: string }).name);
      const violations: string[] = [];
      for (const table of tables) {
        const fromLedger = LEDGER_TABLES.includes(table);
        const fks = db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as { table: string }[];
        for (const fk of fks) {
          if (fromLedger !== LEDGER_TABLES.includes(fk.table)) {
            violations.push(`${table} → ${fk.table}`);
          }
        }
      }
      return violations;
    }

    it('negative control: a merged schema (ledger table FK into a vault table) is detected', () => {
      const merged = new DatabaseSync(':memory:');
      merged.exec(`
        CREATE TABLE entity_index (id TEXT PRIMARY KEY, name TEXT);
        CREATE TABLE vault_index_cache (
          id         TEXT PRIMARY KEY,
          entity_id  TEXT NOT NULL REFERENCES entity_index(id),
          fact_key   TEXT NOT NULL,
          fact_value TEXT NOT NULL
        );
      `);
      expect(findStoreEntanglements(merged)).toEqual(['vault_index_cache → entity_index']);
      merged.close();
    });

    it('real schema: no foreign key crosses the vault/ledger boundary', () => {
      expect(findStoreEntanglements(getDb())).toEqual([]);
    });
  });

  // SKY-10772 M12.5: agent-index:clean handler logic — tombstonesIntact flag.
  // The handler reports before/after decision counts; a mismatch flags data loss.
  describe('agent-index:clean handler contract (SKY-10772 AC-5)', () => {
    it('negative control: losing a decision during clean reduces the count and makes tombstonesIntact false', () => {
      const fp = factFingerprint('Universes/Characters/Aria.md', 'trait', 'bold');
      recordFactDecision(fp, 'dismissed');
      const before = listFactDecisions(true).length;
      // Simulate a buggy clean that also wipes fact_decisions (which real handler must NOT do)
      getDb().prepare('DELETE FROM fact_decisions').run();
      const after = listFactDecisions(true).length;
      expect(before).toBe(1);
      expect(after).toBe(0);
      // This divergence is what tombstonesIntact detects
      expect(before === after).toBe(false);
    });

    it('clean leaves fact_decisions count identical (tombstonesIntact = true)', () => {
      const fp1 = factFingerprint('Universes/Characters/Aria.md', 'trait', 'brave');
      const fp2 = factFingerprint('Universes/Locations/Vale.md', 'climate', 'cold');
      recordFactDecision(fp1, 'dismissed');
      recordFactDecision(fp2, 'dont_ask_again');
      upsertVaultIndexCacheRow({
        file_path: '/vault/file.md',
        content_hash: 'b'.repeat(64),
        name: 'File',
        aliases_json: '[]',
        type: null,
        needs_rescan: 0,
        indexed_at: NOW,
      });
      const before = listFactDecisions(true).length;
      rebuildDerivedFactStores();
      const after = listFactDecisions(true).length;
      expect(before).toBe(2);
      expect(after).toBe(2);
      // tombstonesIntact = before === after
      expect(before === after).toBe(true);
      // cache is gone; decisions remain
      expect(getVaultIndexCacheRows()).toHaveLength(0);
    });
  });
});
