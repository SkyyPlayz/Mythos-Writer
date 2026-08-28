// Vault-root gate (MYT-789) — refuses renderer-supplied path changes that did
// not originate from a user gesture.
//
// `vault:setPaths` and `project:switch` re-root the vault sandbox. Without a
// gate, a compromised renderer could move the root to `$HOME` or `/` and then
// read or overwrite arbitrary files via the other vault:* IPC handlers (which
// only sandbox to whatever root is currently configured).
//
// Two acceptable proofs of user intent:
//   1. A registration token from `vault:pick-folder`, bound to the exact path
//      being requested. Tokens expire after 60s and are one-shot.
//   2. The path is already in the recent-projects allowlist — i.e. the user
//      previously picked it via a main-process dialog.
//
// Pure Node — no Electron deps — so unit tests can exercise the gate.

import path from 'path';
import fs from 'fs';
import { validateRegistrationToken } from './registrationToken.js';
import type { CloudSyncProvider } from './ipc.js';
export interface SetPathsGateInput {
  storyVaultPath: unknown;
  notesVaultPath: unknown;
  storyVaultToken?: unknown;
  notesVaultToken?: unknown;
}

export interface SetPathsGateOk {
  ok: true;
  storyVaultPath: string;
  notesVaultPath: string;
}

export interface SetPathsGateErr {
  ok: false;
  error: string;
}

