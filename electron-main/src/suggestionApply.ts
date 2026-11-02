// Vault-write logic for applying/rolling back suggestions.
// Pure FS operations with explicit vaultRoot — no Electron imports, no module-level
// state, fully unit-testable against a real tmp directory.

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { DbSuggestion } from './db.js';
import type { Manifest } from './ipc.js';
import {
  insertSuggestionSnapshot,
  getSuggestionSnapshot,
  getSuggestion,
  insertAuditLog,
  updateSuggestionStatus,
} from './db.js';
import {
  readManifest,
  writeManifest,
  parseFrontmatter,
  composeProvenanceContent,
  safePath,
} from './vault.js';
import { resolveManifestPath } from './mythosFormat/mythosJson.js';
import { applyTypedRelation, updateEntity } from './entities.js';
import { SafeIpcError } from './ipcErrors.js';
import * as aiGuard from './vault/aiWriteGuard.js';
import type { AiWriteRefuseReason } from './vault/aiWriteGuard.js';

export type { AiWriteRefuseReason };

export type ApplyVaultWriteResult =
  | {
      ok: true;
      finalStatus: 'accepted' | 'applied';
      snapshotPath: string | null;
      refuseAudit?: true;
      reason?: 'unknown_kind';
    }
  | { ok: false; reason: AiWriteRefuseReason };

export function refusalUserMessage(reason: AiWriteRefuseReason): string {
  if (reason === 'manuscript_target') {
    return "AI can't edit your manuscript. Make this change yourself.";
  }
  if (reason === 'no_manifest') {
    return "Couldn't read your story's index, so AI note updates are paused. Reopen the vault and try again.";
  }
  return "1 note suggestion couldn't be saved. It's waiting for you to review.";
}

export class SuggestionRefusedError extends SafeIpcError {
  readonly reason: AiWriteRefuseReason;

  constructor(reason: AiWriteRefuseReason) {
    super(refusalUserMessage(reason));
    this.name = 'SuggestionRefusedError';
    this.reason = reason;
  }
}

interface ContentPayload {
  kind: 'content';
  content?: string;
  prose?: string;
}

interface RelationPayload {
  kind: 'typed-relation';
  relationType?: string;
  sourceEntityId?: string;
  targetEntityId?: string;
}

type ParsedPayload = ContentPayload | RelationPayload | { kind: 'other' } | { kind: 'invalid' };

function readPayload(json: string | null): ParsedPayload {
  if (!json) return { kind: 'invalid' };
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object') return { kind: 'invalid' };
    data = parsed as Record<string, unknown>;
  } catch {
    return { kind: 'invalid' };
  }
  if (data.kind === 'typed-relation') {
    return {
      kind: 'typed-relation',
      relationType: typeof data.relationType === 'string' ? data.relationType : undefined,
      sourceEntityId: typeof data.sourceEntityId === 'string' ? data.sourceEntityId : undefined,
      targetEntityId: typeof data.targetEntityId === 'string' ? data.targetEntityId : undefined,
    };
  }
  if (data.kind === undefined || data.kind === 'content') {
    return {
      kind: 'content',
      content: typeof data.content === 'string' ? data.content : undefined,
      prose: typeof data.prose === 'string' ? data.prose : undefined,
    };
  }
  return { kind: 'other' };
}

function normRel(p: string): string {
  return p.split('\\').join('/');
}

function loadManifest(vaultRoot: string): { ok: true; manifest: Manifest; manifestPath: string } | { ok: false } {
  let manifestPath: string;
  try {
    manifestPath = resolveManifestPath(vaultRoot);
    const manifest = readManifest(manifestPath);
    if (!manifest || !Array.isArray(manifest.stories) || !Array.isArray(manifest.scenes) || !Array.isArray(manifest.entities)) {
      return { ok: false };
    }
    return { ok: true, manifest, manifestPath };
  } catch {
    return { ok: false };
  }
}

function applyTyped(
  suggestion: DbSuggestion,
  vaultRoot: string,
  now: string,
  payload: RelationPayload,
): ApplyVaultWriteResult {
  if (!payload.relationType || !payload.sourceEntityId || !payload.targetEntityId) {
    return { ok: false, reason: 'unresolved_relation' };
  }
  const loaded = loadManifest(vaultRoot);
  if (!loaded.ok) return { ok: false, reason: 'no_manifest' };
  const source = loaded.manifest.entities.find((e) => e.id === payload.sourceEntityId);
  const target = loaded.manifest.entities.find((e) => e.id === payload.targetEntityId);
  if (!source?.path || !target?.path) return { ok: false, reason: 'unresolved_relation' };
  const sourceGuard = aiGuard.assertAiWritable(vaultRoot, source.path);
  const targetGuard = aiGuard.assertAiWritable(vaultRoot, target.path);
  if (!sourceGuard.ok) return sourceGuard;
  if (!targetGuard.ok) return targetGuard;
  insertSuggestionSnapshot({
    id: randomUUID(),
    suggestion_id: suggestion.id,
    snapshot_kind: 'manifest',
    payload_json: JSON.stringify(loaded.manifest),
    created_at: now,
  });
  const { sourceWritten, targetWritten } = applyTypedRelation(
    vaultRoot,
    loaded.manifest,
    {
      relationType: payload.relationType,
      sourceEntityId: payload.sourceEntityId,
      targetEntityId: payload.targetEntityId,
    },
    { source: sourceGuard.abs, target: targetGuard.abs },
  );
  writeManifest(loaded.manifestPath, loaded.manifest);
  return {
    ok: true,
    finalStatus: sourceWritten || targetWritten ? 'applied' : 'accepted',
    snapshotPath: null,
  };
}

