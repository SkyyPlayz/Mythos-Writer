// Atomic manifest writer: write to a .tmp file then rename into place.
// A crash after writeFileSync but before renameSync leaves the .tmp orphaned
// and the original file intact.
import fs from 'fs';
import type { ManifestV1 } from './types.js';

/**
 * Serialize `manifest` to pretty JSON and write it atomically to `manifestPath`.
 */
export function writeManifestV1(manifestPath: string, manifest: ManifestV1): void {
  const tmp = `${manifestPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf-8');
  fs.renameSync(tmp, manifestPath);
}
