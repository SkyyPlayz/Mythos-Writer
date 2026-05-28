// Vault integration tests — real temp directory, no mocks.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  readVaultFile,
  writeVaultFileUnsafe_testOnly,
  writeVaultFileAtomic,
  writeFileAtomic,
  listVaultFiles,
  deleteVaultFile,
  parseFrontmatter,
  serializeFrontmatter,
  writeSceneFile,
  writeSceneFileAtomic,
  readSceneFile,
  writeEntityFile,
  readEntityFile,
  reindexVault,
  importObsidianVault,
  defaultManifest,
  readManifest,
  writeManifest,
  toSlug,
  resolveSlugCollision,
  chapterVaultPath,
  sceneVaultPath,
  scaffoldNotesVault,
  obsidianDryRun,
  mergeProvenanceFrontmatter,
  MANUSCRIPT_DIR,
  MAX_VAULT_FILE_BYTES,
  VaultFileTooLargeError,
  realSafePath,
  startVaultWatcher,
  stopVaultWatcher,
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

  it('writeVaultFileUnsafe_testOnly then readVaultFile returns original content', () => {
    const content = 'Hello, Mythos Writer!';
    const filePath = 'test-scene.txt';
    const writeResult = writeVaultFileUnsafe_testOnly(tmpDir, filePath, content);
    expect(writeResult.path).toBe(filePath);
    expect(writeResult.bytes).toBe(Buffer.byteLength(content, 'utf-8'));
    const readResult = readVaultFile(tmpDir, filePath);
    expect(readResult.content).toBe(content);
  });

  it('writeVaultFileUnsafe_testOnly creates nested directories automatically', () => {
    writeVaultFileUnsafe_testOnly(tmpDir, 'chapters/chapter-1/scene-1.txt', 'Nested content');
    expect(readVaultFile(tmpDir, 'chapters/chapter-1/scene-1.txt').content).toBe('Nested content');
  });

  it('listVaultFiles returns written files', () => {
    writeVaultFileUnsafe_testOnly(tmpDir, 'scene-a.txt', 'a');
    writeVaultFileUnsafe_testOnly(tmpDir, 'scene-b.txt', 'b');
    const { items } = listVaultFiles(tmpDir);
    expect(items.map((i) => i.name)).toContain('scene-a.txt');
    expect(items.map((i) => i.name)).toContain('scene-b.txt');
  });

  it('deleteVaultFile removes file and reports deleted=true', () => {
    writeVaultFileUnsafe_testOnly(tmpDir, 'to-delete.txt', 'bye');
    expect(deleteVaultFile(tmpDir, 'to-delete.txt').deleted).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'to-delete.txt'))).toBe(false);
  });

  it('deleteVaultFile on missing file reports deleted=false', () => {
    expect(deleteVaultFile(tmpDir, 'nonexistent.txt').deleted).toBe(false);
  });

  it('readVaultFile rejects path traversal', () => {
    expect(() => readVaultFile(tmpDir, '../../../etc/passwd')).toThrow('Path traversal denied');
  });

  it('writeVaultFileAtomic succeeds and writes new content even when a stale .tmp file exists', () => {
    const relPath = 'crash-test.txt';
    const fullPath = path.join(tmpDir, relPath);
    const staleTmpPath = `${fullPath}.tmp`;
    fs.writeFileSync(fullPath, 'original content', 'utf-8');
    // Stale .tmp left by a previous crashed write (old fixed-suffix format)
    fs.writeFileSync(staleTmpPath, 'partial torn write', 'utf-8');
    writeVaultFileAtomic(tmpDir, relPath, 'new content');
    expect(fs.readFileSync(fullPath, 'utf-8')).toBe('new content');
    // Unique suffix means we never clobbered or cleaned up the unrelated stale file
    expect(fs.existsSync(staleTmpPath)).toBe(true);
  });

  it('writeVaultFileAtomic: two parallel calls land exactly one payload with no tmp leftovers', async () => {
    const relPath = 'race.md';
    const payloadA = 'content-ALPHA';
    const payloadB = 'content-BETA';

    await Promise.all([
      Promise.resolve().then(() => writeVaultFileAtomic(tmpDir, relPath, payloadA)),
      Promise.resolve().then(() => writeVaultFileAtomic(tmpDir, relPath, payloadB)),
    ]);

    const final = fs.readFileSync(path.join(tmpDir, relPath), 'utf-8');
    // Final content must be exactly one of the two payloads — no interleaving
    expect([payloadA, payloadB]).toContain(final);
    // No stray .tmp files left behind
    const tmpFiles = fs.readdirSync(tmpDir).filter((f) => f.includes('.tmp'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('writeFileAtomic writes buffer to arbitrary path atomically', () => {
    const target = path.join(tmpDir, 'export', 'output.bin');
    const data = Buffer.from('binary export data');
    writeFileAtomic(target, data);
    expect(fs.readFileSync(target)).toEqual(data);
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
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

  it('skips symlinked .md files — no symlink traversal outside vault', () => {
    fs.writeFileSync(path.join(srcDir, 'real.md'), '# Real', 'utf-8');
    fs.symlinkSync('/etc/hostname', path.join(srcDir, 'link.md'));

    const manifest = defaultManifest(dstDir);
    const result = importObsidianVault(srcDir, dstDir, manifest);

    expect(result.imported).toBe(1);
    expect(fs.existsSync(path.join(dstDir, 'real.md'))).toBe(true);
    expect(fs.existsSync(path.join(dstDir, 'link.md'))).toBe(false);
  });

  // MYT-447: oversize source .md must be skipped (errors + continue), not read into memory.
  // A malicious vault with a multi-GB .md previously OOM'd the main process because the
  // read happened before the destination-side write cap.
  it('skips oversize source .md files without reading them — records error and continues', () => {
    // Sparse file 1 byte over the limit — fast, no real GB allocated.
    const oversizePath = path.join(srcDir, 'evil.md');
    const fd = fs.openSync(oversizePath, 'w');
    fs.ftruncateSync(fd, MAX_VAULT_FILE_BYTES + 1);
    fs.closeSync(fd);
    // A second, in-limit file so we can confirm imports continue past the bad one.
    fs.writeFileSync(path.join(srcDir, 'good.md'), '# Good\n', 'utf-8');

    // Guard: if the fix regresses and readFileSync runs on the oversize file,
    // the test should fail loudly rather than spending seconds allocating a string.
    const realReadFileSync = fs.readFileSync.bind(fs);
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(((p: fs.PathOrFileDescriptor, opts?: unknown) => {
      if (typeof p === 'string' && p === oversizePath) {
        throw new Error('readFileSync called on oversize source — size cap regressed');
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return realReadFileSync(p as any, opts as any);
    }) as typeof fs.readFileSync);

    try {
      const manifest = defaultManifest(dstDir);
      const result = importObsidianVault(srcDir, dstDir, manifest);

      expect(result.imported).toBe(1);
      expect(fs.existsSync(path.join(dstDir, 'good.md'))).toBe(true);
      expect(fs.existsSync(path.join(dstDir, 'evil.md'))).toBe(false);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('evil.md');
      expect(result.errors[0]).toMatch(/exceeds the/);
    } finally {
      readSpy.mockRestore();
    }
  });

  // MYT-446: importObsidianVault must use the atomic writer so a crash mid-import
  // leaves no torn destination file.
  it('uses atomic writes — a renameSync crash leaves no torn file at the destination', () => {
    fs.writeFileSync(path.join(srcDir, 'crash.md'), 'imported body', 'utf-8');

    const dstFull = path.join(dstDir, 'crash.md');
    const realRenameSync = fs.renameSync.bind(fs);
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (to === dstFull) throw new Error('simulated crash before rename');
      return realRenameSync(from, to);
    });

    try {
      const manifest = defaultManifest(dstDir);
      const result = importObsidianVault(srcDir, dstDir, manifest);

      expect(result.imported).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('simulated crash before rename');

      // No torn file at the destination — original (absent) state preserved.
      expect(fs.existsSync(dstFull)).toBe(false);
      // No tmp leftovers in the destination directory.
      const leftovers = fs.readdirSync(dstDir).filter((f) => f.includes('.tmp'));
      expect(leftovers).toHaveLength(0);
    } finally {
      renameSpy.mockRestore();
    }
  });
});

describe('Vault file size cap', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sizecap-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('readVaultFile throws VaultFileTooLargeError when file exceeds MAX_VAULT_FILE_BYTES', () => {
    const filePath = 'oversized.md';
    const fullPath = path.join(tmpDir, filePath);
    // Write a file whose on-disk size is 1 byte over the limit
    const oversizeBytes = MAX_VAULT_FILE_BYTES + 1;
    const fd = fs.openSync(fullPath, 'w');
    // Use ftruncate to create a sparse file — fast and avoids allocating real GB
    fs.ftruncateSync(fd, oversizeBytes);
    fs.closeSync(fd);

    expect(() => readVaultFile(tmpDir, filePath)).toThrow(VaultFileTooLargeError);
    expect(() => readVaultFile(tmpDir, filePath)).toThrow(/exceeds the/);
  });

  it('readVaultFile succeeds for a file exactly at MAX_VAULT_FILE_BYTES', () => {
    const filePath = 'at-limit.md';
    const fullPath = path.join(tmpDir, filePath);
    const fd = fs.openSync(fullPath, 'w');
    fs.ftruncateSync(fd, MAX_VAULT_FILE_BYTES);
    fs.closeSync(fd);

    // Should not throw — null bytes in a utf-8 file are valid
    expect(() => readVaultFile(tmpDir, filePath)).not.toThrow();
  });

  it('writeVaultFileAtomic throws VaultFileTooLargeError when content exceeds MAX_VAULT_FILE_BYTES', () => {
    // Build a string whose UTF-8 encoding is 1 byte over the limit (pure ASCII = 1 byte each)
    const oversize = 'x'.repeat(MAX_VAULT_FILE_BYTES + 1);
    expect(() => writeVaultFileAtomic(tmpDir, 'too-big.md', oversize)).toThrow(VaultFileTooLargeError);
    expect(() => writeVaultFileAtomic(tmpDir, 'too-big.md', oversize)).toThrow(/exceeds the/);
    // No temp file should have been created
    const files = fs.readdirSync(tmpDir);
    expect(files.filter((f) => f.includes('.tmp'))).toHaveLength(0);
  });

  it('writeVaultFileAtomic succeeds for content exactly at MAX_VAULT_FILE_BYTES', () => {
    const atLimit = 'x'.repeat(MAX_VAULT_FILE_BYTES);
    expect(() => writeVaultFileAtomic(tmpDir, 'at-limit.md', atLimit)).not.toThrow();
    expect(fs.statSync(path.join(tmpDir, 'at-limit.md')).size).toBe(MAX_VAULT_FILE_BYTES);
  });

  it('VaultFileTooLargeError carries sizeBytes and limitBytes', () => {
    const oversize = 'x'.repeat(MAX_VAULT_FILE_BYTES + 100);
    let caught: VaultFileTooLargeError | null = null;
    try {
      writeVaultFileAtomic(tmpDir, 'err-props.md', oversize);
    } catch (e) {
      if (e instanceof VaultFileTooLargeError) caught = e;
    }
    expect(caught).not.toBeNull();
    expect(caught!.sizeBytes).toBe(MAX_VAULT_FILE_BYTES + 100);
    expect(caught!.limitBytes).toBe(MAX_VAULT_FILE_BYTES);
    expect(caught!.name).toBe('VaultFileTooLargeError');
  });
});

// ─── Symlink sandbox escape (MYT-361) ───

describe('realSafePath — symlink escapes are rejected', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-symlink-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('realSafePath rejects a symlink pointing outside the vault', () => {
    const escapeTarget = os.tmpdir();
    fs.symlinkSync(escapeTarget, path.join(tmpDir, 'escape'));
    expect(() => realSafePath(tmpDir, 'escape')).toThrow(/symlink escape detected/);
  });

  it('realSafePath rejects a symlink-to-file pointing outside', () => {
    const targetFile = path.join(os.tmpdir(), 'outside-file.txt');
    fs.writeFileSync(targetFile, 'sensitive data');
    fs.symlinkSync(targetFile, path.join(tmpDir, 'escape-file.txt'));
    expect(() => realSafePath(tmpDir, 'escape-file.txt')).toThrow(/symlink escape detected/);
  });

  it('realSafePath allows a symlink pointing inside the vault', () => {
    const innerTarget = path.join(tmpDir, 'inner.md');
    fs.writeFileSync(innerTarget, 'content');
    fs.symlinkSync(innerTarget, path.join(tmpDir, 'inner-link.md'));
    expect(() => realSafePath(tmpDir, 'inner-link.md')).not.toThrow();
  });

  it('readVaultFile rejects a symlink escape', () => {
    const targetFile = path.join(os.tmpdir(), 'outside-file.txt');
    fs.writeFileSync(targetFile, 'sensitive data');
    fs.symlinkSync(targetFile, path.join(tmpDir, 'escape.txt'));
    expect(() => readVaultFile(tmpDir, 'escape.txt')).toThrow(/symlink escape detected/);
  });

  it('writeVaultFileAtomic rejects a symlink escape', () => {
    const targetFile = path.join(os.tmpdir(), 'outside-file.txt');
    fs.writeFileSync(targetFile, 'sensitive data');
    fs.symlinkSync(targetFile, path.join(tmpDir, 'escape.txt'));
    expect(() => writeVaultFileAtomic(tmpDir, 'escape.txt', 'content')).toThrow(/symlink escape detected/);
  });

  it('deleteVaultFile rejects a symlink escape', () => {
    const targetFile = path.join(os.tmpdir(), 'outside-file.txt');
    fs.writeFileSync(targetFile, 'sensitive data');
    fs.symlinkSync(targetFile, path.join(tmpDir, 'escape.txt'));
    expect(() => deleteVaultFile(tmpDir, 'escape.txt')).toThrow(/symlink escape detected/);
  });

  it('listVaultFiles skips symlink entries', () => {
    fs.writeFileSync(path.join(tmpDir, 'real.md'), 'content');
    const targetFile = path.join(os.tmpdir(), 'outside-file.txt');
    fs.writeFileSync(targetFile, 'sensitive data');
    fs.symlinkSync(targetFile, path.join(tmpDir, 'escape.txt'));
    const result = listVaultFiles(tmpDir);
    const names = result.items.map((i) => i.name);
    expect(names).toContain('real.md');
    expect(names).not.toContain('escape.txt');
  });

  it('realSafePath rejects a parent-directory symlink escape (new file write)', () => {
    const escapeDir = os.tmpdir();
    fs.symlinkSync(escapeDir, path.join(tmpDir, 'escape-dir'));
    expect(() => realSafePath(tmpDir, 'escape-dir/new-file.md')).toThrow(/parent symlink escape detected/);
  });
});

describe('realSafePath — traversal & absolute-path hardening (MYT-672 / MYT-641)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-traversal-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── MYT-641 Case-3: leaf AND parent don't exist yet ──
  // A fresh vault writing its first deeply nested scene exercises the "parent
  // doesn't exist" branch. On macOS tmpDir resolves through a symlink
  // (/var → /private/var); regression guard for the realSafePath fix landed in
  // da24bfe (lexical check vs un-realpath'd root) so nested writes are allowed
  // while traversal is still denied on that same branch.
  it('allows a nested write when no parent directories exist yet', () => {
    const nestedPath = 'Manuscript/my-story/chapter-one/scene-1.md';
    expect(() => realSafePath(tmpDir, nestedPath)).not.toThrow();
    expect(realSafePath(tmpDir, nestedPath)).toContain('scene-1.md');
  });

  it('still rejects "../" traversal when no parent exists', () => {
    expect(() => realSafePath(tmpDir, '../../../etc/shadow')).toThrow(/Path traversal denied/);
  });

  it('rejects a "../" escape whose parent DOES exist (lands on existing-parent branch)', () => {
    fs.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true });
    expect(() => realSafePath(tmpDir, 'sub/../../escape.md')).toThrow(/Path traversal denied/);
  });

  // ── Absolute paths: path.resolve(root, '/abs') === '/abs', escaping the vault ──
  it('rejects an absolute path that escapes the vault', () => {
    expect(() => realSafePath(tmpDir, '/etc/passwd')).toThrow(/Path traversal denied/);
  });

  // ── Whole-channel coverage: read / write / delete reject both vectors ──
  it('readVaultFile rejects an absolute path', () => {
    expect(() => readVaultFile(tmpDir, '/etc/passwd')).toThrow(/Path traversal denied/);
  });

  it('writeVaultFileAtomic rejects a "../" traversal', () => {
    expect(() => writeVaultFileAtomic(tmpDir, '../escape.md', 'x')).toThrow(/Path traversal denied/);
  });

  it('writeVaultFileAtomic rejects an absolute path', () => {
    expect(() => writeVaultFileAtomic(tmpDir, '/tmp/escape.md', 'x')).toThrow(/Path traversal denied/);
  });

  it('deleteVaultFile rejects a "../" traversal', () => {
    expect(() => deleteVaultFile(tmpDir, '../../etc/passwd')).toThrow(/Path traversal denied/);
  });

  it('deleteVaultFile rejects an absolute path', () => {
    expect(() => deleteVaultFile(tmpDir, '/etc/passwd')).toThrow(/Path traversal denied/);
  });
});

