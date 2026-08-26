// SKY-11058 — Per-Mythos-vault registry of Notes vaults.
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

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeFileAtomic } from '../vault.js';
import { listVaultFiles, readVaultFile } from '../vault.js';

export const NOTES_VAULT_REGISTRY_FILENAME = 'notes-vaults.json';
export const NOTES_VAULT_REGISTRY_VERSION = 1 as const;

// The default Notes Vault dir name — matches the v2 scaffold (mythosJson.ts).
export const DEFAULT_NOTES_VAULT_DIRNAME = 'Notes Vault';

export type NotesVaultOrigin = 'created' | 'imported';

export interface NotesVaultEntry {
  /** Stable opaque id — never changes on rename. */
  id: string;
  /** User-visible label shown in the picker. */
  displayName: string;
  /** Directory name directly inside mythosRoot (not a full path). */
  dirName: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** How the vault was originally added. */
  origin: NotesVaultOrigin;
}

export interface NotesVaultRegistry {
  version: typeof NOTES_VAULT_REGISTRY_VERSION;
  vaults: NotesVaultEntry[];
  /** `id` of the currently active notes vault. */
  activeId: string;
}

// ─── Paths ───────────────────────────────────────────────────────────────────

export function notesVaultRegistryPath(mythosRoot: string): string {
  return path.join(mythosRoot, NOTES_VAULT_REGISTRY_FILENAME);
}

export function notesVaultAbsPath(mythosRoot: string, entry: NotesVaultEntry): string {
  return path.join(mythosRoot, entry.dirName);
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

/** Tolerant read — returns null when the registry doesn't exist yet. */
export function readNotesVaultRegistry(mythosRoot: string): NotesVaultRegistry | null {
  const p = notesVaultRegistryPath(mythosRoot);
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      !Array.isArray((parsed as { vaults?: unknown }).vaults)
    ) {
      return null;
    }
    return parsed as NotesVaultRegistry;
  } catch {
    return null;
  }
}

export function writeNotesVaultRegistry(mythosRoot: string, registry: NotesVaultRegistry): void {
  writeFileAtomic(
    notesVaultRegistryPath(mythosRoot),
    `${JSON.stringify(registry, null, 2)}\n`,
  );
}

// ─── Migration / ensure ───────────────────────────────────────────────────────

/**
 * Called every time a v2 vault opens. When notes-vaults.json doesn't exist
 * yet, create it with one entry pointing at the existing Notes Vault dir.
 * Existing vaults (registry present) are left unchanged (idempotent).
 *
 * Returns the current registry (post-migration if one happened).
 */
export function ensureNotesVaultRegistry(mythosRoot: string): NotesVaultRegistry {
  const existing = readNotesVaultRegistry(mythosRoot);
  if (existing && existing.vaults.length > 0) return existing;

  const defaultDirName = DEFAULT_NOTES_VAULT_DIRNAME;
  const entry: NotesVaultEntry = {
    id: crypto.randomUUID(),
    displayName: 'Notes',
    dirName: defaultDirName,
    createdAt: new Date().toISOString(),
    origin: 'created',
  };
  const registry: NotesVaultRegistry = {
    version: NOTES_VAULT_REGISTRY_VERSION,
    vaults: [entry],
    activeId: entry.id,
  };
  writeNotesVaultRegistry(mythosRoot, registry);
  return registry;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function getActiveNotesVaultEntry(
  registry: NotesVaultRegistry,
): NotesVaultEntry | undefined {
  return registry.vaults.find((v) => v.id === registry.activeId);
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
  const registry = ensureNotesVaultRegistry(mythosRoot);

  // Derive a unique dir name from the display name (slugified).
  const slug = displayName.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Notes Vault';
  let dirName = slug;
  let attempt = 2;
  const used = new Set(registry.vaults.map((v) => v.dirName.toLowerCase()));
  while (used.has(dirName.toLowerCase())) {
    dirName = `${slug} ${attempt++}`;
  }

  const entry: NotesVaultEntry = {
    id: crypto.randomUUID(),
    displayName: displayName.trim() || dirName,
    dirName,
    createdAt: new Date().toISOString(),
    origin: 'created',
  };

  const absDir = notesVaultAbsPath(mythosRoot, entry);
  fs.mkdirSync(absDir, { recursive: true });

  const updated: NotesVaultRegistry = {
    ...registry,
    vaults: [...registry.vaults, entry],
  };
  writeNotesVaultRegistry(mythosRoot, updated);
  return { registry: updated, entry };
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
  const registry = ensureNotesVaultRegistry(mythosRoot);

  const entry: NotesVaultEntry = {
    id: crypto.randomUUID(),
    displayName: displayName.trim() || dirName,
    dirName,
    createdAt: new Date().toISOString(),
    origin: 'imported',
  };

  const updated: NotesVaultRegistry = {
    ...registry,
    vaults: [...registry.vaults, entry],
  };
  writeNotesVaultRegistry(mythosRoot, updated);
  return { registry: updated, entry };
}

/** Change the active vault. Returns the updated registry. */
export function setActiveNotesVault(
  mythosRoot: string,
  id: string,
): { registry: NotesVaultRegistry; entry: NotesVaultEntry } {
  const registry = ensureNotesVaultRegistry(mythosRoot);
  const entry = registry.vaults.find((v) => v.id === id);
  if (!entry) throw new Error(`Notes vault not found: ${id}`);

  const updated: NotesVaultRegistry = { ...registry, activeId: id };
  writeNotesVaultRegistry(mythosRoot, updated);
  return { registry: updated, entry };
}

/** Rename a notes vault's display name. Returns the updated registry. */
export function renameNotesVault(
  mythosRoot: string,
  id: string,
  displayName: string,
): { registry: NotesVaultRegistry; entry: NotesVaultEntry } {
  const registry = ensureNotesVaultRegistry(mythosRoot);
  const idx = registry.vaults.findIndex((v) => v.id === id);
  if (idx < 0) throw new Error(`Notes vault not found: ${id}`);

  const entry: NotesVaultEntry = { ...registry.vaults[idx], displayName: displayName.trim() };
  const vaults = [...registry.vaults];
  vaults[idx] = entry;
  const updated: NotesVaultRegistry = { ...registry, vaults };
  writeNotesVaultRegistry(mythosRoot, updated);
  return { registry: updated, entry };
}

// ─── Link resolution report ───────────────────────────────────────────────────

/**
 * Scan all .md files in the story vault for [[stem]] wikilinks.
 * Returns which unique stems resolve against `targetNotesVaultRoot`
 * (a matching .md file exists anywhere in that vault, matched by stem).
 *
 * Used to generate the pre-swap confirmation report.
 */
export function buildLinkResolutionReport(
  storyVaultRoot: string,
  currentNotesVaultRoot: string,
  targetNotesVaultRoot: string,
): { resolvedCount: number; unresolvedStems: string[]; totalStems: number } {
  const wikiLinkPattern = /\[\[([^\]|#]+?)(?:[|#][^\]]*)?]]/g;

  // Collect all unique stems referenced in story files.
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
          // Take just the last path segment as the stem (Obsidian convention).
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

  // Build a set of stems present in the TARGET notes vault.
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

  // Compare.
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