export type GateResult = SetPathsGateOk | SetPathsGateErr;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function pathApiFor(...paths: string[]): typeof path.posix | typeof path.win32 {
  return paths.some((p) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\')) ? path.win32 : path.posix;
}

function joinPathLike(root: string, child: string): string {
  return pathApiFor(root).join(root, child);
}

function isStrictChildPath(parent: string, child: string): boolean {
  const pathApi = pathApiFor(parent, child);
  if (!pathApi.isAbsolute(parent) || !pathApi.isAbsolute(child)) return false;
  const relative = pathApi.relative(pathApi.resolve(parent), pathApi.resolve(child));
  return (
    relative.length > 0 &&
    relative !== '..' &&
    !relative.startsWith(`..${pathApi.sep}`) &&
    !pathApi.isAbsolute(relative)
  );
}

/**
 * Gate `vault:setPaths`. Each of the two requested paths must independently
 * pass either the registration-token check or the recent-projects allowlist
 * check. On success returns the validated paths; otherwise returns a typed
 * error. Never consumes a token itself — call `consumeSetPathsTokens` after
 * the caller's own fallible work (persisting settings, seeding folders)
 * succeeds, so a mid-operation failure (e.g. antivirus blocking a write)
 * doesn't burn the one-shot token and permanently lock out retry (SKY-10890).
 */
export function checkSetPathsGate(
  input: SetPathsGateInput,
  allowlist: ReadonlyArray<string>,
  now: number = Date.now(),
): GateResult {
  if (!isNonEmptyString(input.storyVaultPath)) {
    return { ok: false, error: 'storyVaultPath: must be a non-empty string' };
  }
  if (!isNonEmptyString(input.notesVaultPath)) {
    return { ok: false, error: 'notesVaultPath: must be a non-empty string' };
  }

  const storyToken = isNonEmptyString(input.storyVaultToken) ? input.storyVaultToken : null;
  const notesToken = isNonEmptyString(input.notesVaultToken) ? input.notesVaultToken : null;

  const storyAllowed = pathPasses(input.storyVaultPath, storyToken, allowlist, now);
  if (!storyAllowed) {
    return {
      ok: false,
      error:
        'storyVaultPath: not authorised — supply a registrationToken from vault:pick-folder bound to this path, or use a path from the recent-projects list',
    };
  }
  const notesAllowed = pathPasses(input.notesVaultPath, notesToken, allowlist, now);
  if (!notesAllowed) {
    return {
      ok: false,
      error:
        'notesVaultPath: not authorised — supply a registrationToken from vault:pick-folder bound to this path, or use a path from the recent-projects list',
    };
  }

  return { ok: true, storyVaultPath: input.storyVaultPath, notesVaultPath: input.notesVaultPath };
}

/**
 * Consumes the tokens `checkSetPathsGate` validated, so they cannot be
 * replayed. Call only after the operation the gate authorised has actually
 * succeeded — see the module-level note on the ordering bug this avoids.
 */
export function consumeSetPathsTokens(
  storyVaultToken: unknown,
  notesVaultToken: unknown,
  now: number = Date.now(),
): void {
  if (isNonEmptyString(storyVaultToken)) validateRegistrationToken(storyVaultToken, { now });
  if (isNonEmptyString(notesVaultToken)) validateRegistrationToken(notesVaultToken, { now });
}

/**
 * Returns true when `child` is exactly one directory level beneath `parent`.
 * One level only — no traversal. Guards the onboarding create flow where the
 * user picks a parent folder D and we create D/Story Vault and D/Notes Vault.
 */
function isDirectChildDir(parent: string, child: string): boolean {
  const p = parent.replace(/[/\\]+$/, '');
  const c = child.replace(/[/\\]+$/, '');
  const sep = c[p.length];
  if (!c.startsWith(p) || (sep !== '/' && sep !== '\\')) return false;
  const rest = c.slice(p.length + 1);
  return rest.length > 0 && !rest.includes('/') && !rest.includes('\\');
}

function pathPasses(
  requestedPath: string,
  token: string | null,
  allowlist: ReadonlyArray<string>,
  now: number,
): boolean {
  if (token) {
    const validated = validateRegistrationToken(token, { consume: false, now });
    if (validated && (validated.vaultRoot === requestedPath || isDirectChildDir(validated.vaultRoot, requestedPath))) return true;
  }
  return allowlist.includes(requestedPath);
}

/**
 * Gate vault:load-sample (SEC-11). The sample always materialises at the
 * hardcoded default path; a renderer-supplied targetPath is not accepted.
 * A compromised renderer could otherwise mkdir at an arbitrary path and
 * re-root the vault sandbox there.
 */
export function checkLoadSampleGate(
  targetPath: unknown,
): { ok: true } | { ok: false; error: string } {
  if (targetPath != null && targetPath !== '') {
    return { ok: false, error: 'UNAUTHORIZED_PATH' };
  }
  return { ok: true };
}

export interface SinglePathGateInput {
  targetPath: unknown;
  registrationToken?: unknown;
}

export interface SinglePathGateOk {
  ok: true;
  targetPath: string;
}

export interface SinglePathGateErr {
  ok: false;
  error: string;
}

export type SinglePathGateResult = SinglePathGateOk | SinglePathGateErr;

/**
 * Gate vault:create-blank and vault:localFolderMove (SEC-11, SKY-10890). The
 * renderer-supplied targetPath must be either (a) present in the
 * recent-projects allowlist, or (b) accompanied by a registration token
 * issued by a main-process file-picker dialog and bound to the exact same
 * path. Rejects anything else so a compromised renderer cannot mkdir at an
 * arbitrary writable path and re-root the vault sandbox.
 *
 * Never consumes the token itself — call `consumeSinglePathToken` after the
 * caller's own fallible FS work succeeds. Consuming here, before that work
 * runs, meant a mid-operation failure (antivirus, a locked file, a full
 * disk) burned the one-shot token with nothing to show for it, permanently
 * blocking retry with UNAUTHORIZED_PATH until the user re-opened the picker
 * (SKY-10890).
 *
 * Note: the caller must expand `~` before passing `targetPath` so the
 * comparison against absolute-path tokens and allowlist entries is correct.
 */
export function checkSinglePathGate(
  input: SinglePathGateInput,
  allowlist: ReadonlyArray<string>,
  now: number = Date.now(),
): SinglePathGateResult {
  if (!isNonEmptyString(input.targetPath)) {
    return { ok: false, error: 'UNAUTHORIZED_PATH' };
  }
  const token = isNonEmptyString(input.registrationToken) ? input.registrationToken : null;
  if (!pathPasses(input.targetPath, token, allowlist, now)) {
    return { ok: false, error: 'UNAUTHORIZED_PATH' };
  }
  return { ok: true, targetPath: input.targetPath };
}

/**
 * Consumes the token `checkSinglePathGate` validated, so it cannot be
 * replayed. Call only after the operation the gate authorised has actually
 * succeeded.
 */
export function consumeSinglePathToken(registrationToken: unknown, now: number = Date.now()): void {
  if (isNonEmptyString(registrationToken)) validateRegistrationToken(registrationToken, { now });
}

/**
 * Gate `template:scaffold` (SKY-780). The renderer must supply a registration
 * token from a prior `vault:pick-folder` dialog call, proving the parent
 * directory was user-selected. The handler derives story/notes sub-paths from
 * the validated parent — the renderer never supplies arbitrary FS paths.
 *
 * Never consumes the token itself — call `consumeScaffoldToken` after
 * `scaffoldFromTemplate` succeeds (SKY-10890 pattern), so a failed scaffold
 * write doesn't burn the one-shot token and block retry.
 */
export function checkScaffoldGate(
  input: { templateId: unknown; parentToken: unknown },
  now: number = Date.now(),
): { ok: true; parentPath: string } | { ok: false; error: string } {
  if (!isNonEmptyString(input.templateId)) {
    return { ok: false, error: 'templateId: must be a non-empty string' };
  }
  if (!isNonEmptyString(input.parentToken)) {
    return { ok: false, error: 'parentToken: must be a non-empty string — use vault:pick-folder first' };
  }
  const validated = validateRegistrationToken(input.parentToken, { consume: false, now });
  if (!validated) {
    return { ok: false, error: 'parentToken is invalid or expired — use vault:pick-folder first' };
  }
  return { ok: true, parentPath: validated.vaultRoot };
}

/**
 * Consumes the parentToken `checkScaffoldGate` validated, so it cannot be
 * replayed. Call only after the scaffold write has actually succeeded.
 */
export function consumeScaffoldToken(parentToken: unknown, now: number = Date.now()): void {
  if (isNonEmptyString(parentToken)) validateRegistrationToken(parentToken, { now });
}

/**
 * Gate `project:switch`. The vault root must already be in the recent-projects
 * allowlist — anything else is rejected. The renderer can only legitimately
 * switch to a project the user previously opened, and the recent-projects list
 * is maintained exclusively by main-process dialog flows (and an
 * initial-launch entry for the active vault).
 */
export function checkProjectSwitchGate(
  vaultRoot: unknown,
  allowlist: ReadonlyArray<string>,
): { ok: true; vaultRoot: string } | { ok: false; error: string } {
  if (!isNonEmptyString(vaultRoot)) {
    return { ok: false, error: 'Invalid vault root' };
  }
  if (!allowlist.includes(vaultRoot)) {
    return {
      ok: false,
      error: 'vaultRoot is not in the recent-projects allowlist — open the folder via the picker first',
    };
  }
  return { ok: true, vaultRoot };
}

/**
 * Guard for `vault:pick-folder-by-path` (SEC-12). Returns true only when `p`
 * contains a `.obsidian` subdirectory, i.e. is a real Obsidian vault. This
 * prevents a compromised renderer from obtaining a registration token for
 * arbitrary paths such as `/home/user` or `/etc`.
 *
 * The `existsSync` parameter is injectable so tests can exercise both paths
 * without touching the filesystem.
 */
export function looksLikeObsidianVault(
  p: string,
  existsSync: (fsPath: string) => boolean = fs.existsSync,
): boolean {
  return existsSync(joinPathLike(p, '.obsidian'));
}

export type OpenFolderGateResult = { ok: true } | { ok: false; error: string };

export interface OpenFolderGateInput {
  root: string;
  existsSync?: (fsPath: string) => boolean;
  readdirSync?: (fsPath: string) => string[];
  /** True when `root` is already a recognized Mythos vault by a check that
   *  lives outside this module (a MythosVault v2 root, or a root carrying
   *  the SKY-15 seed marker) — the caller composes those checks in. */
  isRecognizedVault?: boolean;
}

/**
 * Guard for `vault:open-folder` (SKY-11132). Refuses to adopt `root` as the
 * Story Vault when it is a non-empty folder that isn't already a recognized
 * Mythos vault — e.g. a user's real Obsidian vault. Without this gate, Open
 * Vault Folder repointed the Story Vault at whatever folder the OS dialog
 * returned and immediately seeded app files into it (ensureVaultDir), no
 * copy, no confirmation. Empty or missing folders are still fine — that's
 * genuinely starting a fresh vault there.
 */
export function checkOpenFolderGate(input: OpenFolderGateInput): OpenFolderGateResult {
  const {
    root,
    existsSync = fs.existsSync,
    readdirSync = fs.readdirSync,
    isRecognizedVault = false,
  } = input;
  if (!existsSync(root)) return { ok: true };
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return { ok: true };
  }
  if (entries.length === 0) return { ok: true };
  if (isRecognizedVault || existsSync(joinPathLike(root, 'manifest.json'))) return { ok: true };
  return {
    ok: false,
    error: looksLikeObsidianVault(root, existsSync)
      ? 'This is an Obsidian vault, not a Mythos vault — Open Vault Folder never repoints at it. Use Settings → Vault & Files → Import another vault to copy it in instead.'
      : "This folder doesn't look like a Mythos vault (no manifest.json or mythos.json found). Pick an existing Mythos vault folder, or use Import another vault / New vault to create one.",
  };
}

