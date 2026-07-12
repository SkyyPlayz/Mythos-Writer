// Migration runner: applies forward migrations to bring a raw manifest up to
// the current SCHEMA_VERSION. Migrations are a plain array; each entry covers
// exactly one version step.
import type { ManifestV1 } from './types.js';
import { SCHEMA_VERSION } from './types.js';
import { migrateV0ToV1 } from './migrations/v0ToV1.js';

type Raw = Record<string, unknown>;

interface Migration {
  toVersion: number;
  run: (raw: Raw) => Raw;
}

// Extend this array when a new schema version is introduced.
const migrations: Migration[] = [
  {
    toVersion: 1,
    run: (raw) => migrateV0ToV1(raw) as unknown as Raw,
  },
];

/** Thrown when the on-disk schemaVersion is newer than this build supports. */
export class ManifestVersionError extends Error {
  constructor(public readonly foundVersion: number) {
    super(
      `Manifest schemaVersion ${foundVersion} is newer than this build supports ` +
        `(max ${SCHEMA_VERSION}). Upgrade the application or restore from backup.`
    );
    this.name = 'ManifestVersionError';
  }
}

/** Thrown when a migration or parse step fails. Always carries a backup path. */
export class ManifestMigrationError extends Error {
  constructor(
    public readonly fromVersion: number,
    public readonly backupPath: string,
    cause?: Error
  ) {
    super(
      `Manifest migration from v${fromVersion} failed. Backup at: ${backupPath}` +
        (cause ? `\nCause: ${cause.message}` : '')
    );
    this.name = 'ManifestMigrationError';
  }
}

// electron-main/src/manifest.ts (the legacy, pre-vault/manifest schema) also
// stamps its migrated files with `schemaVersion: 1` — the same literal this
// module uses for ManifestV1. A vault opened once under the legacy path
// therefore has schemaVersion === SCHEMA_VERSION on disk while still being
// legacy-shaped (provenance as a Record, boardReferences instead of boards,
// no v1-only fields). Comparing schemaVersion alone makes that collision
// look like "already migrated" and skips migrateV0ToV1's coercion entirely.
// Detect the legacy shape structurally so it still gets coerced. See SKY-6629.
function isLegacyShapedManifest(raw: Raw): boolean {
  if (raw.provenance !== undefined && !Array.isArray(raw.provenance)) return true;
  if (raw.boards === undefined && raw.boardReferences !== undefined) return true;
  return false;
}

/**
 * Apply all pending forward migrations to `raw`.
 * Returns a raw object at SCHEMA_VERSION (caller should then validate the shape).
 * Throws ManifestVersionError when the on-disk version exceeds SCHEMA_VERSION.
 */
export function runMigrations(raw: Raw): Raw {
  const declaredVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;

  if (declaredVersion > SCHEMA_VERSION) {
    throw new ManifestVersionError(declaredVersion);
  }

  // A legacy-shaped manifest that happens to declare schemaVersion 1 is
  // treated as version 0 so the v0→v1 coercion still runs against it.
  const currentVersion = isLegacyShapedManifest(raw) ? 0 : declaredVersion;

  if (currentVersion === SCHEMA_VERSION) return raw;

  let current = { ...raw };
  for (const mig of migrations) {
    if (mig.toVersion > currentVersion && mig.toVersion <= SCHEMA_VERSION) {
      current = mig.run(current);
    }
  }
  return current;
}

/**
 * Returns true when the raw object needs migration: schemaVersion is missing
 * or below current, OR schemaVersion matches but the shape is actually the
 * legacy pre-vault/manifest schema (see isLegacyShapedManifest above).
 */
export function needsMigration(raw: Raw): boolean {
  const v = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  return v < SCHEMA_VERSION || isLegacyShapedManifest(raw);
}

