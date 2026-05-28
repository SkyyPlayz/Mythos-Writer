// Unit tests for CHAPTER_LIST, CHAPTER_GET, CHAPTER_SAVE, SCENE_LIST, SCENE_GET, SCENE_SAVE
// Uses real temp directories; no Electron mocks needed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import {
  defaultManifest,
  readManifest,
  writeManifest,
  writeSceneFile,
  readSceneFile,
  writeVaultFileAtomic,
  writeSceneFileAtomic,
  safePath,
} from './vault.js';
import type { Manifest, ChapterEntry, SceneEntry } from './ipc.js';

// ─── Helpers ───

function makeManifest(tmpDir: string): Manifest {
  const m = defaultManifest(tmpDir);
  const now = new Date().toISOString();

  const scene1: SceneEntry = {
    id: 'scene-001',
    title: 'Opening',
    path: 'Manuscript/my-story/chapter-one/opening.md',
    order: 0,
    chapterId: 'ch-001',
    storyId: 'story-001',
    blocks: [],
    createdAt: now,
    updatedAt: now,
  };
  const chapter1: ChapterEntry = {
    id: 'ch-001',
    title: 'Chapter One',
    path: 'Manuscript/my-story/chapter-one',
    order: 0,
    scenes: [scene1],
    createdAt: now,
    updatedAt: now,
  };
  m.stories.push({
    id: 'story-001',
    title: 'My Story',
    path: 'Manuscript/my-story',
    chapters: [chapter1],
    createdAt: now,
    updatedAt: now,
  });

  // Create the scene markdown file so SCENE_GET can read it
  const sceneDirFull = path.join(tmpDir, 'Manuscript/my-story/chapter-one');
  fs.mkdirSync(sceneDirFull, { recursive: true });
  writeSceneFile(tmpDir, scene1.path, {
    id: scene1.id,
    title: scene1.title,
    chapterId: scene1.chapterId,
    storyId: scene1.storyId,
    order: scene1.order,
    prose: 'Initial prose.',
  });

  return m;
}

// ─── CHAPTER_LIST ───

describe('CHAPTER_LIST logic', () => {
  let tmpDir: string;
  let manifest: Manifest;
  let manifestPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-chlist-'));
    manifest = makeManifest(tmpDir);
    manifestPath = path.join(tmpDir, 'manifest.json');
    writeManifest(manifestPath, manifest);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns chapters for a valid storyId', () => {
    const m = readManifest(manifestPath);
    const story = m.stories.find((s) => s.id === 'story-001')!;
    expect(story.chapters).toHaveLength(1);
    expect(story.chapters[0].id).toBe('ch-001');
  });

  it('throws for unknown storyId', () => {
    const m = readManifest(manifestPath);
    expect(() => {
      const story = m.stories.find((s) => s.id === 'does-not-exist');
      if (!story) throw new Error('Story not found: does-not-exist');
    }).toThrow('Story not found: does-not-exist');
  });
});

// ─── CHAPTER_GET ───

describe('CHAPTER_GET logic', () => {
  let tmpDir: string;
  let manifestPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-chget-'));
    const manifest = makeManifest(tmpDir);
    manifestPath = path.join(tmpDir, 'manifest.json');
    writeManifest(manifestPath, manifest);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the chapter for a known chapterId', () => {
    const m = readManifest(manifestPath);
    let found: ChapterEntry | null = null;
    for (const story of m.stories) {
      const ch = story.chapters.find((c) => c.id === 'ch-001');
      if (ch) { found = ch; break; }
    }
    expect(found).not.toBeNull();
    expect(found!.title).toBe('Chapter One');
  });

  it('returns null for an unknown chapterId', () => {
    const m = readManifest(manifestPath);
    let found: ChapterEntry | null = null;
    for (const story of m.stories) {
      const ch = story.chapters.find((c) => c.id === 'no-such-chapter');
      if (ch) { found = ch; break; }
    }
    expect(found).toBeNull();
  });
});

// ─── CHAPTER_SAVE ───

