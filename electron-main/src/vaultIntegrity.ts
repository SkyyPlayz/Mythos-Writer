// SKY-2308: Vault manifest integrity check + orphan detection.
// Pure functions — no Electron dependency; fully testable in Node.
import fs from 'fs';
import path from 'path';
import { SCHEMA_VERSION } from './manifest.js';
import { parseFrontmatter, defaultManifest, reindexVault, writeManifest, CHAPTER_META_FILENAME } from './vault.js';
import { reindexEntities } from './entities.js';
import { isUnderRoot } from './pathSecurity.js';
import type { Manifest, VaultIntegrityReport, VaultRebuildManifestResponse } from './ipc.js';

/**
 * Collect all vault-relative `.md` file paths, applying the same skip rules
 * as the existing reindexVault scanner (dotfile dirs, `versions/`, `chapter.md`).
 */
function collectMdFiles(dir: string, base = ''): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'versions') continue;
      results.push(...collectMdFiles(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith('.md')) {
      if (entry.name === CHAPTER_META_FILENAME) continue;
      results.push(rel);
    }
  }
  return results;
}

/**
 * Check the integrity of a vault manifest against the actual files on disk.
 *
 * - `orphanedManifestEntries`: scene/entity IDs whose `.md` file is missing.
 * - `unindexedFiles`: `.md` files on disk not referenced by the manifest.
 * - `manifestSchemaMismatch`: schemaVersion differs from current SCHEMA_VERSION.
 * - `corruptedEntries`: IDs whose file exists but has no parseable `id` field
 *   in frontmatter (or cannot be read at all).
 */
export function checkIntegrity(manifest: Manifest, vaultRoot: string): VaultIntegrityReport {
  // Build a normalised set of vault-relative paths indexed in the manifest.
  // Also include boardReferences so board files are not flagged as unindexed.
  const indexedPaths = new Set<string>();
  const manifestEntries: Array<{ id: string; relPath: string }> = [];

  const addScene = (id: string, relPath: string) => {
    indexedPaths.add(relPath);
    manifestEntries.push({ id, relPath });
  };

  for (const scene of manifest.scenes ?? []) addScene(scene.id, scene.path);
  for (const story of manifest.stories ?? []) {
    for (const chapter of story.chapters ?? []) {
      for (const scene of chapter.scenes ?? []) addScene(scene.id, scene.path);
    }
  }
  for (const entity of manifest.entities ?? []) {
    indexedPaths.add(entity.path);
    manifestEntries.push({ id: entity.id, relPath: entity.path });
  }
  // Board references are indexed — don't report them as unindexed files.
  for (const boardRef of manifest.boardReferences ?? []) {
    indexedPaths.add(boardRef);
  }

  // Identify orphaned entries (manifest points to a missing file) and corrupted
  // entries (file exists but has unreadable or ID-less frontmatter).
  const orphanedManifestEntries: string[] = [];
  const corruptedEntries: string[] = [];

  for (const { id, relPath } of manifestEntries) {
    // Reject absolute paths and ../  traversal — report as corrupted rather than reading them.
    if (!isUnderRoot(vaultRoot, relPath)) {
      corruptedEntries.push(id);
      continue;
    }
    const absPath = path.resolve(vaultRoot, relPath);
    if (!fs.existsSync(absPath)) {
      orphanedManifestEntries.push(id);
      continue;
    }
    try {
      const content = fs.readFileSync(absPath, 'utf-8');
      const { frontmatter } = parseFrontmatter(content);
      if (!frontmatter.id) {
        corruptedEntries.push(id);
      }
    } catch {
      corruptedEntries.push(id);
    }
  }

  // Find .md files on disk that are not referenced by the manifest.
  const diskFiles = collectMdFiles(vaultRoot);
  const unindexedFiles = diskFiles.filter((f) => !indexedPaths.has(f));

  // Schema version comparison.
  const manifestSchemaMismatch = manifest.schemaVersion !== SCHEMA_VERSION;

  return { orphanedManifestEntries, unindexedFiles, manifestSchemaMismatch, corruptedEntries };
}

/**
 * Rebuild the manifest from disk by scanning all `.md` files in the vault.
 * Idempotent — calling twice produces the same result (same disk state → same output).
 * Overwrites the existing manifest.json atomically.
 */
export function rebuildManifest(vaultRoot: string): VaultRebuildManifestResponse {
  const empty = defaultManifest(vaultRoot);

  // reindexVault scans all scene .md files and adds them to the manifest.
  const { manifest: withScenes } = reindexVault(vaultRoot, empty);

  // reindexEntities scans entities/ and adds any orphan entity files.
  reindexEntities(vaultRoot, withScenes);

  const scenesFound =
    (withScenes.scenes ?? []).length +
    (withScenes.stories ?? []).reduce(
      (acc, s) =>
        acc + (s.chapters ?? []).reduce((a, c) => a + (c.scenes ?? []).length, 0),
      0,
    );
  const entitiesFound = (withScenes.entities ?? []).length;

  writeManifest(path.join(vaultRoot, 'manifest.json'), withScenes);

  return { rebuilt: true, scenesFound, entitiesFound };
}
