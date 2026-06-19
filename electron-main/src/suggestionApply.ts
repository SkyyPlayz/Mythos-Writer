// Vault-write logic for accepted/applied suggestions.
//
// Extracted from main.ts so it can be unit-tested without Electron. Callers
// in main.ts pass vaultRoot and manifestPath (from getVaultRoot()/getManifestPath())
// instead of reading module-level state directly.
//
// Coverage: suggestionApply.test.ts

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  readVaultFile,
  writeVaultFileAtomic,
  mergeProvenanceFrontmatter,
  parseFrontmatter,
  readManifest,
  writeManifest,
} from './vault.js';
import { insertSuggestionSnapshot } from './db.js';
import { applyTypedRelation } from './entities.js';
import type { DbSuggestion } from './db.js';
import type { SuggestionPayload } from '@mythos-writer/shared/types/suggestion';

export type ApplyFinalStatus = 'accepted' | 'applied';

export interface ApplyVaultResult {
  finalStatus: ApplyFinalStatus;
  snapshotPath: string | null;
}

/**
 * Write a suggestion's change to the vault, snapshot the original content,
 * and return whether the write succeeded.
 *
 * For vault suggestions (target_kind='vault' with target_path + payload_json):
 *   - typed-relation payload: mutates the manifest and saves a manifest snapshot
 *   - all other vault payloads: writes new content to target_path, saves a file snapshot
 * For all other suggestions (manuscript / advisory): returns accepted with no file write.
 *
 * Errors during vault write are swallowed so the caller can still update DB state.
 */
export function applyVaultSuggestion(
  vaultRoot: string,
  manifestPath: string,
  suggestion: DbSuggestion,
  now: string,
): ApplyVaultResult {
  if (
    suggestion.target_kind === 'vault' &&
    suggestion.target_path &&
    suggestion.payload_json
  ) {
    try {
      const payloadData = JSON.parse(suggestion.payload_json) as SuggestionPayload & Record<string, unknown>;

      // ─── Typed-relation apply ─────────────────────────────────────────────
      if ((payloadData as { kind?: string }).kind === 'typed-relation') {
        const { relationType, sourceEntityId, targetEntityId } = payloadData as {
          relationType?: string;
          sourceEntityId?: string;
          targetEntityId?: string;
        };
        if (!relationType || !sourceEntityId || !targetEntityId) {
          return { finalStatus: 'accepted', snapshotPath: null };
        }
        const manifest = readManifest(manifestPath);
        insertSuggestionSnapshot({
          id: crypto.randomUUID(),
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

      // ─── Standard vault-file apply ────────────────────────────────────────
      const snapshotDir = path.join(vaultRoot, '.mythos', 'suggestion-snapshots');
      if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir, { recursive: true });
      const relSnapshotPath = path.join('.mythos', 'suggestion-snapshots', `${suggestion.id}.json`);
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

      const { content: rawContent, prose: rawProse } = payloadData as {
        content?: string;
        prose?: string;
      };
      const newContent = rawContent ?? rawProse ?? originalContent;
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
      // Vault write failed — fall through to accepted so DB state stays consistent
    }
  }
  return { finalStatus: 'accepted', snapshotPath: null };
}

/**
 * Restore a vault file (or manifest) from the snapshot recorded when the
 * suggestion was applied. Returns the path that was restored, or null if
 * no restorable snapshot was found.
 *
 * File-based: reads the JSON snapshot at snapshotPath inside vaultRoot,
 *             writes originalContent back to its path.
 * Manifest-based: reads the suggestion_snapshots table entry for this
 *                 suggestion_id (kind='manifest') and rewrites the manifest.
 *
 * Exposed for testing; main.ts delegates the rollback IPC handler here.
 */
export function rollbackVaultSuggestion(
  vaultRoot: string,
  manifestPath: string,
  suggestion: DbSuggestion,
  snapshotPath: string | null,
  getManifestSnapshot: (suggestionId: string) => { payload_json: string } | null,
): string | null {
  if (snapshotPath && suggestion.target_path) {
    const fullSnapshotPath = path.join(vaultRoot, snapshotPath);
    if (fs.existsSync(fullSnapshotPath)) {
      const snap = JSON.parse(fs.readFileSync(fullSnapshotPath, 'utf-8')) as {
        originalContent: string;
        path: string;
      };
      writeVaultFileAtomic(vaultRoot, snap.path, snap.originalContent);
      return snap.path;
    }
  }

  const manifestSnap = getManifestSnapshot(suggestion.id);
  if (manifestSnap) {
    const savedManifest = JSON.parse(manifestSnap.payload_json) as ReturnType<typeof readManifest>;
    writeManifest(manifestPath, savedManifest);
    return manifestPath;
  }

  return null;
}