function applyContent(
  suggestion: DbSuggestion,
  vaultRoot: string,
  now: string,
  payload: ContentPayload,
): ApplyVaultWriteResult {
  if (!suggestion.target_path) return { ok: false, reason: 'not_allowlisted' };
  const guard = aiGuard.assertAiWritable(vaultRoot, suggestion.target_path);
  if (!guard.ok) return guard;

  const snapshotDir = path.join(vaultRoot, '.mythos', 'suggestion-snapshots');
  if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir, { recursive: true });
  const relSnapshotPath = path.join('.mythos', 'suggestion-snapshots', `${suggestion.id}.json`);
  const fullSnapshotPath = path.join(vaultRoot, relSnapshotPath);

  let originalContent = '';
  try {
    originalContent = fs.readFileSync(guard.abs, 'utf8');
  } catch {
    // new file — empty original
  }
  fs.writeFileSync(
    fullSnapshotPath,
    JSON.stringify({ originalContent, path: suggestion.target_path }),
    'utf8',
  );

  const newContent = payload.content ?? payload.prose ?? originalContent;
  const { prose: newProse } = parseFrontmatter(newContent);
  const written = composeProvenanceContent(vaultRoot, suggestion.target_path, {
    source_agent: suggestion.source_agent,
    confidence: suggestion.confidence,
    rationale: suggestion.rationale,
    timestamp: now,
    run_id: suggestion.applied_run_id ?? undefined,
    suggestion_id: suggestion.id,
  }, newProse, guard.abs);
  aiGuard.writeAiCanonical(guard.abs, written);
  return { ok: true, finalStatus: 'applied', snapshotPath: relSnapshotPath };
}

/**
 * Attempt to apply a suggestion's payload to the vault.
 * A refused write returns ok:false and does not touch the row.
 * Manuscript-kind rows stay status-only accepted.
 */
export function applyVaultWrite(
  suggestion: DbSuggestion,
  vaultRoot: string,
  now: string,
): ApplyVaultWriteResult {
  const targetKind = suggestion.target_kind as string | null;

  if (targetKind === 'manuscript') {
    return { ok: true, finalStatus: 'accepted', snapshotPath: null };
  }
  if (targetKind !== 'vault' && targetKind !== null) {
    return {
      ok: true,
      finalStatus: 'accepted',
      snapshotPath: null,
      refuseAudit: true,
      reason: 'unknown_kind',
    };
  }
  if (targetKind === null) {
    const payload = readPayload(suggestion.payload_json);
    if (
      payload.kind === 'typed-relation'
      && payload.relationType
      && payload.sourceEntityId
      && payload.targetEntityId
    ) {
      return applyTyped(suggestion, vaultRoot, now, payload);
    }
    return { ok: true, finalStatus: 'accepted', snapshotPath: null };
  }

  const payload = readPayload(suggestion.payload_json);
  if (payload.kind === 'typed-relation') return applyTyped(suggestion, vaultRoot, now, payload);
  if (payload.kind === 'content') return applyContent(suggestion, vaultRoot, now, payload);
  return { ok: false, reason: 'unknown_kind' };
}

export function suggestionLockKeys(suggestion: DbSuggestion, vaultRoot: string): string[] {
  const payload = readPayload(suggestion.payload_json);
  if (payload.kind === 'typed-relation' && payload.sourceEntityId && payload.targetEntityId) {
    try {
      const loaded = loadManifest(vaultRoot);
      if (loaded.ok) {
        const source = loaded.manifest.entities.find((e) => e.id === payload.sourceEntityId);
        const target = loaded.manifest.entities.find((e) => e.id === payload.targetEntityId);
        const keys: string[] = [];
        if (source?.path) keys.push(aiGuard.aiWriteLockKey(vaultRoot, source.path));
        if (target?.path) keys.push(aiGuard.aiWriteLockKey(vaultRoot, target.path));
        if (keys.length > 0) return keys;
      }
    } catch {
      // Fall through to the row path.
    }
  }
  if (suggestion.target_path) return [aiGuard.aiWriteLockKey(vaultRoot, suggestion.target_path)];
  return [`suggestion:${suggestion.id}`];
}

