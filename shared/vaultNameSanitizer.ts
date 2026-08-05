// Canonical NOTES-vault filename sanitizer — single source of truth imported
// by both electron-main (backend writers) and frontend (create/rename UI).
//
// SKY-9027: note/folder names accept full Unicode including emoji (R3). The
// only forbidden characters are the OS-reserved set, control characters,
// trailing dots/spaces, and Windows reserved device names. Do not lowercase,
// strip diacritics, or collapse whitespace here — this produces a DISPLAY
// filename, not an ASCII slug/ID (those remain out of this function's scope,
// e.g. Manuscript/story slugs via electron-main/src/vault.ts#toSlug).

const OS_RESERVED_CHARS = /[\\/:*?"<>|]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;
const TRAILING_DOTS_SPACES = /[.\s]+$/;
const RESERVED_DEVICE_NAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/**
 * Sanitize a user-supplied title into a filesystem-safe NOTES-vault filename
 * (without extension). Preserves case, whitespace, and all Unicode/emoji;
 * only removes what every target OS actually forbids.
 */
export function sanitizeVaultName(rawName: string, fallback = 'untitled'): string {
  let name = rawName
    .replace(CONTROL_CHARS, '')
    .replace(OS_RESERVED_CHARS, '-')
    .trim()
    .replace(TRAILING_DOTS_SPACES, '');

  if (!name) return fallback;

  if (RESERVED_DEVICE_NAME.test(name)) {
    name = `${name}_`;
  }

  return name;
}