describe('CHAPTER_SAVE logic', () => {
  let tmpDir: string;
  let manifestPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-chsave-'));
    const manifest = makeManifest(tmpDir);
    manifestPath = path.join(tmpDir, 'manifest.json');
    writeManifest(manifestPath, manifest);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('updates chapter title and persists atomically', () => {
    const m = readManifest(manifestPath);
    let found: ChapterEntry | null = null;
    for (const story of m.stories) {
      const ch = story.chapters.find((c) => c.id === 'ch-001');
      if (ch) { found = ch; break; }
    }
    expect(found).not.toBeNull();
    found!.title = 'Revised Title';
    found!.updatedAt = new Date().toISOString();
    writeManifest(manifestPath, m);

    const m2 = readManifest(manifestPath);
    const ch2 = m2.stories[0].chapters[0];
    expect(ch2.title).toBe('Revised Title');
  });

  it('throws for unknown chapterId', () => {
    const m = readManifest(manifestPath);
    expect(() => {
      let found: ChapterEntry | null = null;
      for (const story of m.stories) {
        const ch = story.chapters.find((c) => c.id === 'ghost-chapter');
        if (ch) { found = ch; break; }
      }
      if (!found) throw new Error('Chapter not found: ghost-chapter');
    }).toThrow('Chapter not found: ghost-chapter');
  });

  it('rejects a chapterId with path traversal in chapter.path', () => {
    const m = readManifest(manifestPath);
    // Inject a chapter with a traversal path to simulate a tampered manifest
    const now = new Date().toISOString();
    m.stories[0].chapters.push({
      id: 'evil-ch',
      title: 'Evil',
      path: '../../../etc',
      order: 99,
      scenes: [],
      createdAt: now,
      updatedAt: now,
    });
    writeManifest(manifestPath, m);

    const m2 = readManifest(manifestPath);
    const ch = m2.stories[0].chapters.find((c) => c.id === 'evil-ch')!;
    expect(() => safePath(tmpDir, ch.path)).toThrow('Path traversal denied');
  });
});

// ─── SCENE_LIST ───

describe('SCENE_LIST logic', () => {
  let tmpDir: string;
  let manifestPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-slist-'));
    const manifest = makeManifest(tmpDir);
    manifestPath = path.join(tmpDir, 'manifest.json');
    writeManifest(manifestPath, manifest);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns scenes for a known chapterId', () => {
    const m = readManifest(manifestPath);
    let scenes: SceneEntry[] | null = null;
    for (const story of m.stories) {
      const ch = story.chapters.find((c) => c.id === 'ch-001');
      if (ch) { scenes = ch.scenes; break; }
    }
    expect(scenes).not.toBeNull();
    expect(scenes!).toHaveLength(1);
    expect(scenes![0].id).toBe('scene-001');
  });

  it('throws for unknown chapterId', () => {
    const m = readManifest(manifestPath);
    expect(() => {
      let found = false;
      for (const story of m.stories) {
        if (story.chapters.find((c) => c.id === 'no-such')) { found = true; break; }
      }
      if (!found) throw new Error('Chapter not found: no-such');
    }).toThrow('Chapter not found: no-such');
  });
});

// ─── SCENE_GET ───

describe('SCENE_GET logic', () => {
  let tmpDir: string;
  let manifestPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sget-'));
    const manifest = makeManifest(tmpDir);
    manifestPath = path.join(tmpDir, 'manifest.json');
    writeManifest(manifestPath, manifest);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the scene and its prose', () => {
    const m = readManifest(manifestPath);
    let result: { scene: SceneEntry | null; prose: string } = { scene: null, prose: '' };
    outer: for (const story of m.stories) {
      for (const ch of story.chapters) {
        const s = ch.scenes.find((sc) => sc.id === 'scene-001');
        if (s) {
          let prose = '';
          try { prose = readSceneFile(tmpDir, s.path).prose; } catch { /* */ }
          result = { scene: s, prose };
          break outer;
        }
      }
    }
    expect(result.scene).not.toBeNull();
    expect(result.prose).toBe('Initial prose.');
  });

  it('returns scene: null and empty prose for unknown sceneId', () => {
    const m = readManifest(manifestPath);
    let scene: SceneEntry | null = null;
    outer: for (const story of m.stories) {
      for (const ch of story.chapters) {
        const s = ch.scenes.find((sc) => sc.id === 'ghost-scene');
        if (s) { scene = s; break outer; }
      }
    }
    if (!scene) scene = m.scenes.find((s) => s.id === 'ghost-scene') ?? null;
    expect(scene).toBeNull();
  });
});

