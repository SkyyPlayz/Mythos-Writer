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