// ─── checkGuidedMoveGate (SKY-862) ───────────────────────────────────────────
// Gate for vault:guidedFolderMove. Validates all three required proof layers:
//   1. targetPath is within os.homedir() and has no `..` components.
//   2. syncProvider is one of the approved big-4 cloud providers.
//   3. sessionToken is a valid registration token bound to targetPath.
// Never consumes the token — call consumeGuidedMoveToken (below) after the
// move itself succeeds, so a mid-move failure doesn't burn the one-shot
// token and permanently block retry (SKY-10890).

const VALID_SYNC_PROVIDERS = new Set<string>(['icloud', 'dropbox', 'google-drive', 'onedrive']);

export interface GuidedMoveGateInput {
  targetPath: unknown;
  syncProvider: unknown;
  sessionToken: unknown;
}

export type GuidedMoveGateResult =
  | { ok: true; targetPath: string; syncProvider: CloudSyncProvider }
  | { ok: false; error: string };

/**
 * Gate vault:guidedFolderMove (SKY-862, SEC-11 vault-token pattern).
 *
 * Pure validation — no FS side effects. Pass `homeDir` from `os.homedir()` so
 * tests remain Electron-free.
 *
 * Rejection reasons:
 *  - targetPath missing / empty / not absolute.
 *  - targetPath contains `..` (traversal attempt).
 *  - targetPath is not within homeDir (system-directory escape).
 *  - syncProvider is not in the approved set.
 *  - sessionToken absent, invalid, expired, or bound to a different path.
 */
