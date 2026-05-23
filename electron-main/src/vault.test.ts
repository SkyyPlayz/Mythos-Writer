// Vault integration tests — real temp directory, no mocks.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  readVaultFile,
  writeVaultFile,
  listVaultFiles,
  deleteVaultFile,
  parseFrontmatter,
  serializeFrontmatter,
  writeSceneFile,
  readSceneFile,
  writeEntityFile,
  readEntityFile,
  reindexVault,
  importObsidianVault,
  defaultManifest,
  toSlug,
  resolveSlugCollision,
  chapterVaultPath,
  sceneVaultPath,
  MANUSCRIPT_DIR,
} from './vault.js';

describe('Manuscript layout — slug and path helpers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-slug-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('toSlug', () => {
    it('lowercases and replaces spaces with hyphens', () => {
      expect(toSlug('Chapter One')).toBe('chapter-one');
    });

    it('strips non-alphanumeric characters and diacritics', () => {
      // "Arrivée" → NFD → "Arrivee" (accent stripped) → "arrivee"
      expect(toSlug("L'Arrivée: Part 1")).toBe('larrivee-part-1');
    });

    it('collapses multiple hyphens', () => {
      expect(toSlug('Chapter  1  --  Title')).toBe('chapter-1-title');
    });

    it('returns untitled for empty or all-special input', () => {
      expect(toSlug('!!! ???')).toBe('untitled');
      expect(toSlug('')).toBe('untitled');
    });

    it('strips leading and trailing hyphens', () => {
      expect(toSlug('  -Hello-  ')).toBe('hello');
    });
  });

  describe('resolveSlugCollision', () => {
    it('returns base path when no collision', () => {
      const result = resolveSlugCollision(tmpDir, 'Manuscript/story', 'chapter-1');
      expect(result).toBe('Manuscript/story/chapter-1');
    });

    it('appends -2 when base path already exists as directory', () => {
      fs.mkdirSync(path.join(tmpDir, 'Manuscript', 'story', 'chapter-1'), { recursive: true });
      const result = resolveSlugCollision(tmpDir, 'Manuscript/story', 'chapter-1');
      expect(result).toBe('Manuscript/story/chapter-1-2');
    });

    it('appends -3 when -2 also exists', () => {
      fs.mkdirSync(path.join(tmpDir, 'Manuscript', 'story', 'chapter-1'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'Manuscript', 'story', 'chapter-1-2'), { recursive: true });
      const result = resolveSlugCollision(tmpDir, 'Manuscript/story', 'chapter-1');
      expect(result).toBe('Manuscript/story/chapter-1-3');
    });

    it('resolves .md file collisions', () => {
      fs.mkdirSync(path.join(tmpDir, 'Manuscript', 'story', 'ch'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'Manuscript', 'story', 'ch', 'scene.md'), '', 'utf-8');
      const result = resolveSlugCollision(tmpDir, 'Manuscript/story/ch', 'scene', '.md');
      expect(result).toBe('Manuscript/story/ch/scene-2.md');
    });
  });

  describe('chapterVaultPath', () => {
    it('produces Manuscript/<story-slug>/<chapter-slug>', () => {
      const result = chapterVaultPath(tmpDir, 'My Story', 'Chapter One');
      expect(result).toBe(`${MANUSCRIPT_DIR}/my-story/chapter-one`);
    });

    it('resolves directory collision', () => {
      fs.mkdirSync(path.join(tmpDir, MANUSCRIPT_DIR, 'my-story', 'chapter-one'), { recursive: true });
      const result = chapterVaultPath(tmpDir, 'My Story', 'Chapter One');
      expect(result).toBe(`${MANUSCRIPT_DIR}/my-story/chapter-one-2`);
    });
  });

  describe('sceneVaultPath', () => {
    it('produces <chapterDir>/<scene-slug>.md', () => {
      const chapterDir = `${MANUSCRIPT_DIR}/my-story/chapter-one`;
      fs.mkdirSync(path.join(tmpDir, chapterDir), { recursive: true });
      const result = sceneVaultPath(tmpDir, chapterDir, 'The Opening Scene');
      expect(result).toBe(`${MANUSCRIPT_DIR}/my-story/chapter-one/the-opening-scene.md`);
    });

    it('resolves file collision deterministically', () => {
      const chapterDir = `${MANUSCRIPT_DIR}/my-story/ch-1`;
      fs.mkdirSync(path.join(tmpDir, chapterDir), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, chapterDir, 'opening.md'), '', 'utf-8');
      const result = sceneVaultPath(tmpDir, chapterDir, 'opening');
      expect(result).toBe(`${MANUSCRIPT_DIR}/my-story/ch-1/opening-2.md`);
    });

    it('uses actual chapter dir path, not re-derived from title', () => {
      const chapterDir = `${MANUSCRIPT_DIR}/my-story/chapter-one-2`;
      fs.mkdirSync(path.join(tmpDir, chapterDir), { recursive: true });
      const result = sceneVaultPath(tmpDir, chapterDir, 'Intro');
      expect(result).toBe(`${MANUSCRIPT_DIR}/my-story/chapter-one-2/intro.md`);
    });
  });
});

