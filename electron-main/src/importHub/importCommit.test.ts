// #1765 — import hub commit writer, against real temp vaults: a v2 vault made
// with createMythosVault (story folder + manifest cache that matches a full
// rescan) and a legacy manifest.json vault.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMythosVault } from '../mythosFormat/createVault.js';
import { mythosRootForStoryVault, readMythosFile, resolveManifestPath } from '../mythosFormat/mythosJson.js';
import { scanMythosStoryVault, syncCanonicalFromManifest } from '../mythosFormat/v2Manifest.js';
import { parseV2SceneFile } from '../mythosFormat/sceneFiles.js';
import { parseBookFile } from '../mythosFormat/bookFile.js';
import {
  defaultManifest,
  parseFrontmatter,
  readManifest,
  readSceneFile,
  writeManifest as writeManifestRaw,
} from '../vault.js';
import type { Manifest, StoryEntry } from '../ipc.js';
import type { ImportPlan } from './types.js';
import {
  commitImportPlan,
  IMPORT_MAX_SCENES,
  MAX_SEGMENT_BYTES,
  safeSegment,
  truncateUtf8,
  type ImportCommitDeps,
} from './importCommit.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'import-commit-')));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const NOW = new Date('2026-10-01T12:00:00.000Z');

function storyPlan(overrides: Partial<ImportPlan> = {}): ImportPlan {
  return {
    source: { kind: 'docx', name: 'Secret Novel.docx' },
    story: {
      title: 'The Gate',
      partCount: 0,
      structure: 'headings',
      chapters: [
        {
          title: 'Chapter One: Ash',
          order: 0,
          scenes: [
            { title: 'Arrival', order: 0, prose: 'It was **dark** and *cold*.\n\nShe waited.', synopsis: 'Mira reaches the gate.' },
            { title: '1984', order: 1, prose: 'Second scene.' },
          ],
        },
        {
          title: 'Chapter Two',
          order: 1,
          scenes: [{ title: 'Scene 1', order: 0, prose: '' }],
        },
        { title: 'Chapter Three', order: 2, scenes: [] },
      ],
    },
    notes: [],
    warnings: [],
    ...overrides,
  };
}

const NOTES: ImportPlan['notes'] = [
  {
    title: 'Mira',
    folder: '',
    body: 'A thief with a long memory.',
    entityType: 'character',
    frontmatter: { tags: ['hero', '#pov'], aliases: ['The Red', 'Mira Vale'], 'bad key!': 'x', role: 'protagonist' },
  },
  { title: 'Veynn', folder: '', body: 'The last city.', entityType: 'location' },
  { title: 'The Long War', folder: '', body: 'Ages ago.', entityType: 'event' },
  { title: 'Research: Gates', folder: 'World/Lore', body: '# Research\n\nNotes.' },
];

interface V2Vault {
  mythosRoot: string;
  storyRoot: string;
  notesRoot: string;
  cachePath: string;
}

function makeV2Vault(): V2Vault {
  const created = createMythosVault(tmp, { name: 'Test Vault', seedDemo: false });
  if (!created.ok) throw new Error(created.error);
  const cachePath = resolveManifestPath(created.storyVaultPath);
  // What main.ts ensureVaultDir does for a fresh v2 vault.
  writeManifestRaw(cachePath, scanMythosStoryVault(created.mythosRoot));
  return { mythosRoot: created.mythosRoot, storyRoot: created.storyVaultPath, notesRoot: created.notesVaultPath, cachePath };
}

function v2Deps(v: V2Vault, calls: string[] = []): ImportCommitDeps & {
  notifyNotesWritten: ReturnType<typeof vi.fn>;
  notifyStoriesChanged: ReturnType<typeof vi.fn>;
} {
  return {
    getStoryVaultRoot: () => v.storyRoot,
    isV2StoryVault: (root) => mythosRootForStoryVault(root) !== null,
    getManifestPath: () => v.cachePath,
    readManifest: (p) => {
      calls.push('readManifest');
      return readManifest(p);
    },
    // Mirrors the main.ts wrapper: cache write + canonical sync for v2.
    writeManifest: (p, m) => {
      calls.push('writeManifest');
      writeManifestRaw(p, m);
      syncCanonicalFromManifest(v.mythosRoot, m);
    },
    getNotesVaultRoot: () => v.notesRoot,
    ensureNotesVaultDir: () => {
      calls.push('ensureNotesVaultDir');
    },
    notifyNotesWritten: vi.fn((rels: string[]) => {
      calls.push(`notifyNotesWritten:${rels.length}`);
    }),
    notifyStoriesChanged: vi.fn(() => {
      calls.push('notifyStoriesChanged');
    }),
    flushRenderer: async () => {
      calls.push('flushRenderer');
    },
    now: () => NOW,
  };
}

