// Persistent entity-index cache (SKY-10731 / M12.2) — real filesystem and
// real DB in temp directories, no mocks (unlike entityIndex.test.ts, which
// mocks fs to test the pure builder).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildEntityIndex, loadEntityIndex, resolveEntityKeyForFact } from './entityIndex.js';
import {
  openDb,
  closeDb,
  getDb,
  getVaultIndexCacheRows,
  listVaultIndexNeedsRescan,
  clearVaultIndexNeedsRescan,
} from '../db.js';

describe('loadEntityIndex (persistent cache)', () => {
  let vaultRoot: string;
  let lyraPath: string;

  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vault-'));
    fs.mkdirSync(path.join(vaultRoot, 'Universes', 'Characters'), { recursive: true });
    lyraPath = path.join(vaultRoot, 'Universes', 'Characters', 'Lyra.md');
    fs.writeFileSync(lyraPath, '---\naliases: [The Starchild]\ntype: Character\n---\nA hero.');
    openDb(vaultRoot);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(vaultRoot, { recursive: true, force: true });
  });

  it('matches a fresh full rebuild and populates the cache with needs_rescan set', () => {
    const loaded = loadEntityIndex(vaultRoot);
    expect(loaded).toEqual(buildEntityIndex(vaultRoot));
    expect(loaded).toHaveLength(1);
    expect(loaded[0].aliases).toEqual(['The Starchild']);

    const rows = getVaultIndexCacheRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].file_path).toBe(lyraPath);
    expect(rows[0].needs_rescan).toBe(1);
  });

  it('serves unchanged files from the cache without re-parsing', () => {
    loadEntityIndex(vaultRoot);
    // Plant a sentinel in the cached row: if the second load re-parsed the
    // file, the sentinel would be overwritten by the real frontmatter.
    getDb()
      .prepare('UPDATE vault_index_cache SET name = ? WHERE file_path = ?')
      .run('SENTINEL', lyraPath);

    const second = loadEntityIndex(vaultRoot);

    expect(second).toHaveLength(1);
    expect(second[0].name).toBe('SENTINEL');
  });

  it('re-parses only changed content and flips needs_rescan via the SHA-256 hash', () => {
    loadEntityIndex(vaultRoot);
    clearVaultIndexNeedsRescan(lyraPath);
    expect(listVaultIndexNeedsRescan()).toHaveLength(0);
    const oldHash = getVaultIndexCacheRows()[0].content_hash;

    fs.writeFileSync(lyraPath, '---\naliases: [The Starchild, Star of Dawn]\ntype: Character\n---\nA hero.');
    const reloaded = loadEntityIndex(vaultRoot);

    expect(reloaded[0].aliases).toEqual(['The Starchild', 'Star of Dawn']);
    const row = getVaultIndexCacheRows()[0];
    expect(row.content_hash).not.toBe(oldHash);
    expect(row.needs_rescan).toBe(1);
    expect(listVaultIndexNeedsRescan().map((r) => r.file_path)).toEqual([lyraPath]);
  });

  it('does not touch needs_rescan on unchanged files', () => {
    loadEntityIndex(vaultRoot);
    clearVaultIndexNeedsRescan(lyraPath);

    loadEntityIndex(vaultRoot);

    expect(listVaultIndexNeedsRescan()).toHaveLength(0);
  });

  it('purges cache rows for deleted files', () => {
    loadEntityIndex(vaultRoot);
    expect(getVaultIndexCacheRows()).toHaveLength(1);

    fs.rmSync(lyraPath);
    const reloaded = loadEntityIndex(vaultRoot);

    expect(reloaded).toHaveLength(0);
    expect(getVaultIndexCacheRows()).toHaveLength(0);
  });

  it('falls back to a plain rebuild when no DB is open', () => {
    closeDb();
    const loaded = loadEntityIndex(vaultRoot);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('Lyra');
  });
});

describe('resolveEntityKeyForFact', () => {
  it('resolves aliases through the existing matcher to the vault note path', () => {
    const index = [
      { name: 'Lyra', aliases: ['The Starchild'], type: 'Character', path: '/vault/Universes/Characters/Lyra.md' },
      { name: 'Kael', aliases: [], type: 'Character', path: '/vault/Universes/Characters/Kael.md' },
    ];
    expect(resolveEntityKeyForFact('The Starchild', index)).toBe('/vault/Universes/Characters/Lyra.md');
    expect(resolveEntityKeyForFact('kael', index)).toBe('/vault/Universes/Characters/Kael.md');
    expect(resolveEntityKeyForFact('Nobody Known', index)).toBeNull();
  });
});
