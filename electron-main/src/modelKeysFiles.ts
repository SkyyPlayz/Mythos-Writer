// F5 — Models & Keys file ops (location / Reveal / Open / Clear memory).
//
// All filesystem work is sandboxed to the app's Agent Vault ("keys dir" for
// partner identity + hand files under the open Mythos vault). Renderer never
// supplies absolute paths for reveal/open/clear. Relocation is whole-vault via
// MoveVaultWizard (Agent Vault travels with the Mythos vault) — no separate
// modelKeys move IPC.

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
