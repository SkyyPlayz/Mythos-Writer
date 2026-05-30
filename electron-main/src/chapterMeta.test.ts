// SKY-10: chapter.md helpers.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  writeChapterMetaFile,
  readChapterMetaFile,
  chapterMetaPath,
  CHAPTER_META_FILENAME,
} from './vault.js';

describe('chapter.md metadata', () => {
  let vaultRoot: string;
  let chapterRel: string;

  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-chmeta-'));
    chapterRel = path.join('Manuscript', 'Story', '01 - Opening');
    fs.mkdirSync(path.join(vaultRoot, chapterRel), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(vaultRoot, { recursive: true, force: true });
  });

  it('writes chapter.md with frontmatter id + title and the supplied prose', () => {
    writeChapterMetaFile(vaultRoot, chapterRel, {
      id: 'ch-1',
      title: '01 - Opening',
      storyId: 'st-1',
      order: 1,
      prose: 'A chapter epigraph.',
    });
    const fullPath = path.join(vaultRoot, chapterRel, CHAPTER_META_FILENAME);
    const raw = fs.readFileSync(fullPath, 'utf-8');
    expect(raw).toContain('id: ch-1');
    expect(raw).toContain('title: 01 - Opening');
    expect(raw).toContain('storyId: st-1');
    expect(raw.endsWith('A chapter epigraph.')).toBe(true);
  });

  it('readChapterMetaFile round-trips the data and survives folder rename', () => {
    writeChapterMetaFile(vaultRoot, chapterRel, {
      id: 'ch-stable',
      title: '01 - Opening',
      order: 1,
      prose: '',
    });
    // Rename the chapter directory; the id in chapter.md is the stable handle.
    const renamedRel = path.join('Manuscript', 'Story', '01 - Opening Revised');
    fs.renameSync(path.join(vaultRoot, chapterRel), path.join(vaultRoot, renamedRel));

    const read = readChapterMetaFile(vaultRoot, renamedRel);
    expect(read).not.toBeNull();
    expect(read!.id).toBe('ch-stable');
    expect(read!.title).toBe('01 - Opening');
  });

  it('returns null when chapter.md does not exist', () => {
    expect(readChapterMetaFile(vaultRoot, chapterRel)).toBeNull();
  });

  it('chapterMetaPath joins consistently with forward slashes', () => {
    expect(chapterMetaPath('Manuscript/A/01').endsWith('/chapter.md')).toBe(true);
  });
});