/** The identity-bearing shape a cache rebuild must reproduce. */
function shape(story: StoryEntry) {
  return {
    id: story.id,
    title: story.title,
    path: story.path,
    chapters: story.chapters.map((c) => ({
      id: c.id,
      title: c.title,
      order: c.order,
      path: c.path,
      scenes: c.scenes.map((s) => ({ id: s.id, title: s.title, order: s.order, path: s.path, chapterId: s.chapterId, storyId: s.storyId })),
    })),
  };
}

function storyByPath(m: Manifest, p: string): StoryEntry[] {
  return m.stories.filter((s) => s.path === p);
}

describe('commitImportPlan — v2 vault', () => {
  it('writes the v2 layout and a manifest entry identical to a full rescan', async () => {
    const v = makeV2Vault();
    const deps = v2Deps(v);
    const result = await commitImportPlan(storyPlan(), deps);
    expect(result).toMatchObject({ ok: true, storyTitle: 'The Gate', chapterCount: 3, sceneCount: 4 });

    const storyDir = path.join(v.storyRoot, 'The Gate');
    expect(fs.existsSync(path.join(storyDir, 'book.md'))).toBe(true);
    const s1 = parseV2SceneFile(fs.readFileSync(path.join(storyDir, 'Part 1', 'Chapter 01', 'Scene 01.md'), 'utf-8'));
    expect(s1.title).toBe('Arrival');
    expect(s1.prose).toBe('It was **dark** and *cold*.\n\nShe waited.');
    expect(s1.status).toBe('draft');
    expect(s1.extraFrontmatter).toEqual({ synopsis: 'Mira reaches the gate.' });
    const empty = parseV2SceneFile(fs.readFileSync(path.join(storyDir, 'Part 1', 'Chapter 02', 'Scene 01.md'), 'utf-8'));
    expect(empty.status).toBe('todo');
    // An empty chapter still gets a scene file so the scan can see the chapter.
    expect(fs.existsSync(path.join(storyDir, 'Part 1', 'Chapter 03', 'Scene 01.md'))).toBe(true);

    const cached = storyByPath(readManifest(v.cachePath), 'The Gate');
    expect(cached).toHaveLength(1);
    expect(cached[0].chapters.map((c) => c.path)).toEqual([
      'The Gate/Part 1/Chapter 01',
      'The Gate/Part 1/Chapter 02',
      'The Gate/Part 1/Chapter 03',
    ]);
    expect(cached[0].chapters[0].scenes[1].path).toBe('The Gate/Part 1/Chapter 01/Scene 02.md');
    // A numeric title would read back as a number (→ file-name fallback); it stays a title.
    expect(cached[0].chapters[0].scenes[1].title).toBe('Scene 1984');

    // A cache rebuild from the files reproduces exactly the same story.
    const rescanned = storyByPath(scanMythosStoryVault(v.mythosRoot), 'The Gate');
    expect(rescanned).toHaveLength(1);
    expect(shape(rescanned[0])).toEqual(shape(cached[0]));

    // And with the cache deleted entirely (cold rebuild).
    fs.rmSync(v.cachePath);
    const cold = storyByPath(scanMythosStoryVault(v.mythosRoot), 'The Gate');
    expect(shape(cold[0])).toEqual(shape(cached[0]));

    // The wrapper's canonical sync tracked the folder and kept the spine.
    expect(readMythosFile(v.mythosRoot).stories.map((s) => s.folder)).toContain('The Gate');
    const book = parseBookFile(fs.readFileSync(path.join(storyDir, 'book.md'), 'utf-8'));
    expect(book.id).toBe(cached[0].id);
    expect(book.spine[0].chapters.map((c) => c.title)).toEqual(['Chapter One: Ash', 'Chapter Two', 'Chapter Three']);
  });

  it('suffixes a second import of the same title with " (2)" and keeps both', async () => {
    const v = makeV2Vault();
    const deps = v2Deps(v);
    expect((await commitImportPlan(storyPlan(), deps)).ok).toBe(true);
    expect((await commitImportPlan(storyPlan(), deps)).ok).toBe(true);
    expect(fs.existsSync(path.join(v.storyRoot, 'The Gate (2)', 'book.md'))).toBe(true);
    const m = readManifest(v.cachePath);
    const a = storyByPath(m, 'The Gate')[0];
    const b = storyByPath(m, 'The Gate (2)')[0];
    expect(a.id).not.toBe(b.id);
    expect(b.chapters[0].path).toBe('The Gate (2)/Part 1/Chapter 01');
    const scan = scanMythosStoryVault(v.mythosRoot);
    expect(scan.stories).toHaveLength(2);
    expect(shape(storyByPath(scan, 'The Gate (2)')[0])).toEqual(shape(b));
  });

  it('flushes the renderer before reading the manifest or writing any file, then notifies', async () => {
    const v = makeV2Vault();
    const calls: string[] = [];
    const deps = v2Deps(v, calls);
    let sawFilesAtFlush = true;
    deps.flushRenderer = async () => {
      calls.push('flushRenderer');
      sawFilesAtFlush =
        fs.existsSync(path.join(v.storyRoot, 'The Gate')) || fs.existsSync(path.join(v.notesRoot, 'Characters', 'Mira.md'));
    };
    const result = await commitImportPlan(storyPlan({ notes: NOTES }), deps);
    expect(result.ok).toBe(true);
    expect(sawFilesAtFlush).toBe(false);
    expect(calls[0]).toBe('flushRenderer');
    expect(calls.indexOf('readManifest')).toBeGreaterThan(0);
    expect(calls.indexOf('writeManifest')).toBeGreaterThan(calls.indexOf('readManifest'));
    expect(calls.slice(-2)).toEqual([`notifyNotesWritten:${NOTES.length + 1}`, 'notifyStoriesChanged']);
  });

  it('writes notes and entities to the right folders with frontmatter, never overwriting', async () => {
    const v = makeV2Vault();
    fs.mkdirSync(path.join(v.notesRoot, 'Characters'), { recursive: true });
    fs.writeFileSync(path.join(v.notesRoot, 'Characters', 'Mira.md'), 'ORIGINAL');
    const deps = v2Deps(v);
    const result = await commitImportPlan(storyPlan({ notes: NOTES }), deps);
    expect(result).toMatchObject({ ok: true, noteCount: 1, entityCount: 3, planNotePath: 'Plans/Plan — The Gate.md' });

    expect(fs.readFileSync(path.join(v.notesRoot, 'Characters', 'Mira.md'), 'utf-8')).toBe('ORIGINAL');
    const mira = fs.readFileSync(path.join(v.notesRoot, 'Characters', 'Mira 2.md'), 'utf-8');
    const { frontmatter, prose } = parseFrontmatter(mira);
    expect(frontmatter.type).toBe('character');
    expect(frontmatter.title).toBe('Mira');
    expect(frontmatter.tags).toEqual(['imported', 'hero', 'pov']);
    expect(frontmatter.aliases).toEqual(['The Red', 'Mira Vale']);
    expect(frontmatter.role).toBe('protagonist');
    expect(frontmatter.imported).toBe(NOW.toISOString());
    expect(String(frontmatter.source)).toBe('"Word document · Secret Novel.docx"');
    expect(typeof frontmatter.id).toBe('string');
    expect(Object.keys(frontmatter)).not.toContain('bad key!');
    expect(prose.trim()).toBe('A thief with a long memory.');

    expect(fs.existsSync(path.join(v.notesRoot, 'Locations', 'Veynn.md'))).toBe(true);
    expect(parseFrontmatter(fs.readFileSync(path.join(v.notesRoot, 'Plot', 'The Long War.md'), 'utf-8')).frontmatter.type).toBe('event');
    // Plain notes keep their folder under Imported/<source>/.
    const research = path.join(v.notesRoot, 'Imported', 'Secret Novel', 'World', 'Lore', 'Research- Gates.md');
    expect(fs.existsSync(research)).toBe(true);
    const researchFm = parseFrontmatter(fs.readFileSync(research, 'utf-8')).frontmatter;
    expect(researchFm.type).toBeUndefined();
    expect(researchFm.tags).toEqual(['imported']);

    const plan = fs.readFileSync(path.join(v.notesRoot, 'Plans', 'Plan — The Gate.md'), 'utf-8');
    expect(plan).toContain('type: story-plan');
    expect(plan).toContain('Word document · Secret Novel.docx');
    expect(plan).toContain('- **Chapter One: Ash** (2 scenes)');

    const notified = (deps.notifyNotesWritten.mock.calls[0][0] as string[]).slice().sort();
    expect(notified).toEqual(
      [
        'Characters/Mira 2.md',
        'Imported/Secret Novel/World/Lore/Research- Gates.md',
        'Locations/Veynn.md',
        'Plans/Plan — The Gate.md',
        'Plot/The Long War.md',
      ].sort(),
    );
    expect(deps.notifyStoriesChanged).toHaveBeenCalledTimes(1);
  });

  it('keeps every note inside the Notes Vault, sanitizing hostile names', async () => {
    const v = makeV2Vault();
    const deps = v2Deps(v);
    const result = await commitImportPlan(
      storyPlan({
        story: null,
        notes: [
          { title: 'CON', folder: '../../escape', body: 'x' },
          { title: '../../../etc/passwd', folder: 'a\\..\\..\\b', body: 'x' },
          { title: 'what?*:"<>|', folder: '', body: 'x' },
        ],
      }),
      deps,
    );
    expect(result).toMatchObject({ ok: true, noteCount: 3 });
    const rels = deps.notifyNotesWritten.mock.calls[0][0] as string[];
    for (const rel of rels) {
      const abs = path.resolve(v.notesRoot, rel);
      expect(abs.startsWith(v.notesRoot + path.sep)).toBe(true);
      expect(rel.split('/')).not.toContain('..');
    }
    expect(rels).toContain('Imported/Secret Novel/escape/CON_.md');
    expect(fs.existsSync(path.join(tmp, 'escape'))).toBe(false);
  });

  it('skips a note that cannot be written and keeps going', async () => {
    const v = makeV2Vault();
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(v.notesRoot, 'Locations'), 'dir');
    const deps = v2Deps(v);
    const result = await commitImportPlan(storyPlan({ story: null, notes: NOTES }), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entityCount).toBe(2);
    expect(result.warnings.join(' ')).toMatch(/Veynn/);
    expect(fs.readdirSync(outside)).toEqual([]);
    expect(fs.existsSync(path.join(v.notesRoot, 'Characters', 'Mira.md'))).toBe(true);
  });

  it('options.story=false writes only notes (no story, no plan note)', async () => {
    const v = makeV2Vault();
    const deps = v2Deps(v);
    const result = await commitImportPlan(storyPlan({ notes: NOTES }), deps, { story: false });
    expect(result).toMatchObject({ ok: true, chapterCount: 0, sceneCount: 0, entityCount: 3 });
    expect(fs.existsSync(path.join(v.storyRoot, 'The Gate'))).toBe(false);
    expect(fs.existsSync(path.join(v.notesRoot, 'Plans'))).toBe(false);
    expect(readManifest(v.cachePath).stories).toHaveLength(0);
    expect(deps.notifyStoriesChanged).not.toHaveBeenCalled();
  });

  it('options.notes=false writes the story and its plan note but no notes', async () => {
    const v = makeV2Vault();
    const deps = v2Deps(v);
    const result = await commitImportPlan(storyPlan({ notes: NOTES }), deps, { notes: false });
    expect(result).toMatchObject({ ok: true, chapterCount: 3, noteCount: 0, entityCount: 0 });
    expect(fs.existsSync(path.join(v.notesRoot, 'Characters', 'Mira.md'))).toBe(false);
    expect(fs.existsSync(path.join(v.notesRoot, 'Plans', 'Plan — The Gate.md'))).toBe(true);
  });

  it('a failed story write rolls back and writes no notes', async () => {
    const v = makeV2Vault();
    const deps = v2Deps(v);
    deps.writeManifest = () => {
      throw new Error('EACCES: permission denied, open /secret/path/manifest-cache.json');
    };
    const result = await commitImportPlan(storyPlan({ notes: NOTES }), deps);
    expect(result).toEqual({ ok: false, error: "Mythos isn't allowed to write to your vault folder. Check its permissions." });
    expect(fs.existsSync(path.join(v.storyRoot, 'The Gate'))).toBe(false);
    expect(fs.existsSync(path.join(v.notesRoot, 'Characters'))).toBe(false);
    expect(deps.notifyNotesWritten).not.toHaveBeenCalled();
    expect(deps.notifyStoriesChanged).not.toHaveBeenCalled();
  });

  it('refuses without an open story vault, and refuses oversized plans before flushing', async () => {
    const v = makeV2Vault();
    const deps = v2Deps(v);
    deps.getStoryVaultRoot = () => null;
    expect(await commitImportPlan(storyPlan(), deps)).toEqual({
      ok: false,
      error: 'Open or create a Mythos vault first (Settings → Vault & Files → New vault…).',
    });

    const flush = vi.fn(async () => {});
    const big = storyPlan();
    big.story!.chapters = [{
      title: 'Huge',
      order: 0,
      scenes: Array.from({ length: IMPORT_MAX_SCENES + 1 }, (_, i) => ({ title: `S${i}`, order: i, prose: 'x' })),
    }];
    const r = await commitImportPlan(big, { ...v2Deps(v), flushRenderer: flush });
    expect(r.ok).toBe(false);
    expect(flush).not.toHaveBeenCalled();

    const manyNotes = storyPlan({ notes: Array.from({ length: 5001 }, (_, i) => ({ title: `N${i}`, folder: '', body: '' })) });
    expect((await commitImportPlan(manyNotes, v2Deps(v))).ok).toBe(false);
  });
});

