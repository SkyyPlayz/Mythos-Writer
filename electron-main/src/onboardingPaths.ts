import fs from 'fs';
import path from 'path';
import type { Manifest } from './ipc.js';

export interface SystemPathsResponse {
  homeDir: string;
  documentsDir: string;
  desktopDir: string;
  oneDriveDir: string | null;
  iCloudDir: string | null;
}

export interface ElectronAppPaths {
  getPath(name: string): string;
}

type ExistsFn = (candidatePath: string) => boolean;

export function buildSystemPaths(
  appPaths: ElectronAppPaths,
  env: NodeJS.ProcessEnv = process.env,
  exists: ExistsFn = fs.existsSync,
): SystemPathsResponse {
  const homeDir = appPaths.getPath('home');
  const oneDriveCandidate = env.ONEDRIVE || env.OneDrive || env.OneDriveConsumer || env.OneDriveCommercial;
  const iCloudCandidate = path.join(homeDir, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');

  return {
    homeDir,
    documentsDir: appPaths.getPath('documents'),
    desktopDir: appPaths.getPath('desktop'),
    oneDriveDir: oneDriveCandidate || null,
    iCloudDir: exists(iCloudCandidate) ? iCloudCandidate : null,
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
