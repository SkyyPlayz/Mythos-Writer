// SKY-11192/SKY-11674 — unit coverage for migrating the retired Brainstorm
// board's cards into real Notes Vault notes: idempotent, never overwrites,
// never deletes the legacy file (renames to `.migrated`), tolerates
// malformed JSON, and no-ops once already migrated.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentVaultRootFor, notesVaultRootFor } from './mythosJson.js';
import { migrateBrainstormBoardCardsToNotes } from './brainstormBoardMigration.js';

let mythosRoot: string;

beforeEach(() => {
  mythosRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-bsmigrate-'));
});
afterEach(() => {
  fs.rmSync(mythosRoot, { recursive: true, force: true });
});

const legacyPath = (root: string) => path.join(agentVaultRootFor(root), 'Boards', 'brainstorm.board.json');

function writeLegacyBoard(root: string, body: unknown): void {
  const p = legacyPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(body), 'utf-8');
}

describe('migrateBrainstormBoardCardsToNotes', () => {
  it('is a no-op when no legacy board file exists', () => {
    const result = migrateBrainstormBoardCardsToNotes(mythosRoot);
    expect(result).toEqual({ migrated: false, filed: 0, alreadyFiled: 0 });
  });

  it('files every card into its mapped folder as a real note, then renames the legacy file (never deletes it)', () => {
    writeLegacyBoard(mythosRoot, {
      version: 1,
      draftMigrated: true,
      cards: [
        { id: 'c1', cat: 'rel', title: 'Mira and the Captain', desc: 'Old rivals.', x: 10, y: 20 },
        { id: 'c2', cat: 'world', title: 'The Glass Coast', desc: 'A shoreline of shattered mirrors.', x: 30, y: 40 },
        { id: 'c3', cat: 'beats', title: 'The Betrayal Is Revealed', desc: '', x: 50, y: 60 },
      ],
      links: [],
    });

    const result = migrateBrainstormBoardCardsToNotes(mythosRoot);
    expect(result).toEqual({ migrated: true, filed: 3, alreadyFiled: 0 });

    const notesRoot = notesVaultRootFor(mythosRoot);
    expect(fs.readFileSync(path.join(notesRoot, 'Characters', 'Mira and the Captain.md'), 'utf-8')).toContain('Old rivals.');
    expect(fs.readFileSync(path.join(notesRoot, 'Worldbuilding', 'The Glass Coast.md'), 'utf-8')).toContain('shattered mirrors');
    expect(fs.existsSync(path.join(notesRoot, 'Plot & Story', 'The Betrayal Is Revealed.md'))).toBe(true);

    // Legacy file is renamed, not deleted — the data stays on disk.
    expect(fs.existsSync(legacyPath(mythosRoot))).toBe(false);
    expect(fs.existsSync(`${legacyPath(mythosRoot)}.migrated`)).toBe(true);
  });

  it('does not overwrite a note that already exists with the same name (idempotent re-run)', () => {
    const notesRoot = notesVaultRootFor(mythosRoot);
    fs.mkdirSync(path.join(notesRoot, 'Plot & Story'), { recursive: true });
    fs.writeFileSync(path.join(notesRoot, 'Plot & Story', 'Midpoint Reversal.md'), '# hand-written, keep me\n', 'utf-8');
    writeLegacyBoard(mythosRoot, {
      version: 1,
      cards: [{ id: 'c1', cat: 'beats', title: 'Midpoint Reversal', desc: 'agent version', x: 0, y: 0 }],
    });

    const result = migrateBrainstormBoardCardsToNotes(mythosRoot);
    expect(result).toEqual({ migrated: true, filed: 0, alreadyFiled: 1 });
    expect(fs.readFileSync(path.join(notesRoot, 'Plot & Story', 'Midpoint Reversal.md'), 'utf-8')).toBe('# hand-written, keep me\n');
  });

  it('tolerates malformed JSON without throwing, and still renames the legacy file', () => {
    const p = legacyPath(mythosRoot);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '{ not valid json', 'utf-8');

    const result = migrateBrainstormBoardCardsToNotes(mythosRoot);
    expect(result).toEqual({ migrated: true, filed: 0, alreadyFiled: 0 });
    expect(fs.existsSync(`${p}.migrated`)).toBe(true);
  });

  it('skips cards with no title rather than filing an empty note', () => {
    writeLegacyBoard(mythosRoot, {
      version: 1,
      cards: [{ id: 'c1', cat: 'loose', title: '', desc: 'no title here', x: 0, y: 0 }],
    });
    const result = migrateBrainstormBoardCardsToNotes(mythosRoot);
    expect(result).toEqual({ migrated: true, filed: 0, alreadyFiled: 0 });
  });

  it('is a no-op on a second call once the legacy file has been renamed', () => {
    writeLegacyBoard(mythosRoot, { version: 1, cards: [{ id: 'c1', cat: 'loose', title: 'Once', desc: '', x: 0, y: 0 }] });
    migrateBrainstormBoardCardsToNotes(mythosRoot);
    const second = migrateBrainstormBoardCardsToNotes(mythosRoot);
    expect(second).toEqual({ migrated: false, filed: 0, alreadyFiled: 0 });
  });

  it('an unknown/legacy category falls back to loose -> Plot & Story rather than dropping the card', () => {
    writeLegacyBoard(mythosRoot, {
      version: 1,
      cards: [{ id: 'c1', cat: 'character', title: 'Old Legacy Category', desc: '', x: 0, y: 0 }],
    });
    const result = migrateBrainstormBoardCardsToNotes(mythosRoot);
    expect(result.filed).toBe(1);
    const notesRoot = notesVaultRootFor(mythosRoot);
    expect(fs.existsSync(path.join(notesRoot, 'Plot & Story', 'Old Legacy Category.md'))).toBe(true);
  });
});
