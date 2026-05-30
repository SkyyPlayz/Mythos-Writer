// Manifest reader: parse JSON, run migrations if needed, validate, write back.
// No Electron dependency — fully testable in Node.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { ManifestV1 } from './types.js';
import { validateManifestV1, ManifestValidationError } from './schema.js';
import { runMigrations, needsMigration, ManifestVersionError, ManifestMigrationError } from './migrationRunner.js';
import { SCHEMA_VERSION } from './types.js';
import { writeManifestV1 } from './writer.js';

export { ManifestVersionError, ManifestMigrationError, ManifestValidationError };

type Raw = Record<string, unknown>;

export interface OpenManifestV1Options {
  /** Used to derive the backup directory (.mythos/backups). Defaults to dirname(manifestPath). */
  vaultRoot?: string;
  /** Called after each successful migration. */
  onMigrated?: (entry: {
    id: string;
    fromVersion: number;
    toVersion: number;
    backupPath: string;
    createdAt: string;
  }) => void;
}

function writeBackup(vaultRoot: string, rawContent: string): string {
  const backupDir = path.join(vaultRoot, '.mythos', 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `manifest-v1-${timestamp}.json`);
  fs.writeFileSync(backupPath, rawContent, 'utf-8');
  return backupPath;
}

/**
 * Open the ManifestV1 at `manifestPath`.
 *
 * - If schemaVersion is missing or < 1: backs up the original, runs migrations,
 *   validates the result, writes it back atomically, and calls `onMigrated`.
 * - If schemaVersion === 1: validates and returns without writing.
 * - If schemaVersion > 1: throws ManifestVersionError (file untouched).
 * - If the file cannot be parsed: throws ManifestMigrationError with a backup path.
 * - If post-migration validation fails: throws ManifestValidationError.
 */
export function openManifestV1(manifestPath: string, options?: OpenManifestV1Options): ManifestV1 {
  const vaultRoot = options?.vaultRoot ?? path.dirname(manifestPath);

  const rawContent = fs.readFileSync(manifestPath, 'utf-8');

  let raw: Raw;
  try {
    raw = JSON.parse(rawContent) as Raw;
  } catch (parseErr) {
    const backupPath = writeBackup(vaultRoot, rawContent);
    throw new ManifestMigrationError(0, backupPath, parseErr as Error);
  }

  const fromVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;

  // Reject future versions immediately — leave the file untouched.
  if (fromVersion > SCHEMA_VERSION) {
    throw new ManifestVersionError(fromVersion);
  }

  if (!needsMigration(raw)) {
    return validateManifestV1(raw);
  }

  const backupPath = writeBackup(vaultRoot, rawContent);
  let migrated: Raw;
  try {
    migrated = runMigrations(raw);
  } catch (err) {
    if (err instanceof ManifestVersionError) throw err;
    throw new ManifestMigrationError(fromVersion, backupPath, err as Error);
  }

  let validated: ManifestV1;
  try {
    validated = validateManifestV1(migrated);
  } catch (err) {
    throw new ManifestMigrationError(fromVersion, backupPath, err as Error);
  }

  writeManifestV1(manifestPath, validated);

  if (options?.onMigrated) {
    options.onMigrated({
      id: crypto.randomUUID(),
      fromVersion,
      toVersion: validated.schemaVersion,
      backupPath,
      createdAt: new Date().toISOString(),
    });
  }

  return validated;
}
