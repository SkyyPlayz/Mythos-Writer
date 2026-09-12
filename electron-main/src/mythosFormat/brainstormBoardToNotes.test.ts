/**
 * SKY-11192 — the retired brainstorm board becomes real notes.
 *
 * CEO ruling 2: delete the MODEL, keep the user's IDEAS. These tests are the
 * acceptance record for the two properties that ruling turns on — migration is
 * idempotent, and it never overwrites a note the user already has.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  migrateBrainstormBoardToNotes,
  previewBrainstormBoardMigration,
  parseLegacyCards,
  MIGRATED_SUFFIX,
} from './brainstormBoardToNotes.js';
import { BRAINSTORM_BOARD_RELPATH } from './brainstormBoardFile.js';
import { agentVaultRootFor, notesVaultRootFor } from './mythosJson.js';

let mythosRoot: string;
let boardPath: string;
let notesRoot: string;

/** Write a legacy board file with the given cards. */
function seedBoard(cards: Array<Record<string, unknown>>): void {
  fs.mkdirSync(path.dirname(boardPath), { recursive: true });
  fs.writeFileSync(boardPath, JSON.stringify({ version: 1, draftMigrated: false, cards, links: [] }));
}

function readNote(rel: string): string {
  return fs.readFileSync(path.join(notesRoot, rel), 'utf8');
}

