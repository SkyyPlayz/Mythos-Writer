// SKY-11814: unit tests for materializeDocxAsStoryFolder — the pure helper
// that writes a parsed .docx (docxImporter.parseDocxBuffer output) into a v2
// Story Vault folder (book.md + Part 1/Chapter NN/Scene NN.md).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { materializeDocxAsStoryFolder } from './docxStoryImport.js';
import { parseBookFile } from './bookFile.js';
import { parseV2SceneFile } from './sceneFiles.js';
import type { DocxImportResult } from '../docxImporter.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-story-import-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function twoChapterDocx(): DocxImportResult {
  return {
    title: 'Chapter One',
    warnings: [],
    chapters: [
      { title: 'Chapter One', order: 0, scenes: [{ title: 'Chapter One', prose: 'First body text.', order: 0 }] },
      { title: 'Chapter Two', order: 1, scenes: [{ title: 'Chapter Two', prose: 'Second body text.', order: 0 }] },
    ],
  };
}

describe('materializeDocxAsStoryFolder', () => {
  it('writes book.md + Part 1/Chapter NN/Scene NN.md matching v2 scan expectations', () => {
    const { folderName, sceneCount } = materializeDocxAsStoryFolder(twoChapterDocx(), tmp, new Set());
    expect(sceneCount).toBe(2);

    const storyDir = path.join(tmp, folderName);
    expect(fs.existsSync(path.join(storyDir, 'book.md'))).toBe(true);
    const scene1 = path.join(storyDir, 'Part 1', 'Chapter 01', 'Scene 01.md');
    const scene2 = path.join(storyDir, 'Part 1', 'Chapter 02', 'Scene 01.md');
    expect(fs.existsSync(scene1)).toBe(true);
    expect(fs.existsSync(scene2)).toBe(true);

    const parsedScene1 = parseV2SceneFile(fs.readFileSync(scene1, 'utf-8'));
    expect(parsedScene1.prose).toBe('First body text.');
    expect(parsedScene1.status).toBe('draft');
    expect(parsedScene1.id).toBeTruthy();

    const book = parseBookFile(fs.readFileSync(path.join(storyDir, 'book.md'), 'utf-8'));
    expect(book.title).toBe('Chapter One');
    expect(book.spine).toHaveLength(1);
    expect(book.spine[0].chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two']);
  });

  it('marks a scene with no prose as todo, not draft', () => {
    const docx: DocxImportResult = {
      title: 'Empty Chapter',
      warnings: [],
      chapters: [{ title: 'Empty Chapter', order: 0, scenes: [{ title: 'Empty Chapter', prose: '', order: 0 }] }],
    };
    const { folderName } = materializeDocxAsStoryFolder(docx, tmp, new Set());
    const scene = path.join(tmp, folderName, 'Part 1', 'Chapter 01', 'Scene 01.md');
    expect(parseV2SceneFile(fs.readFileSync(scene, 'utf-8')).status).toBe('todo');
  });

  it('avoids folder-name collisions across multiple .docx files with the same title', () => {
    const taken = new Set<string>();
    const first = materializeDocxAsStoryFolder(twoChapterDocx(), tmp, taken);
    const second = materializeDocxAsStoryFolder(twoChapterDocx(), tmp, taken);
    expect(first.folderName).not.toBe(second.folderName);
    expect(fs.existsSync(path.join(tmp, first.folderName, 'book.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, second.folderName, 'book.md'))).toBe(true);
  });
});
