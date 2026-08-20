// SKY-10712: rename → cascade-update inbound links.
//
// The failure-rollback suite comes FIRST — atomicity is the highest-risk part
// of this feature (owner ruling: "A failure partway must roll back, never
// leave a half-updated vault. Write the failure test first.").

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  renameNoteWithCascade,
  undoLastRenameCascade,
  _resetRenameCascadeState,
  type VaultWriter,
} from './renameCascade.js';
import { rewriteWikiLinksForRename } from '@mythos-writer/shared/wikiLinkRename';
import { writeVaultFileAtomic } from './vault.js';

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

beforeEach(() => {
  notesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sky10712-notes-'));
  storyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sky10712-story-'));
  _resetRenameCascadeState();
});

afterEach(() => {
  fs.rmSync(notesRoot, { recursive: true, force: true });
  fs.rmSync(storyRoot, { recursive: true, force: true });
});

describe('failure rollback — never leave a half-updated vault', () => {
  it('restores every written file AND renames the note back when a write fails partway', () => {
    writeNote('Jasper.md', 'The man himself.');
    writeNote('Allies.md', 'See [[Jasper]] for details.');
    writeNote('Enemies.md', 'Feared by [[Jasper|Jay]].');
    writeScene('Manuscript/01/scene-1.md', 'Then [[Jasper]] arrived.');

    // Fail on the third rewritten file — after some writes have landed.
    let writes = 0;
    const failingWriter: VaultWriter = (root, relPath, content) => {
      writes++;
      if (writes === 3) throw new Error('disk full');
      writeVaultFileAtomic(root, relPath, content);
    };

    expect(() =>
      renameNoteWithCascade({
        notesRoot,
        storyRoot,
        fromPath: 'Jasper.md',
        toPath: 'Jasper Thorne.md',
        writeFile: failingWriter,
      }),
    ).toThrow(/rolled back/);

    // Rollback re-uses the writer; writes 4+ (the restores) succeed. The vault
    // must be byte-identical to its pre-rename state.
    expect(fs.existsSync(path.join(notesRoot, 'Jasper.md'))).toBe(true);
    expect(fs.existsSync(path.join(notesRoot, 'Jasper Thorne.md'))).toBe(false);
    expect(readNote('Allies.md')).toBe('See [[Jasper]] for details.');
    expect(readNote('Enemies.md')).toBe('Feared by [[Jasper|Jay]].');
    expect(readScene('Manuscript/01/scene-1.md')).toBe('Then [[Jasper]] arrived.');
  });

  it('reports an incomplete rollback instead of pretending it succeeded', () => {
    writeNote('Jasper.md', 'x');
    writeNote('Allies.md', '[[Jasper]]');
    writeNote('Enemies.md', '[[Jasper]]');

    // First write lands, second fails, and the restore of the first fails too.
    let writes = 0;
    const brokenWriter: VaultWriter = (root, relPath, content) => {
      writes++;
      if (writes === 1) return writeVaultFileAtomic(root, relPath, content) as unknown as void;
      throw new Error('disk full');
    };

    expect(() =>
      renameNoteWithCascade({
        notesRoot,
        storyRoot,
        fromPath: 'Jasper.md',
        toPath: 'Jasper Thorne.md',
        writeFile: brokenWriter,
      }),
    ).toThrow(/could not be restored/);
  });

  it('leaves no undo transaction behind after a rolled-back cascade', () => {
    writeNote('Jasper.md', 'x');
    writeNote('Allies.md', '[[Jasper]]');
    const failingWriter: VaultWriter = () => {
      throw new Error('disk full');
    };
    expect(() =>
      renameNoteWithCascade({
        notesRoot,
        storyRoot,
        fromPath: 'Jasper.md',
        toPath: 'Jasper Thorne.md',
        writeFile: failingWriter,
      }),
    ).toThrow();
    expect(undoLastRenameCascade({ notesRoot, storyRoot }).undone).toBe(false);
  });
});

describe('collision — refused before anything is written', () => {
  it('refuses to rename onto an existing note and touches nothing', () => {
    writeNote('Jasper.md', 'original jasper');
    writeNote('Jasper Thorne.md', 'a different note');
    writeNote('Allies.md', '[[Jasper]]');

    expect(() =>
      renameNoteWithCascade({
        notesRoot,
        storyRoot,
        fromPath: 'Jasper.md',
        toPath: 'Jasper Thorne.md',
      }),
    ).toThrow(/already exists/);

    expect(readNote('Jasper.md')).toBe('original jasper');
    expect(readNote('Jasper Thorne.md')).toBe('a different note');
    expect(readNote('Allies.md')).toBe('[[Jasper]]');
  });
});

