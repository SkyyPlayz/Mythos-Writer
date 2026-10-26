// Create and save artifact records. Vault storage only when the owner gate is yes.

import fs from 'fs';
import path from 'path';
import { AI_DISABLED_MESSAGE, isAiMasterOn } from '../provider.js';
import { writeVaultFileAtomicAbs } from '../vault.js';
import { auditRefusal } from './artifactAudit.js';
import { confirmCleanup, sweepArtifacts, artifactUserDataDir, artifactVaultDir } from './artifactCleanup.js';
import { refreshArtifact } from './artifactRefresh.js';
import { shareArtifactPrompt } from './artifactPrompt.js';
import {
  ARTIFACT_SCHEMA_VERSION,
  ARTIFACTS_ENGINE,
  ARTIFACTS_WRITE_BACK_EXTENDED,
  type ArtifactRecord,
  type ArtifactTargetKind,
  type OwnerGateAnswer,
  guardMutant,
  isUuidV4,
  parseArtifactEditMsg,
  sha256Text,
} from './artifactSchema.js';
import { writeBack } from './artifactWriteBack.js';

export interface ArtifactSaveInput {
  id: string;
  vaultRoot: string;
  userData: string;
  vaultId: string;
  body: string;
  dataSchema?: Record<string, unknown>;
  bound?: ArtifactRecord['bound'];
  engine?: boolean;
  owner?: OwnerGateAnswer;
}

export function artifactStoragePath(input: {
  id: string;
  vaultRoot: string;
  userData: string;
  vaultId: string;
  owner: OwnerGateAnswer;
}): { ok: true; file: string; root: string } | { ok: false; reason: string } {
  if (!isUuidV4(input.id) || !isUuidV4(input.vaultId)) return { ok: false, reason: 'bad_id' };
  if (input.owner === 'yes') {
    const root = artifactVaultDir(input.vaultRoot);
    return { ok: true, root, file: path.join(root, `${input.id}.json`) };
  }
  const root = artifactUserDataDir(input.userData, input.vaultId);
  if (!root) return { ok: false, reason: 'bad_id' };
  return { ok: true, root, file: path.join(root, `${input.id}.json`) };
}

export function saveArtifact(input: ArtifactSaveInput): { ok: true; file: string; record: ArtifactRecord } | { ok: false; reason: string } {
  const engine = input.engine ?? ARTIFACTS_ENGINE;
  const owner = input.owner ?? 'unanswered';
  if (!engine && !guardMutant('gate-removed')) {
    return { ok: false, reason: 'flag_off' };
  }
  try {
    const located = artifactStoragePath({ ...input, owner: owner === 'yes' ? 'yes' : 'no' });
    if (!located.ok) return located;
    const record: ArtifactRecord = {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      id: input.id,
      bound: input.bound ?? null,
      body: input.body,
      dataSchema: input.dataSchema ?? {},
      updatedAt: new Date().toISOString(),
    };
    writeVaultFileAtomicAbs(located.file, JSON.stringify(record));
    return { ok: true, file: located.file, record };
  } catch (err) {
    auditRefusal({
      artifactId: input.id,
      kind: 'save',
      reason: 'fail_closed',
      path: input.vaultRoot,
    });
    if (guardMutant('allow-on-exception')) throw err;
    return { ok: false, reason: 'fail_closed' };
  }
}

export function readArtifactFile(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function asRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  return payload as Record<string, unknown>;
}

function engineOpen(): boolean {
  return ARTIFACTS_ENGINE || guardMutant('gate-removed');
}

export function handleArtifactSave(payload: unknown): { ok: boolean; reason?: string; file?: string } {
  const body = asRecord(payload);
  if (!body) return { ok: false, reason: 'bad_schema' };
  const edit = parseArtifactEditMsg({
    type: 'edit',
    artifactId: body.artifactId,
    origin: body.origin,
    text: typeof body.body === 'string' ? body.body : '',
  });
  if (!edit.ok) return { ok: false, reason: 'bad_schema' };
  return saveArtifact({
    id: edit.value.artifactId,
    vaultRoot: typeof body.vaultRoot === 'string' ? body.vaultRoot : '',
    userData: typeof body.userData === 'string' ? body.userData : '',
    vaultId: typeof body.vaultId === 'string' ? body.vaultId : '',
    body: edit.value.text,
    engine: ARTIFACTS_ENGINE,
    owner: 'unanswered',
  });
}

export function handleArtifactBind(payload: unknown): { ok: boolean; reason?: string; sha256?: string } {
  const saved = handleArtifactSave(payload);
  if (!saved.ok) return saved;
  const body = asRecord(payload);
  const target = body && typeof body.targetPath === 'string' ? body.targetPath : '';
  let text = '';
  try {
    text = fs.readFileSync(target, 'utf8');
  } catch {
    text = '';
  }
  return { ok: true, sha256: sha256Text(text) };
}

