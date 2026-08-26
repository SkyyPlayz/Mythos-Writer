// Fact ledger (SKY-10731 / M12.2) — real DB in a temp directory, no mocks.
// Verifies the durable-vs-derived split is load-bearing: a full derived
// rebuild wipes facts/provenance/cache but never author decisions.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { DatabaseSync } from 'node:sqlite';
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

  // SKY-10769 AC2: ledger records are rebuildable — delete every ledger row,
  // restart the app, and the same extraction pass over the unchanged source
  // text reconstructs the identical fact set. The extractor here is a
  // deterministic stand-in (the real one lands in M12.4); what this proves is
  // the schema property: facts are a pure function of source text, so the
  // store is disposable.
  describe('ledger rebuild from source text (SKY-10769 AC2)', () => {
    const SOURCE_PATH = 'Stories/Novel/ch01.md';
    const SOURCE_TEXT = 'Lyra’s eyes were green. Kael carried a silverblade.';

    function extractionPass(sourcePath: string, sourceText: string) {
      const sourceHash = createHash('sha256').update(sourceText, 'utf-8').digest('hex');
      const extracted: { entity_key: string; fact_key: string; fact_value: string }[] = [];
      for (const m of sourceText.matchAll(/(\w+)['’]s eyes were (\w+)/g)) {
        extracted.push({ entity_key: `Universes/Characters/${m[1]}.md`, fact_key: 'eye_color', fact_value: m[2] });
      }
      for (const m of sourceText.matchAll(/(\w+) carried a (\w+)/g)) {
        extracted.push({ entity_key: `Universes/Characters/${m[1]}.md`, fact_key: 'carries', fact_value: m[2] });
      }
      return extracted.map((f) =>
        upsertFact({ ...f, source_path: sourcePath, source_hash: sourceHash, extracted_at: NOW }),
      );
    }

    it('delete all ledger rows → restart → identical extraction reconstructs identical facts', () => {
      extractionPass(SOURCE_PATH, SOURCE_TEXT);
      const before = listFacts()
        .map((f) => f.fingerprint)
        .sort();
      expect(before).toHaveLength(2);

      rebuildDerivedFactStores(); // "delete all ledger rows"
      closeDb();
      openDb(tmpDir); // "restart app"
      expect(listFacts()).toHaveLength(0); // the wipe persisted

      extractionPass(SOURCE_PATH, SOURCE_TEXT); // next scan over unchanged source
      const after = listFacts()
        .map((f) => f.fingerprint)
        .sort();
      expect(after).toEqual(before);
    });
  });

  // SKY-10769 AC4/AC5: vault and fact ledger are separate stores — no schema
  // entanglement. The checker flags any foreign key that crosses the
  // vault/ledger boundary. Negative control first: a deliberately merged
  // schema (ledger row keyed by FK into a vault table) must be caught,
  // proving the checker can fail — then the real schema must pass it.
  describe('vault/ledger store separation (SKY-10769 AC5)', () => {
    const LEDGER_TABLES = ['fact_ledger', 'fact_provenance', 'vault_index_cache', 'fact_decisions'];

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

    it('negative control: a merged schema (ledger FK into a vault table) is detected', () => {
      const merged = new DatabaseSync(':memory:');
      merged.exec(`
        CREATE TABLE entity_index (id TEXT PRIMARY KEY, name TEXT);
        CREATE TABLE fact_ledger (
          id         TEXT PRIMARY KEY,
          entity_id  TEXT NOT NULL REFERENCES entity_index(id),
          fact_key   TEXT NOT NULL,
          fact_value TEXT NOT NULL
        );
      `);
      expect(findStoreEntanglements(merged)).toEqual(['fact_ledger → entity_index']);
      merged.close();
    });

    it('real schema: no foreign key crosses the vault/ledger boundary', () => {
      expect(findStoreEntanglements(getDb())).toEqual([]);
    });

    it('ledger entity keys are wikilink target paths, not vault row references', () => {
      const fact = upsertFact(makeFact());
      // The canonical entity key is the vault note path (the wikilink target)
      // — resolvable against the vault but never a DB-level reference into it.
      expect(fact.entity_key).toBe('Universes/Characters/Lyra.md');
      const cols = getDb()
        .prepare("PRAGMA table_info('fact_ledger')")
        .all() as { name: string; type: string }[];
      expect(cols.find((c) => c.name === 'entity_key')?.type).toBe('TEXT');
    });
  });
});