describe('commitImportPlan — long non-Latin names', () => {
  const LONG_CJK = '吾輩は猫である'.repeat(15); // 105 characters, 315 UTF-8 bytes

  it('imports a story, its plan note and notes whose titles pass 255 bytes', async () => {
    const v = makeV2Vault();
    const deps = v2Deps(v);
    const plan = storyPlan({
      story: { ...storyPlan().story!, title: LONG_CJK },
      notes: [
        { title: `${'🐉'.repeat(80)}`, folder: '', body: 'Dragons.', entityType: 'concept' },
        { title: LONG_CJK, folder: LONG_CJK, body: 'Long.' },
      ],
    });
    const result = await commitImportPlan(plan, deps);
    expect(result).toMatchObject({ ok: true, storyTitle: LONG_CJK, entityCount: 1, noteCount: 1, warnings: [] });
    if (!result.ok) return;

    const cache = readManifest(v.cachePath);
    const imported = cache.stories.find((st) => st.title === LONG_CJK)!;
    expect(Buffer.byteLength(imported.path, 'utf8')).toBeLessThanOrEqual(200);
    expect(fs.existsSync(path.join(v.storyRoot, imported.path, 'book.md'))).toBe(true);
    // A rescan still finds exactly this story.
    const rescanned = storyByPath(scanMythosStoryVault(v.mythosRoot), imported.path);
    expect(rescanned.map(shape)).toEqual([shape(imported)]);

    expect(result.planNotePath).toBeDefined();
    const planName = result.planNotePath!.split('/').pop()!;
    expect(Buffer.byteLength(planName, 'utf8')).toBeLessThanOrEqual(255);
    expect(fs.existsSync(path.join(v.notesRoot, ...result.planNotePath!.split('/')))).toBe(true);

    const written = deps.notifyNotesWritten.mock.calls[0][0] as string[];
    for (const rel of written) {
      for (const seg of rel.split('/')) expect(Buffer.byteLength(seg, 'utf8')).toBeLessThanOrEqual(255);
      expect(fs.existsSync(path.join(v.notesRoot, ...rel.split('/')))).toBe(true);
    }
  });
});

