/**
 * aiWriteGuard.vault.test.ts — AI-SUGGEST B2.
 * Filename contains `vault.test` so notes-windows already runs it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { assertAiWritable, withAiFileLock } from './aiWriteGuard.js';
import {
  createMythosFile,
  manifestCachePathFor,
  serializeMythosFile,
} from '../mythosFormat/mythosJson.js';

const V1_FIXTURE = path.resolve(__dirname, '../../../e2e/fixtures/v1-vault-pre-templates-v2');

const dirs: string[] = [];

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function writeManifest(root: string, manifest: unknown): void {
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest), 'utf8');
}

function emptyManifest(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { schemaVersion: 1, stories: [], scenes: [], entities: [], ...extra };
}

function copyV1(): string {
  const root = tmp('mythos-b2-v1-');
  fs.cpSync(V1_FIXTURE, root, { recursive: true });
  return root;
}

function makeV2(manifest: unknown): string {
  const mythos = tmp('mythos-b2-v2-');
  const story = path.join(mythos, 'Story Vault');
  fs.mkdirSync(path.join(story, '.mythos'), { recursive: true });
  fs.writeFileSync(path.join(mythos, 'mythos.json'), serializeMythosFile(createMythosFile('B2')));
  fs.writeFileSync(manifestCachePathFor(story), JSON.stringify(manifest), 'utf8');
  return story;
}

function sceneManifest(sceneRel: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    stories: [{
      path: 'stories/story-1',
      chapters: [{
        path: 'stories/ch1',
        scenes: [{ path: sceneRel }],
      }],
    }],
    scenes: [],
    entities: [],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('assertAiWritable schema (M-B2k)', () => {
  it('refuses {} and a partial manifest on v1 and v2', () => {
    for (const root of [tmp('mythos-b2-schema-'), makeV2({})]) {
      if (!root.includes('Story Vault')) writeManifest(root, {});
      expect(assertAiWritable(root, 'entities/characters/a.md')).toEqual({ ok: false, reason: 'no_manifest' });
    }
    const partial = { entities: [{ path: 'entities/characters/a.md' }] };
    const v1 = tmp('mythos-b2-partial-');
    writeManifest(v1, partial);
    expect(assertAiWritable(v1, 'entities/characters/a.md').ok).toBe(false);
    expect(assertAiWritable(makeV2(partial), 'entities/characters/a.md')).toEqual({ ok: false, reason: 'no_manifest' });
    const badScenes = { stories: [], scenes: 'x', entities: [] };
    const v1b = tmp('mythos-b2-scenes-');
    writeManifest(v1b, badScenes);
    expect(assertAiWritable(v1b, 'entities/characters/a.md')).toEqual({ ok: false, reason: 'no_manifest' });
    expect(assertAiWritable(makeV2(badScenes), 'entities/characters/a.md')).toEqual({ ok: false, reason: 'no_manifest' });
  });

  it('does not require a top-level chapters array and refuses a non-array when present', () => {
    const root = copyV1();
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    delete manifest.chapters;
    writeManifest(root, manifest);
    const hero = assertAiWritable(root, 'entities/characters/Hero.md');
    expect(hero.ok).toBe(true);

    manifest.chapters = 'nope';
    writeManifest(root, manifest);
    expect(assertAiWritable(root, 'entities/characters/Hero.md')).toEqual({ ok: false, reason: 'no_manifest' });
  });

  it('refuses a story whose chapters are not an array', () => {
    const root = tmp('mythos-b2-ch-');
    writeManifest(root, {
      stories: [{ path: 'stories/story-1', chapters: 'nope' }],
      scenes: [],
      entities: [],
    });
    expect(assertAiWritable(root, 'entities/characters/a.md')).toEqual({ ok: false, reason: 'no_manifest' });
  });

  it('refuses every write when the manifest file is missing or corrupt', () => {
    const missing = tmp('mythos-b2-miss-');
    expect(assertAiWritable(missing, 'entities/characters/a.md')).toEqual({ ok: false, reason: 'no_manifest' });
    const v2 = makeV2(null);
    fs.writeFileSync(manifestCachePathFor(v2), '{', 'utf8');
    expect(assertAiWritable(v2, 'entities/characters/a.md')).toEqual({ ok: false, reason: 'no_manifest' });
  });
});

describe('assertAiWritable manuscript and allowlist', () => {
  it('allows a manifest entity and a new entities/<type> file, and refuses a scene', () => {
    const root = copyV1();
    expect(assertAiWritable(root, 'entities/characters/Hero.md').ok).toBe(true);
    expect(assertAiWritable(root, 'entities/characters/brand-new.md').ok).toBe(true);
    expect(assertAiWritable(root, 'stories/story-1/chapters/chapter-1/scenes/Opening.md')).toEqual({
      ok: false,
      reason: 'manuscript_target',
    });
  });

  it('refuses chapter meta, outline, synopsis, and book.md, and does not treat Beat Sheet as manuscript', () => {
    const root = copyV1();
    expect(assertAiWritable(root, 'stories/story-1/chapters/chapter-1/chapter.md')).toEqual({
      ok: false,
      reason: 'manuscript_target',
    });
    for (const name of ['Outline.md', 'Synopsis.md', 'book.md']) {
      expect(assertAiWritable(root, `stories/story-1/${name}`)).toEqual({ ok: false, reason: 'manuscript_target' });
    }
    expect(assertAiWritable(root, 'stories/story-1/Beat Sheet.md')).toEqual({ ok: false, reason: 'not_allowlisted' });
  });

  it('uses a folder boundary so ScenesNotes and chapter-1-extra stay writable', () => {
    const root = tmp('mythos-b2-bound-');
    fs.mkdirSync(path.join(root, 'Scenes'), { recursive: true });
    fs.mkdirSync(path.join(root, 'stories/story-1/chapters/chapter-1'), { recursive: true });
    fs.mkdirSync(path.join(root, 'stories/story-1/chapters/chapter-1-extra'), { recursive: true });
    fs.mkdirSync(path.join(root, 'ScenesNotes'), { recursive: true });
    fs.writeFileSync(path.join(root, 'ScenesNotes/note.md'), 'note\n');
    fs.writeFileSync(path.join(root, 'stories/story-1/chapters/chapter-1-extra/note.md'), 'extra\n');
    writeManifest(root, {
      stories: [{
        path: 'stories/story-1',
        chapters: [{ path: 'stories/story-1/chapters/chapter-1', scenes: [] }],
      }],
      chapters: [{ path: 'Scenes' }],
      scenes: [],
      entities: [
        { path: 'ScenesNotes/note.md' },
        { path: 'stories/story-1/chapters/chapter-1-extra/note.md' },
      ],
    });
    expect(assertAiWritable(root, 'ScenesNotes/note.md').ok).toBe(true);
    expect(assertAiWritable(root, 'stories/story-1/chapters/chapter-1-extra/note.md').ok).toBe(true);
    fs.writeFileSync(path.join(root, 'stories/story-1/chapters/chapter-1/scene.md'), 'scene\n');
    expect(assertAiWritable(root, 'stories/story-1/chapters/chapter-1/scene.md')).toEqual({
      ok: false,
      reason: 'manuscript_target',
    });
  });

  it('refuses a .. path that lands on a scene and an extension that is not .md', () => {
    const root = copyV1();
    expect(assertAiWritable(
      root,
      'entities/characters/../../stories/story-1/chapters/chapter-1/scenes/Opening.md',
    )).toEqual({ ok: false, reason: 'manuscript_target' });
    expect(assertAiWritable(root, 'entities/characters/Hero.txt')).toEqual({ ok: false, reason: 'not_allowlisted' });
    expect(assertAiWritable(root, '.mythos/note.md')).toEqual({ ok: false, reason: 'not_allowlisted' });
  });

  it('folds case only when the platform is win32 or darwin (M-B2f)', () => {
    const root = tmp('mythos-b2-case-');
    fs.mkdirSync(path.join(root, 'stories/ch1'), { recursive: true });
    fs.writeFileSync(path.join(root, 'stories/ch1/scene.md'), 'scene\n');
    writeManifest(root, sceneManifest('stories/ch1/scene.md'));
    expect(assertAiWritable(root, 'STORIES/ch1/scene.MD')).toEqual({ ok: false, reason: 'not_allowlisted' });
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    expect(assertAiWritable(root, 'STORIES/ch1/scene.MD')).toEqual({ ok: false, reason: 'manuscript_target' });
    platform.mockRestore();
  });
});

describe('assertAiWritable containment (M-B2j)', () => {
  it('makes an escaped manuscript entry no_manifest and drops an escaped entity', () => {
    for (const rel of ['../x.md', '/etc/x.md', 'C:\\x.md']) {
      const root = tmp('mythos-b2-esc-');
      writeManifest(root, {
        stories: [{ chapters: [{ scenes: [{ path: rel }] }] }],
        scenes: [],
        entities: [{ path: 'entities/characters/Hero.md' }],
      });
      expect(assertAiWritable(root, 'entities/characters/Hero.md')).toEqual({ ok: false, reason: 'no_manifest' });
    }

    const root = tmp('mythos-b2-ent-esc-');
    fs.mkdirSync(path.join(root, 'entities/characters'), { recursive: true });
    fs.writeFileSync(path.join(root, 'entities/characters/Hero.md'), 'hero\n');
    writeManifest(root, {
      stories: [],
      scenes: [],
      entities: [{ path: '../x.md' }, { path: 'entities/characters/Hero.md' }],
    });
    expect(assertAiWritable(root, 'entities/characters/Hero.md').ok).toBe(true);
    expect(assertAiWritable(root, '../x.md').ok).toBe(false);
  });

  it('refuses the whole vault when a manuscript entry is a symlink that leaves the vault', () => {
    const root = tmp('mythos-b2-sym-ent-');
    const outside = tmp('mythos-b2-out-');
    fs.writeFileSync(path.join(outside, 'secret.md'), 'secret\n');
    fs.mkdirSync(path.join(root, 'stories'), { recursive: true });
    try {
      fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'stories/linked.md'));
    } catch (err) {
      console.log(`symlink skipped: ${(err as Error).message}`);
      return;
    }
    writeManifest(root, {
      stories: [],
      scenes: [{ path: 'stories/linked.md' }],
      entities: [{ path: 'entities/characters/Hero.md' }],
    });
    expect(assertAiWritable(root, 'entities/characters/Hero.md')).toEqual({ ok: false, reason: 'no_manifest' });
  });
});

describe('assertAiWritable links (M-B2g)', () => {
  it('refuses a symlink leaf to a scene as not_allowlisted', () => {
    const root = copyV1();
    const link = path.join(root, 'entities/characters/alias.md');
    try {
      fs.symlinkSync(
        path.join(root, 'stories/story-1/chapters/chapter-1/scenes/Opening.md'),
        link,
      );
    } catch (err) {
      console.log(`symlink skipped: ${(err as Error).message}`);
      return;
    }
    expect(assertAiWritable(root, 'entities/characters/alias.md')).toEqual({ ok: false, reason: 'not_allowlisted' });
  });

  it('refuses a symlinked directory that points at scenes', () => {
    const root = copyV1();
    const linked = path.join(root, 'entities/linked-scenes');
    try {
      fs.symlinkSync(path.join(root, 'stories/story-1/chapters/chapter-1/scenes'), linked);
    } catch (err) {
      console.log(`symlink skipped: ${(err as Error).message}`);
      return;
    }
    expect(assertAiWritable(root, 'entities/linked-scenes/Opening.md')).toEqual({
      ok: false,
      reason: 'not_allowlisted',
    });
  });

  it('refuses a hardlink to a scene before classifying it as an entity file', () => {
    const root = copyV1();
    const scene = path.join(root, 'stories/story-1/chapters/chapter-1/scenes/Opening.md');
    const alias = path.join(root, 'entities/characters/alias.md');
    try {
      fs.linkSync(scene, alias);
    } catch (err) {
      console.log(`hardlink skipped: ${(err as Error).message}`);
      return;
    }
    expect(assertAiWritable(root, 'entities/characters/alias.md')).toEqual({ ok: false, reason: 'not_allowlisted' });
    expect(fs.readFileSync(scene, 'utf8')).toBe(fs.readFileSync(path.join(V1_FIXTURE, 'stories/story-1/chapters/chapter-1/scenes/Opening.md'), 'utf8'));
  });
});

describe('assertAiWritable class C (M-B2i)', () => {
  function pair(): { story: string; notes: string } {
    const story = copyV1();
    const notes = tmp('mythos-b2-notes-');
    const note = path.join(notes, 'Universes/My First Universe/Characters');
    fs.mkdirSync(note, { recursive: true });
    fs.writeFileSync(path.join(note, 'hero.md'), 'hero\n');
    fs.mkdirSync(path.join(notes, 'Daily Notes'), { recursive: true });
    fs.writeFileSync(path.join(notes, 'Daily Notes/j.md'), 'journal\n');
    return { story, notes };
  }

  it('patches a universe character note and refuses Daily Notes', () => {
    const { story, notes } = pair();
    const opts = { classC: { notesRoot: notes, storyRoot: story } };
    expect(assertAiWritable(notes, 'Universes/My First Universe/Characters/hero.md', opts).ok).toBe(true);
    expect(assertAiWritable(notes, 'universes/My First Universe/characters/hero.md', opts).ok).toBe(true);
    expect(assertAiWritable(notes, 'Daily Notes/j.md', opts)).toEqual({ ok: false, reason: 'not_allowlisted' });
    expect(assertAiWritable(notes, 'Universes/My First Universe/Diary/x.md', opts)).toEqual({
      ok: false,
      reason: 'not_allowlisted',
    });
  });

  it('turns class C off when the notes and story roots overlap', () => {
    const story = copyV1();
    fs.mkdirSync(path.join(story, 'Universes/U/Characters'), { recursive: true });
    fs.writeFileSync(path.join(story, 'Universes/U/Characters/x.md'), 'x\n');
    expect(assertAiWritable(story, 'Universes/U/Characters/x.md', {
      classC: { notesRoot: story, storyRoot: story },
    })).toEqual({ ok: false, reason: 'not_allowlisted' });
  });

  it('does not need a manifest inside the notes root', () => {
    const { story, notes } = pair();
    expect(fs.existsSync(path.join(notes, 'manifest.json'))).toBe(false);
    expect(assertAiWritable(notes, 'Universes/My First Universe/Characters/hero.md', {
      classC: { notesRoot: notes, storyRoot: story },
    }).ok).toBe(true);
    fs.writeFileSync(path.join(story, 'manifest.json'), '{', 'utf8');
    expect(assertAiWritable(notes, 'Universes/My First Universe/Characters/hero.md', {
      classC: { notesRoot: notes, storyRoot: story },
    })).toEqual({ ok: false, reason: 'no_manifest' });
  });
});

describe('assertAiWritable resolve_failed', () => {
  it('returns resolve_failed when realpath throws EACCES on the entity note (T-B1R)', () => {
    const root = copyV1();
    const native = fs.realpathSync.native;
    vi.spyOn(fs.realpathSync, 'native').mockImplementation((target) => {
      if (String(target).includes(`${path.sep}Hero.md`)) {
        const err = new Error('EACCES') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      }
      return native(target);
    });
    expect(assertAiWritable(root, 'entities/characters/Hero.md')).toEqual({ ok: false, reason: 'resolve_failed' });
  });
});

describe('withAiFileLock', () => {
  it('keeps overlapping writes on one path at concurrency 1', async () => {
    let current = 0;
    let max = 0;
    const abs = path.join(tmp('mythos-b2-lock-'), 'note.md');
    const run = () => withAiFileLock(abs, async () => {
      current += 1;
      max = Math.max(max, current);
      await new Promise((resolve) => setTimeout(resolve, 30));
      current -= 1;
    });
    await Promise.all([run(), run()]);
    expect(max).toBe(1);
  });
});
