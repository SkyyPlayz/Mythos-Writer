// MYT-774: single chokepoint for resolving renderer-supplied paths against the
// vault root. Every vault file op must funnel through this helper so the
// "stays inside the vault" contract is enforced once, in one place.
//
// Hardening layers (each rejection is its own throw so logs name the vector):
//   - null-byte injection ("a\0/b") — Node truncates at \0 when opening,
//     letting an attacker substitute a different path silently.
//   - Windows drive-letter / UNC prefixes ("C:\foo", "\\srv\share") — on Linux
//     `path.resolve` treats these as relative segments and they "stay inside"
//     the vault by accident; reject them as suspicious cross-OS payloads.
//   - URL-encoded ".." sequences ("%2e%2e", "%252e%252e") — they don't escape
//     on disk because we never URL-decode, but they signal an injection
//     attempt from a layer that *did* decode (e.g. wiki-link parser, search).
//   - symlink escape — `fs.realpathSync.native` resolves links and we re-check
//     containment against the realpath'd vault root.
//   - "../" traversal & absolute paths — `path.resolve` collapses these and we
//     verify the result is inside the vault.
//   - optional dotfile rejection and extension allow-list, used at the IPC
//     boundary so the renderer can't reach internal "." dirs or write
//     unexpected file types.

import fs from 'fs';
import path from 'path';

export interface SafeVaultJoinOptions {
  /** Treat as a write/create — the leaf is allowed to not exist yet. */
  writeMode?: boolean;
  /** Reject any path whose leaf basename begins with a dot. */
  rejectDotfiles?: boolean;
  /**
   * If set, the leaf's extension (lowercased, including the leading dot) must
   * be in this list. Pass undefined to skip the check entirely.
   */
  allowedExtensions?: readonly string[];
}

const NULL_BYTE_RE = /\u0000/;
// "C:\foo", "D:/bar" — Windows-style absolute paths. Single letter, then ':',
// then a separator. Reject even on Linux: they look benign to path.resolve but
// are a fingerprint for cross-OS attack payloads.
const WINDOWS_DRIVE_RE = /^[A-Za-z]:[\\/]/;
// "\\server\share" — UNC path. Also reject everywhere.
const UNC_RE = /^\\\\/;
// Single-encoded ("%2e%2e") or double-encoded ("%252e%252e") "..". Neither
// escapes on disk because we never URL-decode the path, but their presence is
// a tripwire: it means an upstream layer (search index, wiki-link parser,
// watcher event normalisation) intends to decode and would *then* escape.
const ENCODED_DOTDOT_RE = /(?:%2e){2}|(?:%252e){2}/i;

function isWithinVault(realVaultRoot: string, candidate: string): boolean {
  return candidate === realVaultRoot || candidate.startsWith(realVaultRoot + path.sep);
}

function applyOptionalChecks(absPath: string, relPath: string, opts: SafeVaultJoinOptions): void {
  const leaf = path.basename(absPath);
  if (opts.rejectDotfiles && leaf.startsWith('.')) {
    throw new Error(`Path traversal denied: ${relPath} (dotfile not allowed)`);
  }
  if (opts.allowedExtensions) {
    const ext = path.extname(leaf).toLowerCase();
    if (!opts.allowedExtensions.includes(ext)) {
      throw new Error(
        `Path traversal denied: ${relPath} (extension '${ext || '<none>'}' not allowed)`,
      );
    }
  }
}

/**
 * Resolve `relPath` against `vaultRoot` and return the absolute on-disk path,
 * or throw if the path escapes the vault by any vector.
 *
 * This is the canonical entry point — `realSafePath` in vault.ts delegates here
 * so legacy callers also get the new defensive checks for free.
 */
