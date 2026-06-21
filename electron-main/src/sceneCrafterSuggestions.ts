// Scene Crafter card suggestion logic — SKY-1764.
// Handles accept/reject for brainstorm-proposed Scene Crafter board cards.
// Pure functions; no Electron imports; fully unit-testable.

import { randomUUID } from 'crypto';
import type { SceneCrafterBoard } from './sceneCrafterBoard.js';
import {
  upsertSuggestion,
  updateSuggestionStatus,
  insertAuditLog,
  getSuggestion,
} from './db.js';

// ─── Types ───

export interface SceneCrafterCardSuggestionPayload {
  /** Card title for the new board card. */
  title: string;
  /** Optional wikilink target (defaults to title). */
  linkedNotePath?: string;
  tags?: string[];
}

export interface SceneCrafterCardSuggestionTarget {
  boardId: string;
  storySlug: string;
  /** Lane name to add the card to. Absent → "Idea". */
  laneId?: string;
}

/** Stored in `payload_json` of the suggestions row. */
export interface SceneCrafterCardSuggestionData {
  kind: 'scene_crafter_card';
  /** 'archive' when emitted by the Archive agent; 'brainstorm' for legacy brainstorm proposals. */
  source: 'brainstorm' | 'archive';
  confidence: number;
  rationale: string;
  timestamp: string;
  target: SceneCrafterCardSuggestionTarget;
  payload: SceneCrafterCardSuggestionPayload;
  status: 'proposed';
}

export interface AcceptSceneCrafterSuggestionResult {
  auditId: string;
  cardPath: string;
  laneUsed: string;
  laneIndex: number;
}

export interface RejectSceneCrafterSuggestionResult {
  auditId: string;
}

// ─── Suggestion creation ───

export function createSceneCrafterCardSuggestion(
  data: Omit<SceneCrafterCardSuggestionData, 'status'>,
  now = new Date().toISOString(),
): string {
  const id = randomUUID();
  const suggestionData: SceneCrafterCardSuggestionData = { ...data, status: 'proposed' };
  upsertSuggestion({
    id,
    source_agent: data.source,
    confidence: data.confidence,
    rationale: data.rationale,
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
  return id;
}

// ─── Accept ───

/**
 * Accept a scene_crafter_card suggestion:
 * 1. Resolve the target lane (by name, case-sensitive; fallback = "Idea").
 * 2. Add the card via handleAddCard.
 * 3. Update suggestion status to "applied".
 * 4. Write audit log entry.
 */
export function acceptSceneCrafterCardSuggestion(
  suggestionId: string,
  getBoard: (storySlug: string) => SceneCrafterBoard | null,
  addCard: (storySlug: string, laneIndex: number, card: {
    wikilink: string;
    title: string;
    done?: boolean;
    tags?: string[];
    raw?: string;
  }) => void,
  actor: string,
  now = new Date().toISOString(),
): AcceptSceneCrafterSuggestionResult {
  const row = getSuggestion(suggestionId);
  if (!row) throw new Error(`Suggestion not found: ${suggestionId}`);

  const data = JSON.parse(row.payload_json ?? 'null') as SceneCrafterCardSuggestionData | null;
  if (!data || data.kind !== 'scene_crafter_card') {
    throw new Error(`Suggestion ${suggestionId} is not a scene_crafter_card suggestion`);
  }

  const { storySlug, laneId } = data.target;
  const { title, linkedNotePath, tags } = data.payload;

  const board = getBoard(storySlug);
  if (!board) throw new Error(`Board not found for story slug: ${storySlug}`);

  const targetLaneName = laneId ?? 'Idea';
  let laneIndex = board.lanes.findIndex((l) => l.name === targetLaneName);
  if (laneIndex === -1) {
    // Fallback to first lane; never hard-fail on missing lane name
    laneIndex = 0;
  }
  const laneUsed = board.lanes[laneIndex]?.name ?? targetLaneName;

  const wikilink = linkedNotePath ?? title;
  // Provenance comment appended to raw card line per spec
  const raw = `- [ ] [[${wikilink}]]${tags && tags.length > 0 ? ' ' + tags.map((t) => `#${t}`).join(' ') : ''} <!-- mythos-provenance: ${suggestionId} -->`;

  addCard(storySlug, laneIndex, { wikilink, title, done: false, tags: tags ?? [], raw });

  updateSuggestionStatus(suggestionId, 'applied', now);

  const auditId = randomUUID();
  const cardPath = `${storySlug}/${laneUsed}/${title}`;
  insertAuditLog({
    id: auditId,
    suggestion_id: suggestionId,
    action: 'apply',
    snapshot_path: cardPath,
    actor,
    created_at: now,
  });

  return { auditId, cardPath, laneUsed, laneIndex };
}

// ─── Reject ───

export function rejectSceneCrafterCardSuggestion(
  suggestionId: string,
  actor: string,
  now = new Date().toISOString(),
): RejectSceneCrafterSuggestionResult {
  const row = getSuggestion(suggestionId);
  if (!row) throw new Error(`Suggestion not found: ${suggestionId}`);

  const data = JSON.parse(row.payload_json ?? 'null') as SceneCrafterCardSuggestionData | null;
  if (!data || data.kind !== 'scene_crafter_card') {
    throw new Error(`Suggestion ${suggestionId} is not a scene_crafter_card suggestion`);
  }

  updateSuggestionStatus(suggestionId, 'rejected');

  const auditId = randomUUID();
  insertAuditLog({
    id: auditId,
    suggestion_id: suggestionId,
    action: 'reject',
    snapshot_path: null,
    actor,
    created_at: now,
  });

  return { auditId };
}