describe('IPC vault round-trip', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writeVaultFile then readVaultFile returns original content', () => {
    const content = 'Hello, Mythos Writer!';
    const filePath = 'test-scene.txt';
    const writeResult = writeVaultFile(tmpDir, filePath, content);
    expect(writeResult.path).toBe(filePath);
    expect(writeResult.bytes).toBe(Buffer.byteLength(content, 'utf-8'));
    const readResult = readVaultFile(tmpDir, filePath);
    expect(readResult.content).toBe(content);
  });

  it('writeVaultFile creates nested directories automatically', () => {
    writeVaultFile(tmpDir, 'chapters/chapter-1/scene-1.txt', 'Nested content');
    expect(readVaultFile(tmpDir, 'chapters/chapter-1/scene-1.txt').content).toBe('Nested content');
  });

  it('listVaultFiles returns written files', () => {
    writeVaultFile(tmpDir, 'scene-a.txt', 'a');
    writeVaultFile(tmpDir, 'scene-b.txt', 'b');
    const { items } = listVaultFiles(tmpDir);
    expect(items.map((i) => i.name)).toContain('scene-a.txt');
    expect(items.map((i) => i.name)).toContain('scene-b.txt');
  });

  it('deleteVaultFile removes file and reports deleted=true', () => {
    writeVaultFile(tmpDir, 'to-delete.txt', 'bye');
    expect(deleteVaultFile(tmpDir, 'to-delete.txt').deleted).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'to-delete.txt'))).toBe(false);
  });

  it('deleteVaultFile on missing file reports deleted=false', () => {
    expect(deleteVaultFile(tmpDir, 'nonexistent.txt').deleted).toBe(false);
  });

  it('readVaultFile rejects path traversal', () => {
    expect(() => readVaultFile(tmpDir, '../../../etc/passwd')).toThrow('Path traversal denied');
  });
});

describe('YAML frontmatter', () => {
  it('parseFrontmatter extracts keys and prose', () => {
    const raw = '---\ntitle: My Scene\nid: abc123\ntags: [action, drama]\n---\nProse goes here.';
    const { frontmatter, prose } = parseFrontmatter(raw);
    expect(frontmatter.title).toBe('My Scene');
    expect(frontmatter.id).toBe('abc123');
    expect(frontmatter.tags).toEqual(['action', 'drama']);
    expect(prose).toBe('Prose goes here.');
  });

  it('parseFrontmatter returns empty frontmatter for plain markdown', () => {
    const { frontmatter, prose } = parseFrontmatter('Just prose.');
    expect(frontmatter).toEqual({});
    expect(prose).toBe('Just prose.');
  });

  it('serializeFrontmatter round-trips correctly', () => {
    const fm = { id: 'x1', title: 'Test', tags: ['a', 'b'] };
    const serialized = serializeFrontmatter(fm, 'The prose.');
    const { frontmatter, prose } = parseFrontmatter(serialized);
    expect(frontmatter.id).toBe('x1');
    expect(frontmatter.title).toBe('Test');
    expect(frontmatter.tags).toEqual(['a', 'b']);
    expect(prose).toBe('The prose.');
  });
});

describe('Obsidian-compatible scene files', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-scene-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writeSceneFile produces Obsidian-compatible markdown with frontmatter', () => {
    writeSceneFile(tmpDir, 'scenes/scene-1.md', {
      id: 'scene-001',
      title: 'The Opening',
      chapterId: 'ch-1',
      order: 0,
      tags: ['intro'],
      prose: 'The story begins here.',
    });
    const raw = fs.readFileSync(path.join(tmpDir, 'scenes/scene-1.md'), 'utf-8');
    expect(raw).toMatch(/^---/);
    expect(raw).toContain('id: scene-001');
    expect(raw).toContain('title: The Opening');
    expect(raw).toContain('The story begins here.');
  });

  it('readSceneFile parses written scene file back to data', () => {
    const data = {
      id: 'scene-002',
      title: 'The Conflict',
      order: 1,
      prose: 'Tension rises.',
    };
    writeSceneFile(tmpDir, 'scene-2.md', data);
    const read = readSceneFile(tmpDir, 'scene-2.md');
    expect(read.id).toBe('scene-002');
    expect(read.title).toBe('The Conflict');
    expect(read.prose).toBe('Tension rises.');
  });
});