describe('startVaultWatcher — symlink containment (MYT-362)', () => {
  let vaultDir: string;
  let outsideDir: string;

  beforeEach(() => {
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-watcher-vault-'));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-watcher-outside-'));
  });

  afterEach(async () => {
    await stopVaultWatcher();
    fs.rmSync(vaultDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it('does not emit events for files under a symlinked directory inside the vault', async () => {
    // Plant a symlink inside the vault pointing to an external directory.
    fs.symlinkSync(outsideDir, path.join(vaultDir, 'external'));
    // Seed a real file inside the vault so we can prove the watcher is otherwise alive.
    const insideFile = path.join(vaultDir, 'inside.md');
    fs.writeFileSync(insideFile, 'baseline');

    const events: string[] = [];
    await startVaultWatcher(vaultDir, (p) => events.push(p));

    // Allow chokidar to complete its initial scan before mutating files.
    await new Promise((r) => setTimeout(r, 400));

    // Drop a file under the symlinked target (outside the vault).
    fs.writeFileSync(path.join(outsideDir, 'leak.md'), 'secret');
    // Modify the inside file as a positive-control signal.
    fs.writeFileSync(insideFile, 'updated content');

    // Wait past awaitWriteFinish (300ms) + slack for any straggling emissions.
    await new Promise((r) => setTimeout(r, 1500));

    const realOutsideDir = fs.realpathSync.native(outsideDir);
    const externalEvents = events.filter(
      (p) => p.includes('leak.md') || p.startsWith(outsideDir) || p.startsWith(realOutsideDir),
    );
    expect(externalEvents).toEqual([]);

    const insideEvents = events.filter((p) => p.endsWith('inside.md'));
    expect(insideEvents.length).toBeGreaterThan(0);
  }, 10_000);
});

describe('startVaultWatcher — symlink containment (MYT-445 / MYT-362)', () => {
  let vaultDir: string;
  let outsideDir: string;

  beforeEach(() => {
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-watcher-vault-'));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-watcher-outside-'));
  });

  afterEach(async () => {
    await stopVaultWatcher();
    fs.rmSync(vaultDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it('does not emit events for files under a symlinked directory inside the vault', async () => {
    // Plant a symlink inside the vault pointing to an external directory.
    fs.symlinkSync(outsideDir, path.join(vaultDir, 'external'));
    // Seed a real file inside the vault so we can prove the watcher is otherwise alive.
    const insideFile = path.join(vaultDir, 'inside.md');
    fs.writeFileSync(insideFile, 'baseline');

    const events: string[] = [];
    await startVaultWatcher(vaultDir, (p) => events.push(p));

    // Allow chokidar to complete its initial scan before mutating files.
    await new Promise((r) => setTimeout(r, 400));

    // Drop a file under the symlinked target (outside the vault).
    fs.writeFileSync(path.join(outsideDir, 'leak.md'), 'secret');
    // Modify the inside file as a positive-control signal.
    fs.writeFileSync(insideFile, 'updated content');

    // Wait past awaitWriteFinish (300ms) + slack for any straggling emissions.
    await new Promise((r) => setTimeout(r, 1500));

    const realOutsideDir = fs.realpathSync.native(outsideDir);
    const externalEvents = events.filter(
      (p) => p.includes('leak.md') || p.startsWith(outsideDir) || p.startsWith(realOutsideDir),
    );
    expect(externalEvents).toEqual([]);

    const insideEvents = events.filter((p) => p.endsWith('inside.md'));
    expect(insideEvents.length).toBeGreaterThan(0);
  }, 10_000);
});

describe('startVaultWatcher — symlink containment (MYT-445 / MYT-362)', () => {
  let vaultDir: string;
  let outsideDir: string;

  beforeEach(() => {
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-watcher-vault-'));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-watcher-outside-'));
  });

  afterEach(async () => {
    await stopVaultWatcher();
    fs.rmSync(vaultDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it('does not emit events for files under a symlinked directory inside the vault', async () => {
    // Plant a symlink inside the vault pointing to an external directory.
    fs.symlinkSync(outsideDir, path.join(vaultDir, 'external'));
    // Seed a real file inside the vault so we can prove the watcher is otherwise alive.
    const insideFile = path.join(vaultDir, 'inside.md');
    fs.writeFileSync(insideFile, 'baseline');

    const events: string[] = [];
    await startVaultWatcher(vaultDir, (p) => events.push(p));

    // Allow chokidar to complete its initial scan before mutating files.
    await new Promise((r) => setTimeout(r, 400));

    // Drop a file under the symlinked target (outside the vault).
    fs.writeFileSync(path.join(outsideDir, 'leak.md'), 'secret');
    // Modify the inside file as a positive-control signal.
    fs.writeFileSync(insideFile, 'updated content');

    // Wait past awaitWriteFinish (300ms) + slack for any straggling emissions.
    await new Promise((r) => setTimeout(r, 1500));

    const realOutsideDir = fs.realpathSync.native(outsideDir);
    const externalEvents = events.filter(
      (p) => p.includes('leak.md') || p.startsWith(outsideDir) || p.startsWith(realOutsideDir),
    );
    expect(externalEvents).toEqual([]);

    const insideEvents = events.filter((p) => p.endsWith('inside.md'));
    expect(insideEvents.length).toBeGreaterThan(0);
  }, 10_000);
});

// ─── obsidianDryRun ───

describe('obsidianDryRun', () => {
  let srcDir: string;

  beforeEach(() => {
    srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-dry-'));
  });

  afterEach(() => {
    fs.rmSync(srcDir, { recursive: true, force: true });
  });

  it('returns fatalError when source path does not exist', () => {
    const result = obsidianDryRun('/nonexistent-path-xyz-does-not-exist', null);
    expect(result.fatalError).toMatch(/does not exist/);
    expect(result.notesCount).toBe(0);
  });

  it('reports notesCount for all .md files', () => {
    fs.writeFileSync(path.join(srcDir, 'a.md'), '# A', 'utf-8');
    fs.writeFileSync(path.join(srcDir, 'b.md'), '# B', 'utf-8');
    const result = obsidianDryRun(srcDir, null);
    expect(result.notesCount).toBe(2);
    expect(result.fatalError).toBeNull();
  });

  it('detects broken wiki-links', () => {
    fs.writeFileSync(path.join(srcDir, 'note.md'), '[[NoSuchFile]]', 'utf-8');
    const result = obsidianDryRun(srcDir, null);
    expect(result.brokenLinks).toHaveLength(1);
    expect(result.brokenLinks[0].target).toBe('[[NoSuchFile]]');
    expect(result.brokenLinks[0].file).toBe('note.md');
  });

  it('does not report broken link when target exists', () => {
    fs.writeFileSync(path.join(srcDir, 'source.md'), '[[target]]', 'utf-8');
    fs.writeFileSync(path.join(srcDir, 'target.md'), '# Target', 'utf-8');
    const result = obsidianDryRun(srcDir, null);
    expect(result.brokenLinks).toHaveLength(0);
  });

  it('detects name collisions with existing manifest entities', () => {
    fs.writeFileSync(path.join(srcDir, 'Hero.md'), '# Hero', 'utf-8');
    const manifest = defaultManifest('/tmp');
    manifest.entities.push({
      id: 'e1',
      name: 'Hero',
      type: 'character',
      path: 'Characters/Hero.md',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const result = obsidianDryRun(srcDir, manifest);
    expect(result.nameCollisions).toHaveLength(1);
    expect(result.nameCollisions[0].name).toBe('Hero');
  });

  it('detects missing frontmatter', () => {
    fs.writeFileSync(path.join(srcDir, 'plain.md'), 'No frontmatter.', 'utf-8');
    const result = obsidianDryRun(srcDir, null);
    expect(result.missingFrontmatter).toContain('plain.md');
  });

  it('does not flag missing frontmatter when --- is present', () => {
    fs.writeFileSync(path.join(srcDir, 'with-fm.md'), '---\ntitle: X\n---\nProse.', 'utf-8');
    const result = obsidianDryRun(srcDir, null);
    expect(result.missingFrontmatter).toHaveLength(0);
  });

  it('returns empty collections and no error for a clean vault', () => {
    fs.writeFileSync(path.join(srcDir, 'clean.md'), '---\ntitle: Clean\n---\nNo issues.', 'utf-8');
    const result = obsidianDryRun(srcDir, null);
    expect(result.brokenLinks).toHaveLength(0);
    expect(result.nameCollisions).toHaveLength(0);
    expect(result.missingFrontmatter).toHaveLength(0);
    expect(result.fatalError).toBeNull();
  });

  it('ignores symlinked files during dry run', () => {
    fs.writeFileSync(path.join(srcDir, 'real.md'), '# Real', 'utf-8');
    fs.symlinkSync('/etc/hostname', path.join(srcDir, 'link.md'));
    const result = obsidianDryRun(srcDir, null);
    expect(result.notesCount).toBe(1);
  });
});

// ─── mergeProvenanceFrontmatter ───

describe('mergeProvenanceFrontmatter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-prov-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes provenance into a new file', () => {
    mergeProvenanceFrontmatter(tmpDir, 'scene.md', {
      source_agent: 'archive',
      confidence: 0.9,
      rationale: 'Inferred from context',
      timestamp: '2024-01-01T00:00:00.000Z',
    }, 'Updated prose.');
    const raw = fs.readFileSync(path.join(tmpDir, 'scene.md'), 'utf-8');
    expect(raw).toContain('provenance_source_agent: archive');
    expect(raw).toContain('provenance_confidence: 0.9');
    expect(raw).toContain('Updated prose.');
  });

  it('merges provenance into an existing file preserving other frontmatter keys', () => {
    fs.writeFileSync(path.join(tmpDir, 'scene.md'), '---\ntitle: My Scene\nid: s1\n---\nOriginal.', 'utf-8');
    mergeProvenanceFrontmatter(tmpDir, 'scene.md', {
      source_agent: 'brainstorm',
      confidence: 0.75,
      rationale: 'Creative suggestion',
      timestamp: '2024-06-01T00:00:00.000Z',
      run_id: 'run-abc',
      suggestion_id: 'sug-123',
    }, 'New prose.');
    const raw = fs.readFileSync(path.join(tmpDir, 'scene.md'), 'utf-8');
    const { frontmatter, prose } = parseFrontmatter(raw);
    expect(frontmatter.title).toBe('My Scene');
    expect(frontmatter.id).toBe('s1');
    expect(frontmatter.provenance_source_agent).toBe('brainstorm');
    expect(frontmatter.provenance_run_id).toBe('run-abc');
    expect(frontmatter.provenance_suggestion_id).toBe('sug-123');
    expect(prose).toBe('New prose.');
  });

  it('overwrites existing provenance fields on re-apply', () => {
    mergeProvenanceFrontmatter(tmpDir, 'scene.md', {
      source_agent: 'v1',
      confidence: 0.5,
      rationale: 'first',
      timestamp: '2024-01-01T00:00:00.000Z',
    }, 'prose v1');
    mergeProvenanceFrontmatter(tmpDir, 'scene.md', {
      source_agent: 'v2',
      confidence: 0.99,
      rationale: 'second',
      timestamp: '2024-06-01T00:00:00.000Z',
    }, 'prose v2');
    const raw = fs.readFileSync(path.join(tmpDir, 'scene.md'), 'utf-8');
    const { frontmatter, prose } = parseFrontmatter(raw);
    expect(frontmatter.provenance_source_agent).toBe('v2');
    expect(frontmatter.provenance_confidence).toBe(0.99);
    expect(prose).toBe('prose v2');
  });
});

// ─── scaffoldNotesVault ───

describe('scaffoldNotesVault', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-scaffold-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the standard Notes Vault directory structure', () => {
    scaffoldNotesVault(tmpDir);
    for (const dir of ['Characters', 'Locations', 'Items', 'Concepts', 'Notes']) {
      expect(fs.existsSync(path.join(tmpDir, dir))).toBe(true);
      expect(fs.statSync(path.join(tmpDir, dir)).isDirectory()).toBe(true);
    }
  });

  it('is idempotent — running twice does not throw', () => {
    scaffoldNotesVault(tmpDir);
    expect(() => scaffoldNotesVault(tmpDir)).not.toThrow();
  });
});

