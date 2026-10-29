// Root-requiring vault writer. Containment is safeVaultJoin; the bytes go
// through writeNoFollowAtomic. Manifest code imports this module so it does
// not cycle through vault.ts.

import fs from 'fs';
import path from 'path';

import { MAX_VAULT_FILE_BYTES, VaultFileTooLargeError } from './limits.js';
import { assertFixedTmpNotLink, writeNoFollowAtomic } from './noFollowWrite.js';
import { safeVaultJoin } from './safeVaultJoin.js';

export function posixRelative(root: string, absPath: string): string {
  return path.relative(root, absPath).split(path.sep).join('/');
}

export function writeVaultFileNoFollow(
  vaultRoot: string,
  relPath: string,
  data: Buffer | string,
  durable: boolean | 'fsync' = true,
): { path: string; bytes: number; absPath: string } {
  // The guard realpaths the root. Callers that create a vault (Agent Vault
  // migration) used to get that directory from the old writer's recursive
  // mkdir. Create only a missing root, then still join.
  if (!fs.existsSync(vaultRoot)) {
    fs.mkdirSync(vaultRoot, { recursive: true });
  }
  const absPath = safeVaultJoin(vaultRoot, relPath, { writeMode: true });
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  if (buf.byteLength > MAX_VAULT_FILE_BYTES) throw new VaultFileTooLargeError(buf.byteLength);
  writeNoFollowAtomic(absPath, buf, { durable, mkdir: true, rel: relPath });
  return { path: relPath, bytes: buf.byteLength, absPath };
}

/** Dialog / userData exports only. Requires an absolute path. No vault guard. */
export function writeExportFileAtomic(absPath: string, data: Buffer | string): void {
  if (!path.isAbsolute(absPath)) {
    throw new Error('writeExportFileAtomic requires an absolute path');
  }
  writeNoFollowAtomic(absPath, data, {
    durable: true,
    mkdir: true,
    rel: path.basename(absPath),
  });
}

function inferVaultRoot(manifestPath: string): string {
  const dir = path.dirname(manifestPath);
  return path.basename(dir) === '.mythos' ? path.dirname(dir) : dir;
}

/** Manifest bytes. A pre-placed `<path>.tmp` symlink is refused before the write. */
export function writeManifestBytes(manifestPath: string, json: string, vaultRoot?: string): number {
  const root = vaultRoot ?? inferVaultRoot(manifestPath);
  const rel = posixRelative(root, manifestPath);
  assertFixedTmpNotLink(`${manifestPath}.tmp`, rel);
  writeVaultFileNoFollow(root, rel, json, true);
  return Buffer.byteLength(json, 'utf-8');
}

/**
 * Raw manifest backup. Same containment and no-follow writer as a note, without
 * the 25 MiB note cap: one backup can hold prose from many valid scenes.
 */
export function writeManifestBackup(manifestPath: string, json: string, vaultRoot?: string): number {
  const root = vaultRoot ?? inferVaultRoot(manifestPath);
  const rel = posixRelative(root, manifestPath);
  assertFixedTmpNotLink(`${manifestPath}.tmp`, rel);
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  const absPath = safeVaultJoin(root, rel, { writeMode: true });
  writeNoFollowAtomic(absPath, json, { durable: true, mkdir: true, rel });
  return Buffer.byteLength(json, 'utf-8');
}
