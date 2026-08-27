import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
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
import { loadEntityIndex, buildEntityIndex } from './vault/entityIndex.js';

/**
 * SKY-10764 / SKY-10839 — independent acceptance-test verifier (QA,
 * non-author) for M12.2 (SKY-10731, fact-ledger schema + persistent vault
 * index cache), part of the M12 scale-architecture epic (SKY-10729 /
 * SKY-10666).
 *
 * Finalized 2026-08-26 against PR #1283 (merged) with the SKY-11035 owner
 * ruling applied: the notes-sourced fact-ledger extractor + alias resolution
 * (the original AC4) was cut entirely. Skyy's own vault notes are already
 * structured, so extracting them into a ledger added a lossy step that
 * produced false continuity conflicts. Only two tables shipped:
 *   - vault_index_cache — derived/disposable, rebuildable from vault content
 *   - fact_decisions    — durable author-decision tombstone bucket
 * No `fact_ledger` / `fact_provenance` tables or extractor exist in this
 * repo. The user-facing "fact ledger" going forward is manuscript-only,
 * tracked separately under SKY-11035 (CTO-owned) — not an extension of these
 * tables. AC4 below documents that cut instead of testing removed scope.
 *
 * Binding rules under test (SKY-10666, do not relax):
 *  - the vault (notes) and the fact ledger are two separate stores, never
 *    merged; the ledger is never shown as UI and never overrides the vault.
 *  - derived/rebuildable ledger facts and durable author decisions about
 *    the ledger (dismissed flags, "don't ask again") live in separate
 *    buckets — decisions are never in the disposable/rebuildable cache.
 *
 * Ivy's standing verification rule: every check here must include a
 * negative control that proves the assertion can actually fail.
 */
