// SKY-134 — Security gate for the bg:load IPC handler.
// Extracted here so the security-critical path can be unit-tested without Electron.
//
// The previous implementation used the extension only to pick a MIME type, then
// fell through to 'image/jpeg' for unknown extensions and read the file regardless.
// That allowed any renderer-supplied path (e.g. /home/user/.ssh/id_rsa) to be
// read and returned as a base64 data URL.  This module fixes that by gating on
// the allowlist before any filesystem access.

import fs from 'fs';
import path from 'path';

const ALLOWED_BG_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

/** 50 MB — well above any realistic background image. */
export const MAX_BG_IMAGE_BYTES = 50 * 1024 * 1024;

/**
 * Returns the MIME type for an allowed background-image extension, or null if
 * the path is not absolute or the extension is not on the allowlist.
 *
 * This is the security gate — it must be called before any FS access.
 */
export function mimeForBgImage(filePath: string): string | null {
  if (!filePath || !path.isAbsolute(filePath)) return null;
  const ext = path.extname(filePath).toLowerCase().slice(1);
  return ALLOWED_BG_MIME[ext] ?? null;
}

/**
 * Reads a background image file and returns it as a base64 data URL.
 * Returns `{ dataUrl: null }` if:
 *   - the path is not absolute
 *   - the extension is not on the explicit image allowlist
 *   - the file does not exist
 *   - the file exceeds MAX_BG_IMAGE_BYTES
 *   - any read error occurs
 */
export function readBgImageAsDataUrl(filePath: string): { dataUrl: string | null } {
  try {
    const mime = mimeForBgImage(filePath);
    if (!mime) return { dataUrl: null };
    if (!fs.existsSync(filePath)) return { dataUrl: null };
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_BG_IMAGE_BYTES) return { dataUrl: null };
    const data = fs.readFileSync(filePath);
    return { dataUrl: `data:${mime};base64,${data.toString('base64')}` };
  } catch {
    return { dataUrl: null };
  }
}
