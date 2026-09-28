import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  resolveDeletePaths,
  cleanUninstall,
  defaultVaultsParent,
  loadRegisteredVaultRoots,
  resolveUninstallDeletePaths,
  writeUninstallDeletePathList,
  uninstallDeletePathsFile,
  isUnsafeUninstallDeletePath,
  isAllowedUninstallDeletePath,
  filterUninstallSidecarLines,
  hasDotOrDotDotSegment,
  normalizeUninstallDeletePath,
  UNINSTALL_DELETE_PATHS_FILENAME,
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

  // SKY-8882: on Windows a locked file lets the vault survive the recursive
  // rm — success must be VERIFIED, never assumed from "rmSync didn't throw".
  it('reports an error when the directory still exists after rm (Windows lock)', () => {
    const vaultsParent = path.join(tmp, 'vaults');
    const story = path.join(vaultsParent, 'Mythos Vault', 'Story Vault');
    const notes = path.join(vaultsParent, 'Mythos Vault', 'Notes Vault');
    fs.mkdirSync(story, { recursive: true });
    fs.mkdirSync(notes, { recursive: true });

    // Simulate the Windows failure mode: rmSync returns without throwing but
    // the directory is still on disk (force:true swallowed a locked entry).
    const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => undefined);
    try {
      const result = cleanUninstall({
        storyVaultRoot: story,
        notesVaultRoot: notes,
        userDataPath: tmp,
      });

      expect(result.deleted).not.toContain(vaultsParent);
      expect(result.errors.some((e) => e.startsWith(vaultsParent))).toBe(true);
      expect(result.errors.join(' ')).toMatch(/still exists/i);
    } finally {
      rmSpy.mockRestore();
    }
  });

  it('passes maxRetries to rmSync so transient Windows locks are retried', () => {
    const vaultsParent = path.join(tmp, 'vaults');
    const story = path.join(vaultsParent, 'Mythos Vault', 'Story Vault');
    fs.mkdirSync(story, { recursive: true });

    const rmSpy = vi.spyOn(fs, 'rmSync');
    try {
      cleanUninstall({
        storyVaultRoot: story,
        notesVaultRoot: path.join(vaultsParent, 'Mythos Vault', 'Notes Vault'),
        userDataPath: tmp,
      });

      const dirCall = rmSpy.mock.calls.find(([p]) => p === vaultsParent);
      expect(dirCall).toBeDefined();
      expect(dirCall![1]).toMatchObject({ recursive: true, maxRetries: 10 });
    } finally {
      rmSpy.mockRestore();
    }
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

// ─── MW-delete-vault: tip-key registry → NSIS sidecar path list ───

function writeVaultSettings(dir: string, body: unknown): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'vault-settings.json'), JSON.stringify(body), 'utf-8');
}

