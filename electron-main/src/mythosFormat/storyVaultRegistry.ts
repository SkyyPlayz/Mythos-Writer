// SKY-11150 — Per-Mythos-vault registry of Story vaults.
//
// Mirrors notesVaultRegistry.ts structure (SKY-11058) but for story vaults.
// Stored at <mythosRoot>/story-vaults.json.
//
// Story-specific addition: pairedNotesVaultId — one story vault may be
// paired to exactly one notes vault (nullable, opt-in). The notes side does
// not store this — fan-out is derived by scanning story entries.
//
// [CARVE-OUT]: writing this file on first open is a vault-data migration
// (additive, old builds ignore it). Follows the same lazy-migration pattern
// as SKY-11058 notes-vaults.json.
//
// Pure Node — no Electron imports — so unit tests drive it with tmpdirs.

import { importObsidianToVaultDir } from '../obsidianImporter.js';
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
  setActiveVault,
  renameVaultEntry,
} from './vaultRegistry.js';

export const STORY_VAULT_REGISTRY_FILENAME = 'story-vaults.json';
export const STORY_VAULT_REGISTRY_VERSION = 1 as const;
export const DEFAULT_STORY_VAULT_DIRNAME = 'Story Vault';

const STORY_CONFIG: VaultRegistryConfig = {
  registryFilename: STORY_VAULT_REGISTRY_FILENAME,
  defaultDirName: DEFAULT_STORY_VAULT_DIRNAME,
  defaultDisplayName: 'Story',
};

export interface StoryVaultEntry extends VaultEntry {
  /**
   * Id of the paired notes vault (from notes-vaults.json), or null if
   * unpaired. Re-linking replaces the existing value — never appends.
   */
  pairedNotesVaultId: string | null;
}

export type StoryVaultRegistry = VaultRegistry<StoryVaultEntry>;

function makeStoryEntry(
  base: VaultEntry,
  pairedNotesVaultId: string | null = null,
): StoryVaultEntry {
  return { ...base, pairedNotesVaultId };
}

// ─── Paths ───────────────────────────────────────────────────────────────────

export function storyVaultRegistryPath(mythosRoot: string): string {
  return vaultRegistryPath(mythosRoot, STORY_CONFIG);
}

