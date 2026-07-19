// Shared scene-prose reader for the export pipeline (SKY-7108 / GH #944).
// No Electron dependency; fully testable in Node.
//
// Every export format (DOCX, PDF, Markdown, plain text, EPUB) reads a scene's
// prose from its .md file the same way. Previously each read site swallowed a
// missing/unreadable file into '' with no signal, so a scene whose file went
// missing exported silently empty. This module centralizes that read so a
// missing file is always warned about and tracked for the export Done state.
import { readSceneFile } from './vault.js';

/**
 * Reads a scene's prose for export. If the scene's .md file is missing or
 * unreadable, warns once and records the scene id in `missingSceneIds`
 * instead of failing the export. A scene whose file exists but is genuinely
 * empty is NOT recorded — only read failures count as "missing".
 */
export function readSceneProseTracked(
  vaultRoot: string,
  scene: { id: string; path: string },
  missingSceneIds: Set<string>,
): string {
  try {
    return readSceneFile(vaultRoot, scene.path).prose;
  } catch {
    if (!missingSceneIds.has(scene.id)) {
      console.warn(
        `[export] scene "${scene.id}" has no readable .md file at "${scene.path}" — exporting empty prose`,
      );
    }
    missingSceneIds.add(scene.id);
    return '';
  }
}