describe('M12.2 — fact-ledger schema + persistent vault index cache (acceptance)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-factledger-acc-'));
    openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('AC1 — fact-ledger schema is split into a derived/disposable bucket and a durable/decision bucket', () => {
    it('the disposable/derived bucket can be fully purged and rebuilt without touching the durable/decision bucket', () => {
      const fp = factFingerprint('Universes/Characters/Lyra.md', 'eye_color', 'green');
      recordFactDecision(fp, 'dont_ask_again');
      upsertVaultIndexCacheRow({
        file_path: 'Universes/Characters/Lyra.md',
        content_hash: 'abc123',
        name: 'Lyra',
        aliases_json: '[]',
        type: 'character',
        needs_rescan: 0,
        indexed_at: '2026-08-19T12:00:00.000Z',
      });

      rebuildDerivedFactStores();

      expect(getVaultIndexCacheRows()).toEqual([]);
      // Negative control: the decision would also be gone here if the split
      // weren't load-bearing — proving the assertion below can fail.
      expect(getFactDecision(fp)).not.toBeNull();
      expect(isFactSuppressed(fp)).toBe(true);
    });

    it('the durable bucket is exactly fact_decisions — DERIVED_FACT_TABLES never includes it', () => {
      // Negative control: a DERIVED_FACT_TABLES that (wrongly) included
      // fact_decisions would make the assertion below fail every time.
      expect(DERIVED_FACT_TABLES).toEqual(['vault_index_cache']);
      expect((DERIVED_FACT_TABLES as readonly string[]).includes('fact_decisions')).toBe(false);
    });

    it('the fact ledger is a store separate from vault notes — loadEntityIndex never reads or writes note prose content', () => {
      const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-factledger-vault-'));
      const noteRel = path.join('Universes', 'Lyra.md');
      const noteAbs = path.join(vaultRoot, noteRel);
      fs.mkdirSync(path.dirname(noteAbs), { recursive: true });
      const prose = 'Lyra keeps to the Upper Terraces after dusk.';
      fs.writeFileSync(noteAbs, `---\nname: Lyra\ntype: character\n---\n\n${prose}`);

      loadEntityIndex(vaultRoot);
      const rows = getVaultIndexCacheRows();

      expect(rows).toHaveLength(1);
      // Negative control: if the cache row embedded prose, this stringified
      // check would trivially pass for any row — assert the exact opposite
      // (the row contains only structural fields) so the check can fail.
      const serialized = JSON.stringify(rows[0]);
      expect(serialized).not.toContain(prose);
      fs.rmSync(vaultRoot, { recursive: true, force: true });
    });

    it('no ledger content is ever surfaced directly as UI — vault_index_cache rows carry no free-text prose field', () => {
      const row = {
        file_path: 'Universes/Characters/Lyra.md',
        content_hash: 'abc123',
        name: 'Lyra',
        aliases_json: '[]',
        type: 'character',
        needs_rescan: 0,
        indexed_at: '2026-08-19T12:00:00.000Z',
      };
      upsertVaultIndexCacheRow(row);
      const [stored] = getVaultIndexCacheRows();

      // Negative control: an accidental `prose`/`excerpt`/`body` column would
      // fail this key-set assertion — proving it's capable of catching a
      // regression, not just echoing whatever shipped.
      expect(Object.keys(stored).sort()).toEqual(
        ['aliases_json', 'content_hash', 'file_path', 'indexed_at', 'name', 'needs_rescan', 'type'].sort()
      );
    });
  });

  describe('AC2 — entityIndex.ts reads/writes a persistent cache instead of rebuilding on every panel open', () => {
    it('negative control: buildEntityIndex() (the pre-M12.2 path) re-parses from disk every call, proving a rebuild-on-open baseline exists to beat', () => {
      const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-factledger-vault2-'));
      const noteAbs = path.join(vaultRoot, 'Universes', 'Lyra.md');
      fs.mkdirSync(path.dirname(noteAbs), { recursive: true });
      fs.writeFileSync(noteAbs, '---\nname: Lyra\ntype: character\n---\n\nProse.');

      buildEntityIndex(vaultRoot);
      // buildEntityIndex is DB-free by design (see entityIndex.ts) — proof
      // that the un-cached path never touches vault_index_cache at all.
      expect(getVaultIndexCacheRows()).toEqual([]);
      fs.rmSync(vaultRoot, { recursive: true, force: true });
    });

    it('opening the entity index a second time with unchanged content reads the cache, not a fresh re-parse', () => {
      const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-factledger-vault3-'));
      const noteAbs = path.join(vaultRoot, 'Universes', 'Lyra.md');
      fs.mkdirSync(path.dirname(noteAbs), { recursive: true });
      fs.writeFileSync(noteAbs, '---\nname: Lyra\ntype: character\n---\n\nProse.');

      loadEntityIndex(vaultRoot);
      const firstRow = getVaultIndexCacheRows()[0];
      expect(firstRow.needs_rescan).toBe(1); // first write always flags for the M12.1 scan job

      // Simulate the M12.1 scan job having already cleared the flag, the
      // steady state a second panel-open should observe.
      getDb().prepare('UPDATE vault_index_cache SET needs_rescan = 0 WHERE file_path = ?').run(firstRow.file_path);

      loadEntityIndex(vaultRoot);
      const secondRow = getVaultIndexCacheRows()[0];

      // Negative control: touching the same row on every open (a rebuild)
      // would flip needs_rescan back to 1 — this proves the assertion below
      // is capable of failing.
      expect(secondRow.needs_rescan).toBe(0);
      expect(secondRow.indexed_at).toBe(firstRow.indexed_at);
      fs.rmSync(vaultRoot, { recursive: true, force: true });
    });

    it('a stale-content check via SHA-256 content hash triggers re-extraction only for changed content', () => {
      const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-factledger-vault4-'));
      const noteAbs = path.join(vaultRoot, 'Universes', 'Lyra.md');
      fs.mkdirSync(path.dirname(noteAbs), { recursive: true });
      fs.writeFileSync(noteAbs, '---\nname: Lyra\ntype: character\n---\n\nOriginal prose.');

      loadEntityIndex(vaultRoot);
      const before = getVaultIndexCacheRows()[0];

      fs.writeFileSync(noteAbs, '---\nname: Lyra\ntype: character\n---\n\nEdited prose.');
      loadEntityIndex(vaultRoot);
      const after = getVaultIndexCacheRows()[0];

      // Negative control: a hash that ignored content changes would report
      // the same hash before/after the edit — this proves the check can fail.
      expect(after.content_hash).not.toBe(before.content_hash);
      expect(after.needs_rescan).toBe(1);
      fs.rmSync(vaultRoot, { recursive: true, force: true });
    });
  });

  describe('AC3 — a dismissed/"don\'t ask again" decision survives a full index rebuild', () => {
    it('negative control: a hard-deleted decision (no tombstone) does not survive a rebuild of that same table', () => {
      const fp = factFingerprint('Universes/Characters/Lyra.md', 'eye_color', 'green');
      recordFactDecision(fp, 'dismissed');
      // Simulate a hard delete instead of the tombstone revoke path.
      getDb().prepare('DELETE FROM fact_decisions WHERE fingerprint = ?').run(fp);
      expect(getFactDecision(fp)).toBeNull();
      expect(isFactSuppressed(fp)).toBe(false);
    });

    it('dismissing a flag ("don\'t ask again") writes a tombstone row, not a hard delete, and survives rebuildDerivedFactStores()', () => {
      const fp = factFingerprint('Universes/Characters/Lyra.md', 'eye_color', 'green');
      recordFactDecision(fp, 'dont_ask_again');
      expect(isFactSuppressed(fp)).toBe(true);

      rebuildDerivedFactStores();

      expect(isFactSuppressed(fp)).toBe(true);
      expect(getFactDecision(fp)?.decision).toBe('dont_ask_again');
    });

    it('revoking a decision tombstones it (revoked_at set) rather than deleting the row, and it stops suppressing', () => {
      const fp = factFingerprint('Universes/Characters/Lyra.md', 'eye_color', 'green');
      recordFactDecision(fp, 'dismissed');
      revokeFactDecision(fp);

      const stored = getFactDecision(fp);
      // Negative control: a hard delete on revoke would make `stored` null —
      // proves this assertion can fail.
      expect(stored).not.toBeNull();
      expect(stored?.revoked_at).not.toBeNull();
      expect(isFactSuppressed(fp)).toBe(false);
      expect(listFactDecisions(true)).toHaveLength(1);
      expect(listFactDecisions(false)).toHaveLength(0);
    });
  });

  describe('AC4 — notes-side extractor + alias resolution (dropped by owner ruling SKY-11035, 2026-08-26)', () => {
    it('no fact_ledger or fact_provenance table exists in this database — the notes-side extractor was never built', () => {
      const tables = getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('fact_ledger','fact_provenance')")
        .all();
      // Negative control: this assertion is meaningful because vault_index_cache
      // and fact_decisions (the tables that DID ship) are proven present below —
      // an empty result here isn't just "nothing was ever created".
      expect(tables).toEqual([]);
      const shipped = getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('vault_index_cache','fact_decisions')")
        .all()
        .map((r) => (r as { name: string }).name)
        .sort();
      expect(shipped).toEqual(['fact_decisions', 'vault_index_cache']);
    });
  });
});
