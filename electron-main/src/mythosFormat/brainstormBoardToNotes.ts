// SKY-11192 — one-time migration of the retired brainstorm board into real notes.
//
// The Brainstorm page used to keep its own free-form idea canvas: cards in six
// hard-coded categories, positions and all, in a single JSON blob under
// `Agent Vault/Boards/brainstorm.board.json`. SKY-11192 replaces that with the
// Notes Board canvas over real vault folders, so the old model goes away.
//
// The MODEL goes away; the user's IDEAS do not (CEO ruling 2). Every card
// becomes a real note in the folder its category maps to, and the old file is
// renamed `.migrated` and left on disk — never deleted, so a user who wants
// the raw JSON back can still find it, and so a bug here is recoverable.
//
// Two properties this has to have, both tested in brainstormBoardToNotes.test.ts:
//
//   IDEMPOTENT. Running twice must not produce a second copy of anything. Two
//   independent reasons it holds: the source file is renamed away after a
//   successful pass (so a second call finds nothing to do), and every note is
//   written only when no file of that name already exists.
//
//   NEVER OVERWRITES. If the user already has `Plot & Story/The Betrayal.md`,
//   whether hand-written or filed earlier from Idea Collections, migration
//   skips that card rather than clobbering it. A skipped card is reported, not
//   silently dropped. Names come from the SHARED ideaNotes module, the same one
//   the renderer's `File` button uses, so "already there" means the same thing
//   on both sides.
//
// Pure Node.

import fs from 'node:fs';
import path from 'node:path';
import { ideaNoteBody, ideaNoteName, ideaTargetFolder } from '@mythos-writer/shared/ideaNotes';
import { writeVaultFileAtomic, renameSyncWithRetry } from '../vault.js';
import { agentVaultRootFor, notesVaultRootFor } from './mythosJson.js';
import { BRAINSTORM_BOARD_RELPATH } from './brainstormBoardFile.js';

/** Suffix the retired board file is parked under. */
export const MIGRATED_SUFFIX = '.migrated';

export interface BoardToNotesResult {
  /** True when a board file was found and has now been parked. */
  migrated: boolean;
  /** Vault-relative paths of notes this run created. */
  created: string[];
  /** Vault-relative paths skipped because a note of that name already existed. */
  skipped: string[];
  /** Set when the board file existed but could not be parsed or parked. */
  error?: string;
}

/** The only fields of a legacy card this migration needs. */
interface LegacyCard {
  cat?: string;
  title?: string;
  desc?: string;
  chips?: string[];
}

/**
 * Pull the card list out of a legacy board file.
 *
 * Deliberately lenient: this runs once, over a file the user cannot re-create,
 * so a card with a missing `desc` or an unknown `cat` is migrated on a best
 * effort (unknown categories fall to Plot & Story via ideaTargetFolder) rather
 * than aborting the whole pass. Only a card with no usable title is dropped —
 * there is no note to make from it.
 */
export function parseLegacyCards(raw: string): LegacyCard[] | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object') return null;
  const cards = (json as { cards?: unknown }).cards;
  if (!Array.isArray(cards)) return null;
  const out: LegacyCard[] = [];
  for (const entry of cards) {
    if (!entry || typeof entry !== 'object') continue;
    const c = entry as Record<string, unknown>;
    const title = typeof c.title === 'string' ? c.title.trim() : '';
    if (!title) continue;
    out.push({
      title,
      cat: typeof c.cat === 'string' ? c.cat : undefined,
      desc: typeof c.desc === 'string' ? c.desc : '',
      chips: Array.isArray(c.chips) ? c.chips.filter((ch): ch is string => typeof ch === 'string') : [],
    });
  }
  return out;
}

/** `x.json.migrated` → `x.json.migrated (2)`, … so a re-run never clobbers a park. */
function uniquePath(candidate: string): string {
  if (!fs.existsSync(candidate)) return candidate;
  for (let n = 2; ; n++) {
    const next = `${candidate} (${n})`;
    if (!fs.existsSync(next)) return next;
  }
}

/**
 * Migrate `Agent Vault/Boards/brainstorm.board.json` into real Notes Vault
 * notes, then park the source file.
 *
 * Safe to call on every vault open once the unified-board flag is on: the
 * existsSync below makes the steady-state cost one stat.
 */
export function migrateBrainstormBoardToNotes(mythosRoot: string): BoardToNotesResult {
  const sourcePath = path.join(agentVaultRootFor(mythosRoot), BRAINSTORM_BOARD_RELPATH);
  const empty: BoardToNotesResult = { migrated: false, created: [], skipped: [] };
  if (!fs.existsSync(sourcePath)) return empty;

  let raw: string;
  try {
    raw = fs.readFileSync(sourcePath, 'utf8');
  } catch (err) {
    return { ...empty, error: (err as Error).message || 'read failed' };
  }

  const cards = parseLegacyCards(raw);
  if (cards === null) {
    // Unreadable JSON. Park it anyway — there is nothing to recover from it and
    // leaving it in place would retry the parse on every open forever — but say
    // so, so the caller can log it rather than report a clean migration.
    const parked = parkSource(sourcePath);
    return { migrated: parked, created: [], skipped: [], error: 'board file was not valid JSON' };
  }

  const notesRoot = notesVaultRootFor(mythosRoot);
  const created: string[] = [];
  const skipped: string[] = [];

  for (const card of cards) {
    const folder = ideaTargetFolder(card.cat);
    const name = ideaNoteName(card.title ?? '');
    const relPath = path.posix.join(folder, `${name}.md`);
    const absPath = path.join(notesRoot, folder, `${name}.md`);

    // NEVER OVERWRITE. Two cards in the old board could also share a title;
    // the second one lands here too, which is the correct outcome — one idea,
    // one note.
    if (fs.existsSync(absPath)) {
      skipped.push(relPath);
      continue;
    }
    try {
      fs.mkdirSync(path.join(notesRoot, folder), { recursive: true });
      writeVaultFileAtomic(notesRoot, relPath, ideaNoteBody({
        title: card.title ?? '',
        desc: card.desc,
        chips: card.chips,
      }));
      created.push(relPath);
    } catch {
      // One unwritable note must not abandon the rest of the board. It stays
      // in the source file, which is only parked if the whole pass got here.
      skipped.push(relPath);
    }
  }

  const parked = parkSource(sourcePath);
  return {
    migrated: parked,
    created,
    skipped,
    ...(parked ? {} : { error: 'notes were written but the board file could not be parked' }),
  };
}

/** Rename the board file out of the way. False = leave it for the next open. */
function parkSource(sourcePath: string): boolean {
  try {
    renameSyncWithRetry(sourcePath, uniquePath(`${sourcePath}${MIGRATED_SUFFIX}`));
    return true;
  } catch {
    return false;
  }
}
