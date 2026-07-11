// Vault-write logic for applying/rolling back suggestions.
// Pure FS operations with explicit vaultRoot — no Electron imports, no module-level
// state, fully unit-testable against a real tmp directory.

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { DbSuggestion } from './db.js';
import { insertSuggestionSnapshot, getSuggestionSnapshot } from './db.js';
import {
  readVaultFile,
  writeVaultFileAtomic,
  readManifest,
  writeManifest,
  parseFrontmatter,
  mergeProvenanceFrontmatter,
  safePath,
} from './vault.js';
import { resolveManifestPath } from './mythosFormat/mythosJson.js';
import { applyTypedRelation } from './entities.js';
import type { SuggestionPayload } from './shared/types/suggestion.js';

export interface ApplyVaultWriteResult {
  finalStatus: 'accepted' | 'applied';
  snapshotPath: string | null;
}

/**
 * Attempt to apply a suggestion's payload to the vault.
 *
 * For `kind='typed-relation'` suggestions, writes reciprocal entity-relation
 * frontmatter and saves a manifest snapshot for rollback.
 *
 * For all other vault suggestions, writes the new file content and saves a
 * file snapshot at `.mythos/suggestion-snapshots/<id>.json`.
 *
 * Returns `finalStatus='applied'` on a successful write, `'accepted'` when
 * the suggestion does not target the vault or the write fails gracefully.
 */
export function applyVaultWrite(
  suggestion: DbSuggestion,
  vaultRoot: string,
  now: string,
): ApplyVaultWriteResult {
  if (
    suggestion.target_kind !== 'vault' ||
    !suggestion.target_path ||
    !suggestion.payload_json
  ) {
    return { finalStatus: 'accepted', snapshotPath: null };
  }

  try {
    const payloadData = JSON.parse(suggestion.payload_json) as SuggestionPayload;

    // ─── Typed-relation apply ───────────────────────────────────────────────
    if (payloadData.kind === 'typed-relation') {
      const { relationType, sourceEntityId, targetEntityId } = payloadData;
      if (!relationType || !sourceEntityId || !targetEntityId) {
        return { finalStatus: 'accepted', snapshotPath: null };
      }
      const manifestPath = resolveManifestPath(vaultRoot); // M5: v2 vaults use the .mythos cache
      const manifest = readManifest(manifestPath);
      // Save manifest snapshot before mutation so rollback can restore it.
      insertSuggestionSnapshot({
        id: randomUUID(),
        suggestion_id: suggestion.id,
        snapshot_kind: 'manifest',
        payload_json: JSON.stringify(manifest),
        created_at: now,
      });
      const { sourceWritten, targetWritten } = applyTypedRelation(
        vaultRoot,
        manifest,
        { relationType, sourceEntityId, targetEntityId },
      );
      writeManifest(manifestPath, manifest);
      return {
        finalStatus: sourceWritten || targetWritten ? 'applied' : 'accepted',
        snapshotPath: null,
      };
    }

    // ─── Standard vault-write apply ────────────────────────────────────────
    const snapshotDir = path.join(vaultRoot, '.mythos', 'suggestion-snapshots');
    if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir, { recursive: true });

    const relSnapshotPath = path.join(
      '.mythos', 'suggestion-snapshots', `${suggestion.id}.json`,
    );
    const fullSnapshotPath = path.join(vaultRoot, relSnapshotPath);

    let originalContent = '';
    try {
      const { content: vc } = readVaultFile(vaultRoot, suggestion.target_path);
      originalContent = vc;
    } catch { /* new file — empty original */ }

    fs.writeFileSync(
      fullSnapshotPath,
      JSON.stringify({ originalContent, path: suggestion.target_path }),
      'utf-8',
    );

    const newContent = payloadData.content ?? payloadData.prose ?? originalContent;
    const { prose: newProse } = parseFrontmatter(newContent);
    mergeProvenanceFrontmatter(vaultRoot, suggestion.target_path, {
      source_agent: suggestion.source_agent,
      confidence: suggestion.confidence,
      rationale: suggestion.rationale,
      timestamp: now,
      run_id: suggestion.applied_run_id ?? undefined,
      suggestion_id: suggestion.id,
    }, newProse);

    return { finalStatus: 'applied', snapshotPath: relSnapshotPath };
  } catch {
    // Vault write failed — fall through to accepted without file write.
  }

  return { finalStatus: 'accepted', snapshotPath: null };
}

/**
 * Restore a vault file or manifest from the snapshot saved when the suggestion
 * was applied. Returns the path that was restored, or null if no snapshot exists.
 *
 * Mirrors the rollback logic in main.ts SUGGESTIONS_ROLLBACK handler.
 */
export function rollbackVaultWrite(
  suggestionId: string,
  vaultRoot: string,
  snapshotPath: string | null,
): string | null {
  if (snapshotPath) {
    safePath(vaultRoot, snapshotPath); // throws on path traversal
    const fullSnapshotPath = path.join(vaultRoot, snapshotPath);
    if (fs.existsSync(fullSnapshotPath)) {
      const snap = JSON.parse(
        fs.readFileSync(fullSnapshotPath, 'utf-8'),
      ) as { originalContent: string; path: string };
      writeVaultFileAtomic(vaultRoot, snap.path, snap.originalContent);
      return snap.path;
    }
  } else {
    // Try manifest snapshot (typed-relation rollback).
    const manifestSnap = getSuggestionSnapshot(suggestionId, 'manifest');
    if (manifestSnap) {
      const manifestPath = resolveManifestPath(vaultRoot); // M5: v2 vaults use the .mythos cache
      const savedManifest = JSON.parse(manifestSnap.payload_json) as Parameters<typeof writeManifest>[1];
      writeManifest(manifestPath, savedManifest);
      return manifestPath;
    }
  }
  return null;
}
