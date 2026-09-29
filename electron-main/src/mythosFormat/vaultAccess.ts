// Slice D — Read & write / Read only access + cross-Mythos-vault link pairs.
// Persisted in the home Mythos vault's settings.json so it travels with the vault.

import {
  readVaultSettingsFile,
  writeVaultSettingsFile,
  type VaultSettingsFile,
} from './vaultSettingsFile.js';

export type VaultAccessMode = 'rw' | 'ro';

/** Key: `${mythosVaultId}:${kind}:${innerVaultId}` */
export type VaultAccessMap = Record<string, VaultAccessMode>;

export interface CrossVaultLinkPair {
  id: string;
  /** Mythos vault id that owns the link chrome (home). */
  homeMythosId: string;
  notes: { mythosId: string; vaultId: string; label: string; mythosName: string };
  story: { mythosId: string; vaultId: string; label: string; mythosName: string };
  createdAt: string;
}

export interface VaultLinkingState {
  vaultAccess: VaultAccessMap;
  crossLinks: CrossVaultLinkPair[];
}

const EMPTY: VaultLinkingState = { vaultAccess: {}, crossLinks: [] };

export function accessKey(mythosId: string, kind: 'notes' | 'story', vaultId: string): string {
  return `${mythosId}:${kind}:${vaultId}`;
}

function readState(settings: VaultSettingsFile): VaultLinkingState {
  const rawAccess = settings.vaultAccess;
  const vaultAccess: VaultAccessMap = {};
  if (rawAccess && typeof rawAccess === 'object' && !Array.isArray(rawAccess)) {
    for (const [k, v] of Object.entries(rawAccess as Record<string, unknown>)) {
      if (v === 'rw' || v === 'ro') vaultAccess[k] = v;
    }
  }
  const crossLinks: CrossVaultLinkPair[] = [];
  const rawLinks = settings.crossVaultLinks;
  if (Array.isArray(rawLinks)) {
    for (const item of rawLinks) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      if (typeof r.id !== 'string' || typeof r.homeMythosId !== 'string') continue;
      const notes = r.notes as CrossVaultLinkPair['notes'] | undefined;
      const story = r.story as CrossVaultLinkPair['story'] | undefined;
      if (!notes?.mythosId || !notes?.vaultId || !story?.mythosId || !story?.vaultId) continue;
      crossLinks.push({
        id: r.id,
        homeMythosId: r.homeMythosId,
        notes: {
          mythosId: notes.mythosId,
          vaultId: notes.vaultId,
          label: typeof notes.label === 'string' ? notes.label : notes.vaultId,
          mythosName: typeof notes.mythosName === 'string' ? notes.mythosName : notes.mythosId,
        },
        story: {
          mythosId: story.mythosId,
          vaultId: story.vaultId,
          label: typeof story.label === 'string' ? story.label : story.vaultId,
          mythosName: typeof story.mythosName === 'string' ? story.mythosName : story.mythosId,
        },
        createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
      });
    }
  }
  return { vaultAccess, crossLinks };
}

export function loadVaultLinkingState(mythosRoot: string): VaultLinkingState {
  return readState(readVaultSettingsFile(mythosRoot));
}

function persist(mythosRoot: string, state: VaultLinkingState): void {
  const cur = readVaultSettingsFile(mythosRoot);
  writeVaultSettingsFile(mythosRoot, {
    ...cur,
    vaultAccess: state.vaultAccess,
    crossVaultLinks: state.crossLinks,
  });
}

export function getVaultAccess(
  mythosRoot: string,
  mythosId: string,
  kind: 'notes' | 'story',
  vaultId: string,
): VaultAccessMode {
  const state = loadVaultLinkingState(mythosRoot);
  return state.vaultAccess[accessKey(mythosId, kind, vaultId)] ?? 'rw';
}

export function setVaultAccess(
  mythosRoot: string,
  mythosId: string,
  kind: 'notes' | 'story',
  vaultId: string,
  mode: VaultAccessMode,
): VaultLinkingState {
  const state = loadVaultLinkingState(mythosRoot);
  state.vaultAccess[accessKey(mythosId, kind, vaultId)] = mode;
  persist(mythosRoot, state);
  return state;
}

export function addCrossVaultLink(
  mythosRoot: string,
  pair: Omit<CrossVaultLinkPair, 'id' | 'createdAt'> & { id?: string },
): VaultLinkingState {
  const state = loadVaultLinkingState(mythosRoot);
  const id = pair.id ?? `xl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  // Replace existing pair with same endpoints.
  state.crossLinks = state.crossLinks.filter(
    (p) =>
      !(
        p.notes.mythosId === pair.notes.mythosId &&
        p.notes.vaultId === pair.notes.vaultId &&
        p.story.mythosId === pair.story.mythosId &&
        p.story.vaultId === pair.story.vaultId
      ),
  );
  state.crossLinks.push({
    id,
    homeMythosId: pair.homeMythosId,
    notes: pair.notes,
    story: pair.story,
    createdAt: new Date().toISOString(),
  });
  persist(mythosRoot, state);
  return state;
}

export function removeCrossVaultLink(mythosRoot: string, linkId: string): VaultLinkingState {
  const state = loadVaultLinkingState(mythosRoot);
  state.crossLinks = state.crossLinks.filter((p) => p.id !== linkId);
  persist(mythosRoot, state);
  return state;
}

export function emptyVaultLinkingState(): VaultLinkingState {
  return { ...EMPTY, vaultAccess: {}, crossLinks: [] };
}