describe('per-side rewrite behaviour (owner ruling)', () => {
  it('notes vault gets Obsidian behaviour, story vault preserves visible words', () => {
    writeNote('Jasper.md', 'He knows [[Jasper]] well.'); // self-link
    writeNote('Notes/Allies.md', 'See [[Jasper]] and [[Jasper|Jay]] and [[Jasper#Backstory]].');
    writeScene(
      'Manuscript/01/scene-1.md',
      'Then [[Jasper]] spoke to [[Jasper|Jay]] about [[jasper]].',
    );
    writeScene('Outline.md', 'Arc: [[Jasper]] falls.');

    const result = renameNoteWithCascade({
      notesRoot,
      storyRoot,
      fromPath: 'Jasper.md',
      toPath: 'Jasper Thorne.md',
    });

    expect(result.moved).toBe(true);
    expect(result.linkUpdate).toBeDefined();
    // Notes side: display updates (bare links retitle), aliases preserved.
    expect(readNote('Jasper Thorne.md')).toBe('He knows [[Jasper Thorne]] well.');
    expect(readNote('Notes/Allies.md')).toBe(
      'See [[Jasper Thorne]] and [[Jasper Thorne|Jay]] and [[Jasper Thorne#Backstory]].',
    );
    // Story side: every link retargets, every visible word stays identical.
    expect(readScene('Manuscript/01/scene-1.md')).toBe(
      'Then [[Jasper Thorne|Jasper]] spoke to [[Jasper Thorne|Jay]] about [[Jasper Thorne|jasper]].',
    );
    expect(readScene('Outline.md')).toBe('Arc: [[Jasper Thorne|Jasper]] falls.');

    expect(result.linkUpdate!.linksUpdated).toBe(8);
    expect(result.linkUpdate!.notesFilesChanged).toBe(2);
    expect(result.linkUpdate!.storyFilesChanged).toBe(2);
    expect(result.linkUpdate!.changedNotesPaths).toContain('Jasper Thorne.md');
  });

  it('never touches plain-text occurrences of the note name', () => {
    writeNote('Jasper.md', 'x');
    writeScene(
      'Manuscript/01/scene-1.md',
      'Jasper walked in. "Jasper!" she cried. Only [[Jasper]] is a link.',
    );

    renameNoteWithCascade({
      notesRoot,
      storyRoot,
      fromPath: 'Jasper.md',
      toPath: 'Jasper Thorne.md',
    });

    expect(readScene('Manuscript/01/scene-1.md')).toBe(
      'Jasper walked in. "Jasper!" she cried. Only [[Jasper Thorne|Jasper]] is a link.',
    );
  });

  it('leaves other notes\' links, session transcripts, and non-md files alone', () => {
    writeNote('Jasper.md', 'x');
    writeNote('Casper.md', 'rhymes');
    writeNote('Allies.md', '[[Casper]] and [[JasperX]] stay; [[Jasper]] goes.');
    writeNote('Sessions/chat-1.md', 'transcript mentions [[Jasper]]');

    renameNoteWithCascade({
      notesRoot,
      storyRoot,
      fromPath: 'Jasper.md',
      toPath: 'Jasper Thorne.md',
    });

    expect(readNote('Allies.md')).toBe('[[Casper]] and [[JasperX]] stay; [[Jasper Thorne]] goes.');
    expect(readNote('Sessions/chat-1.md')).toBe('transcript mentions [[Jasper]]');
  });

  it('does not cascade on folder moves or same-stem moves', () => {
    writeNote('Jasper.md', 'x');
    writeNote('Allies.md', '[[Jasper]]');

    const result = renameNoteWithCascade({
      notesRoot,
      storyRoot,
      fromPath: 'Jasper.md',
      toPath: 'Characters/Jasper.md',
    });

    expect(result.moved).toBe(true);
    expect(result.linkUpdate).toBeUndefined();
    expect(readNote('Allies.md')).toBe('[[Jasper]]'); // stem-resolved: still fine
  });

  it('works without a story vault configured', () => {
    writeNote('Jasper.md', 'x');
    writeNote('Allies.md', '[[Jasper]]');
    const result = renameNoteWithCascade({
      notesRoot,
      storyRoot: '',
      fromPath: 'Jasper.md',
      toPath: 'Jasper Thorne.md',
    });
    expect(result.linkUpdate!.storyFilesChanged).toBe(0);
    expect(readNote('Allies.md')).toBe('[[Jasper Thorne]]');
  });
});

