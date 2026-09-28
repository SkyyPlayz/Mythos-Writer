// Uninstall helper — computes vault delete paths and removes them from disk.
// No Electron dependency; fully testable in Node.
//
// "Delete everything" removes:
//   - The <userData>/vaults/ parent when both vaults live under it (default layout)
//   - Or each vault root individually when the user chose custom locations
//   - vault-settings.json and app-settings.json from userData
//
// Custom vault paths outside the default location are reported in `customPathsWarning`
// so callers can surface a note to the user.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface UninstallCleanOptions {
  storyVaultRoot: string;
  notesVaultRoot: string;
  userDataPath: string;
}

export interface UninstallCleanResult {
  deleted: string[];
  errors: string[];
  /** Paths not under the default vault parent that could not be auto-deleted. */
  customPathsWarning: string[];
}

const VAULTS_SUBDIR = 'vaults';
const SETTINGS_FILES = ['vault-settings.json', 'app-settings.json'];

/** Sidecar the Windows NSIS uninstaller FileReads when the opt-in checkbox is selected (MW-delete-vault). */
export const UNINSTALL_DELETE_PATHS_FILENAME = 'uninstall-delete-paths.txt';

export function uninstallDeletePathsFile(userDataPath: string): string {
  return path.join(userDataPath, UNINSTALL_DELETE_PATHS_FILENAME);
}

/** Tip-schema vault roots only — never a fictional `.root` field. */
export interface RegisteredVaultRoots {
  vaultRoot?: string;
  notesVaultRoot?: string;
}

function pushRoot(out: string[], value: unknown): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) out.push(trimmed);
  }
}

/**
 * Read app-global vault-settings.json using tip keys only:
 * top-level + recentProjects[] → vaultRoot / notesVaultRoot.
 * Missing or corrupt file → empty list (caller falls back to default parent).
 */