export function storyVaultAbsPath(mythosRoot: string, entry: StoryVaultEntry): string {
  return vaultAbsPath(mythosRoot, entry);
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

/** Tolerant read — returns null when the registry does not exist yet. */
export function readStoryVaultRegistry(mythosRoot: string): StoryVaultRegistry | null {
  return readVaultRegistry<StoryVaultEntry>(mythosRoot, STORY_CONFIG);
}

export function writeStoryVaultRegistry(mythosRoot: string, registry: StoryVaultRegistry): void {
  writeVaultRegistry(mythosRoot, STORY_CONFIG, registry);
}

// ─── Migration / ensure ───────────────────────────────────────────────────────

/**
 * Called every time a v2 vault opens. When story-vaults.json does not exist
 * yet, creates it with one entry pointing at the existing Story Vault dir.
 * Idempotent — existing registries are returned unchanged.
 */
export function ensureStoryVaultRegistry(mythosRoot: string): StoryVaultRegistry {
  return ensureVaultRegistry(mythosRoot, STORY_CONFIG, (base) => makeStoryEntry(base, null));
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function getActiveStoryVaultEntry(
  registry: StoryVaultRegistry,
): StoryVaultEntry | undefined {
  return getActiveVaultEntry(registry);
}

export function getActiveStoryVaultPath(mythosRoot: string): string | null {
  const registry = readStoryVaultRegistry(mythosRoot);
  if (!registry) return null;
  const entry = getActiveStoryVaultEntry(registry);
  if (!entry) return null;
  return storyVaultAbsPath(mythosRoot, entry);
}

/**
 * Derive which story vaults are paired to a given notes vault.
 * The notes side has no pairing field — fan-out is derived here by scanning.
 */
export function storyVaultsForNotesVault(
  registry: StoryVaultRegistry,
  notesVaultId: string,
): StoryVaultEntry[] {
  return registry.vaults.filter((v) => v.pairedNotesVaultId === notesVaultId);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a blank story vault directory and register it (unpaired by default).
 * Does NOT activate it — caller decides whether to call setActiveStoryVault.
 */
export function createBlankStoryVault(
  mythosRoot: string,
  displayName: string,
): { registry: StoryVaultRegistry; entry: StoryVaultEntry } {
  return createBlankVaultEntry(mythosRoot, STORY_CONFIG, displayName, (base) =>
    makeStoryEntry(base, null),
  );
}

/**
 * The creation options for an inner (per-Mythos-vault) story vault. No
 * 'template' option — createVaultFromOptions.ts's template mode only seeds
 * the Notes side; there is no story-vault skeleton anywhere in the codebase.
 */
export type StoryVaultCreationMode = 'blank' | 'import';

export interface CreateStoryVaultFromOptionsResult {
  registry: StoryVaultRegistry;
  entry: StoryVaultEntry;
  /** Present for `import` mode only. */
  importTally?: { imported: number; skipped: number; sourceCount: number; warnings: string[] };
}

/**
 * Create a new story vault registry entry using one of the two creation
 * modes available for story vaults: blank / import. Mirrors
 * createNotesVaultFromOptions in notesVaultRegistry.ts.
 */
export function createStoryVaultFromOptions(
  mythosRoot: string,
  displayName: string,
  mode: StoryVaultCreationMode,
  importSourcePath?: string,
): CreateStoryVaultFromOptionsResult {
  if (mode === 'import' && !importSourcePath?.trim()) {
    throw new Error('import mode requires an importSourcePath');
  }

  const { registry, entry } = createBlankVaultEntry(mythosRoot, STORY_CONFIG, displayName, (base) =>
    makeStoryEntry(base, null),
  );

  if (mode === 'import') {
    const absDir = storyVaultAbsPath(mythosRoot, entry);
    const result = importObsidianToVaultDir(importSourcePath as string, absDir);
    if (!result.ok) {
      throw new Error(result.errors.join('; '));
    }
    const warnings = result.dropWarning ? [result.dropWarning] : [];
    return {
      registry,
      entry,
      importTally: {
        imported: result.imported,
        skipped: result.skipped,
        sourceCount: result.sourceCount,
        warnings,
      },
    };
  }

  // mode === 'blank': no-op, dir already created empty by createBlankVaultEntry.
  return { registry, entry };
}

/** Change the active story vault. Returns the updated registry. */
export function setActiveStoryVault(
  mythosRoot: string,
  id: string,
): { registry: StoryVaultRegistry; entry: StoryVaultEntry } {
  return setActiveVault<StoryVaultEntry>(mythosRoot, STORY_CONFIG, id);
}

/** Rename a story vault display name. Returns the updated registry. */
export function renameStoryVault(
  mythosRoot: string,
  id: string,
  displayName: string,
): { registry: StoryVaultRegistry; entry: StoryVaultEntry } {
  return renameVaultEntry<StoryVaultEntry>(mythosRoot, STORY_CONFIG, id, displayName);
}

/**
 * Set or clear the notes-vault pairing for a story vault.
 * Passing null unpairs; passing a notesVaultId replaces any existing pairing
 * (never appends — a story vault is paired to exactly one notes vault).
 */
export function pairStoryVaultToNotesVault(
  mythosRoot: string,
  storyVaultId: string,
  notesVaultId: string | null,
): { registry: StoryVaultRegistry; entry: StoryVaultEntry } {
  const registry = readStoryVaultRegistry(mythosRoot);
  if (!registry) throw new Error('Story vault registry not found');
  const idx = registry.vaults.findIndex((v) => v.id === storyVaultId);
  if (idx < 0) throw new Error('Story vault not found: ' + storyVaultId);
  const entry: StoryVaultEntry = { ...registry.vaults[idx], pairedNotesVaultId: notesVaultId };
  const vaults = [...registry.vaults];
  vaults[idx] = entry;
  const updated: StoryVaultRegistry = { ...registry, vaults };
  writeStoryVaultRegistry(mythosRoot, updated);
  return { registry: updated, entry };
}
