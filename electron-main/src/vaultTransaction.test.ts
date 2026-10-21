// Snapshot, rollback, and one-shot undo owned by vaultTransaction.
// These tests call the module directly. renameCascade.test.ts keeps its
// expectations and still covers the cascade that decides what text changes.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { rewriteWikiLinksForRename } from '@mythos-writer/shared/wikiLinkRename';
import { writeVaultFileAtomic } from './vault.js';
import {
  applyVaultTransaction,
  undoVaultTransaction,
  _resetVaultTransactionState,
  type VaultWriter,
} from './vaultTransaction.js';

let notesRoot: string;
let storyRoot: string;

function writeNote(relPath: string, content: string) {
  const full = path.join(notesRoot, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

function writeScene(relPath: string, content: string) {
  const full = path.join(storyRoot, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

function readNote(relPath: string): string {
  return fs.readFileSync(path.join(notesRoot, relPath), 'utf-8');
}

function readScene(relPath: string): string {
  return fs.readFileSync(path.join(storyRoot, relPath), 'utf-8');
}

function bytesEqual(root: string, relPath: string, text: string): boolean {
  return fs.readFileSync(path.join(root, relPath)).equals(Buffer.from(text, 'utf-8'));
}

beforeEach(() => {
  notesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-tx-notes-'));
  storyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-tx-story-'));
  _resetVaultTransactionState();
});

afterEach(() => {
  fs.rmSync(notesRoot, { recursive: true, force: true });
  fs.rmSync(storyRoot, { recursive: true, force: true });
});

describe('vaultTransaction', () => {
  it('snapshots every file before any write', () => {
    const alliesOriginal = 'See [[Jasper]] for details.';
    const sceneOriginal = 'Then [[Jasper]] arrived.';
    const alliesNext = 'See [[Jasper Thorne]] for details.';
    const sceneNext = 'Then [[Jasper Thorne|Jasper]] arrived.';
    writeNote('Allies.md', alliesOriginal);
    writeScene('Manuscript/01/scene-1.md', sceneOriginal);

    // The first content write clobbers the other planned file. A snapshot
    // taken after any write would record that clobber instead of the original.
    const writeFile: VaultWriter = (root, relPath, content) => {
      if (relPath === 'Allies.md') {
        fs.writeFileSync(path.join(storyRoot, 'Manuscript/01/scene-1.md'), 'clobbered-after-first-write', 'utf-8');
      }
      writeVaultFileAtomic(root, relPath, content);
    };

    const { files } = applyVaultTransaction({
      notesRoot,
      storyRoot,
      fromPath: 'Jasper.md',
      toPath: 'Jasper Thorne.md',
      oldStem: 'Jasper',
      newStem: 'Jasper Thorne',
      changes: [
        {
          side: 'notes',
          kind: 'note',
          relPath: 'Allies.md',
          newContent: alliesNext,
          linkCount: 1,
          mode: 'update-display',
        },
        {
          side: 'story',
          kind: 'note',
          relPath: 'Manuscript/01/scene-1.md',
          newContent: sceneNext,
          linkCount: 1,
          mode: 'preserve-display',
        },
      ],
      writeFile,
    });

    expect(files.map((f) => f.oldContent)).toEqual([alliesOriginal, sceneOriginal]);
    expect(readNote('Allies.md')).toBe(alliesNext);
    expect(readScene('Manuscript/01/scene-1.md')).toBe(sceneNext);
  });

  it('rolls back every file when a write fails mid-cascade', () => {
    writeNote('Jasper Thorne.md', 'The man himself.');
    writeNote('Allies.md', 'See [[Jasper]] for details.');
    writeNote('Enemies.md', 'Feared by [[Jasper|Jay]].');
    writeScene('Manuscript/01/scene-1.md', 'Then [[Jasper]] arrived.');

    let writes = 0;
    const failingWriter: VaultWriter = (root, relPath, content) => {
      writes++;
      if (writes === 3) throw new Error('disk full');
      writeVaultFileAtomic(root, relPath, content);
    };

    expect(() =>
      applyVaultTransaction({
        notesRoot,
        storyRoot,
        fromPath: 'Jasper.md',
        toPath: 'Jasper Thorne.md',
        oldStem: 'Jasper',
        newStem: 'Jasper Thorne',
        changes: [
          {
            side: 'notes',
            kind: 'note',
            relPath: 'Allies.md',
            newContent: 'See [[Jasper Thorne]] for details.',
            linkCount: 1,
            mode: 'update-display',
          },
          {
            side: 'notes',
            kind: 'note',
            relPath: 'Enemies.md',
            newContent: 'Feared by [[Jasper Thorne|Jay]].',
            linkCount: 1,
            mode: 'update-display',
          },
          {
            side: 'story',
            kind: 'note',
            relPath: 'Manuscript/01/scene-1.md',
            newContent: 'Then [[Jasper Thorne|Jasper]] arrived.',
            linkCount: 1,
            mode: 'preserve-display',
          },
        ],
        writeFile: failingWriter,
      }),
    ).toThrow(/rolled back/);

    expect(fs.existsSync(path.join(notesRoot, 'Jasper.md'))).toBe(true);
    expect(fs.existsSync(path.join(notesRoot, 'Jasper Thorne.md'))).toBe(false);
    expect(readNote('Jasper.md')).toBe('The man himself.');
    expect(readNote('Allies.md')).toBe('See [[Jasper]] for details.');
    expect(readNote('Enemies.md')).toBe('Feared by [[Jasper|Jay]].');
    expect(readScene('Manuscript/01/scene-1.md')).toBe('Then [[Jasper]] arrived.');
  });

  it('undo restores exact pre-write bytes', () => {
    // Not wikilinks: only the stored snapshot can put these bytes back.
    const noteOriginal = 'note-v1\n';
    const alliesOriginal = 'allies-v1\n';
    const sceneOriginal = 'scene-v1\n';
    writeNote('Jasper Thorne.md', noteOriginal);
    writeNote('Allies.md', alliesOriginal);
    writeScene('Manuscript/01/scene-1.md', sceneOriginal);

    applyVaultTransaction({
      notesRoot,
      storyRoot,
      fromPath: 'Jasper.md',
      toPath: 'Jasper Thorne.md',
      oldStem: 'Jasper',
      newStem: 'Jasper Thorne',
      changes: [
        {
          side: 'notes',
          kind: 'note',
          relPath: 'Jasper Thorne.md',
          newContent: 'note-v2\n',
          linkCount: 1,
          mode: 'update-display',
        },
        {
          side: 'notes',
          kind: 'note',
          relPath: 'Allies.md',
          newContent: 'allies-v2\n',
          linkCount: 1,
          mode: 'update-display',
        },
        {
          side: 'story',
          kind: 'note',
          relPath: 'Manuscript/01/scene-1.md',
          newContent: 'scene-v2\n',
          linkCount: 1,
          mode: 'preserve-display',
        },
      ],
    });

    const undo = undoVaultTransaction({ notesRoot, storyRoot });

    expect(undo.response.undone).toBe(true);
    expect(undo.response.filesRestored).toBe(3);
    expect(undo.conflicts).toEqual([]);
    expect(fs.existsSync(path.join(notesRoot, 'Jasper Thorne.md'))).toBe(false);
    expect(bytesEqual(notesRoot, 'Jasper.md', noteOriginal)).toBe(true);
    expect(bytesEqual(notesRoot, 'Allies.md', alliesOriginal)).toBe(true);
    expect(bytesEqual(storyRoot, 'Manuscript/01/scene-1.md', sceneOriginal)).toBe(true);
  });

  it('reverts only the touched span after a later edit and lists conflicts (SKY-10887)', () => {
    writeNote('Jasper Thorne.md', 'x');
    const sceneOriginal = 'Then [[Jasper]] arrived. The weather was calm.';
    const otherOriginal = '[[Jasper]] left.';
    writeScene('Manuscript/01/scene-1.md', sceneOriginal);
    writeScene('Manuscript/01/scene-2.md', otherOriginal);

    const sceneNext = rewriteWikiLinksForRename(sceneOriginal, 'Jasper', 'Jasper Thorne', 'preserve-display').content;
    const otherNext = rewriteWikiLinksForRename(otherOriginal, 'Jasper', 'Jasper Thorne', 'preserve-display').content;

    applyVaultTransaction({
      notesRoot,
      storyRoot,
      fromPath: 'Jasper.md',
      toPath: 'Jasper Thorne.md',
      oldStem: 'Jasper',
      newStem: 'Jasper Thorne',
      changes: [
        {
          side: 'story',
          kind: 'note',
          relPath: 'Manuscript/01/scene-1.md',
          newContent: sceneNext,
          linkCount: 1,
          mode: 'preserve-display',
        },
        {
          side: 'story',
          kind: 'note',
          relPath: 'Manuscript/01/scene-2.md',
          newContent: otherNext,
          linkCount: 1,
          mode: 'preserve-display',
        },
      ],
    });

    const laterEdit = 'Then [[Jasper Thorne|Jasper]] arrived. The weather turned stormy without warning.';
    writeScene('Manuscript/01/scene-1.md', laterEdit);
    const conflictText = 'The visitor left without a trace.';
    writeScene('Manuscript/01/scene-2.md', conflictText);

    const undo = undoVaultTransaction({ notesRoot, storyRoot });

    expect(undo.response.undone).toBe(true);
    expect(readScene('Manuscript/01/scene-1.md')).toBe(
      'Then [[Jasper]] arrived. The weather turned stormy without warning.',
    );
    expect(undo.conflicts).toEqual([{ side: 'story', relPath: 'Manuscript/01/scene-2.md' }]);
    expect(readScene('Manuscript/01/scene-2.md')).toBe(conflictText);
    expect(undo.response.filesRestored).toBe(1);
    expect(undo.response.filesSkipped).toBe(undo.conflicts.length);
  });
});