export async function applyVaultWriteLocked(
  suggestion: DbSuggestion,
  vaultRoot: string,
  now: string,
): Promise<ApplyVaultWriteResult> {
  return aiGuard.withAiFileLocks(
    suggestionLockKeys(suggestion, vaultRoot),
    () => applyVaultWrite(suggestion, vaultRoot, now),
  );
}

/** Auto-mark never writes. Only a manuscript-kind row is marked accepted. */
export function performAutoMark(suggestion: { target_kind: string | null }): { markAccepted: boolean } {
  return { markAccepted: suggestion.target_kind === 'manuscript' };
}

export function writeGuardedContinuityNote(args: {
  storyRoot: string;
  notesRoot: string;
  foundRoot: string;
  relPath: string;
  nextContent: string;
}): { ok: true } | { ok: false; reason: AiWriteRefuseReason } {
  const guard = aiGuard.assertAiWritable(args.foundRoot, args.relPath, {
    classC: { notesRoot: args.notesRoot, storyRoot: args.storyRoot },
  });
  if (!guard.ok) return guard;
  aiGuard.writeAiCanonical(guard.abs, args.nextContent);
  return { ok: true };
}

export function writeGuardedArchiveEntity(
  vaultRoot: string,
  manifest: Manifest,
  entityId: string,
  properties: Record<string, unknown>,
): { ok: true } | { ok: false; reason: AiWriteRefuseReason } {
  const entity = manifest.entities.find((e) => e.id === entityId);
  if (!entity?.path) return { ok: true };
  const guard = aiGuard.assertAiWritable(vaultRoot, entity.path);
  if (!guard.ok) return guard;
  updateEntity(vaultRoot, manifest, entityId, {
    properties: { ...(entity.properties ?? {}), ...properties },
  }, guard.abs);
  return { ok: true };
}

/**
 * Restore a vault file or manifest from the snapshot saved when the suggestion
 * was applied. Returns the path that was restored, or null if no snapshot exists.
 * A snapshot aimed at a path the guard refuses throws SuggestionRefusedError.
 */
export function rollbackVaultWrite(
  suggestionId: string,
  vaultRoot: string,
  snapshotPath: string | null,
): string | null {
  if (snapshotPath) {
    safePath(vaultRoot, snapshotPath);
    const fullSnapshotPath = path.join(vaultRoot, snapshotPath);
    if (fs.existsSync(fullSnapshotPath)) {
      const snap = JSON.parse(
        fs.readFileSync(fullSnapshotPath, 'utf8'),
      ) as { originalContent: string; path: string };
      const suggestion = getSuggestion(suggestionId);
      const target = suggestion?.target_path ?? '';
      if (normRel(snap.path) !== normRel(target)) {
        throw new SuggestionRefusedError('not_allowlisted');
      }
      const guard = aiGuard.assertAiWritable(vaultRoot, snap.path);
      if (!guard.ok) throw new SuggestionRefusedError(guard.reason);
      aiGuard.writeAiCanonical(guard.abs, snap.originalContent);
      return snap.path;
    }
  } else {
    const manifestSnap = getSuggestionSnapshot(suggestionId, 'manifest');
    if (manifestSnap) {
      const manifestPath = resolveManifestPath(vaultRoot);
      const savedManifest = JSON.parse(manifestSnap.payload_json) as Parameters<typeof writeManifest>[1];
      writeManifest(manifestPath, savedManifest);
      return manifestPath;
    }
  }
  return null;
}

export function commitSuggestionWrite(
  suggestionId: string,
  result: ApplyVaultWriteResult,
  now: string,
  actor: string,
  auditId: string,
): { id: string; status: 'accepted' | 'applied'; auditId: string } {
  if (!result.ok) {
    insertAuditLog({
      id: auditId,
      suggestion_id: suggestionId,
      action: 'refuse',
      snapshot_path: null,
      actor,
      created_at: now,
    });
    throw new SuggestionRefusedError(result.reason);
  }
  updateSuggestionStatus(suggestionId, result.finalStatus, now);
  insertAuditLog({
    id: auditId,
    suggestion_id: suggestionId,
    action: result.refuseAudit ? 'refuse' : (result.finalStatus === 'applied' ? 'apply' : 'accept'),
    snapshot_path: result.snapshotPath,
    actor,
    created_at: now,
  });
  return { id: suggestionId, status: result.finalStatus, auditId };
}

export async function rollbackVaultWriteLocked(
  suggestionId: string,
  vaultRoot: string,
  snapshotPath: string | null,
): Promise<string | null> {
  const suggestion = getSuggestion(suggestionId);
  const key = suggestion?.target_path
    ? aiGuard.aiWriteLockKey(vaultRoot, suggestion.target_path)
    : `rollback:${suggestionId}`;
  return aiGuard.withAiFileLock(key, () => rollbackVaultWrite(suggestionId, vaultRoot, snapshotPath));
}
