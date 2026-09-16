/**
 * Owner punch (Boards): import a user-picked image into the Notes vault as an
 * attachment so frontmatter `thumb:` can point at a vault-relative path
 * (BOARDS-SPEC §8). Pure Node — no Electron — so unit tests stay headless.
 *
 * Security mirrors vaultIconFile / noteThumbnails: extension allowlist before
 * any FS read, absolute source only, size cap, destination sandboxed under
 * `attachments/` via the caller's join helper.
 */
import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './vault.js';

/** Same set as the BG_PICK dialog — no SVG (never serve user SVG as markup). */
export const THUMB_IMPORT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
};

/** 10 MB — a cover image, not a wallpaper. */
export const MAX_THUMB_IMPORT_BYTES = 10 * 1024 * 1024;

export const THUMB_ATTACHMENTS_DIR = 'attachments';

export type ImportNoteThumbResult =
  | { ok: true; relPath: string }
  | { ok: false; error: string };

/**
 * Unique vault-relative POSIX path under `attachments/` for `baseName`
 * (e.g. `cover.png` → `attachments/cover.png`, or `attachments/cover-2.png`
 * when the first slot is taken).
 */
export function uniqueAttachmentRelPath(vaultRoot: string, baseName: string): string {
  const ext = path.extname(baseName);
  const stem = path.basename(baseName, ext) || 'thumb';
  const safeStem = stem.replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '') || 'thumb';
  const safeExt = ext.toLowerCase();
  let candidate = `${THUMB_ATTACHMENTS_DIR}/${safeStem}${safeExt}`;
  let n = 2;
  while (fs.existsSync(path.join(vaultRoot, ...candidate.split('/')))) {
    candidate = `${THUMB_ATTACHMENTS_DIR}/${safeStem}-${n}${safeExt}`;
    n += 1;
  }
  return candidate;
}

/**
 * Copy `sourceAbsPath` into `<vaultRoot>/attachments/<unique-name>` and
 * return the vault-relative POSIX path for frontmatter `thumb:`.
 */
export function importNoteThumbAttachment(
  vaultRoot: string,
  sourceAbsPath: string,
): ImportNoteThumbResult {
  try {
    if (!sourceAbsPath || !path.isAbsolute(sourceAbsPath)) {
      return { ok: false, error: 'source path must be absolute' };
    }
    if (!vaultRoot || !path.isAbsolute(vaultRoot)) {
      return { ok: false, error: 'vault root must be absolute' };
    }
    const ext = path.extname(sourceAbsPath).toLowerCase().slice(1);
    if (!THUMB_IMPORT_MIME[ext]) {
      return { ok: false, error: 'unsupported image type' };
    }
    if (!fs.existsSync(sourceAbsPath)) {
      return { ok: false, error: 'source file missing' };
    }
    const stat = fs.statSync(sourceAbsPath);
    if (!stat.isFile()) {
      return { ok: false, error: 'source is not a file' };
    }
    if (stat.size > MAX_THUMB_IMPORT_BYTES) {
      return { ok: false, error: 'image too large' };
    }
    const data = fs.readFileSync(sourceAbsPath);
    const relPath = uniqueAttachmentRelPath(vaultRoot, path.basename(sourceAbsPath));
    const destAbs = path.join(vaultRoot, ...relPath.split('/'));
    writeFileAtomic(destAbs, data);
    return { ok: true, relPath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
