// SKY-11814 — materialize a parsed .docx manuscript (docxImporter.parseDocxBuffer
// output: H1 = chapter, H2 = scene) as a v2 Story Vault folder so folder-based
// vault import surfaces Word documents as chapters/scenes. Mirrors the exact
// on-disk shape scanMythosStoryVault() already expects (mythosFormat/v2Manifest.ts):
// `<Story>/book.md` + `<Story>/Part 1/Chapter NN/Scene NN.md`. Every chapter
// lands under a single "Part 1" — parseDocxBuffer only distinguishes H1/H2,
// so there is no source signal for a part boundary.
//
// Pure Node — no Electron imports.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { DocxImportResult } from '../docxImporter.js';
import { serializeBookFile, BOOK_FILENAME, type BookFile, type BookSpineChapter } from './bookFile.js';
import {
  chapterDirName,
  partDirName,
  sceneFileName,
  serializeV2SceneFile,
  storyFolderName,
} from './sceneFiles.js';

/** Pick a story-folder name under storyVaultRoot that doesn't collide with an
 *  existing entry (multiple .docx files in one import, or a repeat title). */
function uniqueStoryFolderName(storyVaultRoot: string, title: string, taken: Set<string>): string {
  const base = storyFolderName(title);
  let candidate = base;
  let n = 2;
  while (taken.has(candidate) || fs.existsSync(path.join(storyVaultRoot, candidate))) {
    candidate = `${base} (${n++})`;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * Write one parsed .docx into storyVaultRoot as a new v2 story folder.
 * `taken` tracks folder names already claimed within the same import batch
 * (callers should share one Set across all .docx files from a single source).
 */
export function materializeDocxAsStoryFolder(
  parsed: DocxImportResult,
  storyVaultRoot: string,
  taken: Set<string>,
): { folderName: string; sceneCount: number } {
  const folderName = uniqueStoryFolderName(storyVaultRoot, parsed.title, taken);
  const storyDir = path.join(storyVaultRoot, folderName);
  const partDir = partDirName(1);
  const now = new Date().toISOString();
  const storyId = crypto.randomUUID();

  let sceneCount = 0;
  const spineChapters: BookSpineChapter[] = parsed.chapters.map((ch, ci) => {
    const chapterDir = chapterDirName(ci + 1);
    const chapterAbs = path.join(storyDir, partDir, chapterDir);
    fs.mkdirSync(chapterAbs, { recursive: true });
    ch.scenes.forEach((sc, si) => {
      const sceneAbs = path.join(chapterAbs, sceneFileName(si + 1));
      fs.writeFileSync(
        sceneAbs,
        serializeV2SceneFile({
          id: crypto.randomUUID(),
          title: sc.title,
          status: sc.prose.trim() ? 'draft' : 'todo',
          updatedAt: now,
          prose: sc.prose,
        }),
        'utf-8',
      );
      sceneCount++;
    });
    return { dir: chapterDir, id: crypto.randomUUID(), title: ch.title };
  });

  const book: BookFile = {
    id: storyId,
    title: parsed.title,
    createdAt: now,
    updatedAt: now,
    spine: [{ dir: partDir, chapters: spineChapters }],
  };
  fs.writeFileSync(path.join(storyDir, BOOK_FILENAME), serializeBookFile(book), 'utf-8');

  return { folderName, sceneCount };
}
