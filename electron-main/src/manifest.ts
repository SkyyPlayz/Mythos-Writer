// Manifest v1 schema — migration framework and atomic I/O.
// No Electron dependency; fully testable in Node.
import fs from 'fs';
import type { Manifest } from './ipc.js';

export const SCHEMA_VERSION = 1 as const;

type Raw = Record<string, unknown>;

interface Migration {
  toVersion: number;
  migrate: (m: Raw) => Raw;
}

// Each entry upgrades from (toVersion - 1) to toVersion.
// The v0→v1 step covers any legacy file that lacks schemaVersion.
const migrations: Migration[] = [
  {
    toVersion: 1,
    migrate: (m) => ({
      ...m,
      schemaVersion: 1,
      provenance: (m.provenance as Record<string, string>) ?? {},
      boardReferences: (m.boardReferences as string[]) ?? [],
    }),
  },
];

/** Pure migration: apply all pending steps in order. No I/O. */
export function migrateManifest(raw: Raw): Manifest {
  const currentVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  let current = { ...raw };
  for (const mig of migrations) {
    if (mig.toVersion > currentVersion) {
      current = mig.migrate(current);
    }
  }
  return current as unknown as Manifest;
}

/**
 * Atomic write: serialise to a temp file then rename into place.
 * A process crash after writeFileSync but before renameSync leaves the
 * original file intact (the .tmp is orphaned but harmless).
 */
export function writeManifestAtomic(manifestPath: string, manifest: Manifest): void {
  const tmp = `${manifestPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf-8');
  fs.renameSync(tmp, manifestPath);
}

/**
 * Read the manifest, run any pending migrations, and write back atomically
 * if the schema was upgraded. Returns the up-to-date manifest.
 */
export function openManifest(manifestPath: string): Manifest {
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Raw;
  const currentVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (currentVersion < SCHEMA_VERSION) {
    const migrated = migrateManifest(raw);
    writeManifestAtomic(manifestPath, migrated);
    return migrated;
  }
  return raw as unknown as Manifest;
}
