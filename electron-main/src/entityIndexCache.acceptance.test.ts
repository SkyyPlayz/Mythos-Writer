// M12.2 (SKY-10731) acceptance test — persistent vault index cache
// (electron-main/src/vault/entityIndex.ts + db.ts's vault_index_cache table).
// Real DB + real filesystem in a temp directory, no mocks.
//
// This file was `factLedger.acceptance.test.ts` (SKY-10764) and originally
// carried AC1 (fact-ledger schema split), AC3 (dismiss-flag survives
// rebuild) and AC4 (extractor alias resolution) alongside AC2. Owner ruling
// 2026-08-26 (SKY-11035, applied to this PR by SKY-11037) dropped the
// notes-sourced fact ledger and its extractor entirely — the manuscript
// ledger is a separate, CTO-owned system with its own spec. There is no
// notes-side extractor, no "suggested fact" surface, and no dismiss UI to
// test, so AC1/AC3/AC4 have no surviving subject and are not reproduced
// here (not deferred — the feature they targeted isn't being built).
// AC1's durable-bucket-survives-rebuild assertion is still covered, just
// against `fact_decisions` (the bucket that stayed) in factDecisions.test.ts.
//
// AC2 — the persistent entityIndex cache — did ship (loadEntityIndex() in
// entityIndex.ts) and had zero test coverage anywhere in the repo before
// this file (entityIndex.test.ts only covers the pure, DB-free
// buildEntityIndex()). These are real assertions against the merged
// implementation, not skeletons.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb, closeDb, getVaultIndexCacheRows } from './db.js';
import { loadEntityIndex, buildEntityIndex } from './vault/entityIndex.js';
import * as frontmatterParser from './vault/entityFrontmatterParser.js';

describe('M12.2 — persistent vault index cache (acceptance)', () => {
  let tmpDir: string;
  let notesVaultRoot: string;
  let entityPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-entity-cache-'));
    notesVaultRoot = tmpDir;
    openDb(tmpDir);

    const universesDir = path.join(notesVaultRoot, 'Universes');
    fs.mkdirSync(universesDir, { recursive: true });
    entityPath = path.join(universesDir, 'Lyra.md');
    fs.writeFileSync(entityPath, '---\naliases: [The Starchild]\ntype: Character\n---\nA hero.');
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it(
    'negative control: without the cache, buildEntityIndex() re-parses the frontmatter on every call ' +
      'on unchanged content — proves the cache-hit assertion below is capable of failing',
    () => {
      const parseSpy = vi.spyOn(frontmatterParser, 'parseEntityFrontmatter');

      buildEntityIndex(notesVaultRoot);
      expect(parseSpy).toHaveBeenCalledTimes(1);

      buildEntityIndex(notesVaultRoot);
      expect(parseSpy).toHaveBeenCalledTimes(2);
    },
  );

  it('opening the entity panel a second time with unchanged vault content reads from the persistent cache, not a fresh rebuild', () => {
    const parseSpy = vi.spyOn(frontmatterParser, 'parseEntityFrontmatter');

    const first = loadEntityIndex(notesVaultRoot);
    expect(first).toHaveLength(1);
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(getVaultIndexCacheRows()).toHaveLength(1);
    const indexedAtAfterFirst = getVaultIndexCacheRows()[0].indexed_at;

    const second = loadEntityIndex(notesVaultRoot);
    expect(second).toEqual(first);
    // Cache hit: no additional parse, and the cache row is untouched (same
    // indexed_at) rather than rewritten.
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(getVaultIndexCacheRows()[0].indexed_at).toBe(indexedAtAfterFirst);
  });

  it('a stale-content check (SHA-256 content hash) triggers re-extraction only for changed content', () => {
    loadEntityIndex(notesVaultRoot);
    const before = getVaultIndexCacheRows()[0];

    fs.writeFileSync(entityPath, '---\naliases: [The Starchild, Skywalker]\ntype: Character\n---\nA hero, revised.');

    const parseSpy = vi.spyOn(frontmatterParser, 'parseEntityFrontmatter');
    const result = loadEntityIndex(notesVaultRoot);

    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(result[0].aliases).toEqual(['The Starchild', 'Skywalker']);

    const after = getVaultIndexCacheRows()[0];
    expect(after.content_hash).not.toBe(before.content_hash);
    expect(after.needs_rescan).toBe(1);
  });

  it('unchanged content is not re-extracted when the panel reopens (repeat of the no-op case with an explicit third open)', () => {
    loadEntityIndex(notesVaultRoot);
    loadEntityIndex(notesVaultRoot);

    const parseSpy = vi.spyOn(frontmatterParser, 'parseEntityFrontmatter');
    loadEntityIndex(notesVaultRoot);

    expect(parseSpy).not.toHaveBeenCalled();
  });
});