describe('undo — one step, never overwrites newer work', () => {
  it('renames back and restores every rewritten file in one call', () => {
    writeNote('Jasper.md', 'self: [[Jasper]]');
    writeNote('Allies.md', '[[Jasper]] and [[Jasper|Jay]]');
    writeScene('Manuscript/01/scene-1.md', '[[Jasper]] appears.');

    renameNoteWithCascade({
      notesRoot,
      storyRoot,
      fromPath: 'Jasper.md',
      toPath: 'Jasper Thorne.md',
    });
    const undo = undoLastRenameCascade({ notesRoot, storyRoot });

    expect(undo.undone).toBe(true);
    expect(undo.filesRestored).toBe(3);
    expect(undo.filesSkipped).toBe(0);
    expect(fs.existsSync(path.join(notesRoot, 'Jasper.md'))).toBe(true);
    expect(fs.existsSync(path.join(notesRoot, 'Jasper Thorne.md'))).toBe(false);
    expect(readNote('Jasper.md')).toBe('self: [[Jasper]]');
    expect(readNote('Allies.md')).toBe('[[Jasper]] and [[Jasper|Jay]]');
    expect(readScene('Manuscript/01/scene-1.md')).toBe('[[Jasper]] appears.');

    // One-shot: a second undo has nothing to do.
    expect(undoLastRenameCascade({ notesRoot, storyRoot }).undone).toBe(false);
  });

  it('skips files edited since the rename instead of clobbering them', () => {
    writeNote('Jasper.md', 'x');
    writeNote('Allies.md', '[[Jasper]]');
    writeNote('Enemies.md', '[[Jasper]]');

    renameNoteWithCascade({
      notesRoot,
      storyRoot,
      fromPath: 'Jasper.md',
      toPath: 'Jasper Thorne.md',
    });
    writeNote('Allies.md', 'User rewrote this after the rename.');

    const undo = undoLastRenameCascade({ notesRoot, storyRoot });
    expect(undo.undone).toBe(true);
    expect(undo.filesSkipped).toBe(1);
    expect(readNote('Allies.md')).toBe('User rewrote this after the rename.');
    expect(readNote('Enemies.md')).toBe('[[Jasper]]');
  });

  it('reverts just the link span in a story file edited elsewhere since the rename (SKY-10887)', () => {
    writeNote('Jasper.md', 'x');
    writeScene('Manuscript/01/scene-1.md', 'Then [[Jasper]] arrived. The weather was calm.');

    renameNoteWithCascade({
      notesRoot,
      storyRoot,
      fromPath: 'Jasper.md',
      toPath: 'Jasper Thorne.md',
    });
    expect(readScene('Manuscript/01/scene-1.md')).toBe(
      'Then [[Jasper Thorne|Jasper]] arrived. The weather was calm.',
    );
    // User edits the scene elsewhere, well away from the link, after the cascade.
    writeScene(
      'Manuscript/01/scene-1.md',
      'Then [[Jasper Thorne|Jasper]] arrived. The weather turned stormy without warning.',
    );

    const undo = undoLastRenameCascade({ notesRoot, storyRoot });
    expect(undo.undone).toBe(true);
    expect(undo.filesSkipped).toBe(0);
    expect(undo.filesRestored).toBe(1);
    expect(undo.restoredStoryPaths).toContain('Manuscript/01/scene-1.md');
    // Link span reverted to the original bare form; the unrelated edit survives.
    expect(readScene('Manuscript/01/scene-1.md')).toBe(
      'Then [[Jasper]] arrived. The weather turned stormy without warning.',
    );
  });

  it('reverts just the link span in a notes file edited elsewhere since the rename (SKY-10887)', () => {
    writeNote('Jasper.md', 'x');
    writeNote('Allies.md', 'See [[Jasper]] for details.');

    renameNoteWithCascade({
      notesRoot,
      storyRoot,
      fromPath: 'Jasper.md',
      toPath: 'Jasper Thorne.md',
    });
    expect(readNote('Allies.md')).toBe('See [[Jasper Thorne]] for details.');
    // User edits the note elsewhere, well away from the link, after the cascade.
    writeNote('Allies.md', 'See [[Jasper Thorne]] for details. Also new info here.');

    const undo = undoLastRenameCascade({ notesRoot, storyRoot });
    expect(undo.undone).toBe(true);
    expect(undo.filesSkipped).toBe(0);
    expect(undo.filesRestored).toBe(1);
    expect(undo.restoredNotesPaths).toContain('Allies.md');
    // Link span reverted to the original bare form; the unrelated edit survives.
    expect(readNote('Allies.md')).toBe('See [[Jasper]] for details. Also new info here.');
  });

  it('refuses when the renamed note has since moved or the old name is retaken', () => {
    writeNote('Jasper.md', 'x');
    writeNote('Allies.md', '[[Jasper]]');
    renameNoteWithCascade({
      notesRoot,
      storyRoot,
      fromPath: 'Jasper.md',
      toPath: 'Jasper Thorne.md',
    });
    writeNote('Jasper.md', 'a brand-new note under the old name');

    const undo = undoLastRenameCascade({ notesRoot, storyRoot });
    expect(undo.undone).toBe(false);
    expect(undo.reason).toMatch(/original name/);
    expect(readNote('Jasper.md')).toBe('a brand-new note under the old name');
  });
});

