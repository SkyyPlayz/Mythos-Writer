// Maps vault-write failures to the approved user text. Names are vault-relative
// only — never an absolute path.
import path from 'path';

import { VaultWriteRefusedError } from './noFollowWrite.js';
import { fileDisplayName, volumeUnsupportedText } from './writeErrorText.js';

export { volumeUnsupportedText };

export const SYMLINK_SAVE_TEXT = (name: string): string =>
  `Couldn't save ${name}: it's a shortcut (symbolic link). Save it under a new name instead.`;

export const SETTINGS_LINK_TEXT =
  "Couldn't save settings: the settings file is a shortcut (symbolic link).";

export function exportFailureText(filePath: string): string {
  return `Couldn't export to ${path.basename(filePath)}.`;
}

export function symlinkSkipLine(rel: string): string {
  return `${rel}: skipped (symlink)`;
}

/** Vault-relative display name. Absolute inputs collapse to the basename. */
export function vaultRelativeName(rel: string): string {
  return fileDisplayName(rel);
}

const LEAF_RE = /^Path traversal denied: (.*) \(symlink leaf not allowed on write\)$/;

export function isSymlinkWriteRefusal(err: unknown): boolean {
  if (err instanceof VaultWriteRefusedError) {
    return err.code === 'LEAF_LINK' || err.code === 'HANDLE_MISMATCH' || err.code === 'SWAP';
  }
  if (!(err instanceof Error)) return false;
  return (
    LEAF_RE.test(err.message) ||
    /\(symlink escape detected\)$/.test(err.message) ||
    /\(parent symlink escapes vault\)$/.test(err.message) ||
    /\(symlink loop\)$/.test(err.message)
  );
}

/**
 * User text for a guard / no-follow refusal, or null when the existing
 * sanitizer should keep today's message (loop and other path denials).
 */
export function mapVaultWriteError(
  err: unknown,
  rel: string,
): { error: string; code: string } | null {
  const name = vaultRelativeName(rel);
  if (err instanceof VaultWriteRefusedError) {
    if (err.code === 'VOLUME_UNSUPPORTED') {
      return { error: err.message, code: err.code };
    }
    if (err.code === 'LEAF_LINK' || err.code === 'HANDLE_MISMATCH' || err.code === 'SWAP') {
      return { error: SYMLINK_SAVE_TEXT(name), code: err.code };
    }
    return null;
  }
  if (err instanceof Error) {
    const leaf = LEAF_RE.exec(err.message);
    if (leaf) {
      return { error: SYMLINK_SAVE_TEXT(vaultRelativeName(leaf[1] ?? name)), code: 'LEAF_LINK' };
    }
  }
  return null;
}

export function isNoFollowExportFailure(err: unknown): boolean {
  return isSymlinkWriteRefusal(err);
}
