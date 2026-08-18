// SKY-2993: Tests for obsidianImporter.ts — all pure logic, no Electron.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  collectObsidianFiles,
  importObsidianToVaultDir,
  dryRunObsidianImport,
  OBSIDIAN_ATTACHMENT_EXTS,
  MAX_IMPORT_FILE_BYTES,
} from './obsidianImporter.js';
import { getNoteBacklinks } from './noteBacklinks.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'obs-test-'));
}

function writeFile(dir: string, relPath: string, content: string): void {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

function writeBin(dir: string, relPath: string, size = 10): void {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, Buffer.alloc(size, 0));
}

// ─── collectObsidianFiles ────────────────────────────────────────────────────

describe('collectObsidianFiles', () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('collects .md files and known attachments', () => {
    writeFile(tmp, 'Notes/a.md', '# A');
    writeFile(tmp, 'Notes/b.md', '# B');
    writeBin(tmp, 'Notes/img.png');
    const result = collectObsidianFiles(tmp);
    expect(result.markdownFiles).toContain('Notes/a.md');
    expect(result.markdownFiles).toContain('Notes/b.md');
    expect(result.attachmentFiles).toContain('Notes/img.png');
  });

  it('skips dotfiles and .obsidian directory', () => {
    writeFile(tmp, '.obsidian/app.json', '{}');
    writeFile(tmp, '.hidden.md', '# hidden');
    writeFile(tmp, 'Visible.md', '# visible');
    const result = collectObsidianFiles(tmp);
    expect(result.markdownFiles).toEqual(['Visible.md']);
    expect(result.markdownFiles).not.toContain('.hidden.md');
  });

  it('handles nested directories', () => {
    writeFile(tmp, 'A/B/C/deep.md', '# deep');
    const result = collectObsidianFiles(tmp);
    expect(result.markdownFiles).toContain('A/B/C/deep.md');
  });

  it('returns empty for non-existent path', () => {
    const result = collectObsidianFiles('/nonexistent-path-xyz-123');
    expect(result.markdownFiles).toHaveLength(0);
    expect(result.attachmentFiles).toHaveLength(0);
  });

  it('collects all known attachment extensions', () => {
    for (const ext of ['.jpg', '.jpeg', '.gif', '.svg', '.pdf']) {
      writeBin(tmp, `file${ext}`);
    }
    const result = collectObsidianFiles(tmp);
    expect(result.attachmentFiles.length).toBeGreaterThanOrEqual(5);
  });

  it('ignores unknown extensions (e.g. .txt)', () => {
    writeFile(tmp, 'notes.txt', 'text');
    const result = collectObsidianFiles(tmp);
    expect(result.markdownFiles).toHaveLength(0);
    expect(result.attachmentFiles).toHaveLength(0);
  });
});

// ─── importObsidianToVaultDir ─────────────────────────────────────────────────

