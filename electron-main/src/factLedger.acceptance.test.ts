import { describe, it } from 'vitest';

/**
 * SKY-10764 — independent acceptance-test verifier (QA, non-author) for
 * M12.2 (SKY-10731, fact-ledger schema + persistent vault index cache),
 * part of the M12 scale-architecture epic (SKY-10729 / SKY-10666).
 *
 * Written from the epic's locked spec + M12.2's acceptance criteria only —
 * NOT from any implementation. As of this run no fact-ledger table exists
 * in electron-main/src/db.ts and electron-main/src/vault/entityIndex.ts
 * still rebuilds fresh on every panel open; M12.2 has no open PR. This
 * slice is explicitly called out in SKY-10764 as still landing, so every
 * case below is `it.todo` — finalize real assertions the moment M12.2's
 * PR merges. Do not patch product code from this file — route failures to
 * the M12.2 owner and report on the epic (SKY-10729).
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
  describe('AC1 — fact-ledger schema is split into a derived/disposable bucket and a durable/decision bucket', () => {
    it.todo('the disposable/derived ledger bucket can be fully purged and rebuilt without touching the durable/decision bucket');
    it.todo('the durable/decision bucket is included in the existing .mythos/ backup path (electron-main/src/backup.ts)');
    it.todo('the fact ledger is a store separate from vault notes — no ledger table is read by note-rendering code paths');
    it.todo('no ledger content is ever surfaced directly as UI (ledger entries never render as notes/content the author sees verbatim)');
  });

  describe('AC2 — entityIndex.ts reads/writes a persistent cache instead of rebuilding on every panel open', () => {
    it.todo(
      'negative control: today\'s entityIndex.ts rebuild-on-open behavior IS measurably slower/re-executed on a repeat ' +
        'panel open with unchanged content — proves the cache-hit assertion below is capable of failing'
    );
    it.todo('opening the entity panel a second time with unchanged vault content reads from the persistent cache, not a fresh rebuild');
    it.todo('a stale-content check (via the existing SHA-256 content hash from versions.ts/draftFiles.ts/snapshots.ts) triggers re-extraction only for changed content');
    it.todo('unchanged content is not re-extracted when the panel reopens');
  });

  describe('AC3 — a dismissed/"don\'t ask again" decision survives a full index rebuild', () => {
    it.todo(
      'negative control: a hard-deleted dismissed flag (no tombstone) DOES regenerate on the next scan/rebuild — ' +
        'proves the tombstone-survival assertion below is capable of failing'
    );
    it.todo('dismissing a flag ("don\'t ask again") writes a tombstone row, not a hard delete');
    it.todo('a full disposable-cache rebuild leaves the tombstoned decision intact — the dismissed item does not reappear');
  });

  describe('AC4 — the extractor resolves entity mentions against the existing wikilink/alias graph, not a new matcher', () => {
    it.todo('entity mentions in extracted facts resolve through vaultGraph.ts / entities.ts / wikiLinks.ts alias resolution');
    it.todo('an alias registered only in the existing wikilink/alias graph is recognized by the extractor without a separate ledger-side alias table');
  });
});
