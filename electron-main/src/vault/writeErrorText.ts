// User-facing write strings. No imports from the writer, so the writer and the
// mapper can share them without a cycle.

import path from 'path';

export function volumeUnsupportedText(name: string): string {
  return [
    `Couldn't save ${name}: Mythos can't confirm this file is safe to write on this drive.`,
    "This drive type isn't supported for saving yet. Move the vault to a local drive.",
  ].join('\n');
}

/** Vault-relative display name. Absolute inputs collapse to the basename. */
export function fileDisplayName(rel: string): string {
  if (!rel) return 'file';
  const normalized = rel.replace(/\\/g, '/');
  if (path.isAbsolute(rel) || path.win32.isAbsolute(rel) || normalized.startsWith('/')) {
    return path.posix.basename(normalized);
  }
  return normalized;
}
