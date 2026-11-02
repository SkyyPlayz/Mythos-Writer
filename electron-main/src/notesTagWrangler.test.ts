import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listNotesTags, renameNotesTag, mergeNotesTags } from './notesTagWrangler.js';
import { isRecentSelfWrite } from './vault.js';
import { MAX_VAULT_FILE_BYTES } from './vault/limits.js';
import { notesTagRefreshLog, resetNotesTagRefreshLog } from './notesTagRefresh.js';

// ─── Helpers ───

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mw-tags-'));
}

function writeNote(dir: string, relPath: string, tags: string[], prose = 'body'): void {
  const absDir = path.dirname(path.join(dir, relPath));
  fs.mkdirSync(absDir, { recursive: true });
  const frontmatter = tags.length
    ? `---\ntags: [${tags.join(', ')}]\n---\n`
    : '---\n---\n';
  fs.writeFileSync(path.join(dir, relPath), frontmatter + prose, 'utf8');
}

function readTags(dir: string, relPath: string): string[] {
  const content = fs.readFileSync(path.join(dir, relPath), 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return [];
  const line = match[1].match(/^tags:\s*\[(.+)\]$/m);
  if (!line) return [];
  return line[1].split(',').map((s) => s.trim()).filter(Boolean);
}

// ─── listNotesTags ───

describe('listNotesTags', () => {
  let root: string;

  beforeEach(() => { root = tmpDir(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('returns empty array for empty vault', () => {
    expect(listNotesTags(root)).toEqual([]);
  });

  it('returns empty array for notes without tags', () => {
    writeNote(root, 'ideas.md', []);
    expect(listNotesTags(root)).toEqual([]);
  });

  it('returns flat tags with counts and paths', () => {
    writeNote(root, 'a.md', ['lore']);
    writeNote(root, 'b.md', ['lore', 'magic']);
    const tree = listNotesTags(root);
    const lore = tree.find((t) => t.fullName === 'lore');
    const magic = tree.find((t) => t.fullName === 'magic');
    expect(lore).toBeDefined();
    expect(lore?.count).toBe(2);
    expect(lore?.paths.sort()).toEqual(['a.md', 'b.md']);
    expect(magic?.count).toBe(1);
    expect(magic?.paths).toEqual(['b.md']);
  });

  it('builds nested tree from slash-separated tags', () => {
    writeNote(root, 'a.md', ['world/factions/order-of-dawn']);
    writeNote(root, 'b.md', ['world/factions']);
    writeNote(root, 'c.md', ['world']);
    const tree = listNotesTags(root);
    const world = tree.find((t) => t.name === 'world');
    expect(world).toBeDefined();
    expect(world?.fullName).toBe('world');
    expect(world?.count).toBe(1); // only c.md has exactly 'world'
    const factions = world?.children.find((t) => t.name === 'factions');
    expect(factions?.count).toBe(1); // b.md
    const order = factions?.children.find((t) => t.name === 'order-of-dawn');
    expect(order?.count).toBe(1); // a.md
    expect(order?.fullName).toBe('world/factions/order-of-dawn');
  });

  it('ignores .md files without frontmatter tags field', () => {
    fs.writeFileSync(path.join(root, 'plain.md'), 'no frontmatter', 'utf8');
    expect(listNotesTags(root)).toEqual([]);
  });

  it('skips dotfile directories', () => {
    writeNote(root, '.hidden/secret.md', ['private']);
    expect(listNotesTags(root)).toEqual([]);
  });
});

// ─── renameNotesTag ───

describe('renameNotesTag', () => {
  let root: string;

  beforeEach(() => { root = tmpDir(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('renames a tag across all files that carry it', () => {
    writeNote(root, 'a.md', ['lore', 'magic']);
    writeNote(root, 'b.md', ['lore']);
    writeNote(root, 'c.md', ['magic']); // should not be touched

    const result = renameNotesTag(root, 'lore', 'worldbuilding');
    expect(result.affectedFiles).toBe(2);
    expect(readTags(root, 'a.md')).toEqual(['worldbuilding', 'magic']);
    expect(readTags(root, 'b.md')).toEqual(['worldbuilding']);
    expect(readTags(root, 'c.md')).toEqual(['magic']); // unchanged
  });

  it('deduplicates if new tag already exists on the file', () => {
    writeNote(root, 'a.md', ['lore', 'worldbuilding']);
    renameNotesTag(root, 'lore', 'worldbuilding');
    expect(readTags(root, 'a.md')).toEqual(['worldbuilding']);
  });

  it('returns 0 when tag not found', () => {
    writeNote(root, 'a.md', ['magic']);
    const result = renameNotesTag(root, 'nonexistent', 'other');
    expect(result.affectedFiles).toBe(0);
    expect(readTags(root, 'a.md')).toEqual(['magic']);
  });

  it('returns 0 and no-ops when oldTag === newTag', () => {
    writeNote(root, 'a.md', ['lore']);
    const result = renameNotesTag(root, 'lore', 'lore');
    expect(result.affectedFiles).toBe(0);
  });

  it('writes a backup file in .tag-wrangler/backups/', () => {
    writeNote(root, 'a.md', ['lore']);
    renameNotesTag(root, 'lore', 'worldbuilding');
    const backupDir = path.join(root, '.tag-wrangler', 'backups');
    const entries = fs.readdirSync(backupDir).filter((f) => f.endsWith('.json'));
    expect(entries.length).toBe(1);
    const backup = JSON.parse(fs.readFileSync(path.join(backupDir, entries[0]), 'utf8'));
    expect(backup.operation).toBe('rename');
    expect(backup.oldTag).toBe('lore');
    expect(backup.newTag).toBe('worldbuilding');
    expect(backup.files.length).toBe(1);
    expect(backup.files[0].relPath).toBe('a.md');
  });

  it('handles tags with nested slash paths (exact match only)', () => {
    writeNote(root, 'a.md', ['world/factions']);
    writeNote(root, 'b.md', ['world/factions/order-of-dawn']);
    const result = renameNotesTag(root, 'world/factions', 'world/guilds');
    expect(result.affectedFiles).toBe(1); // only exact match
    expect(readTags(root, 'a.md')).toEqual(['world/guilds']);
    expect(readTags(root, 'b.md')).toEqual(['world/factions/order-of-dawn']); // unchanged
  });
});

// ─── mergeNotesTags ───

describe('mergeNotesTags', () => {
  let root: string;

  beforeEach(() => { root = tmpDir(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('replaces source tag with target tag across all files', () => {
    writeNote(root, 'a.md', ['lore']);
    writeNote(root, 'b.md', ['lore', 'magic']);
    writeNote(root, 'c.md', ['magic']); // no source tag

    const result = mergeNotesTags(root, 'lore', 'worldbuilding');
    expect(result.affectedFiles).toBe(2);
    expect(readTags(root, 'a.md')).toEqual(['worldbuilding']);
    expect(readTags(root, 'b.md')).toContain('worldbuilding');
    expect(readTags(root, 'b.md')).not.toContain('lore');
    expect(readTags(root, 'c.md')).toEqual(['magic']); // unchanged
  });

  it('deduplicates when target already exists on file', () => {
    writeNote(root, 'a.md', ['lore', 'worldbuilding']);
    mergeNotesTags(root, 'lore', 'worldbuilding');
    expect(readTags(root, 'a.md')).toEqual(['worldbuilding']);
  });

  it('returns 0 when source tag not found', () => {
    writeNote(root, 'a.md', ['magic']);
    const result = mergeNotesTags(root, 'nonexistent', 'other');
    expect(result.affectedFiles).toBe(0);
  });

  it('returns 0 when source === target', () => {
    writeNote(root, 'a.md', ['lore']);
    const result = mergeNotesTags(root, 'lore', 'lore');
    expect(result.affectedFiles).toBe(0);
  });

  it('writes a backup with operation=merge', () => {
    writeNote(root, 'a.md', ['lore']);
    mergeNotesTags(root, 'lore', 'worldbuilding');
    const backupDir = path.join(root, '.tag-wrangler', 'backups');
    const entries = fs.readdirSync(backupDir).filter((f) => f.endsWith('.json'));
    expect(entries.length).toBe(1);
    const backup = JSON.parse(fs.readFileSync(path.join(backupDir, entries[0]), 'utf8'));
    expect(backup.operation).toBe('merge');
  });

  it('renames a tag when the backup file is over the vault size cap', () => {
    const prose = 'x'.repeat(Math.floor(MAX_VAULT_FILE_BYTES / 2) + 4096);
    writeNote(root, 'a.md', ['lore'], prose);
    writeNote(root, 'b.md', ['lore'], prose);
    expect(fs.statSync(path.join(root, 'a.md')).size).toBeLessThanOrEqual(MAX_VAULT_FILE_BYTES);
    expect(fs.statSync(path.join(root, 'b.md')).size).toBeLessThanOrEqual(MAX_VAULT_FILE_BYTES);

    const result = renameNotesTag(root, 'lore', 'saga');
    expect(result.affectedFiles).toBe(2);
    expect(readTags(root, 'a.md')).toEqual(['saga']);

    const backupDir = path.join(root, '.tag-wrangler', 'backups');
    const entries = fs.readdirSync(backupDir).filter((name) => name.endsWith('.json'));
    expect(entries).toHaveLength(1);
    expect(fs.statSync(path.join(backupDir, entries[0])).size).toBeGreaterThan(MAX_VAULT_FILE_BYTES);
  });
});

describe('tag rewrite index refresh', () => {
  let root: string;

  beforeEach(() => { root = tmpDir(); resetNotesTagRefreshLog(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); resetNotesTagRefreshLog(); });

  it('refreshes the notes index after a tag rewrite and does not hide the note from the watcher', () => {
    writeNote(root, 'a.md', ['lore']);
    writeNote(root, 'b.md', ['lore']);
    const renamed = renameNotesTag(root, 'lore', 'saga');
    expect(renamed.affectedFiles).toBe(2);
    expect(isRecentSelfWrite(path.join(root, 'a.md'))).toBe(false);
    expect(isRecentSelfWrite(path.join(root, 'b.md'))).toBe(false);
    expect(notesTagRefreshLog().map((batch) => [...batch].sort())).toEqual([['a.md', 'b.md']]);

    resetNotesTagRefreshLog();
    const merged = mergeNotesTags(root, 'saga', 'epic');
    expect(merged.affectedFiles).toBe(2);
    expect(isRecentSelfWrite(path.join(root, 'a.md'))).toBe(false);
    expect(notesTagRefreshLog().map((batch) => [...batch].sort())).toEqual([['a.md', 'b.md']]);

    const mainSrc = fs.readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(mainSrc).toContain('installNotesTagIndexFanout');
  });
});
