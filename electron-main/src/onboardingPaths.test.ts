import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildSystemPaths,
  detectLegacyVaults,
  readExistingVaultPaths,
  updateRecentVaultParentPaths,
} from './onboardingPaths.js';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-onboarding-paths-'));
}

describe('buildSystemPaths', () => {
  it('returns macOS app path suggestions and detected cloud directories', () => {
    const homeDir = mkTmp();
    const desktopDir = path.join(homeDir, 'Desktop');
    const documentsDir = path.join(homeDir, 'Documents');
    const oneDriveDir = path.join(homeDir, 'OneDrive');
    const iCloudDir = path.join(homeDir, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
    fs.mkdirSync(iCloudDir, { recursive: true });

    const result = buildSystemPaths(
      {
        getPath(name) {
          if (name === 'home') return homeDir;
          if (name === 'documents') return documentsDir;
          if (name === 'desktop') return desktopDir;
          throw new Error(`unexpected app path: ${name}`);
        },
      },
      { ONEDRIVE: oneDriveDir },
      fs.existsSync,
      'darwin',
    );

    expect(result).toEqual({
      homeDir,
      documentsDir,
      desktopDir,
      oneDriveDir,
      iCloudDir,
      suggestedSaveLocations: [
        path.join(documentsDir, 'MythosWriter'),
        path.join(desktopDir, 'MythosWriter'),
        path.join(iCloudDir, 'MythosWriter'),
      ],
    });
  });

  it('returns Linux suggestions without desktop/cloud paths', () => {
    const homeDir = mkTmp();
    const documentsDir = path.join(homeDir, 'Documents');
    const desktopDir = path.join(homeDir, 'Desktop');

    expect(buildSystemPaths(
      {
        getPath(name) {
          if (name === 'home') return homeDir;
          if (name === 'documents') return documentsDir;
          if (name === 'desktop') return desktopDir;
          throw new Error(`unexpected app path: ${name}`);
        },
      },
      {},
      fs.existsSync,
      'linux',
    ).suggestedSaveLocations).toEqual([
      path.join(documentsDir, 'MythosWriter'),
      path.join(homeDir, 'MythosWriter'),
    ]);
  });

  it('returns Windows suggestions with OneDrive when detected', () => {
    const homeDir = mkTmp();
    const documentsDir = path.join(homeDir, 'Documents');
    const desktopDir = path.join(homeDir, 'Desktop');
    const oneDriveDir = path.join(homeDir, 'OneDrive');

    expect(buildSystemPaths(
      {
        getPath(name) {
          if (name === 'home') return homeDir;
          if (name === 'documents') return documentsDir;
          if (name === 'desktop') return desktopDir;
          throw new Error(`unexpected app path: ${name}`);
        },
      },
      { OneDrive: oneDriveDir },
      fs.existsSync,
      'win32',
    ).suggestedSaveLocations).toEqual([
      path.join(documentsDir, 'MythosWriter'),
      path.join(desktopDir, 'MythosWriter'),
      path.join(oneDriveDir, 'MythosWriter'),
    ]);
  });

  it('returns null for undetected optional cloud directories', () => {
    const homeDir = mkTmp();
    expect(buildSystemPaths(
      {
        getPath(name) {
          if (name === 'home') return homeDir;
          return path.join(homeDir, name);
        },
      },
      {},
      fs.existsSync,
    )).toMatchObject({ oneDriveDir: null, iCloudDir: null });
  });
});

describe('updateRecentVaultParentPaths', () => {
  it('appends successful onboarding parents, dedupes, and keeps the newest five', () => {
    expect(updateRecentVaultParentPaths(
      ['/vaults/A', '/vaults/B', '/vaults/C', '/vaults/D', '/vaults/E'],
      '/vaults/B',
    )).toEqual(['/vaults/A', '/vaults/C', '/vaults/D', '/vaults/E', '/vaults/B']);

    expect(updateRecentVaultParentPaths(
      ['/vaults/A', '/vaults/B', '/vaults/C', '/vaults/D', '/vaults/E'],
      '/vaults/F',
    )).toEqual(['/vaults/B', '/vaults/C', '/vaults/D', '/vaults/E', '/vaults/F']);
  });
});

describe('readExistingVaultPaths', () => {
  it('accepts an existing Mythos vault parent without creating or modifying files', () => {
    const parent = mkTmp();
    const storyVaultPath = path.join(parent, 'Story Vault');
    const notesVaultPath = path.join(parent, 'Notes Vault');
    fs.mkdirSync(notesVaultPath);
    fs.mkdirSync(storyVaultPath);
    fs.writeFileSync(path.join(storyVaultPath, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      stories: [{ chapters: [{ scenes: [{ id: 'scene-1', path: 'Manuscript/scene-1.md' }] }] }],
      chapters: [],
      scenes: [],
    }));

    const before = fs.readdirSync(parent).sort();
    expect(readExistingVaultPaths(parent)).toEqual({
      storyVaultPath,
      notesVaultPath,
      firstSceneId: 'scene-1',
      firstScenePath: 'Manuscript/scene-1.md',
    });
    expect(fs.readdirSync(parent).sort()).toEqual(before);
  });

  it('rejects a path without a Mythos story-vault manifest', () => {
    const parent = mkTmp();
    fs.mkdirSync(path.join(parent, 'Story Vault'));
    fs.mkdirSync(path.join(parent, 'Notes Vault'));
    expect(() => readExistingVaultPaths(parent)).toThrow('Existing vault is missing Story Vault/manifest.json');
  });

  it('scaffolds missing Notes Vault rather than rejecting', () => {
    const parent = mkTmp();
    const storyVaultPath = path.join(parent, 'Story Vault');
    const notesVaultPath = path.join(parent, 'Notes Vault');
    fs.mkdirSync(storyVaultPath);
    fs.writeFileSync(path.join(storyVaultPath, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      stories: [],
      chapters: [],
      scenes: [],
    }));

    const result = readExistingVaultPaths(parent);
    expect(fs.existsSync(notesVaultPath)).toBe(true);
    expect(result.notesVaultPath).toBe(notesVaultPath);
  });
});