export function safeVaultJoin(
  vaultRoot: string,
  relPath: string,
  opts: SafeVaultJoinOptions = {},
): string {
  if (typeof relPath !== 'string') {
    throw new Error('Path traversal denied: path must be a string');
  }
  if (NULL_BYTE_RE.test(relPath)) {
    throw new Error(`Path traversal denied: ${JSON.stringify(relPath)} (null byte in path)`);
  }
  if (WINDOWS_DRIVE_RE.test(relPath) || UNC_RE.test(relPath)) {
    throw new Error(`Path traversal denied: ${relPath} (absolute Windows path)`);
  }
  if (ENCODED_DOTDOT_RE.test(relPath)) {
    throw new Error(`Path traversal denied: ${relPath} (encoded traversal sequence)`);
  }

  const realVaultRoot = fs.realpathSync.native(vaultRoot);
  const resolved = path.resolve(vaultRoot, relPath);

  if (opts.writeMode) {
    // Leaf may not exist yet — walk up to the nearest existing ancestor,
    // realpath that ancestor, then reattach the remaining suffix so a
    // symlinked vault root with deeply-nested empty parents is still allowed.
    let ancestor = resolved;
    while (!fs.existsSync(ancestor)) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
    if (!fs.existsSync(ancestor)) throw new Error(`Path traversal denied: ${relPath}`);

    const realAncestor = fs.realpathSync.native(ancestor);
    if (!isWithinVault(realVaultRoot, realAncestor)) {
      // Phrasing kept compatible with existing call sites that grep for the
      // "symlink escape detected" / "parent symlink escapes vault" markers.
      const msg =
        ancestor === resolved
          ? `Path traversal denied: ${relPath} (symlink escape detected)`
          : `Path traversal denied: ${relPath} (parent symlink escapes vault)`;
      throw new Error(msg);
    }

    const remainder = path.relative(ancestor, resolved);
    const realTarget = path.resolve(realAncestor, remainder);
    if (!isWithinVault(realVaultRoot, realTarget)) {
      throw new Error(`Path traversal denied: ${relPath}`);
    }

    applyOptionalChecks(realTarget, relPath, opts);
    return realTarget;
  }

  // Read mode: keep the return value anchored to the caller's vault root so
  // callers see the path they passed in. Containment is still checked against
  // the realpath'd root.
  const normalizedRoot = path.resolve(vaultRoot);

  if (fs.existsSync(resolved)) {
    const realPath = fs.realpathSync.native(resolved);
    if (!isWithinVault(realVaultRoot, realPath)) {
      throw new Error(`Path traversal denied: ${relPath} (symlink escape detected)`);
    }
    applyOptionalChecks(resolved, relPath, opts);
    return resolved;
  }

  const parent = path.dirname(resolved);
  if (fs.existsSync(parent)) {
    const realParent = fs.realpathSync.native(parent);
    if (!isWithinVault(realVaultRoot, realParent)) {
      throw new Error(`Path traversal denied: ${relPath} (parent symlink escape detected)`);
    }
    applyOptionalChecks(resolved, relPath, opts);
    return resolved;
  }

  // Neither leaf nor parent exists yet — lexical check against the un-realpath'd
  // root. We don't check against realVaultRoot here because on macOS the temp
  // dir resolves through a symlink (/var → /private/var) and that would wrongly
  // deny valid nested writes into empty directories.
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    throw new Error(`Path traversal denied: ${relPath}`);
  }
  applyOptionalChecks(resolved, relPath, opts);
  return resolved;
}

/** Extension allow-list for renderer-facing IPC: scene/notes markdown + JSON manifests. */
export const VAULT_IPC_ALLOWED_EXTENSIONS: readonly string[] = ['.md', '.json'];

/**
 * Strict variant used at the IPC boundary: no dotfiles, .md / .json only.
 * Internal code paths (e.g. `.mythos/` snapshots, scaffold dirs) should keep
 * calling `safeVaultJoin` directly without these flags.
 */
export function safeVaultIpcJoin(
  vaultRoot: string,
  relPath: string,
  writeMode = false,
): string {
  return safeVaultJoin(vaultRoot, relPath, {
    writeMode,
    rejectDotfiles: true,
    allowedExtensions: VAULT_IPC_ALLOWED_EXTENSIONS,
  });
}
