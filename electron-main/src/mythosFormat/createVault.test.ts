// Beta 4 M5 — vault creation, Veynn demo seeding (seed-once), and the v2
// scanner that rebuilds the legacy manifest from canonical files.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createMythosVault,
  ensureMythosV2SeedMarker,
} from './createVault.js';
import { VEYNN_STORY_FOLDER, VEYNN_STORY_TITLE, writeVeynnSeed } from './veynnSeed.js';
import { _clearDetectionCache, readMythosFile, storyVaultRootFor, notesVaultRootFor } from './mythosJson.js';
import { readTimelinesFile } from './timelinesFile.js';
import {
  nextV2ChapterRelPath,
  nextV2SceneRelPath,
  scanMythosStoryVault,
  syncCanonicalFromManifest,
} from './v2Manifest.js';
import { parseBookFile } from './bookFile.js';
import { listSessions } from './agentSessions.js';
import { parseV2SceneFile } from './sceneFiles.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-create-'));
  _clearDetectionCache();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Recursive, sorted, relative file list. */
function fileList(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else out.push(rel);
    }
  };
  walk(root, '');
  return out;
}

describe('createMythosVault + Veynn seed', () => {
  it('scaffolds the full v2 layout and seeds the demo once', () => {
    const result = createMythosVault(tmp, { name: 'Demo Vault' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seeded).toBe(true);

    const files = fileList(result.mythosRoot);
    // Top level format files.
    expect(files).toContain('mythos.json');
    expect(files).toContain('settings.json');
    expect(files).toContain('timelines.json');
    expect(files).toContain('Brainstorm/idea-library.json');
    // Manuscript: 3 parts / 4 chapters / 9 scenes + book.md.
    const story = `Story Vault/${VEYNN_STORY_FOLDER}`;
    expect(files).toContain(`${story}/book.md`);
    expect(files).toContain(`${story}/Part 1/Chapter 01/Scene 01.md`);
    expect(files).toContain(`${story}/Part 1/Chapter 01/Scene 02.md`);
    expect(files).toContain(`${story}/Part 1/Chapter 02/Scene 01.md`);
    expect(files).toContain(`${story}/Part 1/Chapter 02/Scene 02.md`);
    expect(files).toContain(`${story}/Part 1/Chapter 02/Scene 03.md`);
    expect(files).toContain(`${story}/Part 2/Chapter 03/Scene 01.md`);
    expect(files).toContain(`${story}/Part 2/Chapter 03/Scene 02.md`);
    expect(files).toContain(`${story}/Part 3/Chapter 04/Scene 01.md`);
    expect(files).toContain(`${story}/Part 3/Chapter 04/Scene 02.md`);
    // Sample notes.
    expect(files).toContain('Notes Vault/Characters/Mira Veynn.md');
    expect(files).toContain('Notes Vault/Characters/Kael Thorne.md');
    expect(files).toContain('Notes Vault/Worldbuilding/Locations/The Sunken Gate.md');
    expect(files).toContain('Notes Vault/Worldbuilding/Lore & Myth/Tide Mechanics.md');
    expect(files).toContain('Notes Vault/Plot & Story/Project Bible.md');

    // mythos.json: story listed, seed marker recorded.
    const mythos = readMythosFile(result.mythosRoot);
    expect(mythos.name).toBe('Demo Vault');
    expect(mythos.stories).toHaveLength(1);
    expect(mythos.stories[0].title).toBe(VEYNN_STORY_TITLE);
    expect(mythos.seed?.layout).toBe('veynn-demo@M5');

    // Scene frontmatter carries {title,status,pov,when}.
    const scene1 = parseV2SceneFile(
      fs.readFileSync(path.join(result.mythosRoot, story, 'Part 1/Chapter 01/Scene 01.md'), 'utf-8'),
    );
    expect(scene1.title).toBe("The Watcher's Call");
    expect(scene1.status).toBe('done');
    expect(scene1.pov).toBe('Mira Veynn');
    expect(scene1.when).toBe(8710);

    // Timeline events + demo session.
    expect(readTimelinesFile(result.mythosRoot).events.length).toBeGreaterThanOrEqual(6);
    expect(listSessions(notesVaultRootFor(result.mythosRoot))).toHaveLength(1);
  });

  it('seeds ONCE — a second boot never re-seeds, even after the user deletes content (W0.1)', () => {
    const result = createMythosVault(tmp, { name: 'Once' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // User deletes the demo story and some notes.
    fs.rmSync(path.join(result.storyVaultPath, VEYNN_STORY_FOLDER), { recursive: true });
    fs.rmSync(path.join(result.notesVaultPath, 'Characters'), { recursive: true });
    const before = fileList(result.mythosRoot);
    // Boot-time guard runs again (twice, for good measure).
    expect(ensureMythosV2SeedMarker(result.mythosRoot).adopted).toBe(false);
    expect(ensureMythosV2SeedMarker(result.mythosRoot).adopted).toBe(false);
    expect(fileList(result.mythosRoot)).toEqual(before);
    expect(readMythosFile(result.mythosRoot).seed?.layout).toBe('veynn-demo@M5');
  });

  it('adopts a pre-marker v2 vault instead of seeding into it', () => {
    const result = createMythosVault(tmp, { name: 'Handmade', seedDemo: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Simulate a hand-built vault that predates the marker.
    const mythos = readMythosFile(result.mythosRoot);
    fs.writeFileSync(
      path.join(result.mythosRoot, 'mythos.json'),
      JSON.stringify({ ...mythos, seed: null }, null, 2),
    );
    _clearDetectionCache();
    expect(ensureMythosV2SeedMarker(result.mythosRoot).adopted).toBe(true);
    expect(readMythosFile(result.mythosRoot).seed?.layout).toBe('adopted-preexisting@M5');
  });

  it('blank mode records the decision without demo content', () => {
    const result = createMythosVault(tmp, { name: 'Blank', seedDemo: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seeded).toBe(false);
    expect(fileList(result.storyVaultPath).filter((f) => f.endsWith('.md'))).toHaveLength(0);
    expect(readMythosFile(result.mythosRoot).seed?.mode).toBe('blank');
  });

  it('suffixes colliding names and refuses non-empty exact targets', () => {
    const a = createMythosVault(tmp, { name: 'Same', seedDemo: false });
    const b = createMythosVault(tmp, { name: 'Same', seedDemo: false });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.vaultName).toBe('Same 2');
    const c = createMythosVault(tmp, { name: 'Same', exactName: true, seedDemo: false });
    expect(c.ok).toBe(false);
  });
});

describe('scanMythosStoryVault (rebuild from canonical files)', () => {
  it('rebuilds the full manifest tree from a seeded vault', () => {
    const result = createMythosVault(tmp, { name: 'Scan' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const manifest = scanMythosStoryVault(result.mythosRoot);
    expect(manifest.stories).toHaveLength(1);
    const story = manifest.stories[0];
    expect(story.title).toBe(VEYNN_STORY_TITLE);
    expect(story.chapters).toHaveLength(4);
    expect(story.chapters.map((c) => c.title)).toEqual([
      'The Quiet Before', 'Fractures', 'Whispers of Rebellion', 'Blood and Bone',
    ]);
    const sceneTitles = story.chapters.flatMap((c) => c.scenes.map((s) => s.title));
    expect(sceneTitles).toEqual([
      "The Watcher's Call", 'A City in Shadows',
      "The Smuggler's Bargain", 'Into the Undercity', 'The Broken Gate',
      'Ward Violet', 'The Deep Awakens',
      'The Sunken Gate', 'The Last Stand',
    ]);
    // Prose flows into the single prose block; status maps to draftState.
    const watcher = story.chapters[0].scenes[0];
    expect(watcher.blocks[0].content).toContain('Mira Veynn had counted the bells');
    expect(watcher.draftState).toBe('final');
    expect(watcher.card?.pov).toBe('Mira Veynn');
    const broken = story.chapters[1].scenes[2];
    expect(broken.draftState).toBeUndefined(); // todo
    // Flat legacy lists mirror the hierarchy.
    expect(manifest.scenes).toHaveLength(9);
    expect(manifest.chapters).toHaveLength(4);
  });

  it('copying the vault folder to a second machine preserves everything (no .mythos)', () => {
    const result = createMythosVault(tmp, { name: 'Copy Source' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const original = scanMythosStoryVault(result.mythosRoot);
    // "Second machine": plain folder copy WITHOUT machine-local state.
    const machine2 = path.join(tmp, 'machine-2', 'Copy Source');
    fs.cpSync(result.mythosRoot, machine2, { recursive: true });
    fs.rmSync(path.join(machine2, 'Story Vault', '.mythos'), { recursive: true, force: true });
    _clearDetectionCache();
    const rebuilt = scanMythosStoryVault(machine2);
    const strip = (m: typeof original) =>
      m.stories.map((s) => ({
        title: s.title,
        chapters: s.chapters.map((c) => ({
          title: c.title,
          scenes: c.scenes.map((sc) => ({
            id: sc.id,
            title: sc.title,
            draftState: sc.draftState,
            prose: sc.blocks[0]?.content,
          })),
        })),
      }));
    expect(strip(rebuilt)).toEqual(strip(original));
  });

  it('assigns and persists ids for hand-created scene files', () => {
    const result = createMythosVault(tmp, { name: 'Hand', seedDemo: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    writeVeynnSeed(result.mythosRoot);
    const extra = path.join(
      result.storyVaultPath, VEYNN_STORY_FOLDER, 'Part 1', 'Chapter 01', 'Scene 03.md',
    );
    fs.writeFileSync(extra, '---\ntitle: Hand Made\n---\nWritten in Obsidian.');
    const manifest = scanMythosStoryVault(result.mythosRoot);
    const scene = manifest.stories[0].chapters[0].scenes.find((s) => s.title === 'Hand Made');
    expect(scene).toBeDefined();
    expect(scene?.id).toBeTruthy();
    // The id was written back so the next scan keeps it stable.
    const reread = parseV2SceneFile(fs.readFileSync(extra, 'utf-8'));
    expect(reread.id).toBe(scene?.id);
    const again = scanMythosStoryVault(result.mythosRoot);
    expect(again.stories[0].chapters[0].scenes.find((s) => s.title === 'Hand Made')?.id).toBe(scene?.id);
  });

  it('adopts untracked story folders that carry a book.md', () => {
    const result = createMythosVault(tmp, { name: 'Adopt', seedDemo: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const other = path.join(result.storyVaultPath, 'Dropped In');
    fs.mkdirSync(path.join(other, 'Part 1', 'Chapter 01'), { recursive: true });
    fs.writeFileSync(
      path.join(other, 'book.md'),
      '---\nid: dropped-1\ntitle: Dropped In\ncreatedAt: 2026-01-01T00:00:00.000Z\nupdatedAt: 2026-01-01T00:00:00.000Z\n---\n# Dropped In\n',
    );
    fs.writeFileSync(
      path.join(other, 'Part 1', 'Chapter 01', 'Scene 01.md'),
      '---\nid: sc-1\ntitle: First\nstatus: draft\n---\ntext',
    );
    const manifest = scanMythosStoryVault(result.mythosRoot);
    expect(manifest.stories.map((s) => s.id)).toContain('dropped-1');
  });
});

describe('syncCanonicalFromManifest + creation-path helpers', () => {
  it('manifest edits flow back into mythos.json + book.md', () => {
    const result = createMythosVault(tmp, { name: 'Sync' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const manifest = scanMythosStoryVault(result.mythosRoot);
    const story = manifest.stories[0];

    // Simulate chapter:create — a new canonical chapter dir + manifest entry.
    const chapterRel = nextV2ChapterRelPath(result.storyVaultPath, VEYNN_STORY_FOLDER);
    expect(chapterRel).toBe(`${VEYNN_STORY_FOLDER}/Part 3/Chapter 05`);
    fs.mkdirSync(path.join(result.storyVaultPath, chapterRel), { recursive: true });
    story.chapters.push({
      id: 'ch-new',
      title: 'The Ninth Bell',
      path: chapterRel,
      order: story.chapters.length,
      scenes: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    story.title = 'The Last City of Veynn (Revised)';
    syncCanonicalFromManifest(result.mythosRoot, manifest);

    const mythos = readMythosFile(result.mythosRoot);
    expect(mythos.stories[0].title).toBe('The Last City of Veynn (Revised)');
    const book = parseBookFile(
      fs.readFileSync(
        path.join(result.storyVaultPath, VEYNN_STORY_FOLDER, 'book.md'), 'utf-8'),
    );
    expect(book.title).toBe('The Last City of Veynn (Revised)');
    const part3 = book.spine.find((p) => p.dir === 'Part 3');
    expect(part3?.chapters.map((c) => c.title)).toContain('The Ninth Bell');
    // Part labels from the seed survive the rewrite.
    expect(book.spine.find((p) => p.dir === 'Part 1')?.label).toBe('Ash and Oath');
  });

  it('numbers new scenes canonically', () => {
    const result = createMythosVault(tmp, { name: 'Scenes' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const chapterRel = `${VEYNN_STORY_FOLDER}/Part 1/Chapter 01`;
    expect(nextV2SceneRelPath(result.storyVaultPath, chapterRel)).toBe(
      `${chapterRel}/Scene 03.md`,
    );
    expect(nextV2ChapterRelPath(result.storyVaultPath, VEYNN_STORY_FOLDER)).toBe(
      `${VEYNN_STORY_FOLDER}/Part 3/Chapter 05`,
    );
  });
});

describe('storyVaultRootFor sanity', () => {
  it('derives the twin roots from the mythos root', () => {
    expect(storyVaultRootFor('/x/V')).toBe(path.join('/x/V', 'Story Vault'));
    expect(notesVaultRootFor('/x/V')).toBe(path.join('/x/V', 'Notes Vault'));
  });
});