// ─── writeSceneFileAtomic ───

describe('writeSceneFileAtomic', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-scene-atomic-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes scene with frontmatter and round-trips via readSceneFile', () => {
    writeSceneFileAtomic(tmpDir, 'atomic.md', {
      id: 'scene-atomic-1',
      title: 'Atomic Scene',
      order: 0,
      tags: ['test'],
      prose: 'Atomic prose.',
    });
    const read = readSceneFile(tmpDir, 'atomic.md');
    expect(read.id).toBe('scene-atomic-1');
    expect(read.title).toBe('Atomic Scene');
    expect(read.tags).toEqual(['test']);
    expect(read.prose).toBe('Atomic prose.');
  });

  it('leaves no tmp files on success', () => {
    writeSceneFileAtomic(tmpDir, 'clean.md', {
      id: 's1',
      title: 'Clean',
      prose: 'body',
    });
    const leftovers = fs.readdirSync(tmpDir).filter((f) => f.includes('.tmp'));
    expect(leftovers).toHaveLength(0);
  });
});

// ─── readManifest / writeManifest round-trip ───

describe('readManifest / writeManifest', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-manifest-rw-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trips a manifest through writeManifest and readManifest', () => {
    const manifestPath = path.join(tmpDir, 'mythos.json');
    const original = defaultManifest(tmpDir);
    original.stories.push({
      id: 'story-1',
      title: 'My Story',
      path: 'Manuscript/my-story',
      chapters: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    writeManifest(manifestPath, original);
    const loaded = readManifest(manifestPath);
    expect(loaded.stories).toHaveLength(1);
    expect(loaded.stories[0].id).toBe('story-1');
    expect(loaded.schemaVersion).toBe(original.schemaVersion);
  });
});
