// Artifact JSON schema v1 and the closed edit-message parser the IPC accepts.

import crypto from 'crypto';

export const ARTIFACT_SCHEMA_VERSION = 1 as const;

/** Compile-time PLAN-0.5.9 switches. Both stay off. No remote-config reader. */
export const ARTIFACTS_ENGINE = false as const;
export const ARTIFACTS_WRITE_BACK_EXTENDED = false as const;

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type ArtifactTargetKind = 'note' | 'codex' | 'metric' | 'scene' | 'manuscript' | 'unknown';

export type OwnerGateAnswer = 'yes' | 'no' | 'unanswered';

export interface ArtifactRecord {
  schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  id: string;
  bound: {
    kind: ArtifactTargetKind;
    path: string;
    sha256: string;
  } | null;
  body: string;
  dataSchema: Record<string, unknown>;
  updatedAt: string;
}

export interface ArtifactEditMsg {
  type: 'edit';
  artifactId: string;
  origin: 'user';
  text: string;
}

export function isUuidV4(value: string): boolean {
  return UUID_V4.test(value);
}

export function sha256Text(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function guardMutant(name: string): boolean {
  return process.env.VITEST === 'true' && process.env.GUARD_MUTANT === name;
}

/** Closed parser. zod is not a repo dependency; this is the schema check. */
export function parseArtifactEditMsg(input: unknown): { ok: true; value: ArtifactEditMsg } | { ok: false; reason: 'bad_schema' } {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'bad_schema' };
  const msg = input as Record<string, unknown>;
  const keys = Object.keys(msg);
  if (keys.length !== 4) return { ok: false, reason: 'bad_schema' };
  if (msg.type !== 'edit') return { ok: false, reason: 'bad_schema' };
  if (typeof msg.artifactId !== 'string' || !isUuidV4(msg.artifactId)) return { ok: false, reason: 'bad_schema' };
  if (msg.origin !== 'user') return { ok: false, reason: 'bad_schema' };
  if (typeof msg.text !== 'string') return { ok: false, reason: 'bad_schema' };
  return {
    ok: true,
    value: { type: 'edit', artifactId: msg.artifactId, origin: 'user', text: msg.text },
  };
}

export function parseArtifactRecord(raw: string): ArtifactRecord | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const rec = parsed as Partial<ArtifactRecord>;
    if (rec.schemaVersion !== ARTIFACT_SCHEMA_VERSION) return null;
    if (typeof rec.id !== 'string' || !isUuidV4(rec.id)) return null;
    if (typeof rec.body !== 'string') return null;
    return rec as ArtifactRecord;
  } catch {
    return null;
  }
}