export function checkGuidedMoveGate(
  input: GuidedMoveGateInput,
  homeDir: string,
  now: number = Date.now(),
): GuidedMoveGateResult {
  if (!isNonEmptyString(input.targetPath)) {
    return { ok: false, error: 'targetPath: must be a non-empty string' };
  }
  const targetPath = input.targetPath;

  // Reject any path component equal to `..` (belt-and-suspenders alongside resolve).
  if (targetPath.split(/[/\\]/).some((seg) => seg === '..')) {
    return { ok: false, error: 'targetPath: path traversal denied' };
  }

  // Require an absolute path strictly within homeDir (not homeDir itself).
  if (!isStrictChildPath(homeDir, targetPath)) {
    return { ok: false, error: 'targetPath: must be within the user home directory' };
  }

  // Validate syncProvider.
  if (!isNonEmptyString(input.syncProvider) || !VALID_SYNC_PROVIDERS.has(input.syncProvider)) {
    return {
      ok: false,
      error: `syncProvider: must be one of ${[...VALID_SYNC_PROVIDERS].join(', ')}`,
    };
  }

  // Validate sessionToken — must be a registration token issued by vault:pick-folder
  // and bound to exactly targetPath.
  if (!isNonEmptyString(input.sessionToken)) {
    return { ok: false, error: 'sessionToken: required — use vault:pick-folder first' };
  }
  const validated = validateRegistrationToken(input.sessionToken, { consume: false, now });
  if (!validated) {
    return { ok: false, error: 'sessionToken: invalid or expired — use vault:pick-folder first' };
  }
  if (validated.vaultRoot !== targetPath) {
    return { ok: false, error: 'sessionToken: not bound to the requested targetPath' };
  }

  return { ok: true, targetPath, syncProvider: input.syncProvider as CloudSyncProvider };
}

/**
 * Consumes the sessionToken `checkGuidedMoveGate` validated, so it cannot be
 * replayed. Call only after the move the gate authorised has actually
 * succeeded.
 */
export function consumeGuidedMoveToken(sessionToken: unknown, now: number = Date.now()): void {
  if (isNonEmptyString(sessionToken)) validateRegistrationToken(sessionToken, { now });
}
