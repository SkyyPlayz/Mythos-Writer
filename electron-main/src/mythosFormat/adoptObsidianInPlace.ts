// Slice D — "Open Obsidian vault in Mythos" (IN PLACE).
// The chosen Obsidian folder becomes the Notes Vault; Mythos scaffolding
// (mythos.json, Story Vault, Agent Vault, registries) is written beside it
// in the parent folder. Source files are never copied.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  AGENT_VAULT_DIRNAME,
  MYTHOS_JSON_FILENAME,
  MYTHOS_MACHINE_DIRNAME,
  STORIES_GROUP_DIRNAME,
  STORY_VAULT_DIRNAME,
  createMythosFile,
  tryReadMythosFile,
  writeMythosFile,
} from './mythosJson.js';
import { defaultVaultSettingsFile, writeVaultSettingsFile } from './vaultSettingsFile.js';
import { defaultTimelinesFile, writeTimelinesFile } from './timelinesFile.js';
import { VAULT_REGISTRY_VERSION } from './vaultRegistry.js';
import { writeNotesVaultRegistry } from './notesVaultRegistry.js';
import { writeStoryVaultRegistry } from './storyVaultRegistry.js';
import { ensureAgentsPartnerFiles } from './agentsVaultPartner.js';

export const OPENIN_SEED_LAYOUT = 'openin@SliceD';

export type AdoptObsidianResult =
  | {
      ok: true;
      mythosRoot: string;
      notesVaultPath: string;
      storyVaultPath: string;
      vaultName: string;
    }
  | { ok: false; error: string };

function looksLikeObsidianOrMarkdownTree(dir: string): boolean {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
  if (fs.existsSync(path.join(dir, '.obsidian'))) return true;
  // Plain markdown folder is also allowed (Welcome copy).
  try {
    const entries = fs.readdirSync(dir);
    return entries.some((e) => e.endsWith('.md') || e === '.obsidian');
  } catch {
    return false;
  }
}

/**
 * Adopt `obsidianPath` in place: Mythos root = parent directory.
 * Refuses if parent already has mythos.json (would mix worlds / wipe risk).
 */
export function adoptObsidianVaultInPlace(
  obsidianPath: string,
  opts: { vaultName?: string; defaultTheme?: string } = {},
): AdoptObsidianResult {
  if (!path.isAbsolute(obsidianPath)) {
    return { ok: false, error: 'obsidianPath: must be an absolute path' };
  }
  const notesAbs = path.resolve(obsidianPath);
  if (!looksLikeObsidianOrMarkdownTree(notesAbs)) {
    return { ok: false, error: 'Folder is not an Obsidian vault or Markdown tree' };
  }
  const mythosRoot = path.dirname(notesAbs);
  const notesDirName = path.basename(notesAbs);
  if (tryReadMythosFile(mythosRoot) || fs.existsSync(path.join(mythosRoot, MYTHOS_JSON_FILENAME))) {
    return {
      ok: false,
      error: `Parent folder already has a Mythos vault (${mythosRoot}). Pick a vault whose parent is not already Mythos-managed.`,
    };
  }

  const vaultName = (opts.vaultName?.trim() || notesDirName || 'Mythos Vault').slice(0, 128);
  const storyVaultPath = path.join(mythosRoot, STORIES_GROUP_DIRNAME, STORY_VAULT_DIRNAME);
  const agentVaultPath = path.join(mythosRoot, AGENT_VAULT_DIRNAME);

  try {
    fs.mkdirSync(storyVaultPath, { recursive: true });
    fs.mkdirSync(agentVaultPath, { recursive: true });
    fs.mkdirSync(path.join(storyVaultPath, MYTHOS_MACHINE_DIRNAME), { recursive: true });

    const mythos = createMythosFile(vaultName, {
      ...(opts.defaultTheme ? { defaultTheme: opts.defaultTheme } : {}),
    });
    mythos.seed = {
      layout: OPENIN_SEED_LAYOUT,
      mode: 'blank',
      seededAt: new Date().toISOString(),
    };
    writeMythosFile(mythosRoot, mythos);
    writeVaultSettingsFile(
      mythosRoot,
      defaultVaultSettingsFile({
        ...(opts.defaultTheme ? { defaultTheme: opts.defaultTheme } : {}),
        layoutMode: 'blank',
      }),
    );
    writeTimelinesFile(mythosRoot, defaultTimelinesFile());

    const notesEntryId = crypto.randomUUID();
    writeNotesVaultRegistry(mythosRoot, {
      version: VAULT_REGISTRY_VERSION,
      vaults: [{
        id: notesEntryId,
        displayName: notesDirName,
        dirName: notesDirName,
        createdAt: new Date().toISOString(),
        origin: 'imported',
      }],
      activeId: notesEntryId,
    });
    const storyEntryId = crypto.randomUUID();
    writeStoryVaultRegistry(mythosRoot, {
      version: VAULT_REGISTRY_VERSION,
      vaults: [{
        id: storyEntryId,
        displayName: 'Story',
        dirName: `${STORIES_GROUP_DIRNAME}/${STORY_VAULT_DIRNAME}`,
        createdAt: new Date().toISOString(),
        pairedNotesVaultId: notesEntryId,
      }],
      activeId: storyEntryId,
    });

    ensureAgentsPartnerFiles(mythosRoot);

    return {
      ok: true,
      mythosRoot,
      notesVaultPath: notesAbs,
      storyVaultPath,
      vaultName,
    };
  } catch (e) {
    return { ok: false, error: `Open-in-place failed: ${(e as Error).message}` };
  }
}
