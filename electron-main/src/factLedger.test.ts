// Fact ledger (SKY-10731 / M12.2) — real DB in a temp directory, no mocks.
// Verifies the durable-vs-derived split is load-bearing: a full derived
// rebuild wipes facts/provenance/cache but never author decisions.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  openDb,
  closeDb,
  getDb,
  factFingerprint,
  upsertFact,
  getFactByFingerprint,
  listFacts,
  listFactProvenance,
  supersedeFactsForSource,
  purgeOrphanFacts,
  rebuildDerivedFactStores,
  recordFactDecision,
  getFactDecision,
  listFactDecisions,
  revokeFactDecision,
  isFactSuppressed,
  upsertVaultIndexCacheRow,
  getVaultIndexCacheRows,
  DERIVED_FACT_TABLES,
} from './db.js';

const NOW = '2026-08-19T12:00:00.000Z';

function makeFact(overrides: Partial<Parameters<typeof upsertFact>[0]> = {}) {
  return {
    entity_key: 'Universes/Characters/Lyra.md',
    fact_key: 'eye_color',
    fact_value: 'green',
    source_path: 'Stories/Novel/ch01.md',
    source_hash: 'a'.repeat(64),
    extracted_at: NOW,
    ...overrides,
  };
}

describe('fact ledger', () => {
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
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('fact_ledger','fact_provenance','vault_index_cache','fact_decisions')")
      .all()
      .map((r) => (r as { name: string }).name)
      .sort();
    expect(tables).toEqual(['fact_decisions', 'fact_ledger', 'fact_provenance', 'vault_index_cache']);
  });

  it('collapses duplicate extractions into one fact row with N provenance entries', () => {
    const a = upsertFact(makeFact({ source_path: 'Stories/Novel/ch01.md' }));
    const b = upsertFact(makeFact({ source_path: 'Stories/Novel/ch07.md' }));
    expect(b.id).toBe(a.id);
    expect(listFacts()).toHaveLength(1);
    expect(listFactProvenance(a.id)).toHaveLength(2);
  });

  it('re-extracting the same fact from the same source refreshes, not duplicates, provenance', () => {
    const f = upsertFact(makeFact({ source_hash: 'a'.repeat(64) }));
    upsertFact(makeFact({ source_hash: 'b'.repeat(64) }));
    const prov = listFactProvenance(f.id);
    expect(prov).toHaveLength(1);
    expect(prov[0].source_hash).toBe('b'.repeat(64));
  });

  it('supersede-on-re-extract: single-source facts no longer produced go superseded', () => {
    const kept = upsertFact(makeFact({ fact_key: 'eye_color', fact_value: 'green' }));
    const dropped = upsertFact(makeFact({ fact_key: 'hair_color', fact_value: 'silver' }));

    const count = supersedeFactsForSource('Stories/Novel/ch01.md', [kept.fingerprint]);

    expect(count).toBe(1);
    expect(getFactByFingerprint(kept.fingerprint)?.status).toBe('active');
    expect(getFactByFingerprint(dropped.fingerprint)?.status).toBe('superseded');
    // Re-extraction of a superseded fact re-activates the same row.
    const revived = upsertFact(makeFact({ fact_key: 'hair_color', fact_value: 'silver' }));
    expect(revived.id).toBe(dropped.id);
    expect(revived.status).toBe('active');
  });

  it('supersede keeps facts corroborated by another source active', () => {
    const f = upsertFact(makeFact({ source_path: 'Stories/Novel/ch01.md' }));
    upsertFact(makeFact({ source_path: 'Stories/Novel/ch07.md' }));

    const count = supersedeFactsForSource('Stories/Novel/ch01.md', []);

    expect(count).toBe(0);
    expect(getFactByFingerprint(f.fingerprint)?.status).toBe('active');
    const prov = listFactProvenance(f.id);
    expect(prov).toHaveLength(1);
    expect(prov[0].source_path).toBe('Stories/Novel/ch07.md');
  });

  it('orphan purge deletes facts whose sources are all gone, keeps the rest', () => {
    const orphan = upsertFact(makeFact({ fact_key: 'gone', source_path: 'Stories/deleted.md' }));
    const kept = upsertFact(makeFact({ fact_key: 'stays', source_path: 'Stories/Novel/ch01.md' }));

    const deleted = purgeOrphanFacts(['Stories/Novel/ch01.md']);

    expect(deleted).toBe(1);
    expect(getFactByFingerprint(orphan.fingerprint)).toBeNull();
    expect(getFactByFingerprint(kept.fingerprint)).not.toBeNull();
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
    it('negative control: a decision stored in a derived table does NOT survive rebuild', () => {
      // Misfile the dismissal as a derived fact row (the unprotected table).
      const wrong = upsertFact(makeFact({ fact_key: 'decision:dismissed', fact_value: '1' }));
      expect(getFactByFingerprint(wrong.fingerprint)).not.toBeNull();

      rebuildDerivedFactStores();

      // The "decision" regenerates as undecided — exactly the bug the durable
      // bucket exists to prevent.
      expect(getFactByFingerprint(wrong.fingerprint)).toBeNull();
      expect(isFactSuppressed(wrong.fingerprint)).toBe(false);
    });

    it('durable bucket: a dismissed decision survives the identical rebuild unchanged', () => {
      const fact = upsertFact(makeFact());
      recordFactDecision(fact.fingerprint, 'dismissed', '{"reason":"author says eyes are grey"}');
      const before = getFactDecision(fact.fingerprint);
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
      expect(listFacts()).toHaveLength(0);
      expect(getVaultIndexCacheRows()).toHaveLength(0);
      for (const table of DERIVED_FACT_TABLES) {
        const row = getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
        expect(row.n).toBe(0);
      }
      // …but the decision is byte-for-byte intact and still suppresses.
      expect(getFactDecision(fact.fingerprint)).toEqual(before);
      expect(isFactSuppressed(fact.fingerprint)).toBe(true);

      // Post-rebuild re-extraction sees the fact again yet stays suppressed.
      const reextracted = upsertFact(makeFact());
      expect(isFactSuppressed(reextracted.fingerprint)).toBe(true);
    });
  });
});
