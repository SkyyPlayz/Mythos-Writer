// W0.1 (Beta 4, GAP-REPORT-v2 P0 #1) — Notes-tree hygiene regression tests.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listVaultFiles, scaffoldNotesVault, scaffoldStoryVault } from './vault.js';
import {
  filterNotesListing,
  isStoryInternalNotesPath,
  storyVaultRelPrefix,
  UUID_NAME_RE,
  type NotesListItem,
} from './notesListing.js';

const item = (p: string, isDirectory = false): NotesListItem => ({
  path: p,
  name: p.split('/').pop() ?? p,
  isDirectory,
  modifiedAt: new Date(0).toISOString(),
});

describe('storyVaultRelPrefix', () => {
  it('returns null when the story vault lives elsewhere (healthy layout)', () => {
    expect(storyVaultRelPrefix('/v/Mythos/Notes Vault', '/v/Mythos/Story Vault')).toBeNull();
  });

  it("returns '' when notes and story roots are the same directory", () => {
    expect(storyVaultRelPrefix('/v/Vault', '/v/Vault')).toBe('');
  });

  it('returns the relative prefix when the story vault is nested inside the notes root', () => {
    expect(storyVaultRelPrefix('/v/Everything', '/v/Everything/Story Vault')).toBe('Story Vault');
    expect(storyVaultRelPrefix('/v/E', '/v/E/deep/Story Vault')).toBe('deep/Story Vault');
  });

  it('returns null when the notes root is nested inside the story vault', () => {
    expect(storyVaultRelPrefix('/v/Story Vault/Notes', '/v/Story Vault')).toBeNull();
  });
});

describe('isStoryInternalNotesPath / filterNotesListing — unit', () => {
  const SCENE_UUID = '3f6a804a-1c2b-4d3e-9f10-abcdef012345';

  it('excludes UUID-named directories and their whole subtree', () => {
    expect(isStoryInternalNotesPath(item(SCENE_UUID, true), null)).toBe(true);
    expect(isStoryInternalNotesPath(item(`${SCENE_UUID}/notes.md`), null)).toBe(true);
    expect(isStoryInternalNotesPath(item(`versions/${SCENE_UUID}`, true), null)).toBe(true);
    expect(isStoryInternalNotesPath(item(`versions/${SCENE_UUID}/draft.md`), null)).toBe(true);
  });

  it('keeps normal notes content, including UUID-lookalike text that is not a UUID', () => {
    expect(isStoryInternalNotesPath(item('Universes', true), null)).toBe(false);
    expect(isStoryInternalNotesPath(item('Universes/My First Universe/Characters', true), null)).toBe(false);
    expect(isStoryInternalNotesPath(item('Inbox/idea-3f6a804a.md'), null)).toBe(false);
    expect(isStoryInternalNotesPath(item('Research/UUIDs are neat.md'), null)).toBe(false);
  });

  it('excludes dot-segment paths and their children (no orphan promotion in the tree)', () => {
    expect(isStoryInternalNotesPath(item('.obsidian', true), null)).toBe(true);
    expect(isStoryInternalNotesPath(item('.obsidian/plugins', true), null)).toBe(true);
    expect(isStoryInternalNotesPath(item('.snapshots/abc', true), null)).toBe(true);
    expect(isStoryInternalNotesPath(item('.mythos-seeded'), null)).toBe(true);
    expect(isStoryInternalNotesPath(item('Universes/.gitkeep'), null)).toBe(true);
  });

  it('excludes manifest bookkeeping at any root', () => {
    expect(isStoryInternalNotesPath(item('manifest.json'), null)).toBe(true);
    expect(isStoryInternalNotesPath(item('manifest.json.bak'), null)).toBe(true);
  });

  it('same-root mis-scope: excludes story internals but keeps user notes', () => {
    const prefix = ''; // notes root === story root
    expect(isStoryInternalNotesPath(item('Manuscript', true), prefix)).toBe(true);
    expect(isStoryInternalNotesPath(item('Manuscript/my-story/chapter-1/scene.md'), prefix)).toBe(true);
    expect(isStoryInternalNotesPath(item('versions', true), prefix)).toBe(true);
    expect(isStoryInternalNotesPath(item('drafts', true), prefix)).toBe(true);
    expect(isStoryInternalNotesPath(item('My Notes/idea.md'), prefix)).toBe(false);
  });

  it('healthy separate roots: a user folder literally named "versions" survives', () => {
    expect(isStoryInternalNotesPath(item('versions', true), null)).toBe(false);
    expect(isStoryInternalNotesPath(item('drafts/plot.md'), null)).toBe(false);
  });

  it('nested story vault: the whole story subtree is excluded', () => {
    const prefix = 'Story Vault';
    expect(isStoryInternalNotesPath(item('Story Vault', true), prefix)).toBe(true);
    expect(isStoryInternalNotesPath(item('Story Vault/My First Story/Outline.md'), prefix)).toBe(true);
    expect(isStoryInternalNotesPath(item('Story Vault Notes/keep.md'), prefix)).toBe(false);
    expect(isStoryInternalNotesPath(item('Universes', true), prefix)).toBe(false);
  });

  it('SKY-8207: Boards/<uuid>/ (Scene Crafter board storage) survives the UUID-dir rule', () => {
    expect(isStoryInternalNotesPath(item(`Boards/${SCENE_UUID}`, true), null)).toBe(false);
    expect(
      isStoryInternalNotesPath(item(`Boards/${SCENE_UUID}/My Board.canvas.json`), null),
    ).toBe(false);
    // The carve-out is scoped to exactly the segment after Boards/ — a UUID
    // dir anywhere deeper (e.g. Boards/<slug>/<uuid>/) still hides.
    expect(
      isStoryInternalNotesPath(item(`Boards/${SCENE_UUID}/${SCENE_UUID}/nested.md`), null),
    ).toBe(true);
    expect(isStoryInternalNotesPath(item(`Chapters/${SCENE_UUID}`, true), null)).toBe(true);
    // Other W0.1 rules still apply inside Boards/.
    expect(isStoryInternalNotesPath(item(`Boards/${SCENE_UUID}/.snapshots`, true), null)).toBe(true);
  });
});