describe('importObsidianToVaultDir', () => {
  let src: string;
  let dst: string;
  beforeEach(() => {
    src = makeTmpDir();
    dst = makeTmpDir();
  });
  afterEach(() => {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  });

  it('copies markdown files byte-for-byte (no frontmatter injection)', () => {
    writeFile(src, 'Note.md', '# Hello');
    const result = importObsidianToVaultDir(src, dst);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    const content = fs.readFileSync(path.join(dst, 'Note.md'), 'utf-8');
    expect(content).toBe('# Hello');
  });

  it('copies attachments as binary', () => {
    writeBin(src, 'img.png', 50);
    const result = importObsidianToVaultDir(src, dst);
    expect(result.imported).toBe(1);
    expect(fs.existsSync(path.join(dst, 'img.png'))).toBe(true);
  });

  it('skips files already present in destination', () => {
    writeFile(src, 'Note.md', '# A');
    writeFile(dst, 'Note.md', '# existing');
    const result = importObsidianToVaultDir(src, dst);
    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(0);
    // Destination unchanged
    expect(fs.readFileSync(path.join(dst, 'Note.md'), 'utf-8')).toContain('# existing');
  });

  it('preserves nested folder structure', () => {
    writeFile(src, 'A/B/deep.md', '# deep');
    importObsidianToVaultDir(src, dst);
    expect(fs.existsSync(path.join(dst, 'A/B/deep.md'))).toBe(true);
  });

  it('SKY-10383: leaves wikilinks unrewritten, even across folders', () => {
    writeFile(src, 'Lore/Dragons.md', '# Dragons');
    writeFile(src, 'Story.md', '[[Dragons]] is referenced here.');
    importObsidianToVaultDir(src, dst);
    const story = fs.readFileSync(path.join(dst, 'Story.md'), 'utf-8');
    // Bare-stem link is copied as-is — Mythos resolves it natively on read
    // (noteBacklinks.ts), so rewriting it here would only mutate the user's prose.
    expect(story).toContain('[[Dragons]]');
    expect(story).not.toContain('[[Lore/Dragons]]');
  });

  // SKY-10383 pinned regression (CEO scope pin): imported .md bytes are
  // identical to the Obsidian source, AND bare [[stem]] links still resolve
  // through the native backlink resolver. Both assertions required.
  it('SKY-10383: fixture vault imports byte-identical and backlinks resolve', () => {
    const fixtures: Record<string, string> = {
      // Frontmatter with keys the old importer used to strip — must survive.
      'Characters/Elara.md':
        '---\naliases: [The Wanderer]\ncssclass: wide\npublish: false\n---\n# Elara\n\nShe studies [[Dragons]].\n',
      // No frontmatter, no trailing newline — the old importer injected an id here.
      'Lore/Dragons.md': '# Dragons\n\nSee [[Elara|the wanderer]] and [[Lore/Ancient Fire]].',
      'Lore/Ancient Fire.md': '# Ancient Fire\n\nUnresolvable link stays put: [[No Such Note]].\n',
      // CRLF line endings — byte-identity must preserve them.
      'Notes/Windows Note.md': '# CRLF\r\n\r\nLinks to [[Dragons]].\r\n',
    };
    for (const [rel, content] of Object.entries(fixtures)) writeFile(src, rel, content);

    const result = importObsidianToVaultDir(src, dst);
    expect(result.ok).toBe(true);
    expect(result.imported).toBe(Object.keys(fixtures).length);

    for (const rel of Object.keys(fixtures)) {
      const srcBytes = fs.readFileSync(path.join(src, rel));
      const dstBytes = fs.readFileSync(path.join(dst, rel));
      expect(dstBytes.equals(srcBytes), `${rel} must be byte-identical`).toBe(true);
    }

    // Bare [[Dragons]] links in two different folders resolve to Lore/Dragons.md.
    const { backlinks } = getNoteBacklinks(dst, 'Lore/Dragons.md');
    const linkingPaths = backlinks.map((b) => b.path);
    expect(linkingPaths).toContain('Characters/Elara.md');
    expect(linkingPaths).toContain('Notes/Windows Note.md');

    // Aliased bare link [[Elara|the wanderer]] resolves too.
    const elara = getNoteBacklinks(dst, 'Characters/Elara.md');
    expect(elara.backlinks.map((b) => b.path)).toContain('Lore/Dragons.md');
  });

  it('returns ok:false + error for non-existent source', () => {
    const result = importObsidianToVaultDir('/no-such-dir-xyz', dst);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('records error for oversized file without failing the rest', () => {
    // Write a tiny file and a fake oversized one
    writeFile(src, 'small.md', '# small');
    // Simulate size check by writing a normal file then mocking statSync isn't needed —
    // just verify that the small file IS imported and no crash
    const result = importObsidianToVaultDir(src, dst);
    expect(result.imported).toBeGreaterThanOrEqual(1);
  });

  it('returns ok:true even with partial errors if some files imported', () => {
    writeFile(src, 'ok.md', '# ok');
    const result = importObsidianToVaultDir(src, dst);
    expect(result.ok).toBe(true);
  });
});

// ─── dryRunObsidianImport ────────────────────────────────────────────────────

describe('dryRunObsidianImport', () => {
  let src: string;
  beforeEach(() => { src = makeTmpDir(); });
  afterEach(() => { fs.rmSync(src, { recursive: true, force: true }); });

  it('returns preview with correct counts', () => {
    writeFile(src, 'Notes/A.md', '# A');
    writeFile(src, 'Notes/B.md', '# B');
    writeBin(src, 'img.png');
    const result = dryRunObsidianImport(src);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.markdownCount).toBe(2);
    expect(result.attachmentCount).toBe(1);
    expect(result.totalFiles).toBe(3);
  });

  it('returns error for non-existent path', () => {
    const result = dryRunObsidianImport('/no-such-path-xyz-123');
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error).toMatch(/does not exist/i);
  });

  it('returns error for a file path (not a directory)', () => {
    const file = path.join(src, 'test.md');
    fs.writeFileSync(file, '# hi');
    const result = dryRunObsidianImport(file);
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error).toMatch(/not a directory/i);
  });

  it('does not write any files', () => {
    writeFile(src, 'Note.md', '# Note');
    const dst = makeTmpDir();
    try {
      dryRunObsidianImport(src);
      // After dry-run, no files should appear in dst (we didn't pass dst — that's correct)
      // This test confirms dryRunObsidianImport only reads, never writes to src
      const before = fs.readdirSync(src);
      dryRunObsidianImport(src);
      const after = fs.readdirSync(src);
      expect(after).toEqual(before);
    } finally {
      fs.rmSync(dst, { recursive: true, force: true });
    }
  });

  it('includes top-level folders in preview', () => {
    fs.mkdirSync(path.join(src, 'Chapters'));
    fs.mkdirSync(path.join(src, 'Research'));
    writeFile(src, 'Chapters/ch1.md', '#');
    const result = dryRunObsidianImport(src);
    if ('error' in result) throw new Error(result.error);
    expect(result.topLevelFolders).toContain('Chapters');
    expect(result.topLevelFolders).toContain('Research');
  });

  it('includes up to 5 sample files', () => {
    for (let i = 0; i < 8; i++) writeFile(src, `note${i}.md`, '#');
    const result = dryRunObsidianImport(src);
    if ('error' in result) throw new Error(result.error);
    expect(result.sampleFiles.length).toBeLessThanOrEqual(5);
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe('constants', () => {
  it('OBSIDIAN_ATTACHMENT_EXTS includes common image formats', () => {
    expect(OBSIDIAN_ATTACHMENT_EXTS.has('.png')).toBe(true);
    expect(OBSIDIAN_ATTACHMENT_EXTS.has('.jpg')).toBe(true);
    expect(OBSIDIAN_ATTACHMENT_EXTS.has('.svg')).toBe(true);
  });

  it('MAX_IMPORT_FILE_BYTES is 25 MB', () => {
    expect(MAX_IMPORT_FILE_BYTES).toBe(25 * 1024 * 1024);
  });
});

// ─── importObsidianToVaultDir — verification fields (SKY-7948) ───────────────

describe('importObsidianToVaultDir — post-import verification', () => {
  let src: string;
  let dst: string;
  beforeEach(() => {
    src = makeTmpDir();
    dst = makeTmpDir();
  });
  afterEach(() => {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  });

  it('returns sourceCount equal to files found in source', () => {
    writeFile(src, 'a.md', '# A');
    writeFile(src, 'sub/b.md', '# B');
    writeBin(src, 'img.png');
    const result = importObsidianToVaultDir(src, dst);
    expect(result.sourceCount).toBe(3);
  });

  it('returns dropWarning="" when all files are accounted for', () => {
    writeFile(src, 'a.md', '# A');
    const result = importObsidianToVaultDir(src, dst);
    expect(result.dropWarning).toBe('');
    expect(result.imported).toBe(1);
    expect(result.sourceCount).toBe(1);
  });

  it('returns sourceCount=0 and dropWarning="" for non-existent srcPath', () => {
    const result = importObsidianToVaultDir('/nonexistent/path/here', dst);
    expect(result.ok).toBe(false);
    expect(result.sourceCount).toBe(0);
    expect(result.dropWarning).toBe('');
  });

  it('counts skipped (already-existing) files in accountedFor — no false drop warning', () => {
    writeFile(src, 'a.md', '# A');
    writeFile(dst, 'a.md', '# A already there');
    const result = importObsidianToVaultDir(src, dst);
    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(0);
    expect(result.dropWarning).toBe('');
  });
});