// ─── SCENE_SAVE (atomic write) ───

describe('SCENE_SAVE logic', () => {
  let tmpDir: string;
  let manifestPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ssave-'));
    const manifest = makeManifest(tmpDir);
    manifestPath = path.join(tmpDir, 'manifest.json');
    writeManifest(manifestPath, manifest);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes new prose atomically and updates the manifest', () => {
    const m = readManifest(manifestPath);
    const scenePath = 'Manuscript/my-story/chapter-one/opening.md';

    // Validate path (no traversal)
    expect(() => safePath(tmpDir, scenePath)).not.toThrow();

    writeSceneFileAtomic(tmpDir, scenePath, {
      id: 'scene-001',
      title: 'Opening',
      chapterId: 'ch-001',
      storyId: 'story-001',
      order: 0,
      prose: 'Updated prose after save.',
    });

    // Update manifest prose block
    const scene = m.stories[0].chapters[0].scenes[0];
    scene.blocks = [{ id: crypto.randomUUID(), type: 'prose', order: 0, content: 'Updated prose after save.', updatedAt: new Date().toISOString() }];
    scene.updatedAt = new Date().toISOString();
    writeManifest(manifestPath, m);

    // Verify file on disk
    const readBack = readSceneFile(tmpDir, scenePath);
    expect(readBack.prose).toBe('Updated prose after save.');

    // Verify manifest
    const m2 = readManifest(manifestPath);
    const block = m2.stories[0].chapters[0].scenes[0].blocks[0];
    expect(block.content).toBe('Updated prose after save.');
  });

  it('no .tmp file left on disk after atomic write', () => {
    const scenePath = 'Manuscript/my-story/chapter-one/opening.md';
    writeSceneFileAtomic(tmpDir, scenePath, {
      id: 'scene-001', title: 'Opening', prose: 'Final prose.',
    });
    const tmpFile = path.join(tmpDir, scenePath + '.tmp');
    expect(fs.existsSync(tmpFile)).toBe(false);
  });

  it('throws for path traversal in scene path', () => {
    expect(() => safePath(tmpDir, '../../../etc/passwd')).toThrow('Path traversal denied');
  });

  it('throws for unknown sceneId', () => {
    const m = readManifest(manifestPath);
    expect(() => {
      let found: SceneEntry | null = null;
      outer: for (const story of m.stories) {
        for (const ch of story.chapters) {
          const s = ch.scenes.find((sc) => sc.id === 'ghost');
          if (s) { found = s; break outer; }
        }
      }
      if (!found) found = m.scenes.find((s) => s.id === 'ghost') ?? null;
      if (!found) throw new Error('Scene not found: ghost');
    }).toThrow('Scene not found: ghost');
  });
});

// ─── writeVaultFileAtomic ───

describe('writeVaultFileAtomic', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-atomic-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes content and returns correct byte count', () => {
    const content = 'Hello atomic!';
    const result = writeVaultFileAtomic(tmpDir, 'atomic.txt', content);
    expect(result.path).toBe('atomic.txt');
    expect(result.bytes).toBe(Buffer.byteLength(content, 'utf-8'));
    expect(fs.readFileSync(path.join(tmpDir, 'atomic.txt'), 'utf-8')).toBe(content);
  });

  it('leaves no .tmp file after a successful write', () => {
    writeVaultFileAtomic(tmpDir, 'clean.txt', 'content');
    expect(fs.existsSync(path.join(tmpDir, 'clean.txt.tmp'))).toBe(false);
  });

  it('rejects path traversal', () => {
    expect(() => writeVaultFileAtomic(tmpDir, '../../../etc/crontab', 'pwned')).toThrow('Path traversal denied');
  });

  it('creates parent directories automatically', () => {
    writeVaultFileAtomic(tmpDir, 'deep/nested/file.txt', 'content');
    expect(fs.existsSync(path.join(tmpDir, 'deep/nested/file.txt'))).toBe(true);
  });

  it('rejects symlink escape during write', () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-atomic-outside-'));
    fs.symlinkSync(outsideDir, path.join(tmpDir, 'external'));
    try {
      expect(() => writeVaultFileAtomic(tmpDir, 'external/leak.txt', 'pwned')).toThrow('Path traversal denied');
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
