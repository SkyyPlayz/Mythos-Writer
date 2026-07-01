// SKY-4773: Path-containment primitives — prevent directory traversal and symlink escapes.
// Pure Node.js, no Electron dependency; fully testable in vitest.
import fs from 'fs';
import path from 'path';

function isDescendant(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

/**
 * Throws if `candidate` resolves outside `root`.
 *
 * Catches: `../` traversal, absolute paths pointing elsewhere, null bytes, and
 * symlinks whose target escapes root (when the path already exists on disk).
 *
 * `root` is resolved via `path.resolve`; `candidate` may be relative (joined
 * under root) or absolute (checked as-is). Neither needs to exist on disk for
 * the traversal check; the symlink check is skipped with ENOENT.
 */
export function assertUnderRoot(root: string, candidate: string): void {
  if (candidate.includes('\0')) {
    throw new Error('Path containment violation: null byte in candidate path');
  }

  const resolvedRoot = path.resolve(root);
  const joined = path.isAbsolute(candidate)
    ? candidate
    : path.join(resolvedRoot, candidate);
  const resolved = path.resolve(joined);

  if (!isDescendant(resolvedRoot, resolved)) {
    throw new Error('Path containment violation: path escapes root');
  }

  // Symlink check — only when the resolved path already exists on disk.
  try {
    const real = fs.realpathSync(resolved);
    let realRoot = resolvedRoot;
    try { realRoot = fs.realpathSync(resolvedRoot); } catch { /* root may not exist yet */ }
    if (!isDescendant(realRoot, real)) {
      throw new Error('Path containment violation: symlink target escapes root');
    }
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}

/**
 * Returns `true` iff `candidate` is contained within `root`. Never throws.
 * Use `assertUnderRoot` when a violation should be a hard error; use this when
 * you want to classify an entry (e.g. manifest corruption detection).
 */
export function isUnderRoot(root: string, candidate: string): boolean {
  try {
    assertUnderRoot(root, candidate);
    return true;
  } catch {
    return false;
  }
}
