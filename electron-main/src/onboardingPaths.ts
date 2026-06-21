import fs from 'fs';
import path from 'path';
import type { Manifest } from './ipc.js';

export interface SystemPathsResponse {
  homeDir: string;
  documentsDir: string;
  desktopDir: string;
  oneDriveDir: string | null;
  iCloudDir: string | null;
  suggestedSaveLocations: string[];
}

export interface ElectronAppPaths {
  getPath(name: string): string;
}

type ExistsFn = (candidatePath: string) => boolean;

export function buildSystemPaths(
  appPaths: ElectronAppPaths,
  env: NodeJS.ProcessEnv = process.env,
  exists: ExistsFn = fs.existsSync,
  platform: NodeJS.Platform = process.platform,
): SystemPathsResponse {
  const homeDir = appPaths.getPath('home');
  const oneDriveCandidate = env.ONEDRIVE || env.OneDrive || env.OneDriveConsumer || env.OneDriveCommercial;
  const iCloudCandidate = path.join(homeDir, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
  const documentsDir = appPaths.getPath('documents');
  const desktopDir = appPaths.getPath('desktop');
  const oneDriveDir = oneDriveCandidate || null;
  const iCloudDir = exists(iCloudCandidate) ? iCloudCandidate : null;
  const suggestedSaveLocations = (() => {
    if (platform === 'win32') {
      return [documentsDir, desktopDir, oneDriveDir]
        .filter((candidate): candidate is string => Boolean(candidate))
        .map((candidate) => path.join(candidate, 'MythosWriter'));
    }
    if (platform === 'darwin') {
      return [documentsDir, desktopDir, iCloudDir]
        .filter((candidate): candidate is string => Boolean(candidate))
        .map((candidate) => path.join(candidate, 'MythosWriter'));
    }
    return [path.join(documentsDir, 'MythosWriter'), path.join(homeDir, 'MythosWriter')];
  })();

  return {
    homeDir,
    documentsDir,
    desktopDir,
    oneDriveDir,
    iCloudDir,
    suggestedSaveLocations,
  };
}

export function updateRecentVaultParentPaths(
  current: readonly string[] | undefined,
  nextPath: string | undefined | null,
): string[] | undefined {
  const trimmed = nextPath?.trim();
  if (!trimmed) return current ? [...current].slice(-5) : current;
  const deduped = (current ?? []).filter((entry) => entry !== trimmed);
  deduped.push(trimmed);
  return deduped.slice(-5);
}

export interface ExistingVaultPaths {
  storyVaultPath: string;
  notesVaultPath: string;
  firstSceneId?: string;
  firstScenePath?: string;
}

function firstSceneFromManifest(manifest: Manifest): { firstSceneId?: string; firstScenePath?: string } {
  const firstScene = manifest.stories?.[0]?.chapters?.[0]?.scenes?.[0]
    ?? manifest.chapters?.[0]?.scenes?.[0]
    ?? manifest.scenes?.[0];
  return { firstSceneId: firstScene?.id, firstScenePath: firstScene?.path };
}

export function readExistingVaultPaths(vaultParentPath: string): ExistingVaultPaths {
  const parent = vaultParentPath.trim();
  if (!parent || !fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error('Existing vault path does not exist');
  }

  const storyVaultPath = path.join(parent, 'Story Vault');
  const notesVaultPath = path.join(parent, 'Notes Vault');
  const manifestPath = path.join(storyVaultPath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Existing vault is missing Story Vault/manifest.json');
  }
  if (!fs.existsSync(notesVaultPath) || !fs.statSync(notesVaultPath).isDirectory()) {
    throw new Error('Existing vault is missing Notes Vault');
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Manifest;
  } catch {
    throw new Error('Existing vault manifest is not valid JSON');
  }

  if (typeof manifest.schemaVersion !== 'number') {
    throw new Error('Existing vault manifest is missing schemaVersion');
  }

  return {
    storyVaultPath,
    notesVaultPath,
    ...firstSceneFromManifest(manifest),
  };
}

/** Returns true when p contains a valid Mythos two-vault layout (Story Vault/manifest.json + Notes Vault/). */
export function detectMythosVaultAt(p: string, exists: ExistsFn = fs.existsSync): boolean {
  if (!p || typeof p !== 'string') return false;
  try {
    return (
      exists(path.join(p, 'Story Vault', 'manifest.json')) &&
      exists(path.join(p, 'Notes Vault'))
    );
  } catch {
    return false;
  }
}

export type LegacyVaultDetection =
  | { found: false }
  | { found: true; legacyRoot: string; storyVaultPath: string; notesVaultPath: string };

export interface DetectLegacyVaultsOptions {
  homeDir: string;
  appVersion: string;
  legacyVaultDismissed?: boolean;
  exists?: ExistsFn;
}

export function detectLegacyVaults(options: DetectLegacyVaultsOptions): LegacyVaultDetection {
  if (options.legacyVaultDismissed) return { found: false };
  if (/^0\.1(?:\.|$)/.test(options.appVersion)) return { found: false };
  const exists = options.exists ?? fs.existsSync;
  const legacyRoot = path.join(options.homeDir, 'Mythos');
  const storyVaultPath = path.join(legacyRoot, 'Story Vault');
  const notesVaultPath = path.join(legacyRoot, 'Notes Vault');
  if (!exists(path.join(storyVaultPath, 'manifest.json'))) return { found: false };
  if (!exists(notesVaultPath)) return { found: false };
  return { found: true, legacyRoot, storyVaultPath, notesVaultPath };
}
