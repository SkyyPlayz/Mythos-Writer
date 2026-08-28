// SKY-11068 — Security gate for the per-vault icon image (project:iconSet /
// project:icons IPC). Mirrors bgLoad.ts: the allowlist gate runs before any
// filesystem access, and every failure collapses to a null result instead of
// throwing to the renderer.
//
// The icon file lives directly at the mythos root as `vault-icon.<ext>`, so it
// travels with the vault on move/copy. Reads never join renderer-supplied path
// segments: the stored file name must match the strict vault-icon pattern.

import fs from 'fs';
import path from 'path';
import { writeFileAtomic } from './vault.js';

const ALLOWED_VAULT_ICON_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

/** 5 MB — an icon, not a wallpaper. */
export const MAX_VAULT_ICON_BYTES = 5 * 1024 * 1024;

export const VAULT_ICON_BASENAME = 'vault-icon';

const VAULT_ICON_FILENAME_RE = /^vault-icon\.(jpg|jpeg|png|webp|gif|avif)$/;

/**
 * Returns the MIME type for an allowed icon-source extension, or null if the
 * path is not absolute or the extension is not on the allowlist.
 *
 * This is the security gate — it must be called before any FS access.
 */
export function mimeForVaultIconSource(filePath: string): string | null {
  if (!filePath || !path.isAbsolute(filePath)) return null;
  const ext = path.extname(filePath).toLowerCase().slice(1);
  return ALLOWED_VAULT_ICON_MIME[ext] ?? null;
}

/** True when `name` is exactly a stored icon file name (no path segments possible). */
export function isVaultIconFileName(name: string): boolean {
  return VAULT_ICON_FILENAME_RE.test(name);
}

/**
 * Copies a user-picked image into the vault as `<mythosRoot>/vault-icon.<ext>`
 * and removes any stale vault-icon.* with a different extension.
 * Returns `{ file: null }` if:
 *   - either path is not absolute, or the source extension is not allowlisted
 *   - the source does not exist or exceeds MAX_VAULT_ICON_BYTES
 *   - any read/write error occurs
 */
export function importVaultIconFile(
  mythosRoot: string,
  sourcePath: string,
): { file: string | null } {
  try {
    const mime = mimeForVaultIconSource(sourcePath);
    if (!mime || !path.isAbsolute(mythosRoot)) return { file: null };
    if (!fs.existsSync(sourcePath)) return { file: null };
    const stat = fs.statSync(sourcePath);
    if (stat.size > MAX_VAULT_ICON_BYTES) return { file: null };
    const data = fs.readFileSync(sourcePath);
    const fileName = `${VAULT_ICON_BASENAME}${path.extname(sourcePath).toLowerCase()}`;
    writeFileAtomic(path.join(mythosRoot, fileName), data);
    removeVaultIconFiles(mythosRoot, fileName);
    return { file: fileName };
  } catch {
    return { file: null };
  }
}

/**
 * Reads a stored vault icon and returns it as a base64 data URL.
 * Returns `{ dataUrl: null }` if:
 *   - the mythos root is not absolute
 *   - `fileName` is not a strict `vault-icon.<allowed ext>` name
 *   - the file does not exist or exceeds MAX_VAULT_ICON_BYTES
 *   - any read error occurs
 */
export async function readVaultIconAsDataUrl(
  mythosRoot: string,
  fileName: string,
): Promise<{ dataUrl: string | null }> {
  try {
    if (!mythosRoot || !path.isAbsolute(mythosRoot)) return { dataUrl: null };
    if (!isVaultIconFileName(fileName)) return { dataUrl: null };
    const ext = path.extname(fileName).toLowerCase().slice(1);
    const mime = ALLOWED_VAULT_ICON_MIME[ext];
    if (!mime) return { dataUrl: null };
    const filePath = path.join(mythosRoot, fileName);
    // SKY-11108: async fs so a 5 MB icon read never blocks the main-process
    // IPC queue (readFileSync here delayed every other in-flight IPC round
    // trip, e.g. outline.load(), while boot-time loadVaultIcons() ran).
    const stat = await fs.promises.stat(filePath);
    if (stat.size > MAX_VAULT_ICON_BYTES) return { dataUrl: null };
    const data = await fs.promises.readFile(filePath);
    return { dataUrl: `data:${mime};base64,${data.toString('base64')}` };
  } catch {
    return { dataUrl: null };
  }
}

/** Best-effort removal of stored vault-icon.* files, keeping `keep` when given. */
export function removeVaultIconFiles(mythosRoot: string, keep?: string): void {
  try {
    if (!mythosRoot || !path.isAbsolute(mythosRoot)) return;
    for (const entry of fs.readdirSync(mythosRoot)) {
      if (entry === keep || !isVaultIconFileName(entry)) continue;
      try {
        fs.unlinkSync(path.join(mythosRoot, entry));
      } catch {
        // best-effort — a stale icon file is cosmetic, never fail the caller
      }
    }
  } catch {
    // mythos root unreadable — nothing to clean
  }
}