describe('Entity files', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-entity-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writeEntityFile and readEntityFile round-trip', () => {
    writeEntityFile(tmpDir, 'characters/alia.md', {
      id: 'char-001',
      name: 'Alia',
      type: 'character',
      aliases: ['The Wanderer'],
      prose: 'A mysterious traveler.',
    });
    const read = readEntityFile(tmpDir, 'characters/alia.md');
    expect(read.id).toBe('char-001');
    expect(read.name).toBe('Alia');
    expect(read.type).toBe('character');
    expect(read.aliases).toEqual(['The Wanderer']);
    expect(read.prose).toBe('A mysterious traveler.');
  });
});

describe('Vault reindex', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-reindex-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reindexVault picks up a new .md file not in manifest', () => {
    writeSceneFile(tmpDir, 'new-scene.md', {
      id: 'scene-new',
      title: 'New Scene',
      prose: 'Brand new.',
    });
    const manifest = defaultManifest(tmpDir);
    const { manifest: updated, scanned, updated: count } = reindexVault(tmpDir, manifest);
    expect(scanned).toBeGreaterThan(0);
    expect(count).toBeGreaterThan(0);
    expect(updated.scenes.some((s) => s.id === 'scene-new')).toBe(true);
  });

  it('reindexVault syncs updated prose into existing manifest entry', () => {
    const id = 'scene-existing';
    writeSceneFile(tmpDir, 'existing.md', { id, title: 'Old', prose: 'Old prose.' });
    const manifest = defaultManifest(tmpDir);
    const { manifest: after1 } = reindexVault(tmpDir, manifest);

    // Simulate external markdown edit
    const raw = fs.readFileSync(path.join(tmpDir, 'existing.md'), 'utf-8');
    const newContent = raw.replace('Old prose.', 'Updated prose.');
    // Ensure mtime advances
    const future = new Date(Date.now() + 5000);
    fs.writeFileSync(path.join(tmpDir, 'existing.md'), newContent, 'utf-8');
    fs.utimesSync(path.join(tmpDir, 'existing.md'), future, future);

    const { manifest: after2 } = reindexVault(tmpDir, after1);
    const scene = after2.scenes.find((s) => s.id === id);
    expect(scene?.blocks[0]?.content).toBe('Updated prose.');
  });
});

describe('importObsidianVault', () => {
  let srcDir: string;
  let dstDir: string;

  beforeEach(() => {
    srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-src-'));
    dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-dst-'));
  });

  afterEach(() => {
    fs.rmSync(srcDir, { recursive: true, force: true });
    fs.rmSync(dstDir, { recursive: true, force: true });
  });

  it('imports .md files from an Obsidian vault without data loss', () => {
    fs.writeFileSync(path.join(srcDir, 'Chapter One.md'), '# Chapter One\n\nOpening paragraph.', 'utf-8');
    fs.mkdirSync(path.join(srcDir, 'Characters'));
    fs.writeFileSync(path.join(srcDir, 'Characters', 'Hero.md'), '# Hero\nBrave and bold.', 'utf-8');

    const manifest = defaultManifest(dstDir);
    const result = importObsidianVault(srcDir, dstDir, manifest);

    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(fs.existsSync(path.join(dstDir, 'Chapter One.md'))).toBe(true);
    expect(fs.existsSync(path.join(dstDir, 'Characters', 'Hero.md'))).toBe(true);
  });

  it('skips files that already exist in vault', () => {
    fs.writeFileSync(path.join(srcDir, 'note.md'), 'content', 'utf-8');
    fs.writeFileSync(path.join(dstDir, 'note.md'), 'existing', 'utf-8');

    const manifest = defaultManifest(dstDir);
    const result = importObsidianVault(srcDir, dstDir, manifest);
    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(0);
    // Original vault content preserved
    expect(fs.readFileSync(path.join(dstDir, 'note.md'), 'utf-8')).toBe('existing');
  });

  it('injects missing id frontmatter on import', () => {
    fs.writeFileSync(path.join(srcDir, 'plain.md'), 'No frontmatter here.', 'utf-8');
    const manifest = defaultManifest(dstDir);
    importObsidianVault(srcDir, dstDir, manifest);
    const content = fs.readFileSync(path.join(dstDir, 'plain.md'), 'utf-8');
    expect(content).toMatch(/^---/);
    expect(content).toContain('id:');
  });
});
