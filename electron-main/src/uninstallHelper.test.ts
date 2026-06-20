import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  resolveDeletePaths,
  cleanUninstall,
  defaultVaultsParent,
} from './uninstallHelper.js';

// ─── resolveDeletePaths ───

describe('resolveDeletePaths', () => {
  const userData = '/AppData/Roaming/Mythos Writer';
  const vaultsParent = path.join(userData, 'vaults');
  const defaultBundle = path.join(vaultsParent, 'Mythos Vault');

  it('uses the vaults parent when both vaults live under the default location', () => {
    const { toDelete, customPathsWarning } = resolveDeletePaths({
      storyVaultRoot: path.join(defaultBundle, 'Story Vault'),
      notesVaultRoot: path.join(defaultBundle, 'Notes Vault'),
      userDataPath: userData,
    });

    expect(toDelete).toContain(vaultsParent);
    expect(toDelete).not.toContain(path.join(defaultBundle, 'Story Vault'));
    expect(toDelete).not.toContain(path.join(defaultBundle, 'Notes Vault'));
    expect(customPathsWarning).toHaveLength(0);
  });

  it('includes settings files regardless of vault location', () => {
    const { toDelete } = resolveDeletePaths({
      storyVaultRoot: path.join(defaultBundle, 'Story Vault'),
      notesVaultRoot: path.join(defaultBundle, 'Notes Vault'),
      userDataPath: userData,
    });

    expect(toDelete).toContain(path.join(userData, 'vault-settings.json'));
    expect(toDelete).toContain(path.join(userData, 'app-settings.json'));
  });

  it('uses individual vault roots when both are in custom locations', () => {
    const customStory = '/Users/test/Documents/Novel/Story';
    const customNotes = '/Users/test/Documents/Novel/Notes';

    const { toDelete, customPathsWarning } = resolveDeletePaths({
      storyVaultRoot: customStory,
      notesVaultRoot: customNotes,
      userDataPath: userData,
    });

    expect(toDelete).toContain(customStory);
    expect(toDelete).toContain(customNotes);
    expect(toDelete).not.toContain(vaultsParent);
    expect(customPathsWarning).toContain(customStory);
    expect(customPathsWarning).toContain(customNotes);
  });

  it('deduplicates when story and notes vault are the same path', () => {
    const singleVault = '/Users/test/Documents/Vault';
    const { toDelete } = resolveDeletePaths({
      storyVaultRoot: singleVault,
      notesVaultRoot: singleVault,
      userDataPath: userData,
    });

    const count = toDelete.filter(p => p === singleVault).length;
    expect(count).toBe(1);
  });

  it('handles story under default + notes in custom location', () => {
    const { toDelete, customPathsWarning } = resolveDeletePaths({
      storyVaultRoot: path.join(defaultBundle, 'Story Vault'),
      notesVaultRoot: '/Users/test/CustomNotes',
      userDataPath: userData,
    });

    expect(toDelete).toContain(vaultsParent);
    expect(toDelete).toContain('/Users/test/CustomNotes');
    expect(customPathsWarning).toContain('/Users/test/CustomNotes');
  });
});

describe('defaultVaultsParent', () => {
  it('returns <userData>/vaults', () => {
    expect(defaultVaultsParent('/App/Mythos Writer')).toBe(
      path.join('/App/Mythos Writer', 'vaults')
    );
  });
});

// ─── cleanUninstall ───

describe('cleanUninstall', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-uninstall-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('removes the default vaults parent dir and settings files', () => {
    const vaultsParent = path.join(tmp, 'vaults');
    const story = path.join(vaultsParent, 'Mythos Vault', 'Story Vault');
    const notes = path.join(vaultsParent, 'Mythos Vault', 'Notes Vault');
    fs.mkdirSync(story, { recursive: true });
    fs.writeFileSync(path.join(story, 'scene.md'), '# Scene');
    fs.mkdirSync(notes, { recursive: true });
    fs.writeFileSync(path.join(tmp, 'vault-settings.json'), '{}');
    fs.writeFileSync(path.join(tmp, 'app-settings.json'), '{}');

    const result = cleanUninstall({
      storyVaultRoot: story,
      notesVaultRoot: notes,
      userDataPath: tmp,
    });

    expect(result.errors).toHaveLength(0);
    expect(result.deleted.length).toBeGreaterThan(0);
    expect(fs.existsSync(vaultsParent)).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'vault-settings.json'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'app-settings.json'))).toBe(false);
  });

  it('skips non-existent paths without errors', () => {
    const result = cleanUninstall({
      storyVaultRoot: path.join(tmp, 'missing', 'Story Vault'),
      notesVaultRoot: path.join(tmp, 'missing', 'Notes Vault'),
      userDataPath: tmp,
    });

    expect(result.errors).toHaveLength(0);
  });

  it('removes custom vault roots individually', () => {
    const customStory = path.join(tmp, 'custom-story');
    const customNotes = path.join(tmp, 'custom-notes');
    fs.mkdirSync(customStory, { recursive: true });
    fs.writeFileSync(path.join(customStory, 'scene.md'), '# Scene');
    fs.mkdirSync(customNotes, { recursive: true });

    const result = cleanUninstall({
      storyVaultRoot: customStory,
      notesVaultRoot: customNotes,
      userDataPath: tmp,
    });

    expect(result.errors).toHaveLength(0);
    expect(fs.existsSync(customStory)).toBe(false);
    expect(fs.existsSync(customNotes)).toBe(false);
  });

  it('does not delete userData dir itself — only targeted subdirs and files', () => {
    const vaultsParent = path.join(tmp, 'vaults');
    const story = path.join(vaultsParent, 'Mythos Vault', 'Story Vault');
    const notes = path.join(vaultsParent, 'Mythos Vault', 'Notes Vault');
    fs.mkdirSync(story, { recursive: true });
    fs.mkdirSync(notes, { recursive: true });
    // Extra file in userData that should NOT be removed
    fs.writeFileSync(path.join(tmp, 'state.db'), 'db-data');

    cleanUninstall({
      storyVaultRoot: story,
      notesVaultRoot: notes,
      userDataPath: tmp,
    });

    expect(fs.existsSync(tmp)).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'state.db'))).toBe(true);
  });
});