describe('loadRegisteredVaultRoots (tip keys only)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-reg-roots-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns empty when vault-settings.json is missing', () => {
    expect(loadRegisteredVaultRoots(tmp)).toEqual([]);
  });

  it('returns empty on corrupt JSON (safe fallback)', () => {
    fs.writeFileSync(path.join(tmp, 'vault-settings.json'), '{not json', 'utf-8');
    expect(loadRegisteredVaultRoots(tmp)).toEqual([]);
  });

  it('reads top-level vaultRoot / notesVaultRoot only — ignores fictional .root', () => {
    writeVaultSettings(tmp, {
      vaultRoot: '/ud/vaults/Story',
      notesVaultRoot: '/ud/vaults/Notes',
      root: '/should-never-appear',
    });
    expect(loadRegisteredVaultRoots(tmp)).toEqual(['/ud/vaults/Story', '/ud/vaults/Notes']);
  });

  it('reads recentProjects[].vaultRoot / notesVaultRoot (not .root)', () => {
    writeVaultSettings(tmp, {
      vaultRoot: 'C:\\Users\\Skyy\\AppData\\Roaming\\Mythos Writer\\vaults\\Active',
      recentProjects: [
        {
          name: 'Novel',
          vaultRoot: 'C:\\Users\\Skyy\\Documents\\MyNovel',
          notesVaultRoot: 'C:\\Users\\Skyy\\Documents\\MyNovelNotes',
          root: 'C:\\ignored',
          openedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const roots = loadRegisteredVaultRoots(tmp);
    expect(roots).toContain('C:\\Users\\Skyy\\AppData\\Roaming\\Mythos Writer\\vaults\\Active');
    expect(roots).toContain('C:\\Users\\Skyy\\Documents\\MyNovel');
    expect(roots).toContain('C:\\Users\\Skyy\\Documents\\MyNovelNotes');
    expect(roots).not.toContain('C:\\ignored');
  });
});

describe('resolveUninstallDeletePaths + sidecar writer', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-nsh-paths-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('default-only: missing settings → default vaults parent + settings files', () => {
    const paths = resolveUninstallDeletePaths(tmp);
    expect(paths).toContain(defaultVaultsParent(tmp));
    expect(paths).toContain(path.join(tmp, 'vault-settings.json'));
    expect(paths).toContain(path.join(tmp, 'app-settings.json'));
    expect(paths).not.toContain(tmp);
  });

  it('drops registered roots outside the allowlist (e.g. C:\\Windows)', () => {
    writeVaultSettings(tmp, {
      vaultRoot: 'C:\\Windows',
      notesVaultRoot: 'C:\\Users\\Skyy\\Documents',
      recentProjects: [
        { name: 'pf', vaultRoot: 'C:\\Program Files\\Poison', notesVaultRoot: 'C:\\Users\\Skyy' },
      ],
    });
    const paths = resolveUninstallDeletePaths(tmp);
    expect(paths).not.toContain('C:\\Windows');
    expect(paths).not.toContain('C:\\Users\\Skyy\\Documents');
    expect(paths).not.toContain('C:\\Program Files\\Poison');
    expect(paths).not.toContain('C:\\Users\\Skyy');
    expect(paths).toContain(defaultVaultsParent(tmp));
  });

  it('custom Documents roots from tip keys land in toDelete', () => {
    const story = path.join(tmp, 'Documents', 'MyNovel');
    const notes = path.join(tmp, 'Documents', 'MyNovelNotes');
    writeVaultSettings(tmp, { vaultRoot: story, notesVaultRoot: notes });
    const paths = resolveUninstallDeletePaths(tmp);
    expect(paths).toContain(story);
    expect(paths).toContain(notes);
    expect(paths).toContain(defaultVaultsParent(tmp));
  });

  it('mixed: AppData default + recentProjects custom Documents', () => {
    const active = path.join(tmp, 'vaults', 'Active');
    const custom = path.join(tmp, 'Documents', 'OtherVault');
    writeVaultSettings(tmp, {
      vaultRoot: active,
      notesVaultRoot: path.join(active, 'Notes'),
      recentProjects: [
        { name: 'Other', vaultRoot: custom, notesVaultRoot: custom, openedAt: '2026-01-01T00:00:00.000Z' },
      ],
    });
    const paths = resolveUninstallDeletePaths(tmp);
    expect(paths).toContain(active);
    expect(paths).toContain(custom);
  });

  it('rejects userData, empty, slash, and drive-root-only paths', () => {
    expect(isUnsafeUninstallDeletePath(tmp, tmp)).toBe(true);
    expect(isUnsafeUninstallDeletePath('', tmp)).toBe(true);
    expect(isUnsafeUninstallDeletePath('\\', tmp)).toBe(true);
    expect(isUnsafeUninstallDeletePath('/', tmp)).toBe(true);
    expect(isUnsafeUninstallDeletePath('C:\\', tmp)).toBe(true);
    expect(isUnsafeUninstallDeletePath('D:/', tmp)).toBe(true);
    expect(isUnsafeUninstallDeletePath(path.join(tmp, 'vaults'), tmp)).toBe(false);
  });

  it('rejects profile, Documents root, C:\\Windows, and Program Files (allowlist)', () => {
    expect(isUnsafeUninstallDeletePath('C:\\Users\\Skyy', tmp)).toBe(true);
    expect(isUnsafeUninstallDeletePath('C:\\Users\\Skyy\\', tmp)).toBe(true);
    expect(isUnsafeUninstallDeletePath('C:\\Users', tmp)).toBe(true);
    expect(isUnsafeUninstallDeletePath('C:\\Users\\Skyy\\Documents', tmp)).toBe(true);
    expect(isUnsafeUninstallDeletePath('C:\\Users\\Skyy\\Desktop', tmp)).toBe(true);
    expect(isUnsafeUninstallDeletePath('C:\\Users\\Skyy\\Downloads', tmp)).toBe(true);
    expect(isUnsafeUninstallDeletePath('C:\\Windows', tmp)).toBe(true);
    expect(isUnsafeUninstallDeletePath('C:\\Windows\\System32', tmp)).toBe(true);
    expect(isUnsafeUninstallDeletePath('C:\\Program Files', tmp)).toBe(true);
    expect(isUnsafeUninstallDeletePath('C:\\Program Files\\Mythos Writer', tmp)).toBe(true);
    expect(isUnsafeUninstallDeletePath(os.homedir(), tmp)).toBe(true);
    expect(isUnsafeUninstallDeletePath(path.join(os.homedir(), 'Documents'), tmp)).toBe(true);
  });

  it('allows userData children and Documents/Desktop/Downloads children', () => {
    expect(isAllowedUninstallDeletePath(path.join(tmp, 'vaults'), tmp)).toBe(true);
    expect(isAllowedUninstallDeletePath(path.join(tmp, 'vault-settings.json'), tmp)).toBe(true);
    expect(isAllowedUninstallDeletePath('C:\\Users\\Skyy\\Documents\\MyNovel', tmp)).toBe(true);
    expect(isAllowedUninstallDeletePath('C:\\Users\\Skyy\\Documents\\MyNovelNotes', tmp)).toBe(true);
    expect(isAllowedUninstallDeletePath('C:\\Users\\Skyy\\Desktop\\Vault', tmp)).toBe(true);
    expect(isAllowedUninstallDeletePath('C:\\Users\\Skyy\\Downloads\\ExportVault', tmp)).toBe(true);
  });

  it('planted sidecar line outside the allowlist never deletes', () => {
    const allowed = path.join(tmp, 'vaults');
    const planted = [
      'C:\\Windows',
      'C:\\Windows\\System32\\evil',
      'C:\\Users\\Skyy',
      'C:\\Users\\Skyy\\Documents',
      'C:\\Program Files\\Poison',
      'D:\\not-on-allowlist',
    ];
    const filtered = filterUninstallSidecarLines([allowed, ...planted], tmp);
    expect(filtered).toEqual([allowed]);
    for (const p of planted) {
      expect(filtered).not.toContain(p);
      expect(isUnsafeUninstallDeletePath(p, tmp)).toBe(true);
    }
  });

  it('rejects .. / . traversal segments (Shield tip-3 — must not elevate)', () => {
    const traversals = [
      'C:\\Users\\Skyy\\Documents\\..\\..\\..\\Windows',
      'C:\\Users\\Skyy\\Documents\\foo\\..\\..\\..\\Windows',
      'C:\\Users\\Skyy\\AppData\\Roaming\\Mythos Writer\\..\\..\\',
      'C:\\Users\\Skyy\\Documents\\vault\\..\\..\\..\\Windows',
      'C:\\Users\\Skyy\\Documents\\.\\evil',
      'C:/Users/Skyy/Documents/../../../Windows',
    ];
    for (const p of traversals) {
      expect(hasDotOrDotDotSegment(p)).toBe(true);
      expect(isUnsafeUninstallDeletePath(p, tmp)).toBe(true);
      expect(isAllowedUninstallDeletePath(p, tmp)).toBe(false);
    }
    // Canonicalize collapses Documents\..\..\..\Windows → C:\Windows
    expect(normalizeUninstallDeletePath(traversals[0])).toBe('c:\\windows');
    // Planted sidecar with .. must never survive the filter.
    const allowed = path.join(tmp, 'vaults');
    const filtered = filterUninstallSidecarLines([allowed, ...traversals], tmp);
    expect(filtered).toEqual([allowed]);
  });

  it('registered tip-key root with .. never lands in resolveUninstallDeletePaths', () => {
    writeVaultSettings(tmp, {
      vaultRoot: 'C:\\Users\\Skyy\\Documents\\..\\..\\..\\Windows',
      notesVaultRoot: 'C:\\Users\\Skyy\\AppData\\Roaming\\Mythos Writer\\..\\..\\',
    });
    const paths = resolveUninstallDeletePaths(tmp);
    expect(paths.every((p) => !hasDotOrDotDotSegment(p))).toBe(true);
    expect(paths).not.toContain('C:\\Users\\Skyy\\Documents\\..\\..\\..\\Windows');
    expect(paths).not.toContain('C:\\Windows');
  });

  it('writeUninstallDeletePathList is UTF-8 no BOM, one path per line, no userData', () => {
    const custom = path.join(tmp, 'Documents', 'CustomVault');
    writeVaultSettings(tmp, { vaultRoot: custom, notesVaultRoot: custom });
    const dest = writeUninstallDeletePathList(tmp);
    expect(dest).toBe(uninstallDeletePathsFile(tmp));
    expect(path.basename(dest)).toBe(UNINSTALL_DELETE_PATHS_FILENAME);
    const buf = fs.readFileSync(dest);
    expect(buf[0]).not.toBe(0xef);
    const text = buf.toString('utf8');
    expect(text).not.toMatch(/^\uFEFF/);
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    expect(lines).toContain(custom);
    expect(lines).toContain(defaultVaultsParent(tmp));
    expect(lines).not.toContain(tmp);
    expect(new Set(lines).size).toBe(lines.length);
  });
});

/**
 * Windows path-resolution proof for NSIS (Node simulation of the delete
 * target set). This is NOT the in-app Clear-all-data path and does not
 * claim the installer is proven from Linux UI.
 */
describe('NSIS sidecar path-list resolution (Windows custom roots)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-nsh-win-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('FileRead-equivalent loop includes Windows Documents custom vaults + fallback settings', () => {
    const winUserData = 'C:\\Users\\Skyy\\AppData\\Roaming\\Mythos Writer';
    const winStory = 'C:\\Users\\Skyy\\Documents\\MyNovel';
    const winNotes = 'C:\\Users\\Skyy\\Documents\\MyNovelNotes';
    writeVaultSettings(tmp, {
      vaultRoot: winStory,
      notesVaultRoot: winNotes,
      recentProjects: [
        {
          name: 'MyNovel',
          vaultRoot: winStory,
          notesVaultRoot: winNotes,
          openedAt: '2026-09-28T00:00:00.000Z',
        },
      ],
    });

    const dest = writeUninstallDeletePathList(tmp);
    const sidecar = fs.readFileSync(dest, 'utf8');
    // Simulate NSIS FileRead: one line at a time, skip empty, never parse JSON.
    const nsisTargets = sidecar.split(/\r?\n/).map((l) => l.replace(/\r$/, '')).filter(Boolean);

    expect(nsisTargets).toContain(winStory);
    expect(nsisTargets).toContain(winNotes);
    expect(nsisTargets).toContain(path.join(tmp, 'vault-settings.json'));
    expect(nsisTargets).toContain(path.join(tmp, 'app-settings.json'));
    expect(nsisTargets).toContain(defaultVaultsParent(tmp));
    expect(nsisTargets).not.toContain(tmp);
    expect(nsisTargets).not.toContain(winUserData);
    expect(nsisTargets.some((p) => /^[A-Za-z]:[\\/]?$/.test(p))).toBe(false);
  });
});
