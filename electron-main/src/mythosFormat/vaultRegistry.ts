// Generic vault-registry core — parameterised by kind (notes | story).
// Extracted from notesVaultRegistry.ts (SKY-11150). Kind-specific modules
// (notesVaultRegistry.ts, storyVaultRegistry.ts) are thin wrappers around
// these exports — they add entry-type-specific fields and named re-exports.
//
// Pure Node — no Electron imports — so unit tests drive it with tmpdirs.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeFileAtomic } from '../vault.js';

export const VAULT_REGISTRY_VERSION = 1 as const;

/** Minimum shape every registry entry must have. */
export interface VaultEntry {
  /** Stable opaque id — never changes on rename. */
  id: string;
  /** User-visible label shown in the picker. */
  displayName: string;
  /** Directory name directly inside mythosRoot (not a full path). */
  dirName: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

export interface VaultRegistry<E extends VaultEntry = VaultEntry> {
  version: typeof VAULT_REGISTRY_VERSION;
  vaults: E[];
  /** id of the currently active vault. */
  activeId: string;
}

/** Kind-specific config passed to every generic function. */
export interface VaultRegistryConfig {
  /** Filename of the JSON registry at <mythosRoot>/<registryFilename>. */
  registryFilename: string;
  /** Dir name of the pre-existing vault the lazy migration picks up. */
  defaultDirName: string;
  /** Display name used for the auto-created first entry. */
  defaultDisplayName: string;
}

// ─── Paths ───────────────────────────────────────────────────────────────────

export function vaultRegistryPath(mythosRoot: string, config: VaultRegistryConfig): string {
  return path.join(mythosRoot, config.registryFilename);
}

export function vaultAbsPath(mythosRoot: string, entry: VaultEntry): string {
  return path.join(mythosRoot, entry.dirName);
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

/** Tolerant read — returns null when the registry does not exist yet. */
export function readVaultRegistry<E extends VaultEntry>(
  mythosRoot: string,
  config: VaultRegistryConfig,
): VaultRegistry<E> | null {
  const p = vaultRegistryPath(mythosRoot, config);
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
    return parsed as VaultRegistry<E>;
  } catch {
    return null;
  }
}

export function writeVaultRegistry<E extends VaultEntry>(
  mythosRoot: string,
  config: VaultRegistryConfig,
  registry: VaultRegistry<E>,
): void {
  writeFileAtomic(
    vaultRegistryPath(mythosRoot, config),
    JSON.stringify(registry, null, 2) + '\n',
  );
}

// ─── Migration / ensure ───────────────────────────────────────────────────────

/**
 * Called every time a v2 vault opens. When the registry JSON does not exist
 * yet, creates it with one entry pointing at the existing default vault dir.
 * Idempotent — existing registries are returned unchanged.
 *
 * @param makeEntry  Factory that adds kind-specific fields to the base entry.
 */
export function ensureVaultRegistry<E extends VaultEntry>(
  mythosRoot: string,
  config: VaultRegistryConfig,
  makeEntry: (base: VaultEntry) => E,
): VaultRegistry<E> {
  const existing = readVaultRegistry<E>(mythosRoot, config);
  if (existing && existing.vaults.length > 0) return existing;

  const base: VaultEntry = {
    id: crypto.randomUUID(),
    displayName: config.defaultDisplayName,
    dirName: config.defaultDirName,
    createdAt: new Date().toISOString(),
  };
  const entry = makeEntry(base);
  const registry: VaultRegistry<E> = {
    version: VAULT_REGISTRY_VERSION,
    vaults: [entry],
    activeId: entry.id,
  };
  writeVaultRegistry(mythosRoot, config, registry);
  return registry;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export function getActiveVaultEntry<E extends VaultEntry>(
  registry: VaultRegistry<E>,
): E | undefined {
  return registry.vaults.find((v) => v.id === registry.activeId);
}

export function getActiveVaultPath<E extends VaultEntry>(
  mythosRoot: string,
  registry: VaultRegistry<E>,
): string | null {
  const entry = getActiveVaultEntry(registry);
  if (!entry) return null;
  return vaultAbsPath(mythosRoot, entry);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a blank vault directory and register it.
 * Does NOT activate it — caller decides whether to call setActiveVault.
 */
export function createBlankVaultEntry<E extends VaultEntry>(
  mythosRoot: string,
  config: VaultRegistryConfig,
  displayName: string,
  makeEntry: (base: VaultEntry) => E,
): { registry: VaultRegistry<E>; entry: E } {
  const registry = ensureVaultRegistry(mythosRoot, config, makeEntry);

  const slug = displayName.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || config.defaultDirName;
  let dirName = slug;
  let attempt = 2;
  const used = new Set(registry.vaults.map((v) => v.dirName.toLowerCase()));
  while (used.has(dirName.toLowerCase())) {
    dirName = slug + ' ' + attempt++;
  }

  const base: VaultEntry = {
    id: crypto.randomUUID(),
    displayName: displayName.trim() || dirName,
    dirName,
    createdAt: new Date().toISOString(),
  };
  const entry = makeEntry(base);

  const absDir = vaultAbsPath(mythosRoot, entry);
  fs.mkdirSync(absDir, { recursive: true });

  const updated: VaultRegistry<E> = {
    ...registry,
    vaults: [...registry.vaults, entry],
  };
  writeVaultRegistry(mythosRoot, config, updated);
  return { registry: updated, entry };
}

/**
 * Reserve a unique, filesystem-safe directory name for a future vault,
 * WITHOUT creating the directory or writing the registry.
 */
export function reserveVaultDirName<E extends VaultEntry>(
  mythosRoot: string,
  config: VaultRegistryConfig,
  displayName: string,
  makeEntry: (base: VaultEntry) => E,
): string {
  const registry = ensureVaultRegistry(mythosRoot, config, makeEntry);

  const slug = displayName.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || config.defaultDirName;
  let dirName = slug;
  let attempt = 2;
  const used = new Set(registry.vaults.map((v) => v.dirName.toLowerCase()));
  while (used.has(dirName.toLowerCase())) {
    dirName = slug + ' ' + attempt++;
  }

  return dirName;
}

/**
 * Register an existing directory (e.g. after a vault import) as a new entry.
 * The directory must already exist inside mythosRoot.
 */
export function registerExistingVaultEntry<E extends VaultEntry>(
  mythosRoot: string,
  config: VaultRegistryConfig,
  dirName: string,
  displayName: string,
  makeEntry: (base: VaultEntry) => E,
): { registry: VaultRegistry<E>; entry: E } {
  const registry = ensureVaultRegistry(mythosRoot, config, makeEntry);
  const base: VaultEntry = {
    id: crypto.randomUUID(),
    displayName: displayName.trim() || dirName,
    dirName,
    createdAt: new Date().toISOString(),
  };
  const entry = makeEntry(base);
  const updated: VaultRegistry<E> = {
    ...registry,
    vaults: [...registry.vaults, entry],
  };
  writeVaultRegistry(mythosRoot, config, updated);
  return { registry: updated, entry };
}

/** Change the active vault. Returns the updated registry. */
export function setActiveVault<E extends VaultEntry>(
  mythosRoot: string,
  config: VaultRegistryConfig,
  id: string,
): { registry: VaultRegistry<E>; entry: E } {
  const registry = readVaultRegistry<E>(mythosRoot, config);
  if (!registry) throw new Error('Vault registry not found: ' + config.registryFilename);
  const entry = registry.vaults.find((v) => v.id === id);
  if (!entry) throw new Error('Vault not found: ' + id);
  const updated: VaultRegistry<E> = { ...registry, activeId: id };
  writeVaultRegistry(mythosRoot, config, updated);
  return { registry: updated, entry };
}

/** Rename a vault display name. Returns the updated registry. */
export function renameVaultEntry<E extends VaultEntry>(
  mythosRoot: string,
  config: VaultRegistryConfig,
  id: string,
  displayName: string,
): { registry: VaultRegistry<E>; entry: E } {
  const registry = readVaultRegistry<E>(mythosRoot, config);
  if (!registry) throw new Error('Vault registry not found: ' + config.registryFilename);
  const idx = registry.vaults.findIndex((v) => v.id === id);
  if (idx < 0) throw new Error('Vault not found: ' + id);
  const entry: E = { ...registry.vaults[idx], displayName: displayName.trim() };
  const vaults = [...registry.vaults];
  vaults[idx] = entry;
  const updated: VaultRegistry<E> = { ...registry, vaults };
  writeVaultRegistry(mythosRoot, config, updated);
  return { registry: updated, entry };
}