describe('commitImportPlan — legacy vault', () => {
  function makeLegacyVault(): { root: string; manifestPath: string } {
    const root = path.join(tmp, 'Legacy Vault');
    fs.mkdirSync(root, { recursive: true });
    const manifestPath = path.join(root, 'manifest.json');
    writeManifestRaw(manifestPath, defaultManifest(root));
    return { root, manifestPath };
  }

  it('writes the Manuscript/<slug> layout and persists through deps.writeManifest', async () => {
    const { root, manifestPath } = makeLegacyVault();
    const notesRoot = path.join(tmp, 'Notes');
    fs.mkdirSync(notesRoot);
    const writeManifest = vi.fn((p: string, m: Manifest) => {
      writeManifestRaw(p, m);
    });
    const deps: ImportCommitDeps = {
      getStoryVaultRoot: () => root,
      isV2StoryVault: () => false,
      getManifestPath: () => manifestPath,
      readManifest: (p) => readManifest(p),
      writeManifest,
      getNotesVaultRoot: () => notesRoot,
      ensureNotesVaultDir: () => {},
      notifyNotesWritten: vi.fn(),
      notifyStoriesChanged: vi.fn(),
      flushRenderer: async () => {},
      now: () => NOW,
    };
    const result = await commitImportPlan(storyPlan(), deps);
    expect(result).toMatchObject({ ok: true, chapterCount: 3, sceneCount: 4 });
    expect(writeManifest).toHaveBeenCalledTimes(1);

    const m = readManifest(manifestPath);
    expect(m.stories).toHaveLength(1);
    const story = m.stories[0];
    expect(story.path).toBe('Manuscript/the-gate');
    expect(story.chapters.map((c) => c.path)).toEqual([
      'Manuscript/the-gate/chapter-one-ash',
      'Manuscript/the-gate/chapter-two',
      'Manuscript/the-gate/chapter-three',
    ]);
    const first = story.chapters[0].scenes[0];
    const onDisk = readSceneFile(root, first.path);
    expect(onDisk.id).toBe(first.id);
    expect(onDisk.prose).toBe('It was **dark** and *cold*.\n\nShe waited.');

    expect((await commitImportPlan(storyPlan(), deps)).ok).toBe(true);
    const again = readManifest(manifestPath);
    expect(again.stories.map((s) => s.path)).toEqual(['Manuscript/the-gate', 'Manuscript/the-gate-2']);
    expect(fs.existsSync(path.join(notesRoot, 'Plans', 'Plan — The Gate 2.md'))).toBe(true);
  });

  it('caps legacy slugs so a very long title still imports', async () => {
    const { root, manifestPath } = makeLegacyVault();
    const deps: ImportCommitDeps = {
      getStoryVaultRoot: () => root,
      isV2StoryVault: () => false,
      getManifestPath: () => manifestPath,
      readManifest: (p) => readManifest(p),
      writeManifest: (p, m) => writeManifestRaw(p, m),
      getNotesVaultRoot: () => null,
      ensureNotesVaultDir: () => {},
      notifyNotesWritten: vi.fn(),
      notifyStoriesChanged: vi.fn(),
      flushRenderer: async () => {},
      now: () => NOW,
    };
    const long = 'A very long title '.repeat(20).trim();
    const base = storyPlan();
    const plan = storyPlan({
      story: {
        ...base.story!,
        title: long,
        chapters: [{ title: long, order: 0, scenes: [{ title: long, order: 0, prose: 'Words.' }] }],
      },
    });
    const result = await commitImportPlan(plan, deps);
    expect(result).toMatchObject({ ok: true, storyTitle: long, sceneCount: 1 });
    const scene = readManifest(manifestPath).stories[0].chapters[0].scenes[0];
    for (const seg of scene.path.split('/')) expect(Buffer.byteLength(seg, 'utf8')).toBeLessThanOrEqual(255);
    expect(readSceneFile(root, scene.path).title).toBe(long);
  });
});

