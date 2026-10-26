// Refusal audit: time, artifact id, kind, reason, path hash. Never content or keys.

import { sha256Text } from './artifactSchema.js';

export interface ArtifactAuditRecord {
  time: string;
  artifactId: string;
  kind: string;
  reason: string;
  pathHash: string;
}

const records: ArtifactAuditRecord[] = [];

export function auditRefusal(input: {
  artifactId: string;
  kind: string;
  reason: string;
  path: string;
  time?: string;
}): ArtifactAuditRecord {
  const record: ArtifactAuditRecord = {
    time: input.time ?? new Date().toISOString(),
    artifactId: input.artifactId,
    kind: input.kind,
    reason: input.reason,
    pathHash: sha256Text(input.path),
  };
  records.push(record);
  return record;
}

export function listArtifactAudit(): readonly ArtifactAuditRecord[] {
  return records;
}

export function clearArtifactAudit(): void {
  records.length = 0;
}
