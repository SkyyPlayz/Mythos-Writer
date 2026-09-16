// Beta 4 / M19 — Scene Crafter AI draft generation (§7.1).
//
// Coach-framed: the agent explains why it made each craft choice so the
// rewrite teaches the writer, per the M19 copy spec — "…annotates why it
// made each choice, so the rewrite teaches you". The generated prose is
// NEVER written into the manuscript automatically; the writer lifts it onto
// the canvas by hand via "Add to scene board" (B4-9). This module only
// builds a prompt and shapes the agent's response — it calls no IPC itself.
// sceneCrafterDraftNoAutoManuscript.test.ts locks that this generation path
// never reaches a manuscript-write API (AC#6).
//
// Pure functions only — no DOM, no IPC.

import type { CanvasBoardData } from '../../canvas/canvasTypes';
import { CRAFTER_TONES, composeDraftBoard, type ChosenCard, type CrafterSetup } from './crafterState';

/** A completed AI draft, staged for review before it lands on the canvas. */
export interface SceneDraft {
  text: string;
  wordCount: number;
  preview: string;
}

const PREVIEW_CHARS = 220;

function beatsLine(setup: CrafterSetup): string {
  return setup.beats.length > 0 ? setup.beats.join(' → ') : '(no beats set)';
}

function tonesLine(setup: CrafterSetup): string {
  const tones = CRAFTER_TONES.filter((tone) => setup.tones[tone]);
  return tones.length > 0 ? tones.join(', ') : '(no tone set)';
}

/**
 * Coach-framed generation prompt: a first-pass prose draft plus a short "why"
 * annotation for the key craft choices, so the rewrite teaches the writer.
 */
export function buildDraftPrompt(setup: CrafterSetup, chosen: ChosenCard[]): string {
  const title = setup.title.trim() || 'Untitled scene';
  const lines = [
    'Write a first-pass prose draft for this scene, then briefly annotate ' +
      'why you made your key craft choices. This is a first pass the writer ' +
      'will rewrite by hand — teach them, don’t lecture.',
    '',
    `Scene: "${title}"`,
    setup.pov.trim() ? `POV: ${setup.pov.trim()}` : null,
    setup.goal.trim() ? `Goal: ${setup.goal.trim()}` : null,
    setup.conflict.trim() ? `Conflict: ${setup.conflict.trim()}` : null,
    `Beats: ${beatsLine(setup)}`,
    `Tone: ${tonesLine(setup)}`,
    `Length: ${setup.len}`,
    chosen.length > 0
      ? `Reference cards:\n${chosen.map((c) => `- ${c.title}${c.desc ? `: ${c.desc}` : ''}`).join('\n')}`
      : null,
    '',
    'End with a short "Why these choices" section (2-4 bullet points) ' +
      'explaining the POV, pacing, and tone decisions you made.',
  ].filter((line): line is string => line !== null);
  return lines.join('\n');
}

/** Whitespace-delimited word count; blank text counts as zero. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Truncate to `limit` chars on a clean boundary, with an ellipsis marker. */
export function previewText(text: string, limit = PREVIEW_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return trimmed.slice(0, limit).trimEnd() + '…';
}

/** Shape the agent's raw response text into a stageable draft. */
export function draftFromResponseText(text: string): SceneDraft {
  return { text, wordCount: countWords(text), preview: previewText(text) };
}

/**
 * Land a reviewed draft on the scene's canvas board: the hub card (prototype
 * layout via composeDraftBoard) carries the generated prose as its body,
 * titled "<scene> — first pass" per the M19 draft-card label. Satellite
 * cards (POV + chosen references) are unchanged from the structural layout.
 */
export function landDraftOnBoard(
  setup: CrafterSetup,
  chosen: ChosenCard[],
  draft: SceneDraft,
  boardNumber: number,
  id?: string,
): CanvasBoardData {
  const board = id ? composeDraftBoard(setup, chosen, boardNumber, id) : composeDraftBoard(setup, chosen, boardNumber);
  const title = setup.title.trim() || 'Untitled scene';
  const [hub, ...rest] = board.cards;
  return {
    ...board,
    name: `${title} — first pass ${boardNumber}`,
    cards: [{ ...hub, t: `${title} — first pass`, d: draft.text }, ...rest],
  };
}
