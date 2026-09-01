// SKY-11058 — Per-Mythos-vault registry of Notes vaults.
// Refactored (SKY-11150) to delegate generic ops to vaultRegistry.ts.
//
// Stored at <mythosRoot>/notes-vaults.json — vault-local, travels with the
// folder (SKY-10949 self-contained ruling). Machine-local cache files go
// under .mythos/ but this is user data so it lives beside mythos.json.
//
// Only v2 vaults (those with a mythosRoot) have a registry. Legacy v0.4 vaults
// fall back to the userData vault-settings.json notesVaultRoot (unchanged).
//
// [CARVE-OUT]: writing this file on first open is a vault-data migration
// (additive, old builds ignore it). Approved by Ivy before merge per SKY-6626.
//
// Pure Node — no Electron imports — so unit tests drive it with tmpdirs.

import path from 'node:path';
import { listVaultFiles, readVaultFile } from '../vault.js';
import {
  VaultEntry,
  VaultRegistryConfig,
  VaultRegistry,
  vaultRegistryPath,
  vaultAbsPath,
  readVaultRegistry,
  writeVaultRegistry,
  ensureVaultRegistry,
  getActiveVaultEntry,
  createBlankVaultEntry,
  reserveVaultDirName,
  registerExistingVaultEntry,
  setActiveVault,
  renameVaultEntry,
} from './vaultRegistry.js';

export const NOTES_VAULT_REGISTRY_FILENAME = 'notes-vaults.json';
export const NOTES_VAULT_REGISTRY_VERSION = 1 as const;

// The default Notes Vault dir name — matches the v2 scaffold (mythosJson.ts).
export const DEFAULT_NOTES_VAULT_DIRNAME = 'Notes Vault';

const NOTES_CONFIG: VaultRegistryConfig = {
  registryFilename: NOTES_VAULT_REGISTRY_FILENAME,
  defaultDirName: DEFAULT_NOTES_VAULT_DIRNAME,
  defaultDisplayName: 'Notes',
};

export type NotesVaultOrigin = 'created' | 'imported';

export interface NotesVaultEntry extends VaultEntry {
  /** How the vault was originally added. */
  origin: NotesVaultOrigin;
}

export type NotesVaultRegistry = VaultRegistry<NotesVaultEntry>;

function makeNotesEntry(base: VaultEntry, origin: NotesVaultOrigin = 'created'): NotesVaultEntry {
  return { ...base, origin };
}

// ─── Paths ───────────────────────────────────────────────────────────────────

export function notesVaultRegistryPath(mythosRoot: string): string {
  return vaultRegistryPath(mythosRoot, NOTES_CONFIG);
}