export function handleArtifactWriteBack(payload: unknown): { ok: boolean; reason?: string } {
  const body = asRecord(payload);
  if (!body) return { ok: false, reason: 'bad_schema' };
  const edit = parseArtifactEditMsg(body.edit ?? {
    type: body.type,
    artifactId: body.artifactId,
    origin: body.origin,
    text: body.text,
  });
  if (!edit.ok) return { ok: false, reason: 'bad_schema' };
  const kind = body.kind;
  const allowed: readonly ArtifactTargetKind[] = ['note', 'codex', 'metric', 'scene', 'manuscript', 'unknown'];
  if (typeof kind !== 'string' || !(allowed as readonly string[]).includes(kind)) {
    return { ok: false, reason: 'bad_schema' };
  }
  if (!engineOpen()) return { ok: false, reason: 'flag_off' };
  return writeBack({
    artifactId: edit.value.artifactId,
    vaultRoot: typeof body.vaultRoot === 'string' ? body.vaultRoot : '',
    targetPath: typeof body.targetPath === 'string' ? body.targetPath : '',
    kind: kind as ArtifactTargetKind,
    boundSha256: typeof body.boundSha256 === 'string' ? body.boundSha256 : '',
    content: edit.value.text,
    origin: 'user',
    editorOpen: body.editorOpen === true,
    extended: ARTIFACTS_WRITE_BACK_EXTENDED,
  });
}

export function handleArtifactRefresh(payload: unknown): { ok: boolean; error?: string; proposal?: { artifactId: string; text: string; outputTokens: number } } {
  if (!isAiMasterOn()) return { ok: false, error: AI_DISABLED_MESSAGE };
  if (!engineOpen()) return { ok: false, error: 'flag_off' };
  const body = asRecord(payload);
  if (!body || typeof body.artifactId !== 'string') return { ok: false, error: 'bad_schema' };
  return refreshArtifact({
    artifactId: body.artifactId,
    selfTrigger: body.selfTrigger === true,
    outputTokens: typeof body.outputTokens === 'number' ? body.outputTokens : 0,
    usage: {
      used: typeof (body.usage as { used?: number } | undefined)?.used === 'number' ? (body.usage as { used: number }).used : 0,
      cap: typeof (body.usage as { cap?: number } | undefined)?.cap === 'number' ? (body.usage as { cap: number }).cap : 0,
    },
    propose: () => (typeof body.proposal === 'string' ? body.proposal : ''),
  });
}

export function handleArtifactSharePrompt(payload: unknown): { ok: boolean; error?: string; card?: { type: 'prompt-card'; source: string; dataSchema: Record<string, unknown> } } {
  if (!isAiMasterOn()) return { ok: false, error: AI_DISABLED_MESSAGE };
  if (!engineOpen()) return { ok: false, error: 'flag_off' };
  const body = asRecord(payload);
  if (!body || typeof body.body !== 'string') return { ok: false, error: 'bad_schema' };
  const dataSchema = body.dataSchema && typeof body.dataSchema === 'object' ? body.dataSchema as Record<string, unknown> : {};
  return shareArtifactPrompt({ body: body.body, dataSchema });
}

export function handleArtifactDelete(payload: unknown): { ok: boolean; reason?: string } {
  if (!engineOpen()) return { ok: false, reason: 'flag_off' };
  const body = asRecord(payload);
  if (!body || !Array.isArray(body.paths) || typeof body.listHash !== 'string') return { ok: false, reason: 'bad_schema' };
  const paths = body.paths.filter((item): item is string => typeof item === 'string');
  return confirmCleanup({
    paths,
    listHash: body.listHash,
    vaultRoot: typeof body.vaultRoot === 'string' ? body.vaultRoot : '',
    userData: typeof body.userData === 'string' ? body.userData : '',
    vaultId: typeof body.vaultId === 'string' ? body.vaultId : '',
    allowDelete: false,
  });
}

export function handleArtifactSweep(payload: unknown): { ok: boolean; reason?: string } {
  const body = asRecord(payload);
  if (!body) return { ok: false, reason: 'bad_schema' };
  if (!isUuidV4(typeof body.vaultId === 'string' ? body.vaultId : '')) return { ok: false, reason: 'bad_vault_id' };
  return sweepArtifacts({
    vaultRoot: typeof body.vaultRoot === 'string' ? body.vaultRoot : '',
    userData: typeof body.userData === 'string' ? body.userData : '',
    vaultId: body.vaultId as string,
    flagOff: !engineOpen(),
  });
}
