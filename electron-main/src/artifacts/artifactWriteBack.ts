// Write user-entered edits back to bound notes. The only sink is aiWriteGuard then writeVaultFileAtomicAbs.

import fs from 'fs';
import path from 'path';
import { assertAiWritable } from '../vault/aiWriteGuard.js';
import { writeVaultFileAtomicAbs } from '../vault.js';
import { auditRefusal } from './artifactAudit.js';
import { trimPreimages } from './artifactCleanup.js';
import {
  ARTIFACTS_WRITE_BACK_EXTENDED,
  type ArtifactTargetKind,
  guardMutant,
  isUuidV4,
  sha256Text,
} from './artifactSchema.js';

export class StaleNoteError extends Error {
  readonly code = 'stale_note' as const;
  constructor() {
    super('note changed, re-bind');
    this.name = 'StaleNoteError';
  }
}

const NOTE_KINDS = new Set<ArtifactTargetKind>(['note']);
const EXTENDED_KINDS = new Set<ArtifactTargetKind>(['codex', 'metric']);

export function kindAllowed(kind: ArtifactTargetKind, extended: boolean): boolean {
  if (NOTE_KINDS.has(kind)) return true;
  if (extended && EXTENDED_KINDS.has(kind)) return true;
  return false;
}

export interface WriteBackInput {
  artifactId: string;
  vaultRoot: string;
  targetPath: string;
  kind: ArtifactTargetKind;
  boundSha256: string;
  content: string;
  origin: 'user' | 'agent' | 'refresh';
  editorOpen?: boolean;
  extended?: boolean;
}

export type WriteBackResult =
  | { ok: true; via: 'editor'; content: string }
  | { ok: true; via: 'file'; file: string; preimage: string }
  | { ok: false; reason: string; error?: StaleNoteError };

let preimageSeq = 0;

function preimageDir(vaultRoot: string, artifactId: string): string {
  return path.join(vaultRoot, '.mythos', 'artifacts', 'preimage', artifactId);
}

function writePreimage(vaultRoot: string, artifactId: string, original: string): string {
  const dir = preimageDir(vaultRoot, artifactId);
  preimageSeq += 1;
  const file = path.join(dir, `${String(preimageSeq).padStart(8, '0')}-${Date.now()}.json`);
  writeVaultFileAtomicAbs(file, JSON.stringify({ original }));
  trimPreimages(dir, 5);
  return file;
}

export function restorePreimage(preimageFile: string): string {
  const parsed = JSON.parse(fs.readFileSync(preimageFile, 'utf8')) as { original: string };
  return parsed.original;
}

export function writeBack(input: WriteBackInput): WriteBackResult {
  const extended = input.extended ?? ARTIFACTS_WRITE_BACK_EXTENDED;
  try {
    if (input.origin !== 'user') {
      auditRefusal({ artifactId: input.artifactId, kind: input.kind, reason: 'origin', path: input.targetPath });
      return { ok: false, reason: 'origin' };
    }
    if (!isUuidV4(input.artifactId)) return { ok: false, reason: 'bad_id' };
    if (!guardMutant('no-kind') && !kindAllowed(input.kind, extended)) {
      auditRefusal({ artifactId: input.artifactId, kind: input.kind, reason: 'kind', path: input.targetPath });
      return { ok: false, reason: 'kind' };
    }
    if (input.targetPath.includes('..') || path.isAbsolute(input.targetPath)) {
      auditRefusal({ artifactId: input.artifactId, kind: input.kind, reason: 'path', path: input.targetPath });
      return { ok: false, reason: 'path' };
    }
    if (input.editorOpen) {
      return { ok: true, via: 'editor', content: input.content };
    }
    const guard = assertAiWritable(input.vaultRoot, input.targetPath);
    if (!guard.ok) {
      auditRefusal({ artifactId: input.artifactId, kind: input.kind, reason: guard.reason, path: input.targetPath });
      return { ok: false, reason: guard.reason };
    }
    let current = '';
    try {
      current = fs.readFileSync(guard.abs, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    let link: fs.Stats | null = null;
    try {
      link = fs.lstatSync(guard.abs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    if (link?.isSymbolicLink()) {
      auditRefusal({ artifactId: input.artifactId, kind: input.kind, reason: 'symlink', path: input.targetPath });
      return { ok: false, reason: 'symlink' };
    }
    if (link && link.isFile() && link.nlink > 1) {
      auditRefusal({ artifactId: input.artifactId, kind: input.kind, reason: 'hardlink', path: input.targetPath });
      return { ok: false, reason: 'hardlink' };
    }
    const vaultReal = fs.realpathSync(input.vaultRoot);
    const targetReal = fs.realpathSync(path.dirname(guard.abs));
    const inside = targetReal === vaultReal || targetReal.startsWith(vaultReal + path.sep);
    if (!inside) return { ok: false, reason: 'containment' };
    if (!guardMutant('skip-compare') && !guardMutant('skip-hash')) {
      if (sha256Text(current) !== input.boundSha256) {
        const error = new StaleNoteError();
        auditRefusal({ artifactId: input.artifactId, kind: input.kind, reason: 'stale_note', path: input.targetPath });
        return { ok: false, reason: 'stale_note', error };
      }
    }
    const preimage = writePreimage(input.vaultRoot, input.artifactId, current);
    writeVaultFileAtomicAbs(guard.abs, input.content);
    return { ok: true, via: 'file', file: guard.abs, preimage };
  } catch (err) {
    if (guardMutant('allow-on-exception')) {
      const guard = assertAiWritable(input.vaultRoot, input.targetPath);
      if (guard.ok) writeVaultFileAtomicAbs(guard.abs, input.content);
      return { ok: true, via: 'file', file: input.targetPath, preimage: '' };
    }
    auditRefusal({
      artifactId: input.artifactId,
      kind: input.kind,
      reason: 'fail_closed',
      path: input.targetPath,
    });
    return { ok: false, reason: 'fail_closed' };
  }
}