describe('rewriteWikiLinksForRename — the shared transform', () => {
  const cases: Array<[string, string, string]> = [
    // [input, notes-mode expected, manuscript-mode expected]
    ['[[Jasper]]', '[[Jasper Thorne]]', '[[Jasper Thorne|Jasper]]'],
    ['[[jasper]]', '[[Jasper Thorne]]', '[[Jasper Thorne|jasper]]'],
    ['[[Jasper|Jay]]', '[[Jasper Thorne|Jay]]', '[[Jasper Thorne|Jay]]'],
    ['[[Jasper#Backstory]]', '[[Jasper Thorne#Backstory]]', '[[Jasper Thorne#Backstory|Jasper#Backstory]]'],
    ['[[Jasper#Backstory|Jay]]', '[[Jasper Thorne#Backstory|Jay]]', '[[Jasper Thorne#Backstory|Jay]]'],
    ['![[Jasper]]', '![[Jasper Thorne]]', '![[Jasper Thorne|Jasper]]'],
    ['[[Characters/Jasper]]', '[[Characters/Jasper Thorne]]', '[[Characters/Jasper Thorne|Characters/Jasper]]'],
    ['[[Jasper.md]]', '[[Jasper Thorne.md]]', '[[Jasper Thorne.md|Jasper.md]]'],
    // Empty alias renders its target — treat as bare so display is preserved.
    ['[[Jasper|]]', '[[Jasper Thorne]]', '[[Jasper Thorne|Jasper]]'],
    // Non-matches stay byte-identical.
    ['[[JasperX]]', '[[JasperX]]', '[[JasperX]]'],
    ['[[Jasper.png]]', '[[Jasper.png]]', '[[Jasper.png]]'],
    ['Jasper unlinked', 'Jasper unlinked', 'Jasper unlinked'],
    ['[[Casper|Jasper]]', '[[Casper|Jasper]]', '[[Casper|Jasper]]'], // alias is not a target
  ];

  it.each(cases)('%s', (input, notesExpected, manuscriptExpected) => {
    expect(rewriteWikiLinksForRename(input, 'Jasper', 'Jasper Thorne', 'update-display').content).toBe(notesExpected);
    expect(rewriteWikiLinksForRename(input, 'Jasper', 'Jasper Thorne', 'preserve-display').content).toBe(manuscriptExpected);
  });

  it('is its own inverse for undo state-patching', () => {
    const original = 'A [[Jasper]] B [[Jasper|Jay]] C [[Jasper#H]] D';
    const forward = rewriteWikiLinksForRename(original, 'Jasper', 'Jasper Thorne', 'preserve-display').content;
    const back = rewriteWikiLinksForRename(forward, 'Jasper Thorne', 'Jasper', 'update-display').content;
    expect(back).toBe(original);
  });

  it('counts rewritten links', () => {
    const r = rewriteWikiLinksForRename('[[Jasper]] [[Jasper]] [[Other]]', 'Jasper', 'New', 'update-display');
    expect(r.count).toBe(2);
  });
});

describe('progress reporting', () => {
  it('emits {current,total,lastAction} per rewritten file', () => {
    writeNote('Jasper.md', 'x');
    writeNote('A.md', '[[Jasper]]');
    writeNote('B.md', '[[Jasper]]');
    const events: Array<{ current: number; total: number }> = [];
    renameNoteWithCascade({
      notesRoot,
      storyRoot,
      fromPath: 'Jasper.md',
      toPath: 'Jasper Thorne.md',
      onProgress: (p) => events.push({ current: p.current, total: p.total }),
    });
    expect(events.length).toBe(2);
    expect(events[events.length - 1]).toEqual({ current: 2, total: 2 });
  });
});
