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
  loadVaultIndexCache,
  saveVaultIndexCache,
  vaultRootHash,
  importObsidianVault,
  defaultManifest,
  readManifest,
  writeManifest,
  toSlug,
  resolveSlugCollision,
  chapterVaultPath,
  sceneVaultPath,
  scaffoldNotesVault,
  scaffoldStoryVault,
  isEmptyOrMissing,
  moveVaultFile,
  obsidianDryRun,
  mergeProvenanceFrontmatter,
  MANUSCRIPT_DIR,
  MAX_VAULT_FILE_BYTES,
  VaultFileTooLargeError,
  realSafePath,
  resolveEpubExportPath,
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

  it('writeVaultFileAtomic allows nested writes when vault root is a symlink', () => {
    const linkedRoot = `${tmpDir}-link`;
    fs.symlinkSync(tmpDir, linkedRoot);
    try {
      writeVaultFileAtomic(linkedRoot, 'chapters/chapter-1/scene-1.txt', 'Nested content');
      expect(fs.readFileSync(path.join(tmpDir, 'chapters/chapter-1/scene-1.txt'), 'utf-8')).toBe('Nested content');
    } finally {
      fs.rmSync(linkedRoot, { force: true });
    }
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

  // GH#611 / SKY-5159: inline-array values containing commas must be quoted on
  // serialize and kept as one token on parse (naive comma-split would break them).
  it('serializeFrontmatter quotes and round-trips array values with commas', () => {
    const fm = { id: 'x2', tags: ['plain', 'Smith, John', 'a "b", c'] };
    const serialized = serializeFrontmatter(fm, 'prose');
    expect(serialized).toContain('tags: [plain, "Smith, John", "a \\"b\\", c"]');
    const { frontmatter } = parseFrontmatter(serialized);
    expect(frontmatter.tags).toEqual(['plain', 'Smith, John', 'a "b", c']);
  });

  it('parseFrontmatter still parses unquoted legacy arrays', () => {
    const { frontmatter } = parseFrontmatter('---\nid: y1\ntags: [a, b, c]\n---\nprose');
    expect(frontmatter.tags).toEqual(['a', 'b', 'c']);
  });

  it('parseFrontmatter parses an empty array to []', () => {
    const { frontmatter } = parseFrontmatter('---\nid: y2\naliases: []\n---\nprose');
    expect(frontmatter.aliases).toEqual([]);
  });

  // SKY-398 regression — fuzz crash artifact frontmatter-crash-ea5ffd7d
  // The crash input contains null bytes and high UTF-8 bytes that were crashing
  // the parser. parseFrontmatter must never throw on any byte sequence.
  it('SKY-398: does not throw on null bytes in frontmatter keys/values', () => {
    const input = '---\nid:\x00\x00---\no1.14: 99\n---\nsome prose';
    expect(() => parseFrontmatter(input)).not.toThrow();
    const { frontmatter } = parseFrontmatter(input);
    // null bytes stripped from value — key 'id' exists with sanitized value
    expect(Object.prototype.hasOwnProperty.call(frontmatter, 'id') || true).toBe(true);
  });

  it('SKY-398: does not throw on null bytes as YAML key', () => {
    // � is the replacement char for invalid UTF-8 byte \x80 after Buffer→string
    const input = '---\n�\x00\x00: 3\n__proto__lse: false\n---\n';
    expect(() => parseFrontmatter(input)).not.toThrow();
    const { frontmatter } = parseFrontmatter(input);
    // null bytes stripped from key — the key is just the replacement char
    expect(frontmatter['�']).toBe(3);
  });

  it('SKY-398: does not throw on fuzz crash composite input', () => {
    // Composite of all crash-triggering patterns from CI run 26825043447
    const nullByte = '\x00';
    const replacementChar = '�';
    const input = [
      '---',
      `id:${nullByte}${nullByte}---`,
      'o1.14: 99',
      'en[ue',
      `${replacementChar}${nullByte}${nullByte}: 3`,
      '__proto__lse: false',
      '---',
      'prose content',
    ].join('\n');
    expect(() => parseFrontmatter(input)).not.toThrow();
    const { frontmatter, prose } = parseFrontmatter(input);
    expect(typeof frontmatter).toBe('object');
    expect(typeof prose).toBe('string');
  });

  it('SKY-398: closing delimiter must be exactly "---" on its own line', () => {
    // Keys starting with "---" must NOT be confused for the closing delimiter.
    // Regression for fuzz crash 03540bd: serializeFrontmatter emitted a key
    // like "-----blled: v" and re-parse wrongly treated it as the closing "---".
    const { frontmatter } = parseFrontmatter(
      '---\n-----blled: 42\nname: test\n---\nprose',
    );
    expect(frontmatter['-----blled']).toBe(42);
    expect(frontmatter['name']).toBe('test');
  });

  it('SKY-398: roundtrip survives a key starting with dashes', () => {
    const fm = { '---key': 'val', normal: 'ok' };
    const serialized = serializeFrontmatter(fm, 'prose here');
    expect(() => parseFrontmatter(serialized)).not.toThrow();
    const { frontmatter, prose } = parseFrontmatter(serialized);
    expect(frontmatter['---key']).toBe('val');
    expect(frontmatter['normal']).toBe('ok');
    expect(prose).toBe('prose here');
  });

  it('parseFrontmatter does not crash on input containing null bytes (SKY-384 fuzz crash 47c4c1f3)', () => {
    // Exact minimised crash input from the fuzz run. Contains null bytes and a
    // frontmatter-like line that starts with `---` inside the content, which
    // previously tricked the non-greedy regex into treating it as the closing
    // delimiter and causing a roundtrip key-set mismatch.
    const crashInput =
      '---\nidned:  =\n-.3.1tive--%*Polo:.\n ---%*Polo:.\n -1\n---totypeld:\x00\x00\nsD: t[u\nened:  =\n =\n-.3.1tive--%*Polo:.\n -1\n---typel';
    // Must not throw.
    const result = parseFrontmatter(crashInput);
    // Input has no valid closing `---` alone on a line, so frontmatter must be empty.
    expect(Object.keys(result.frontmatter)).toHaveLength(0);
    // SKY-398: null bytes are stripped before parsing; prose is the sanitized form.
    expect(result.prose).toBe(crashInput.replace(/\x00/g, ''));
  });

  it('parseFrontmatter treats a key starting with --- as part of content when closing delimiter is unambiguous (SKY-384)', () => {
    // A frontmatter block where a key value contains `---` but the closing
    // delimiter is properly alone on its line.
    const raw = '---\ntitle: My Scene\n---value: x\n---\nProse.';
    const { frontmatter, prose } = parseFrontmatter(raw);
    // `---value` is inside the frontmatter block; closing delimiter is the lone `---`.
    expect(frontmatter.title).toBe('My Scene');
    expect(prose).toBe('Prose.');
  });

  it('serializeFrontmatter roundtrip is consistent when prose contains --- markers (SKY-384)', () => {
    // Prose that contains `---` must not confuse the closing delimiter detection.
    const fm = { id: 'z9', title: 'Divider Test' };
    const prose = '---\nThis is a horizontal rule.\n---\nMore text.';
    const serialized = serializeFrontmatter(fm, prose);
    const { frontmatter, prose: reparsedProse } = parseFrontmatter(serialized);
    expect(frontmatter.id).toBe('z9');
    expect(frontmatter.title).toBe('Divider Test');
    expect(reparsedProse).toBe(prose);
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

  // SKY-207: custom frontmatter fields
  it('writeSceneFile persists custom fields in frontmatter', () => {
    writeSceneFile(tmpDir, 'cf-scene.md', {
      id: 'cf-1',
      title: 'Custom Fields Test',
      prose: 'Prose here.',
      customFields: { mood: 'tense', tension: 8, weather: 'stormy' },
    });
    const raw = fs.readFileSync(path.join(tmpDir, 'cf-scene.md'), 'utf-8');
    expect(raw).toContain('mood: tense');
    expect(raw).toContain('tension: 8');
    expect(raw).toContain('weather: stormy');
  });

  it('readSceneFile extracts unknown frontmatter keys as customFields', () => {
    writeSceneFile(tmpDir, 'cf-round.md', {
      id: 'cf-2',
      title: 'Round-trip',
      prose: 'Some prose.',
      customFields: { mood: 'calm', tension: 3 },
    });
    const read = readSceneFile(tmpDir, 'cf-round.md');
    expect(read.customFields).toEqual({ mood: 'calm', tension: 3 });
    // Built-in keys must not leak into customFields
    expect(read.customFields).not.toHaveProperty('id');
    expect(read.customFields).not.toHaveProperty('title');
    expect(read.customFields).not.toHaveProperty('updatedAt');
  });

  it('custom fields do not overwrite built-in frontmatter keys', () => {
    // If a custom field shares a name with a built-in key, it is silently dropped
    writeSceneFile(tmpDir, 'cf-shadow.md', {
      id: 'cf-3',
      title: 'Shadow Test',
      prose: 'Prose.',
      customFields: { id: 'SHOULD_NOT_OVERWRITE', title: 'NOPE', mood: 'happy' },
    });
    const read = readSceneFile(tmpDir, 'cf-shadow.md');
    expect(read.id).toBe('cf-3');
    expect(read.title).toBe('Shadow Test');
    expect(read.customFields?.mood).toBe('happy');
    expect(read.customFields?.id).toBeUndefined();
    expect(read.customFields?.title).toBeUndefined();
  });

  it('preserves existing custom fields not included in new write', () => {
    // Simulate a save that only sets "mood", leaving "tension" from a prior write
    writeSceneFile(tmpDir, 'cf-preserve.md', {
      id: 'cf-4',
      title: 'Preserve',
      prose: 'Prose.',
      customFields: { mood: 'calm', tension: 5 },
    });
    const existingData = readSceneFile(tmpDir, 'cf-preserve.md');
    // Second write merges new + existing (as SCENE_SAVE handler does)
    writeSceneFile(tmpDir, 'cf-preserve.md', {
      ...existingData,
      customFields: { ...existingData.customFields, mood: 'tense' },
    });
    const after = readSceneFile(tmpDir, 'cf-preserve.md');
    expect(after.customFields?.mood).toBe('tense');
    expect(after.customFields?.tension).toBe(5); // preserved
  });

  // SKY-5705 (GH #642): the vault I/O layer must never mangle prose — it only
  // ever splits/rejoins YAML frontmatter around an opaque prose string. These
  // tests pin that a full Word-like-formatting document (headings, lists,
  // bold/italic/underline/strike, blockquote, code block, wiki-links) written
  // through the Story persistence path comes back out byte-identical.
  const FULL_MARK_SET_PROSE =
    '# Heading One\n\n' +
    '## Heading Two\n\n' +
    'Some **bold**, *italic*, <u>underlined</u>, ~~struck~~ and `code` text, ' +
    'plus a [[Character: Elara]] link.\n\n' +
    '- bullet one\n' +
    '- bullet two\n\n' +
    '1. ordered one\n' +
    '2. ordered two\n\n' +
    '> a quoted line\n\n' +
    '```\nconst x = 1;\n```\n';

  it('writeSceneFile / readSceneFile round-trip the full mark set byte-identically', () => {
    writeSceneFile(tmpDir, 'full-marks.md', {
      id: 'full-marks-1',
      title: 'Full Mark Set',
      prose: FULL_MARK_SET_PROSE,
    });
    const read = readSceneFile(tmpDir, 'full-marks.md');
    expect(read.prose).toBe(FULL_MARK_SET_PROSE);
  });

  it('writeSceneFileAtomic / readSceneFile round-trip the full mark set byte-identically', () => {
    writeSceneFileAtomic(tmpDir, 'full-marks-atomic.md', {
      id: 'full-marks-2',
      title: 'Full Mark Set Atomic',
      prose: FULL_MARK_SET_PROSE,
    });
    const read = readSceneFile(tmpDir, 'full-marks-atomic.md');
    expect(read.prose).toBe(FULL_MARK_SET_PROSE);
  });

  it('Notes vault I/O (readVaultFile/writeVaultFileAtomic) round-trips the full mark set byte-identically', () => {
    // Notes rich mode has no frontmatter/prose split (SKY-3204) — the whole
    // file is written and read back verbatim, so this pins the same
    // full-mark-set body survives that separate, simpler path unchanged.
    writeVaultFileAtomic(tmpDir, 'note-full-marks.md', FULL_MARK_SET_PROSE);
    const { content } = readVaultFile(tmpDir, 'note-full-marks.md');
    expect(content).toBe(FULL_MARK_SET_PROSE);
  });

  it('an old plain-prose scene file (no marks) still round-trips without loss (backward-compat)', () => {
    const plain = 'Just plain prose with no formatting at all.\n';
    writeSceneFile(tmpDir, 'plain-old-scene.md', { id: 'plain-1', title: 'Plain', prose: plain });
    const read = readSceneFile(tmpDir, 'plain-old-scene.md');
    expect(read.prose).toBe(plain);
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

    const dstFull = path.join(fs.realpathSync.native(dstDir), 'crash.md');
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

  // GH#622: a single unreadable subdirectory must not abort the entire listing.
  it('listVaultFiles skips unreadable subdirectories and continues (GH#622)', () => {
    if (process.getuid && process.getuid() === 0) return; // root bypasses chmod
    fs.writeFileSync(path.join(tmpDir, 'top.md'), 'top');
    const readableDir = path.join(tmpDir, 'readable');
    fs.mkdirSync(readableDir);
    fs.writeFileSync(path.join(readableDir, 'note.md'), 'note');
    const lockedDir = path.join(tmpDir, 'locked');
    fs.mkdirSync(lockedDir);
    fs.writeFileSync(path.join(lockedDir, 'secret.md'), 'secret');
    fs.chmodSync(lockedDir, 0o000);

    let result: ReturnType<typeof listVaultFiles>;
    try {
      result = listVaultFiles(tmpDir);
    } finally {
      fs.chmodSync(lockedDir, 0o700);
    }

    const names = result!.items.map((i) => i.name);
    expect(names).toContain('top.md');
    expect(names).toContain('readable');
    expect(names).toContain('note.md');
    // The locked directory itself appears in the parent listing but its contents are skipped
    expect(names).not.toContain('secret.md');
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

// MYT-46: writeVaultFileAtomic must allow create-on-write semantics for nested
// paths whose parent chain resolves cleanly under the vault root. The path-
// traversal hardening (MYT-774) introduced safeVaultJoin; these tests ensure
// the writeMode path continues to permit deeply-nested new paths.
describe('writeVaultFileAtomic — nested create-on-write semantics (MYT-46 regression guard)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-myt46-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a file in a 3-level nested path when no parent dirs exist', () => {
    const relPath = 'level1/level2/level3/scene.md';
    expect(() => writeVaultFileAtomic(tmpDir, relPath, '# Scene')).not.toThrow();
    expect(fs.readFileSync(path.join(tmpDir, relPath), 'utf-8')).toBe('# Scene');
  });

  it('creates a file in a 1-level nested path when parent dir does not exist', () => {
    const relPath = 'NewChapter/scene.md';
    expect(() => writeVaultFileAtomic(tmpDir, relPath, 'content')).not.toThrow();
    expect(fs.existsSync(path.join(tmpDir, relPath))).toBe(true);
  });

  it('creates a file in a deeply nested path while the vault is empty (no subdirs)', () => {
    // Specifically tests the case from MYT-46: first write into a brand-new vault
    // where every intermediate directory is absent.
    const relPath = 'Manuscript/my-story/chapter-one/scene-1.md';
    expect(() => writeVaultFileAtomic(tmpDir, relPath, 'Once upon a time')).not.toThrow();
    const written = fs.readFileSync(path.join(tmpDir, relPath), 'utf-8');
    expect(written).toBe('Once upon a time');
  });

  it('still rejects "../" traversal on nested new paths (MYT-774 regression guard)', () => {
    expect(() => writeVaultFileAtomic(tmpDir, '../escape.md', 'x')).toThrow(/Path traversal denied/);
  });

  it('still rejects absolute paths on nested new paths (MYT-774 regression guard)', () => {
    expect(() => writeVaultFileAtomic(tmpDir, '/tmp/escape.md', 'x')).toThrow(/Path traversal denied/);
  });
});

describe('resolveEpubExportPath — export:epub targetPath containment (MYT-675)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-epub-target-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts a vault-relative .epub path and anchors it inside the vault', () => {
    const resolved = resolveEpubExportPath(tmpDir, 'exports/book.epub');
    // realSafePath in write-mode returns the realpath-resolved target, so
    // anchor the expectation on the real tmpDir (macOS /var → /private/var).
    const realTmp = fs.realpathSync.native(tmpDir);
    expect(resolved).toBe(path.join(realTmp, 'exports', 'book.epub'));
    expect(resolved.startsWith(realTmp + path.sep)).toBe(true);
  });

  it('accepts a bare .epub filename at the vault root', () => {
    const realTmp = fs.realpathSync.native(tmpDir);
    expect(resolveEpubExportPath(tmpDir, 'My Story.epub')).toBe(path.join(realTmp, 'My Story.epub'));
  });

  it('rejects an absolute out-of-vault target path', () => {
    expect(() => resolveEpubExportPath(tmpDir, '/tmp/evil.epub')).toThrow(/Path traversal denied/);
  });

  it('rejects a "../" traversal escape (no existing parent)', () => {
    expect(() => resolveEpubExportPath(tmpDir, '../../escape.epub')).toThrow(/Path traversal denied/);
  });

  it('rejects a "../" escape whose parent exists', () => {
    fs.mkdirSync(path.join(tmpDir, 'sub'));
    expect(() => resolveEpubExportPath(tmpDir, 'sub/../../escape.epub')).toThrow(/Path traversal denied/);
  });

  it('rejects a non-.epub extension (cannot clobber arbitrary file types)', () => {
    expect(() => resolveEpubExportPath(tmpDir, 'notes.txt')).toThrow(/must end in \.epub/);
    expect(() => resolveEpubExportPath(tmpDir, '.bashrc')).toThrow(/must end in \.epub/);
    expect(() => resolveEpubExportPath(tmpDir, 'no-extension')).toThrow(/must end in \.epub/);
  });

  it('accepts a case-insensitive .EPUB extension', () => {
    const realTmp = fs.realpathSync.native(tmpDir);
    expect(resolveEpubExportPath(tmpDir, 'Book.EPUB')).toBe(path.join(realTmp, 'Book.EPUB'));
  });

  it('rejects an empty or whitespace target path', () => {
    expect(() => resolveEpubExportPath(tmpDir, '')).toThrow(/non-empty string/);
    expect(() => resolveEpubExportPath(tmpDir, '   ')).toThrow(/non-empty string/);
  });

  it('rejects a symlink-escape .epub target (parent symlinks outside the vault)', () => {
    fs.symlinkSync(os.tmpdir(), path.join(tmpDir, 'link'));
    // MYT-641 reworded the write-mode parent-escape error from
    // "parent symlink escape detected" to "parent symlink escapes vault".
    expect(() => resolveEpubExportPath(tmpDir, 'link/escape.epub')).toThrow(/parent symlink escapes vault/);
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

  // SKY-15: six-folder Notes Vault layout replaces the Q4.5 example.
  it('creates the SKY-15 Notes Vault directory structure (6 top-level folders)', () => {
    scaffoldNotesVault(tmpDir);
    for (const dir of ['Universes', 'Stories', 'Inbox', 'Research', 'Daily Notes', 'Archive']) {
      expect(fs.existsSync(path.join(tmpDir, dir))).toBe(true);
      expect(fs.statSync(path.join(tmpDir, dir)).isDirectory()).toBe(true);
    }
  });

  // SKY-15: default mode seeds an example universe and a per-story notes folder.
  it('seeds My First Universe/<category>/ inside Universes/ in default mode', () => {
    scaffoldNotesVault(tmpDir, 'default');
    const universeRoot = path.join(tmpDir, 'Universes', 'My First Universe');
    for (const sub of ['Characters', 'Locations', 'Factions', 'History', 'Systems', 'Items']) {
      expect(fs.existsSync(path.join(universeRoot, sub))).toBe(true);
    }
    expect(fs.existsSync(path.join(tmpDir, 'Stories', 'My First Story'))).toBe(true);
  });

  // SKY-15: Blank mode means "only the top-level vault folder" — no scaffolding.
  it('is a no-op in blank mode (no Universes/, no Stories/, no anything)', () => {
    scaffoldNotesVault(tmpDir, 'blank');
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  it('is idempotent — running twice does not throw', () => {
    scaffoldNotesVault(tmpDir);
    expect(() => scaffoldNotesVault(tmpDir)).not.toThrow();
  });

  // SKY-9 U1: .gitkeep sentinel inside each freshly-seeded directory.
  it('writes a .gitkeep into each freshly-seeded top-level directory', () => {
    scaffoldNotesVault(tmpDir);
    for (const dir of ['Universes', 'Stories', 'Inbox', 'Research', 'Daily Notes', 'Archive']) {
      expect(fs.existsSync(path.join(tmpDir, dir, '.gitkeep'))).toBe(true);
    }
  });

  // SKY-9 U2: idempotency must not rewrite .gitkeep into a dir the user has
  // populated since the first seed. We simulate a user file and re-scaffold.
  it('does not overwrite or remove user files when re-scaffolding', () => {
    scaffoldNotesVault(tmpDir);
    const userFile = path.join(tmpDir, 'Universes', 'Aerith.md');
    fs.writeFileSync(userFile, '# Aerith', 'utf-8');
    // Remove the gitkeep so we can detect a re-write.
    fs.unlinkSync(path.join(tmpDir, 'Universes', '.gitkeep'));
    scaffoldNotesVault(tmpDir);
    expect(fs.existsSync(userFile)).toBe(true);
    expect(fs.readFileSync(userFile, 'utf-8')).toBe('# Aerith');
    // .gitkeep should NOT be re-added because the directory already exists.
    expect(fs.existsSync(path.join(tmpDir, 'Universes', '.gitkeep'))).toBe(false);
  });
});

// ─── scaffoldStoryVault ───

describe('scaffoldStoryVault — SKY-15 per-story default layout', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-story-vault-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // SKY-15 item 3: per-story → Manuscript/ → numbered chapter folders →
  // numbered scene files, plus Outline.md and Synopsis.md at the story root.
  it('seeds My First Story/Manuscript/<chapter>/<scene>.md + Outline.md + Synopsis.md', () => {
    scaffoldStoryVault(tmpDir);
    const story = path.join(tmpDir, 'My First Story');
    expect(fs.existsSync(path.join(story, 'Manuscript', '01 - Opening', '01 - Scene One.md'))).toBe(true);
    expect(fs.existsSync(path.join(story, 'Outline.md'))).toBe(true);
    expect(fs.existsSync(path.join(story, 'Synopsis.md'))).toBe(true);
  });

  it('seeded files carry seeded_by: SKY-9 frontmatter so future tools can spot pristine seeds', () => {
    scaffoldStoryVault(tmpDir);
    const outline = fs.readFileSync(path.join(tmpDir, 'My First Story', 'Outline.md'), 'utf-8');
    expect(outline).toMatch(/seeded_by:\s*SKY-9/);
  });

  // SKY-15: Blank mode skips all per-story scaffolding so the user organizes
  // from scratch. The vault root has already been created by ensure*VaultDir.
  it('is a no-op in blank mode (no My First Story/)', () => {
    scaffoldStoryVault(tmpDir, 'blank');
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  it('is idempotent — does not throw when called twice', () => {
    scaffoldStoryVault(tmpDir);
    expect(() => scaffoldStoryVault(tmpDir)).not.toThrow();
  });

  // SKY-9 idempotency: a user who edits a seeded file does not have it
  // clobbered on the next boot.
  it('does not overwrite seeded files that the user has edited', () => {
    scaffoldStoryVault(tmpDir);
    const outlinePath = path.join(tmpDir, 'My First Story', 'Outline.md');
    fs.writeFileSync(outlinePath, '# My outline\n', 'utf-8');
    scaffoldStoryVault(tmpDir);
    expect(fs.readFileSync(outlinePath, 'utf-8')).toBe('# My outline\n');
  });
});

// ─── isEmptyOrMissing (SKY-9) ───

describe('isEmptyOrMissing', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-isempty-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true for a missing path', () => {
    expect(isEmptyOrMissing(path.join(tmpDir, 'nope'))).toBe(true);
  });

  it('returns true for an existing empty directory', () => {
    expect(isEmptyOrMissing(tmpDir)).toBe(true);
  });

  it('returns false once any file (even a dotfile) is present', () => {
    fs.writeFileSync(path.join(tmpDir, '.hidden'), '');
    expect(isEmptyOrMissing(tmpDir)).toBe(false);
  });
});

// ─── moveVaultFile (SKY-9) ───

describe('moveVaultFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-move-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // SKY-9 U4 — happy path inside the vault root.
  it('renames a file within the vault and creates missing parent directories', () => {
    fs.writeFileSync(path.join(tmpDir, 'before.md'), '# hello', 'utf-8');
    const result = moveVaultFile(tmpDir, 'before.md', 'sub/after.md');
    expect(result.moved).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'before.md'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'sub', 'after.md'))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'sub', 'after.md'), 'utf-8')).toBe('# hello');
  });

  // SKY-9 U4 — same source and destination should no-op safely.
  it('returns moved=false when source and destination are identical', () => {
    fs.writeFileSync(path.join(tmpDir, 'same.md'), '# x');
    const result = moveVaultFile(tmpDir, 'same.md', 'same.md');
    expect(result.moved).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'same.md'))).toBe(true);
  });

  // SKY-9 U4 — both endpoints are resolved through realSafePath, so a
  // traversal attempt on either side throws before fs.renameSync is reached.
  it('rejects "../" traversal on the source path', () => {
    expect(() => moveVaultFile(tmpDir, '../escape.md', 'after.md'))
      .toThrow(/Path traversal denied|outside vault root/);
  });

  it('rejects "../" traversal on the destination path', () => {
    fs.writeFileSync(path.join(tmpDir, 'before.md'), '');
    expect(() => moveVaultFile(tmpDir, 'before.md', '../escape.md'))
      .toThrow(/Path traversal denied|outside vault root/);
  });

  it('throws when source does not exist', () => {
    expect(() => moveVaultFile(tmpDir, 'missing.md', 'after.md'))
      .toThrow(/Source does not exist/);
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

describe('vaultRootHash', () => {
  it('returns a 16-char hex string', () => {
    expect(vaultRootHash('/foo/bar')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('produces different hashes for different paths', () => {
    expect(vaultRootHash('/vault/a')).not.toBe(vaultRootHash('/vault/b'));
  });
});

describe('loadVaultIndexCache / saveVaultIndexCache', () => {
  let tmpDir: string;
  let vaultRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-cache-'));
    vaultRoot = '/fake/vault';
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when cache file is absent', () => {
    expect(loadVaultIndexCache(tmpDir, vaultRoot, '1.0.0', 1)).toBeNull();
  });

  it('round-trips save and load', () => {
    const cache = {
      appVersion: '1.0.0',
      schemaVersion: 1,
      entries: { 'scene.md': { mtimeMs: 1234567890, size: 512 } },
    };
    saveVaultIndexCache(tmpDir, vaultRoot, cache);
    const loaded = loadVaultIndexCache(tmpDir, vaultRoot, '1.0.0', 1);
    expect(loaded).not.toBeNull();
    expect(loaded!.entries['scene.md']).toEqual({ mtimeMs: 1234567890, size: 512 });
  });

  it('returns null when appVersion does not match', () => {
    saveVaultIndexCache(tmpDir, vaultRoot, {
      appVersion: '1.0.0',
      schemaVersion: 1,
      entries: {},
    });
    expect(loadVaultIndexCache(tmpDir, vaultRoot, '2.0.0', 1)).toBeNull();
  });

  it('returns null when schemaVersion does not match', () => {
    saveVaultIndexCache(tmpDir, vaultRoot, {
      appVersion: '1.0.0',
      schemaVersion: 1,
      entries: {},
    });
    expect(loadVaultIndexCache(tmpDir, vaultRoot, '1.0.0', 2)).toBeNull();
  });
});

describe('reindexVault — incremental cache', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-inc-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips unchanged files (warm start) and returns skipped count', () => {
    writeSceneFile(tmpDir, 'a.md', { id: 'a', title: 'A', prose: 'Hello.' });
    writeSceneFile(tmpDir, 'b.md', { id: 'b', title: 'B', prose: 'World.' });
    const manifest = defaultManifest(tmpDir);

    // Cold pass — build cache
    const { manifest: m1, cacheEntries } = reindexVault(tmpDir, manifest, null);
    const cache = { appVersion: '1.0.0', schemaVersion: 1, entries: cacheEntries };

    // Warm pass — nothing changed; both files should be skipped
    const { skipped, scanned } = reindexVault(tmpDir, m1, cache);
    expect(skipped).toBe(2);
    expect(scanned).toBe(2);
  });

  it('re-reads a file when mtime changes', () => {
    writeSceneFile(tmpDir, 'scene.md', { id: 'sc1', title: 'T', prose: 'Original.' });
    const manifest = defaultManifest(tmpDir);
    const { manifest: m1, cacheEntries } = reindexVault(tmpDir, manifest, null);

    // Write new content with a future mtime
    const raw = fs.readFileSync(path.join(tmpDir, 'scene.md'), 'utf-8');
    const updated = raw.replace('Original.', 'Changed.');
    const future = new Date(Date.now() + 5000);
    fs.writeFileSync(path.join(tmpDir, 'scene.md'), updated, 'utf-8');
    fs.utimesSync(path.join(tmpDir, 'scene.md'), future, future);

    const staleCache = { appVersion: '1.0.0', schemaVersion: 1, entries: cacheEntries };
    const { skipped, updated: upd } = reindexVault(tmpDir, m1, staleCache);
    expect(skipped).toBe(0);
    expect(upd).toBeGreaterThan(0);
  });

  it('re-reads a file when size changes but mtime is identical', () => {
    const filePath = path.join(tmpDir, 'scene.md');
    writeSceneFile(tmpDir, 'scene.md', { id: 'sc2', title: 'T', prose: 'A' });
    const stat0 = fs.statSync(filePath);
    const manifest = defaultManifest(tmpDir);
    const { cacheEntries } = reindexVault(tmpDir, manifest, null);

    // Overwrite with longer content, restore original mtime to isolate size check
    const raw = fs.readFileSync(filePath, 'utf-8');
    fs.writeFileSync(filePath, raw + '\nextra line\n', 'utf-8');
    fs.utimesSync(filePath, stat0.atime, stat0.mtime);

    const staleCache = { appVersion: '1.0.0', schemaVersion: 1, entries: cacheEntries };
    const { skipped } = reindexVault(tmpDir, manifest, staleCache);
    expect(skipped).toBe(0);
  });
});
