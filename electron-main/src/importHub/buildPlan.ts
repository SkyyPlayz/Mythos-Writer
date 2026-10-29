// #1765 — Import hub dispatcher: a safety-checked, detected source → the
// matching importer → one ImportPlan. Injected into registerImportHubIpc as
// `buildPlan` so the IPC module stays free of importer imports.
//
// Every caller has already run assessImportPath (deny-list, sniff, size and
// zip caps) and detectImportSource on `realPath`.

import fs from 'fs';
import path from 'path';
import type { ImportPlan, ImportSourceKind, ImportStory } from './types.js';
import type { AssessedImportPath } from './importSafety.js';
import { segmentBlocks } from './blocks.js';
import { parseDocxStory } from './docx.js';
import { parseEpubStory } from './epub.js';
import { htmlToBlocks } from './htmlBlocks.js';
import { plainTextToBlocks } from './plainText.js';
import { markdownFileToPlan, markdownFolderToPlan } from './markdownImport.js';
import { rtfFileToPlan } from './rtf.js';
import { scrivenerToPlan } from './scrivener.js';

/**
 * Decode a text file honouring a UTF-8 / UTF-16 byte-order mark (Word's
 * "Plain Text → Unicode" and older Notepad save UTF-16 with a BOM).
 */
export function decodeTextFile(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  return new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '');
}

/** File name without its final extension — the fallback story title. */
function baseTitle(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim() || 'Imported Story';
}

function storyPlan(kind: ImportSourceKind, name: string, story: ImportStory, warnings: string[]): ImportPlan {
  return { source: { kind, name }, story, notes: [], warnings };
}

export async function buildImportPlan(
  realPath: string,
  kind: ImportSourceKind,
  assessed: Pick<AssessedImportPath, 'name'>,
): Promise<ImportPlan> {
  const name = assessed.name || path.basename(realPath);
  switch (kind) {
    case 'docx': {
      const { story, warnings } = await parseDocxStory(fs.readFileSync(realPath), baseTitle(name));
      return storyPlan(kind, name, story, warnings);
    }
    case 'epub': {
      const { story, warnings } = await parseEpubStory(fs.readFileSync(realPath), baseTitle(name));
      return storyPlan(kind, name, story, warnings);
    }
    case 'gdoc-html':
    case 'html': {
      const { blocks, title, warnings } = htmlToBlocks(decodeTextFile(fs.readFileSync(realPath)));
      // A Google Docs export's <title> is the document name — a better
      // fallback than the downloaded file name; a Title-style line still wins.
      const seg = segmentBlocks(blocks, { fallbackTitle: title || baseTitle(name) });
      return storyPlan(kind, name, seg.story, [...warnings, ...seg.warnings]);
    }
    case 'text': {
      const seg = segmentBlocks(plainTextToBlocks(decodeTextFile(fs.readFileSync(realPath))), {
        fallbackTitle: baseTitle(name),
      });
      return storyPlan(kind, name, seg.story, seg.warnings);
    }
    case 'markdown':
      return markdownFileToPlan(realPath, name);
    case 'markdown-folder':
      return markdownFolderToPlan(realPath, name);
    case 'rtf':
      return rtfFileToPlan(realPath, name);
    case 'scrivener':
      return scrivenerToPlan(realPath, name);
    default: {
      const never: never = kind;
      throw new Error(`Unsupported import source: ${String(never)}`);
    }
  }
}