describe('detectLegacyVaults', () => {
  it('detects ~/Mythos/Story Vault + Notes Vault when not dismissed after upgrade', () => {
    const homeDir = mkTmp();
    const legacyRoot = path.join(homeDir, 'Mythos');
    fs.mkdirSync(path.join(legacyRoot, 'Story Vault'), { recursive: true });
    fs.mkdirSync(path.join(legacyRoot, 'Notes Vault'), { recursive: true });
    fs.writeFileSync(path.join(legacyRoot, 'Story Vault', 'manifest.json'), JSON.stringify({ schemaVersion: 1 }));

    expect(detectLegacyVaults({ homeDir, appVersion: '0.2.0', legacyVaultDismissed: false })).toEqual({
      found: true,
      legacyRoot,
      storyVaultPath: path.join(legacyRoot, 'Story Vault'),
      notesVaultPath: path.join(legacyRoot, 'Notes Vault'),
    });
  });

  it('skips detection when dismissed or still on v0.1.x', () => {
    const homeDir = mkTmp();
    const legacyRoot = path.join(homeDir, 'Mythos');
    fs.mkdirSync(path.join(legacyRoot, 'Story Vault'), { recursive: true });
    fs.mkdirSync(path.join(legacyRoot, 'Notes Vault'), { recursive: true });
    fs.writeFileSync(path.join(legacyRoot, 'Story Vault', 'manifest.json'), JSON.stringify({ schemaVersion: 1 }));

    expect(detectLegacyVaults({ homeDir, appVersion: '0.2.0', legacyVaultDismissed: true })).toEqual({ found: false });
    expect(detectLegacyVaults({ homeDir, appVersion: '0.1.9', legacyVaultDismissed: false })).toEqual({ found: false });
  });
});