// ─── Integration: real directories through listVaultFiles ───────────────────

describe('filterNotesListing — integration with listVaultFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-notes-hygiene-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GAP #1 shape: leaked story internals never reach the notes listing', () => {
    const notesRoot = path.join(tmpDir, 'Notes Vault');
    scaffoldNotesVault(notesRoot, 'default');

    // Recreate the shipped screenshot's pollution inside the notes root:
    const sceneUuid = 'f8c62a1a-9b71-4f22-8f6f-0123456789ab';
    fs.mkdirSync(path.join(notesRoot, sceneUuid, 'scenes'), { recursive: true });
    fs.mkdirSync(path.join(notesRoot, 'Manuscript', 'my-story', 'chapter-1', 'versions', sceneUuid), {
      recursive: true,
    });
    fs.writeFileSync(path.join(notesRoot, 'manifest.json'), '{}', 'utf-8');
    fs.mkdirSync(path.join(notesRoot, '.obsidian', 'plugins'), { recursive: true });
    // Legitimate user note for contrast.
    fs.writeFileSync(path.join(notesRoot, 'Inbox', 'idea.md'), '# Idea', 'utf-8');

    const { items } = listVaultFiles(notesRoot);
    // Same-root mis-scope is the worst case — assert with prefix '' so the
    // Manuscript subtree counts as story-internal too.
    const filtered = filterNotesListing(items, '');

    const paths = filtered.map((i) => i.path.split(path.sep).join('/'));
    // No UUID-pattern folders anywhere in the tree (W0.1 acceptance).
    expect(paths.some((p) => p.split('/').some((seg) => UUID_NAME_RE.test(seg)))).toBe(false);
    expect(paths.some((p) => p === 'Manuscript' || p.startsWith('Manuscript/'))).toBe(false);
    expect(paths).not.toContain('manifest.json');
    expect(paths.some((p) => p.startsWith('.obsidian'))).toBe(false);
    // The real notes survive.
    expect(paths).toContain('Universes');
    expect(paths).toContain('Inbox/idea.md');
    expect(paths.filter((p) => p === 'Universes')).toHaveLength(1);
    expect(paths.filter((p) => p === 'Archive')).toHaveLength(1);
  });

  it('story vault nested inside the notes root is fully hidden', () => {
    const notesRoot = path.join(tmpDir, 'Everything');
    const storyRoot = path.join(notesRoot, 'Story Vault');
    scaffoldNotesVault(notesRoot, 'default');
    scaffoldStoryVault(storyRoot, 'default');

    const prefix = storyVaultRelPrefix(notesRoot, storyRoot);
    expect(prefix).toBe('Story Vault');

    const { items } = listVaultFiles(notesRoot);
    const filtered = filterNotesListing(items, prefix);
    const paths = filtered.map((i) => i.path.split(path.sep).join('/'));

    expect(paths.some((p) => p === 'Story Vault' || p.startsWith('Story Vault/'))).toBe(false);
    expect(paths).toContain('Universes');
  });

  it('healthy separate roots: filtering is a no-op apart from dotfiles', () => {
    const notesRoot = path.join(tmpDir, 'Notes Vault');
    scaffoldNotesVault(notesRoot, 'default');

    const { items } = listVaultFiles(notesRoot);
    const filtered = filterNotesListing(items, null);
    const removed = items.filter((i) => !filtered.includes(i));

    // Only .gitkeep sentinels are removed from a clean seeded vault.
    expect(removed.every((i) => i.name.startsWith('.'))).toBe(true);
    const paths = filtered.map((i) => i.path.split(path.sep).join('/'));
    expect(paths).toContain('Universes/My First Universe/Characters');
  });

  it('SKY-8207: a saved Scene Crafter board survives a simulated app restart', () => {
    // Mirrors crafterBoardStore.ts's boardFilePath(storySlug, name) shape:
    // `Boards/<storySlug>/<name>.canvas.json`, where storySlug is DesktopShell's
    // story UUID. Restart = a fresh listVaultFiles() + filterNotesListing()
    // pass, exactly as loadCrafterBoards() sees it via window.api.listNotesVault().
    const notesRoot = path.join(tmpDir, 'Notes Vault');
    scaffoldNotesVault(notesRoot, 'default');
    const storySlug = 'f8c62a1a-9b71-4f22-8f6f-0123456789ab';
    fs.mkdirSync(path.join(notesRoot, 'Boards', storySlug), { recursive: true });
    fs.writeFileSync(
      path.join(notesRoot, 'Boards', storySlug, 'My Board.canvas.json'),
      JSON.stringify({ nodes: [], edges: [] }),
      'utf-8',
    );

    const { items } = listVaultFiles(notesRoot);
    const filtered = filterNotesListing(items, null);
    const paths = filtered.map((i) => i.path.split(path.sep).join('/'));

    expect(paths).toContain(`Boards/${storySlug}/My Board.canvas.json`);
  });
});
