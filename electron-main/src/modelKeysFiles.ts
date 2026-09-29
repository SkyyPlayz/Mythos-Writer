// F5 — Models & Keys file ops (location / Reveal / Open / Clear / Move).
//
// All filesystem work is sandboxed to the app's Agent Vault ("keys dir" for
// partner identity + hand files under the open Mythos vault). Renderer never
// supplies absolute paths for reveal/open/clear; Move only accepts a dialog-
// picked destination that passes containment checks.

import fs from 'node:fs';
import path from 'node:path';
import {
  ensureAgentsPartnerFiles,
  clearAgentMemory,
  listAgentsVaultStats,
  agentsPartnerDir,
} from './mythosFormat/agentsVaultPartner.js';
import { AGENT_VAULT_DIRNAME } from './mythosFormat/mythosJson.js';

export { AGENT_VAULT_DIRNAME };

export interface ModelKeysLocation {
  ok: true;
  path: string;
  name: string;
  files: number;
  chips: string[];
  scope: string;
}

function realpathOrSelf(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

/** True when `candidate` is the keys dir or a path strictly inside it. */
export function isInsideKeysDir(keysDir: string, candidate: string): boolean {
  const root = realpathOrSelf(keysDir);
  const target = realpathOrSelf(candidate);
  return target === root || target.startsWith(root + path.sep);
}

/**
 * Resolve the sandboxed keys dir for the open Mythos vault. Ensures identity
 * files exist. Throws if mythosRoot is missing/invalid.
 */
export function resolveKeysDir(mythosRoot: string): string {
  if (!mythosRoot || typeof mythosRoot !== 'string') {
    throw new Error('No Mythos vault open');
  }
  const resolved = path.resolve(mythosRoot);
  if (resolved.includes('\0') || /(?:%2e){2}/i.test(resolved)) {
    throw new Error('Invalid vault root');
  }
  const ensured = ensureAgentsPartnerFiles(resolved);
  const keysDir = ensured.agentVaultPath;
  const mythosReal = realpathOrSelf(resolved);
  const keysReal = realpathOrSelf(keysDir);
  if (keysReal !== mythosReal && !keysReal.startsWith(mythosReal + path.sep)) {
    throw new Error('Keys directory escaped vault root');
  }
  // Keep agentsPartnerDir in sync with the resolved path (same folder).
  if (realpathOrSelf(agentsPartnerDir(resolved)) !== keysReal) {
    throw new Error('Keys directory mismatch');
  }
  return keysDir;
}

export function getModelKeysLocation(
  mythosRoot: string,
  scopeLabel: string,
): ModelKeysLocation {
  const keysDir = resolveKeysDir(mythosRoot);
  const stats = listAgentsVaultStats(mythosRoot);
  return {
    ok: true,
    path: keysDir,
    name: stats.name,
    files: stats.files,
    chips: stats.chips,
    scope: scopeLabel,
  };
}

export function clearModelKeysMemory(mythosRoot: string): {
  ok: true;
  removed: string[];
} | { ok: false; error: string } {
  resolveKeysDir(mythosRoot); // sandbox gate
  return clearAgentMemory(mythosRoot);
}

/**
 * Validate a Move destination. Rejects traversal, null bytes, and destinations
 * that would nest the keys dir inside itself. Does not perform the move —
 * Agent Vault travels with the Mythos vault; this gate exists so the UI can
 * confirm the chosen folder is a real, writable directory outside the keys dir.
 */
export function validateModelKeysMoveTarget(
  mythosRoot: string,
  destPath: string,
): { ok: true; dest: string } | { ok: false; error: string } {
  if (typeof destPath !== 'string' || !destPath.trim()) {
    return { ok: false, error: 'Destination required' };
  }
  if (destPath.includes('\0') || /(?:%2e){2}/i.test(destPath) || /^\.\.($|[\\/])|[\\/]\.\.($|[\\/])/.test(destPath)) {
    return { ok: false, error: 'Path traversal denied' };
  }
  let keysDir: string;
  try {
    keysDir = resolveKeysDir(mythosRoot);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const dest = path.resolve(destPath.trim());
  let destReal: string;
  try {
    destReal = fs.realpathSync.native(dest);
  } catch {
    return { ok: false, error: 'Destination does not exist' };
  }
  let st: fs.Stats;
  try {
    st = fs.statSync(destReal);
  } catch {
    return { ok: false, error: 'Destination is not accessible' };
  }
  if (!st.isDirectory()) {
    return { ok: false, error: 'Destination must be a folder' };
  }
  // Refuse moving into the keys dir itself (would nest / clobber identity files).
  if (isInsideKeysDir(keysDir, destReal)) {
    return { ok: false, error: 'Destination cannot be inside the keys directory' };
  }
  // Refuse the keys dir as destination.
  if (realpathOrSelf(keysDir) === destReal) {
    return { ok: false, error: 'Destination cannot be the keys directory' };
  }
  return { ok: true, dest: destReal };
}