export function notesVaultAbsPath(mythosRoot: string, entry: NotesVaultEntry): string {
  return vaultAbsPath(mythosRoot, entry);
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

/** Tolerant read — returns null when the registry does not exist yet. */
export function readNotesVaultRegistry(mythosRoot: string): NotesVaultRegistry | null {
  return readVaultRegistry<NotesVaultEntry>(mythosRoot, NOTES_CONFIG);
}

export function writeNotesVaultRegistry(mythosRoot: string, registry: NotesVaultRegistry): void {
  writeVaultRegistry(mythosRoot, NOTES_CONFIG, registry);
}

// ─── Migration / ensure ───────────────────────────────────────────────────────

export function ensureNotesVaultRegistry(mythosRoot: string): NotesVaultRegistry {
  return ensureVaultRegistry(mythosRoot, NOTES_CONFIG, (base) => makeNotesEntry(base, 'created'));
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function getActiveNotesVaultEntry(
  registry: NotesVaultRegistry,
): NotesVaultEntry | undefined {
  return getActiveVaultEntry(registry);
}

/** Resolve the active notes vault absolute path from the registry. */
export function getActiveNotesVaultPath(mythosRoot: string): string | null {
  const registry = readNotesVaultRegistry(mythosRoot);
  if (!registry) return null;
  const entry = getActiveNotesVaultEntry(registry);
  if (!entry) return null;
  return notesVaultAbsPath(mythosRoot, entry);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a blank notes vault directory and register it.
 * Does NOT activate it — caller decides whether to call setActiveNotesVault.
 */
export function createBlankNotesVault(
  mythosRoot: string,
  displayName: string,
): { registry: NotesVaultRegistry; entry: NotesVaultEntry } {
  return createBlankVaultEntry(mythosRoot, NOTES_CONFIG, displayName, (base) =>
    makeNotesEntry(base, 'created'),
  );
}

/**
 * Reserve a unique, filesystem-safe directory name under mythosRoot for a
 * future notes vault, WITHOUT creating the directory or writing the registry.
 */
export function reserveNotesVaultDirName(mythosRoot: string, displayName: string): string {
  return reserveVaultDirName(mythosRoot, NOTES_CONFIG, displayName, (base) =>
    makeNotesEntry(base),
  );
}

/**
 * Register an existing directory (e.g. after an Obsidian import) as a new
 * notes vault entry. The directory must already exist inside mythosRoot.
 */
export function registerImportedNotesVault(
  mythosRoot: string,
  dirName: string,
  displayName: string,
): { registry: NotesVaultRegistry; entry: NotesVaultEntry } {
  return registerExistingVaultEntry(mythosRoot, NOTES_CONFIG, dirName, displayName, (base) =>
    makeNotesEntry(base, 'imported'),
  );
}

/** Change the active vault. Returns the updated registry. */
export function setActiveNotesVault(
  mythosRoot: string,
  id: string,
): { registry: NotesVaultRegistry; entry: NotesVaultEntry } {
  return setActiveVault<NotesVaultEntry>(mythosRoot, NOTES_CONFIG, id);
}

/** Rename a notes vault display name. Returns the updated registry. */
export function renameNotesVault(
  mythosRoot: string,
  id: string,
  displayName: string,
): { registry: NotesVaultRegistry; entry: NotesVaultEntry } {
  return renameVaultEntry<NotesVaultEntry>(mythosRoot, NOTES_CONFIG, id, displayName);
}

// ─── Link resolution report ───────────────────────────────────────────────────

/**
 * Scan all .md files in the story vault for [[stem]] wikilinks.
 * Returns which unique stems resolve against targetNotesVaultRoot.
 */
export function buildLinkResolutionReport(
  storyVaultRoot: string,
  currentNotesVaultRoot: string,
  targetNotesVaultRoot: string,
): { resolvedCount: number; unresolvedStems: string[]; totalStems: number } {
  const wikiLinkPattern = /\[\[([^\]|#]+?)(?:[|#][^\]]*)?]]/g;

  const stems = new Set<string>();
  try {
    const { items } = listVaultFiles(storyVaultRoot);
    for (const item of items) {
      if (item.isDirectory || !item.name.endsWith('.md')) continue;
      try {
        const { content } = readVaultFile(storyVaultRoot, item.path);
        let m: RegExpExecArray | null;
        wikiLinkPattern.lastIndex = 0;
        while ((m = wikiLinkPattern.exec(content)) !== null) {
          const raw = m[1].trim();
          const stem = path.basename(raw, '.md').toLowerCase();
          if (stem) stems.add(stem);
        }
      } catch {
        // Skip unreadable files.
      }
    }
  } catch {
    return { resolvedCount: 0, unresolvedStems: [], totalStems: 0 };
  }

  if (stems.size === 0) {
    return { resolvedCount: 0, unresolvedStems: [], totalStems: 0 };
  }

  const targetStems = new Set<string>();
  try {
    const { items } = listVaultFiles(targetNotesVaultRoot);
    for (const item of items) {
      if (item.isDirectory || !item.name.endsWith('.md')) continue;
      targetStems.add(path.basename(item.name, '.md').toLowerCase());
    }
  } catch {
    // Target vault unreadable — all stems unresolved.
  }

  const unresolvedStems: string[] = [];
  let resolvedCount = 0;
  for (const stem of stems) {
    if (targetStems.has(stem)) {
      resolvedCount++;
    } else {
      unresolvedStems.push(stem);
    }
  }

  return { resolvedCount, unresolvedStems: unresolvedStems.sort(), totalStems: stems.size };
}
