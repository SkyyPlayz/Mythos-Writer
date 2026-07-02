// Archive → Scene Crafter gap-detection generator — SKY-3200 (Part E · E4b).
// Compares the vault entity index against the active Scene Crafter board and
// proposes `scene_crafter_card` suggestions for entities that have no card yet.
// Pure heuristics — zero LLM calls, zero board mutation.
//
// Contract §0 (owner-locked, Beta 2 sign-off): this module writes ONLY to the
// `suggestions` table via `upsertSuggestion()`. It must never import a
// board-mutating export (addCardToBoard/createBoard/removeCard/moveCard/
// reorderLanes/deleteLane) or an IPC-registration module — see
// archiveSceneCrafterGenerator.test.ts CONTRACT 2 for the static enforcement.

import { randomUUID } from 'crypto';
import { upsertSuggestion, listSuggestions } from './db.js';
import type { ArchiveIndex, VaultEntityRecord } from './archiveAgent.js';
import type { SceneCrafterBoard } from './sceneCrafterBoard.js';
import type { SceneCrafterCardSuggestionData } from './sceneCrafterSuggestions.js';

const CONFIDENCE_THRESHOLD = 0.4;
const CONFIDENCE_CAP = 0.95;
const MAX_SUGGESTIONS_PER_RUN = 5;
const STORY_DRIVER_TYPES = new Set(['character', 'location']);

/** Pure heuristic confidence score for whether an entity deserves a Scene Crafter card. */
export function scoreEntityConfidence(entity: VaultEntityRecord, allEntities: VaultEntityRecord[]): number {
  let score = 0;
  if (entity.name) score += 0.3;
  if (Object.keys(entity.properties).length >= 2) score += 0.15;
  if (entity.prose.length >= 50) score += 0.15;
  if (STORY_DRIVER_TYPES.has(entity.type)) score += 0.15;
  if (entity.aliases.length >= 1) score += 0.1;

  const proseLower = entity.prose.toLowerCase();
  const referencesAnotherEntity = allEntities.some(
    (other) => other.id !== entity.id && other.name && proseLower.includes(other.name.toLowerCase()),
  );
  if (referencesAnotherEntity) score += 0.1;

  return Math.min(score, CONFIDENCE_CAP);
}

function boardCardTitleSet(board: SceneCrafterBoard | null): Set<string> {
  const titles = new Set<string>();
  if (!board) return titles;
  for (const lane of board.lanes) {
    for (const card of lane.cards) {
      titles.add(card.title.trim().toLowerCase());
    }
  }
  return titles;
}

function proposedSceneCrafterTitles(): Set<string> {
  const titles = new Set<string>();
  for (const row of listSuggestions('proposed', 'archive')) {
    if (!row.payload_json) continue;
    let data: SceneCrafterCardSuggestionData | null = null;
    try {
      data = JSON.parse(row.payload_json) as SceneCrafterCardSuggestionData;
    } catch {
      continue;
    }
    if (data?.kind !== 'scene_crafter_card') continue;
    titles.add(data.payload.title.trim().toLowerCase());
  }
  return titles;
}

/**
 * Scan the vault entity index for entities that are absent from the Scene
 * Crafter board and emit `scene_crafter_card` suggestions for the strongest
 * candidates (capped at 5 per invocation to avoid inbox flooding).
 *
 * Suggestion-only: this function's only side effect is `upsertSuggestion`
 * (status='proposed'). It never reads or writes the board file.
 */
export function generateSceneCrafterSuggestions(
  index: ArchiveIndex,
  boardSnapshot: SceneCrafterBoard | null,
  storySlug: string,
  now: string,
): number {
  const existingTitles = boardCardTitleSet(boardSnapshot);
  const proposedTitles = proposedSceneCrafterTitles();
  const candidates: Array<{ entity: VaultEntityRecord; score: number }> = [];

  for (const entity of index.entities) {
    const score = scoreEntityConfidence(entity, index.entities);
    if (score < CONFIDENCE_THRESHOLD) continue;

    const normalizedTitle = entity.name.trim().toLowerCase();
    if (existingTitles.has(normalizedTitle)) continue;
    if (proposedTitles.has(normalizedTitle)) continue;

    candidates.push({ entity, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  const selected = candidates.slice(0, MAX_SUGGESTIONS_PER_RUN);

  for (const { entity, score } of selected) {
    const rationale = `Archive: "${entity.name}" (${entity.type}) appears in vault but has no Scene Crafter card.`;
    const suggestionData: SceneCrafterCardSuggestionData = {
      kind: 'scene_crafter_card',
      source: 'archive',
      confidence: score,
      rationale,
      timestamp: now,
      target: { boardId: storySlug, storySlug, laneId: 'Idea' },
      payload: { title: entity.name, linkedNotePath: entity.id, tags: [entity.type] },
      status: 'proposed',
    };
    upsertSuggestion({
      id: randomUUID(),
      source_agent: 'archive',
      confidence: score,
      rationale,
      target_kind: null,
      target_path: null,
      target_anchor: null,
      payload_json: JSON.stringify(suggestionData),
      status: 'proposed',
      created_at: now,
      applied_at: null,
      applied_run_id: null,
      budget_exceeded: 0,
      category: null,
    });
  }

  return selected.length;
}
