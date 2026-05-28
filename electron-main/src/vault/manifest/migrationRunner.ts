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
 * Apply all pending forward migrations to `raw`.
 * Returns a raw object at SCHEMA_VERSION (caller should then validate the shape).
 * Throws ManifestVersionError when the on-disk version exceeds SCHEMA_VERSION.
 */
export function runMigrations(raw: Raw): Raw {
  const currentVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;

  if (currentVersion > SCHEMA_VERSION) {
    throw new ManifestVersionError(currentVersion);
  }

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
 * Returns true when the raw object needs migration (schemaVersion missing or < current).
 */
export function needsMigration(raw: Raw): boolean {
  const v = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  return v < SCHEMA_VERSION;
}

