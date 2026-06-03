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

/**
 * Gate `vault:setPaths`. Each of the two requested paths must independently
 * pass either the registration-token check or the recent-projects allowlist
 * check. On success returns the validated paths; otherwise returns a typed
 * error and does not consume any token.
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

  // Peek each token without consuming so we can fail fast without burning
  // a still-valid pair when only one side is bad.
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

  // Both passed. Consume each supplied token so it cannot be replayed.
  if (storyToken) validateRegistrationToken(storyToken, { now });
  if (notesToken) validateRegistrationToken(notesToken, { now });

  return { ok: true, storyVaultPath: input.storyVaultPath, notesVaultPath: input.notesVaultPath };
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
 * Gate vault:create-blank (SEC-11). The renderer-supplied targetPath must be
 * either (a) present in the recent-projects allowlist, or (b) accompanied by
 * a registration token issued by a main-process file-picker dialog and bound
 * to the exact same path. Rejects anything else so a compromised renderer
 * cannot mkdir at an arbitrary writable path and re-root the vault sandbox.
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
  // Path is authorised. Consume the token so it cannot be replayed.
  if (token) validateRegistrationToken(token, { now });
  return { ok: true, targetPath: input.targetPath };
}

/**
 * Gate `template:scaffold` (SKY-780). The renderer must supply a registration
 * token from a prior `vault:pick-folder` dialog call, proving the parent
 * directory was user-selected. The handler derives story/notes sub-paths from
 * the validated parent — the renderer never supplies arbitrary FS paths.
 * The token is consumed on success (one-shot).
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
  const validated = validateRegistrationToken(input.parentToken, { consume: true, now });
  if (!validated) {
    return { ok: false, error: 'parentToken is invalid or expired — use vault:pick-folder first' };
  }
  return { ok: true, parentPath: validated.vaultRoot };
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
  return existsSync(path.join(p, '.obsidian'));
}