describe('safeSegment', () => {
  it('strips separators, reserved characters, reserved device names and dot-only names', () => {
    expect(safeSegment('a/b\\c:d', 'x')).toBe('a-b-c-d');
    expect(safeSegment('CON', 'x')).toBe('CON_');
    expect(safeSegment('lpt1.txt', 'x')).toBe('lpt1_.txt');
    expect(safeSegment('..', 'x')).toBe('x');
    expect(safeSegment('.hidden', 'x')).toBe('hidden');
    expect(safeSegment('name. . ', 'x')).toBe('name');
    expect([...safeSegment('a'.repeat(500), 'x')].length).toBeLessThanOrEqual(120);
  });

  it(`caps a segment at ${MAX_SEGMENT_BYTES} UTF-8 bytes without splitting a character`, () => {
    const cjk = safeSegment('猫'.repeat(120), 'x');
    expect(Buffer.byteLength(cjk, 'utf8')).toBeLessThanOrEqual(MAX_SEGMENT_BYTES);
    expect(cjk).toBe('猫'.repeat(66));
    const emoji = safeSegment('🐉'.repeat(100), 'x');
    expect(Buffer.byteLength(emoji, 'utf8')).toBeLessThanOrEqual(MAX_SEGMENT_BYTES);
    expect(emoji).toBe('🐉'.repeat(50));
    expect(truncateUtf8('a🐉b', 3)).toBe('a');
    expect(truncateUtf8('short', 200)).toBe('short');
  });
});
