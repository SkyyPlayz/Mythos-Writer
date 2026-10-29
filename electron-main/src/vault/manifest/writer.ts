// Atomic manifest writer. A pre-placed `<path>.tmp` symlink is refused.
import type { ManifestV1 } from './types.js';
import { writeManifestBytes } from '../vaultFileWrite.js';

/**
 * Serialize `manifest` to pretty JSON and write it atomically to `manifestPath`.
 */
export function writeManifestV1(manifestPath: string, manifest: ManifestV1): void {
  writeManifestBytes(manifestPath, JSON.stringify(manifest, null, 2));
}