beforeEach(() => {
  mythosRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sky11192-'));
  notesRoot = notesVaultRootFor(mythosRoot);
  boardPath = path.join(agentVaultRootFor(mythosRoot), BRAINSTORM_BOARD_RELPATH);
  fs.mkdirSync(notesRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(mythosRoot, { recursive: true, force: true });
});

describe('parseLegacyCards', () => {
  it('returns null for a file that is not JSON, so the caller can park it', () => {
    expect(parseLegacyCards('not json{')).toBeNull();
  });

  it('returns null when there is no card array to migrate', () => {
    expect(parseLegacyCards('{"version":1}')).toBeNull();
  });

  it('drops a card with no usable title — there is no note to make from it', () => {
    const cards = parseLegacyCards('{"cards":[{"title":"  "},{"title":"Real"}]}');
    expect(cards?.map((c) => c.title)).toEqual(['Real']);
  });

  it('keeps a card whose category is unknown rather than aborting the pass', () => {
    // This file cannot be re-created by the user, so a best-effort migration
    // beats a strict one that refuses the whole board over one bad field.
    const cards = parseLegacyCards('{"cards":[{"title":"X","cat":"invented"}]}');
    expect(cards).toHaveLength(1);
  });
});

/**
 * AC 4: the migration is offered, never performed on the user's behalf, so the
 * renderer needs to know what is waiting BEFORE anything is written. The whole
 * point of these tests is the last one — that asking does not change the vault.
 */
describe('previewBrainstormBoardMigration', () => {
  it('reports nothing to do when there is no legacy board file', () => {
    expect(previewBrainstormBoardMigration(mythosRoot)).toEqual({ pending: 0, unreadable: false });
  });

  it('counts the cards the migration would act on, not the raw array length', () => {
    // The titleless card is dropped by parseLegacyCards, so offering "3" here
    // would promise the user one more note than the click can deliver.
    seedBoard([{ title: 'Keep' }, { title: '   ' }, { title: 'Also keep' }]);
    expect(previewBrainstormBoardMigration(mythosRoot)).toEqual({ pending: 2, unreadable: false });
  });

  it('flags an unparseable board rather than calling it empty', () => {
    fs.mkdirSync(path.dirname(boardPath), { recursive: true });
    fs.writeFileSync(boardPath, 'not json{');
    expect(previewBrainstormBoardMigration(mythosRoot)).toEqual({ pending: 0, unreadable: true });
  });

  it('reports nothing once the source has been parked', () => {
    seedBoard([{ title: 'Gone' }]);
    migrateBrainstormBoardToNotes(mythosRoot);
    expect(previewBrainstormBoardMigration(mythosRoot)).toEqual({ pending: 0, unreadable: false });
  });

  it('does not touch the vault — asking is not consent (AC 4)', () => {
    seedBoard([{ title: 'Midpoint Reversal', cat: 'beats', desc: 'The goal changes.' }]);
    const before = fs.readFileSync(boardPath, 'utf8');

    previewBrainstormBoardMigration(mythosRoot);
    previewBrainstormBoardMigration(mythosRoot);

    // Source untouched, nothing parked, and no note written anywhere.
    expect(fs.readFileSync(boardPath, 'utf8')).toBe(before);
    expect(fs.existsSync(`${boardPath}${MIGRATED_SUFFIX}`)).toBe(false);
    expect(fs.existsSync(path.join(notesRoot, 'Plot & Story'))).toBe(false);
  });
});

describe('SKY-11192 — migrating the board into notes', () => {
  it('is a clean no-op when there is no legacy board file', () => {
    expect(migrateBrainstormBoardToNotes(mythosRoot)).toEqual({
      migrated: false, created: [], skipped: [],
    });
  });

  it('writes each card into the folder its category maps to', () => {
    seedBoard([
      { title: 'Midpoint Reversal', cat: 'beats', desc: 'The goal changes.' },
      { title: 'Mira and Vale', cat: 'rel', desc: 'Rivals.' },
      { title: 'The Deep Vault', cat: 'world', desc: 'Under the city.' },
    ]);

    const res = migrateBrainstormBoardToNotes(mythosRoot);

    expect(res.migrated).toBe(true);
    expect(res.created.sort()).toEqual([
      'Characters/Mira and Vale.md',
      'Plot & Story/Midpoint Reversal.md',
      'Worldbuilding/The Deep Vault.md',
    ]);
    expect(readNote('Plot & Story/Midpoint Reversal.md')).toContain('The goal changes.');
  });

  it('creates the target folders when the vault does not have them', () => {
    seedBoard([{ title: 'X', cat: 'world' }]);
    migrateBrainstormBoardToNotes(mythosRoot);
    expect(fs.existsSync(path.join(notesRoot, 'Worldbuilding'))).toBe(true);
  });

  it('parks the board file as .migrated and NEVER deletes it (ruling 2)', () => {
    seedBoard([{ title: 'X', cat: 'beats' }]);
    migrateBrainstormBoardToNotes(mythosRoot);

    expect(fs.existsSync(boardPath)).toBe(false);
    expect(fs.existsSync(`${boardPath}${MIGRATED_SUFFIX}`)).toBe(true);
    // The user's original data is still readable, byte for byte.
    expect(JSON.parse(fs.readFileSync(`${boardPath}${MIGRATED_SUFFIX}`, 'utf8')).cards)
      .toHaveLength(1);
  });

  it('NEVER overwrites a note the user already has', () => {
    fs.mkdirSync(path.join(notesRoot, 'Plot & Story'), { recursive: true });
    fs.writeFileSync(path.join(notesRoot, 'Plot & Story', 'The Betrayal.md'), 'MY OWN WORDS');
    seedBoard([{ title: 'The Betrayal', cat: 'trope', desc: 'from the old board' }]);

    const res = migrateBrainstormBoardToNotes(mythosRoot);

    expect(res.skipped).toEqual(['Plot & Story/The Betrayal.md']);
    expect(res.created).toEqual([]);
    expect(readNote('Plot & Story/The Betrayal.md')).toBe('MY OWN WORDS');
  });

  it('is idempotent — a second run creates nothing', () => {
    seedBoard([{ title: 'Found Family', cat: 'theme', desc: 'd' }]);

    const first = migrateBrainstormBoardToNotes(mythosRoot);
    const second = migrateBrainstormBoardToNotes(mythosRoot);

    expect(first.created).toEqual(['Plot & Story/Found Family.md']);
    expect(second).toEqual({ migrated: false, created: [], skipped: [] });
    expect(fs.readdirSync(path.join(notesRoot, 'Plot & Story'))).toEqual(['Found Family.md']);
  });

  it('is idempotent even if the same board file comes back', () => {
    // The source file is normally parked, so a re-run finds nothing. Belt and
    // braces: restore it and confirm the per-note existence check also holds,
    // because that is the check that protects against a restored backup.
    seedBoard([{ title: 'Found Family', cat: 'theme', desc: 'd' }]);
    migrateBrainstormBoardToNotes(mythosRoot);
    seedBoard([{ title: 'Found Family', cat: 'theme', desc: 'd' }]);

    const second = migrateBrainstormBoardToNotes(mythosRoot);

    expect(second.created).toEqual([]);
    expect(second.skipped).toEqual(['Plot & Story/Found Family.md']);
    expect(fs.readdirSync(path.join(notesRoot, 'Plot & Story'))).toEqual(['Found Family.md']);
  });

  it('files two cards sharing a title as ONE note — one idea, one note', () => {
    seedBoard([
      { title: 'Found Family', cat: 'theme', desc: 'first' },
      { title: 'Found Family', cat: 'loose', desc: 'second' },
    ]);

    const res = migrateBrainstormBoardToNotes(mythosRoot);

    expect(res.created).toEqual(['Plot & Story/Found Family.md']);
    expect(res.skipped).toEqual(['Plot & Story/Found Family.md']);
    expect(readNote('Plot & Story/Found Family.md')).toContain('first');
  });

  it('sanitises a title that no filesystem would accept', () => {
    seedBoard([{ title: 'Plot: A/B "test"?', cat: 'beats' }]);
    const res = migrateBrainstormBoardToNotes(mythosRoot);
    expect(res.created).toEqual(['Plot & Story/Plot A B test.md']);
  });

  it('parks an unparseable board file and says so, rather than retrying forever', () => {
    fs.mkdirSync(path.dirname(boardPath), { recursive: true });
    fs.writeFileSync(boardPath, 'not json{');

    const res = migrateBrainstormBoardToNotes(mythosRoot);

    expect(res.error).toMatch(/not valid JSON/);
    expect(res.migrated).toBe(true);
    expect(fs.existsSync(`${boardPath}${MIGRATED_SUFFIX}`)).toBe(true);
    // And the next open is a clean no-op.
    expect(migrateBrainstormBoardToNotes(mythosRoot).error).toBeUndefined();
  });

  it('does not clobber an earlier park if a board file reappears twice', () => {
    seedBoard([{ title: 'A', cat: 'beats' }]);
    migrateBrainstormBoardToNotes(mythosRoot);
    seedBoard([{ title: 'B', cat: 'beats' }]);
    migrateBrainstormBoardToNotes(mythosRoot);

    expect(fs.existsSync(`${boardPath}${MIGRATED_SUFFIX}`)).toBe(true);
    expect(fs.existsSync(`${boardPath}${MIGRATED_SUFFIX} (2)`)).toBe(true);
  });
});
