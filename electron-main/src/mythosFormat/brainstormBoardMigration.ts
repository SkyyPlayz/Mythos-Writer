// SKY-11192/SKY-11674 — one-time migration of the retired Brainstorm board
// model into real Notes Vault notes.
//
// CEO ruling (SKY-11192 comment, ruling 2): migration and the deletion of
// the old board component/model land in the SAME PR — no split ticket, and
// a window where both board models exist is worse than a larger diff. The
// old board's CODE is deleted (components/BrainstormBoard/BoardCanvas.tsx,
// brainstormBoard.ts's category/world model, brainstormBoardStore.ts); the
// user's DATA is migrated, never dropped: every card in the legacy
// `Boards/brainstorm.board.json` becomes a real note in one of the same
// three Idea-Collections-mapped folders (ideaCollectionsFiling.ts), then the
// legacy file is renamed to `.migrated` and left on disk — never deleted.
//
// Idempotent and safe to call on every vault open (mirrors
// migrateBrainstormBoardToAgentVault's contract in brainstormBoardFile.ts):
// a single existsSync check once migrated. Runs unconditionally — this is
// data preservation, not a new UI surface, so it is NOT gated by the
// brainstormBoardsUnification flag.

import fs from 'node:fs';
import path from 'node:path';
import { agentVaultRootFor, notesVaultRootFor } from './mythosJson.js';
import { fileIdea, type IdeaCollectionCategory, IDEA_COLLECTION_FOLDER } from '../ideaCollectionsFiling.js';

const LEGACY_BOARD_FILE = 'brainstorm.board.json';
const LEGACY_BOARD_RELPATH = path.posix.join('Boards', LEGACY_BOARD_FILE);

const CATEGORY_KEYS = new Set<IdeaCollectionCategory>(Object.keys(IDEA_COLLECTION_FOLDER) as IdeaCollectionCategory[]);

interface LegacyBoardCard {
  id: string;
  cat: IdeaCollectionCategory;
  title: string;
  desc: string;
}

/** Permissive parse of the legacy board JSON — tolerates anything malformed by dropping it, never throws (matches the retired frontend parseBoardFile's NaN/shape-guard philosophy). */
function parseLegacyCards(raw: string): LegacyBoardCard[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!json || typeof json !== 'object') return [];
  const obj = json as Record<string, unknown>;
  if (!Array.isArray(obj.cards)) return [];

  const cards: LegacyBoardCard[] = [];
  for (const entry of obj.cards) {
    if (!entry || typeof entry !== 'object') continue;
    const c = entry as Record<string, unknown>;
    if (typeof c.id !== 'string' || !c.id) continue;
    if (typeof c.title !== 'string' || !c.title.trim()) continue;
    const cat: IdeaCollectionCategory = typeof c.cat === 'string' && CATEGORY_KEYS.has(c.cat as IdeaCollectionCategory)
      ? (c.cat as IdeaCollectionCategory)
      : 'loose';
    cards.push({ id: c.id, cat, title: c.title, desc: typeof c.desc === 'string' ? c.desc : '' });
  }
  return cards;
}

export interface MigrateBrainstormBoardCardsResult {
  migrated: boolean;
  filed: number;
  alreadyFiled: number;
}

/**
 * File every legacy board card as a real note, then rename the legacy JSON
 * to `.migrated` (never delete — the CEO ruling's data-preservation
 * constraint). Already-filed cards (matched by note name, same rule as
 * ideaCollectionsFiling.findFiledNote) are skipped without error — this
 * makes the whole function safe to re-run if it's ever interrupted
 * mid-migration.
 */
export function migrateBrainstormBoardCardsToNotes(mythosRoot: string): MigrateBrainstormBoardCardsResult {
  const agentVaultRoot = agentVaultRootFor(mythosRoot);
  const legacyPath = path.join(agentVaultRoot, LEGACY_BOARD_RELPATH);
  if (!fs.existsSync(legacyPath)) return { migrated: false, filed: 0, alreadyFiled: 0 };

  const notesVaultRoot = notesVaultRootFor(mythosRoot);
  let raw: string;
  try {
    raw = fs.readFileSync(legacyPath, 'utf-8');
  } catch {
    return { migrated: false, filed: 0, alreadyFiled: 0 };
  }

  const cards = parseLegacyCards(raw);
  let filed = 0;
  let alreadyFiled = 0;
  for (const card of cards) {
    const result = fileIdea({
      notesVaultRoot,
      category: card.cat,
      title: card.title,
      desc: card.desc,
    });
    if (result.status === 'filed') filed += 1;
    else alreadyFiled += 1;
  }

  // Never delete the legacy file — rename it in place so it stays on disk
  // as a recoverable record, matching the ticket's explicit "do NOT delete
  // the user's data" constraint. `n` suffix guards the vanishingly unlikely
  // case a `.migrated` file already exists (e.g. a prior interrupted run
  // that got this far but crashed before returning).
  let migratedPath = `${legacyPath}.migrated`;
  for (let n = 2; fs.existsSync(migratedPath); n++) {
    migratedPath = `${legacyPath}.migrated.${n}`;
  }
  try {
    fs.renameSync(legacyPath, migratedPath);
  } catch {
    // Leave the legacy file in place rather than lose track of it — the
    // notes it named are already filed (or were already-filed), so at worst
    // this re-runs (harmlessly, idempotently) on the next vault open.
  }

  return { migrated: true, filed, alreadyFiled };
}