export function loadRegisteredVaultRoots(userDataPath: string): string[] {
  const settingsPath = path.join(userDataPath, 'vault-settings.json');
  if (!fs.existsSync(settingsPath)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const rec = parsed as Record<string, unknown>;
  const roots: string[] = [];
  pushRoot(roots, rec.vaultRoot);
  pushRoot(roots, rec.notesVaultRoot);
  const recent = rec.recentProjects;
  if (Array.isArray(recent)) {
    for (const entry of recent) {
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as Record<string, unknown>;
      pushRoot(roots, row.vaultRoot);
      pushRoot(roots, row.notesVaultRoot);
    }
  }
  return [...new Set(roots)];
}

/** Lowercase, backslash-normalized, no trailing slash. Windows drive paths stay drive-absolute. */
export function normalizeUninstallDeletePath(p: string): string {
  const trimmed = p.trim();
  if (!trimmed) return '';
  if (/^[A-Za-z]:[\\/]/.test(trimmed) || /^[A-Za-z]:$/.test(trimmed)) {
    return trimmed.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  }
  try {
    return path.resolve(trimmed).replace(/[/\\]+$/, '').replace(/\\/g, '/').toLowerCase();
  } catch {
    return trimmed.replace(/[/\\]+$/, '').toLowerCase();
  }
}

/** True when `child` is `parent` plus at least one extra path segment. */
export function isStrictPathChild(child: string, parent: string): boolean {
  const c = normalizeUninstallDeletePath(child);
  const p = normalizeUninstallDeletePath(parent);
  if (!c || !p) return false;
  const sep = c.includes('\\') || p.includes('\\') ? '\\' : '/';
  const cn = c.replace(/\//g, sep);
  const pn = p.replace(/\//g, sep);
  if (cn === pn) return false;
  return cn.startsWith(pn + sep) && cn.length > pn.length + 1;
}

const WIN_FORBIDDEN_PREFIXES = [
  'c:\\windows',
  'c:\\winnt',
  'c:\\program files',
  'c:\\program files (x86)',
  'c:\\programdata',
];

/** `X:\Users\<name>\(OneDrive\)?(Documents|Desktop|Downloads)\<child>` */
const WIN_CONTENT_CHILD_RE =
  /^[a-z]:\\users\\[^\\]+\\(?:onedrive\\)?(?:documents|desktop|downloads)\\.+/;

function isWindowsForbiddenPrefix(norm: string): boolean {
  const n = norm.replace(/\//g, '\\');
  if (n === 'c:\\users') return true;
  for (const root of WIN_FORBIDDEN_PREFIXES) {
    if (n === root || n.startsWith(root + '\\')) return true;
  }
  return false;
}

function isWindowsProfileFolder(norm: string): boolean {
  const n = norm.replace(/\//g, '\\');
  return /^[a-z]:\\users\\[^\\]+$/.test(n);
}

function isWindowsContentRoot(norm: string): boolean {
  const n = norm.replace(/\//g, '\\');
  return /^[a-z]:\\users\\[^\\]+\\(?:onedrive\\)?(?:documents|desktop|downloads)$/.test(n);
}

function posixKnownRoots(home: string): string[] {
  return [
    path.join(home, 'Documents'),
    path.join(home, 'Desktop'),
    path.join(home, 'Downloads'),
    path.join(home, 'OneDrive', 'Documents'),
    path.join(home, 'OneDrive', 'Desktop'),
    path.join(home, 'OneDrive', 'Downloads'),
  ];
}

/**
 * Positive allowlist (Shield Secure): a path may be deleted only when it is
 * a **child** of userData, or a **child** of Documents / Desktop / Downloads
 * (never those folders themselves, never the profile, never Windows /
 * Program Files / Users root). Fail closed.
 */
export function isAllowedUninstallDeletePath(candidate: string, userDataPath: string): boolean {
  return !isUnsafeUninstallDeletePath(candidate, userDataPath);
}

/**
 * True when NSIS / Node must not RMDir or Delete this path.
 * Empty / `\` / `/` / drive-root / userData itself / profile / Documents root /
 * C:\Windows / Program Files / anything outside the positive allowlist.
 */
export function isUnsafeUninstallDeletePath(candidate: string, userDataPath: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed) return true;
  if (trimmed === path.sep || trimmed === '/' || trimmed === '\\') return true;
  if (/^[A-Za-z]:[\\/]?$/.test(trimmed)) return true;

  const norm = normalizeUninstallDeletePath(trimmed);
  if (!norm) return true;
  if (isWindowsForbiddenPrefix(norm)) return true;
  if (isWindowsProfileFolder(norm)) return true;
  if (isWindowsContentRoot(norm)) return true;

  try {
    const home = os.homedir();
    if (home && normalizeUninstallDeletePath(home) === norm) return true;
    for (const root of posixKnownRoots(home)) {
      if (normalizeUninstallDeletePath(root) === norm) return true;
    }
  } catch {
    /* homedir unavailable — continue with string allowlist */
  }

  if (isStrictPathChild(trimmed, userDataPath)) return false;
  if (WIN_CONTENT_CHILD_RE.test(norm.replace(/\//g, '\\'))) return false;

  try {
    const home = os.homedir();
    if (home && posixKnownRoots(home).some((r) => isStrictPathChild(trimmed, r))) return false;
  } catch {
    /* fall through to deny */
  }

  return true;
}

/**
 * NSIS FileRead simulation: drop any sidecar line outside the allowlist
 * so a planted path cannot elevate an uninstall delete.
 */
export function filterUninstallSidecarLines(lines: readonly string[], userDataPath: string): string[] {
  return lines
    .map((l) => l.replace(/\r$/, '').trim())
    .filter((l) => l.length > 0 && !isUnsafeUninstallDeletePath(l, userDataPath));
}

/**
 * Union of default vaults parent, every registered tip-key root, and the
 * two settings files. Custom Documents roots are in `toDelete` (not warn-only).
 * Never includes userData itself.
 */
export function resolveUninstallDeletePaths(userDataPath: string): string[] {
  const out: string[] = [defaultVaultsParent(userDataPath)];
  for (const root of loadRegisteredVaultRoots(userDataPath)) {
    out.push(root);
  }
  for (const f of SETTINGS_FILES) {
    out.push(path.join(userDataPath, f));
  }
  const unique = [...new Set(out)];
  return unique.filter((p) => !isUnsafeUninstallDeletePath(p, userDataPath));
}

/**
 * Write UTF-8 **no BOM** newline-separated absolute paths for NSIS FileRead.
 * Skip empty/dupes; never write userData itself; reject drive-root paths.
 */
export function writeUninstallDeletePathList(userDataPath: string): string {
  const dest = uninstallDeletePathsFile(userDataPath);
  const lines = resolveUninstallDeletePaths(userDataPath);
  const body = lines.length > 0 ? `${lines.join('\n')}\n` : '';
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(dest, body, { encoding: 'utf8' });
  return dest;
}

/** Returns the default vault parent dir for the given userData path. */
export function defaultVaultsParent(userDataPath: string): string {
  return path.join(userDataPath, VAULTS_SUBDIR);
}

/**
 * Resolve which filesystem paths should be deleted.
 * Returns a tuple: [pathsToDelete, customPathsWarning].
 * `pathsToDelete` includes directories and settings files.
 * `customPathsWarning` lists vaults stored outside the default location.
 */
export function resolveDeletePaths(options: UninstallCleanOptions): {
  toDelete: string[];
  customPathsWarning: string[];
} {
  const { storyVaultRoot, notesVaultRoot, userDataPath } = options;
  const vaultsParent = defaultVaultsParent(userDataPath);
  // Normalize to avoid trailing-sep mismatches on comparison
  const parentWithSep = vaultsParent.endsWith(path.sep) ? vaultsParent : vaultsParent + path.sep;

  const storyUnderDefault = storyVaultRoot.startsWith(parentWithSep);
  const notesUnderDefault = notesVaultRoot.startsWith(parentWithSep);

  const toDelete: string[] = [];
  const customPathsWarning: string[] = [];

  if (storyUnderDefault && notesUnderDefault) {
    // Both vaults are under the default parent — delete the whole bundle at once.
    toDelete.push(vaultsParent);
  } else {
    // One or both vaults are in custom locations.
    if (storyUnderDefault) {
      toDelete.push(vaultsParent);
    } else {
      toDelete.push(storyVaultRoot);
      customPathsWarning.push(storyVaultRoot);
    }

    if (!notesUnderDefault && notesVaultRoot !== storyVaultRoot) {
      toDelete.push(notesVaultRoot);
      customPathsWarning.push(notesVaultRoot);
    } else if (notesUnderDefault && !toDelete.includes(vaultsParent)) {
      toDelete.push(vaultsParent);
    }
  }

  // Always remove settings files from userData.
  for (const f of SETTINGS_FILES) {
    toDelete.push(path.join(userDataPath, f));
  }

  // Deduplicate while preserving order.
  return { toDelete: [...new Set(toDelete)], customPathsWarning: [...new Set(customPathsWarning)] };
}

function removeEntry(p: string): { ok: boolean; error?: string } {
  try {
    if (!fs.existsSync(p)) return { ok: true };
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      // maxRetries/retryDelay: on Windows, EBUSY/EPERM/ENOTEMPTY are often
      // transient (AV scanners, search indexer, a handle mid-close) — Node
      // retries the failing operation instead of giving up on first contact.
      fs.rmSync(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } else {
      fs.unlinkSync(p);
    }
    // SKY-8882: never report a delete as successful without verifying the
    // entry is actually gone — on Windows a locked file can survive the
    // recursive rm without an exception reaching us.
    if (fs.existsSync(p)) {
      return { ok: false, error: 'Entry still exists after delete (a file may be locked by another program)' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Delete the resolved paths and return a result summary. */
export function cleanUninstall(options: UninstallCleanOptions): UninstallCleanResult {
  const { toDelete, customPathsWarning } = resolveDeletePaths(options);
  const deleted: string[] = [];
  const errors: string[] = [];

  for (const p of toDelete) {
    const result = removeEntry(p);
    if (result.ok) {
      deleted.push(p);
    } else {
      errors.push(`${p}: ${result.error}`);
    }
  }

  return { deleted, errors, customPathsWarning };
}
