// Slice D — migrate existing Mythos vaults into multi-inner model without wipe.
// Ensures Notes/Story registries, Agent Vault + partner/hand files exist.
// Never deletes user notes/stories; never injects another world's content.

import fs from 'node:fs';
import path from 'node:path';
import {
  AGENT_VAULT_DIRNAME,
  MYTHOS_MACHINE_DIRNAME,
  tryReadMythosFile,
} from './mythosJson.js';
import { ensureNotesVaultRegistry } from './notesVaultRegistry.js';
import { ensureStoryVaultRegistry } from './storyVaultRegistry.js';
import { ensureAgentsPartnerFiles } from './agentsVaultPartner.js';
import { ensureMythosV2SeedMarker } from './createVault.js';
import { loadVaultLinkingState } from './vaultAccess.js';

export type MigrateMultiInnerResult =
  | {
      ok: true;
      mythosRoot: string;
      notesVaultCount: number;
      storyVaultCount: number;
      agentsPartnerCreated: string[];
      adoptedSeedMarker: boolean;
    }
  | { ok: false; error: string };

/**
 * Idempotent migrate-without-wipe for one Mythos vault root.
 * Soft-FAIL if this ever wiped user data — it only creates missing scaffolding.
 */
export function migrateVaultToMultiInner(mythosRoot: string): MigrateMultiInnerResult {
  if (!path.isAbsolute(mythosRoot)) {
    return { ok: false, error: 'mythosRoot must be absolute' };
  }
  if (!fs.existsSync(mythosRoot) || !tryReadMythosFile(mythosRoot)) {
    return { ok: false, error: 'Not a Mythos v2 vault' };
  }
  try {
    // Preserve any existing content — only ensure registries/dirs.
    const beforeNotes = listMarkdownRough(mythosRoot);
    const notesReg = ensureNotesVaultRegistry(mythosRoot);
    const storyReg = ensureStoryVaultRegistry(mythosRoot);
    fs.mkdirSync(path.join(mythosRoot, AGENT_VAULT_DIRNAME), { recursive: true });
    fs.mkdirSync(path.join(mythosRoot, MYTHOS_MACHINE_DIRNAME), { recursive: true });
    const partner = ensureAgentsPartnerFiles(mythosRoot);
    const { adopted } = ensureMythosV2SeedMarker(mythosRoot);
    // Touch linking state so settings.json carries vaultAccess envelope.
    loadVaultLinkingState(mythosRoot);
    const afterNotes = listMarkdownRough(mythosRoot);
    // Guard: migrate must not remove markdown files.
    for (const f of beforeNotes) {
      if (!afterNotes.has(f) && !f.includes(`${path.sep}${AGENT_VAULT_DIRNAME}${path.sep}`)) {
        // Identity files may be new; user md must remain.
        if (!fs.existsSync(f)) {
          return { ok: false, error: `Migrate wiped user file: ${f}` };
        }
      }
    }
    return {
      ok: true,
      mythosRoot,
      notesVaultCount: notesReg.vaults.length,
      storyVaultCount: storyReg.vaults.length,
      agentsPartnerCreated: partner.created,
      adoptedSeedMarker: adopted,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function listMarkdownRough(root: string): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === '.mythos' || e.name === 'node_modules') continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith('.md')) out.add(abs);
    }
  };
  walk(root);
  return out;
}
