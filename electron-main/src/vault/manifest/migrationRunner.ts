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

/**
 * The legacy top-level manifest (electron-main/src/manifest.ts) stamps its own,
 * structurally-unrelated schema with `schemaVersion: 1` too. Both pipelines can
 * run against the same on-disk manifest.json, so a declared `schemaVersion === 1`
 * does not by itself mean "already in ManifestV1 shape" — it may be the legacy
 * shape (`provenance` as a Record, `boardReferences` instead of `boards`).
 * Distinguish by checking the two fields whose shape actually differs between
 * the schemas.
 */
function hasManifestV1Shape(raw: Raw): boolean {
  return Array.isArray(raw.provenance) && Array.isArray(raw.boards);
}

/**
 * The migration-relevant version: the declared schemaVersion, downgraded to 0
 * when it collides with the legacy schema's own v1 (see hasManifestV1Shape).
 */
function effectiveVersion(raw: Raw): number {
  const declared = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (declared === SCHEMA_VERSION && !hasManifestV1Shape(raw)) return 0;
  return declared;
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

  const currentVersion = effectiveVersion(raw);
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
 * Returns true when the raw object needs migration: schemaVersion missing,
 * below current, or colliding with the legacy schema's own v1 stamp.
 */
export function needsMigration(raw: Raw): boolean {
  return effectiveVersion(raw) < SCHEMA_VERSION;
}

