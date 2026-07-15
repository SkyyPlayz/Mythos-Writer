// Beta 4 M13 — Full Scene Analysis orchestration (§5.4).
//
// `View Full Analysis` (right-panel Scene Analysis card) runs this flow:
//   1. COMPUTED · LOCAL · FREE — pure text metrics from
//      analysis/computedSceneMetrics.ts, always available (no AI involved).
//   2. COACH'S READ · AI — one call to the coach agent with a dedicated
//      analysis prompt (purpose/tension/pacing/POV, each with a teaching
//      clause, + takeaway + drill). When AI is disabled, unconfigured, or the
//      call fails, the card carries an honest `readNote` instead — the
//      computed section still renders in full (M13 acceptance).
//   3. The finished card is appended as ONE agent turn to the shared `coach`
//      session store, so the Coach page feed and the right-panel Coach chat
//      both see it (§5.2 single conversation).
//
// Agent contract (§2, §14.6): this module ASKS the coach for judgment text and
// persists a card — there is no code path that writes prose into the
// manuscript. Locked by coachNoGhostwriting.test.ts (this file lives in the
// scanned coach directory on purpose).

import { useSyncExternalStore } from 'react';
import type { Scene } from '../types';
import {
  computeSceneMetrics,
  computedAnalysisRows,
} from '../analysis/computedSceneMetrics';
import { getAgentSessionStore } from '../lib/useAgentSessions';
import {
  decodeCoachCard,
  encodeCoachCard,
  type CoachAnalysisCard,
} from './coachMessages';

// ── Card title ──────────────────────────────────────────────────────────────

/** Prototype 4233: `Full Scene Analysis — Sc. 2 · Into the Undercity`. */
export function buildSceneAnalysisTitle(scene: Pick<Scene, 'title' | 'order'>): string {
  return `Full Scene Analysis — Sc. ${scene.order + 1} · ${scene.title}`;
}

// ── The dedicated analysis agent prompt (M13 deliverable) ───────────────────

/** COACH'S READ row labels, in prototype order (HTML 4235). */
export const COACH_READ_LABELS = ['Purpose', 'Tension', 'Pacing', 'POV'] as const;

/**
 * Prompt for the coach agent's read of the open scene. The scene text itself
 * travels as the separate `context` argument (electron-main wraps it in
 * `<scene_context>` tags — SEC-6), so this string is instructions only.
 */
export function buildCoachReadPrompt(): string {
  return [
    "Give your COACH'S READ of the scene in scene_context — the judgment calls a word-counter cannot make.",
    'You are a writing coach: you teach; you never rewrite the scene or generate manuscript prose.',
    '',
    'Respond with ONLY a JSON object, no text before or after, in exactly this shape:',
    '{"purpose":"<what the scene does for the story> — <one teaching clause on why that matters>",',
    ' "tension":"<Rising, Falling, Flat, or Uneven> — <one teaching clause on where it climbs or slackens>",',
    ' "pacing":"<Fast, Medium, or Slow> — <one teaching clause naming where it drags or races>",',
    ' "pov":"<the narration point of view> — <one teaching clause on how firmly it holds>",',
    ' "takeaway":"<two or three sentences a coach would leave the writer with>",',
    ' "drill":"Drill: <one concrete 5-10 minute exercise using this exact scene>"}',
    '',
    'Each clause must teach: name what you see AND why it matters to the reader.',
    "Quote at most a few words of the writer's own text. Keep every value to one or two sentences.",
  ].join('\n');
}

// ── Response parsing ────────────────────────────────────────────────────────

export interface CoachReadResult {
  /** [label, teaching clause] pairs in COACH_READ_LABELS order. */
  read: Array<[string, string]>;
  takeaway: string;
  drill?: string;
}

/**
 * Extract the first syntactically balanced JSON object from `text`,
 * respecting quoted strings (the model may wrap JSON in prose or fences).
 */
export function extractFirstJsonObject(text: string): Record<string, unknown> | null {
  const len = text.length;
  let i = 0;
  while (i < len) {
    const start = text.indexOf('{', i);
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let j = start; j < len; j++) {
      const ch = text[j];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\' && inString) { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end = j; break; }
      }
    }
    if (end !== -1) {
      try {
        const parsed: unknown = JSON.parse(text.slice(start, end + 1));
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch { /* not valid JSON — try the next `{` */ }
    }
    i = start + 1;
  }
  return null;
}

const READ_FIELDS: ReadonlyArray<[key: string, label: (typeof COACH_READ_LABELS)[number]]> = [
  ['purpose', 'Purpose'],
  ['tension', 'Tension'],
  ['pacing', 'Pacing'],
  ['pov', 'POV'],
];

/**
 * Parse the agent's JSON reply into read rows + takeaway + drill.
 * Returns null when nothing usable came back (treated as AI-unavailable).
 */
export function parseCoachRead(text: string): CoachReadResult | null {
  const obj = extractFirstJsonObject(text);
  if (!obj) return null;
  const read: Array<[string, string]> = [];
  for (const [key, label] of READ_FIELDS) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) read.push([label, value.trim()]);
  }
  if (read.length === 0) return null;
  const takeaway = typeof obj.takeaway === 'string' ? obj.takeaway.trim() : '';
  const drill = typeof obj.drill === 'string' && obj.drill.trim() ? obj.drill.trim() : undefined;
  return { read, takeaway, ...(drill ? { drill } : {}) };
}

// ── Card assembly ───────────────────────────────────────────────────────────

/** Honest AI-section states (§5.4: the split is the pattern for all AI features). */
export const READ_UNAVAILABLE_NOTE =
  "Coach's read unavailable — the computed stats above are local and always free.";

export function buildAnalysisCard(
  scene: Pick<Scene, 'title' | 'order'> & { blocks: Scene['blocks'] },
  ai: CoachReadResult | { unavailable: string },
): CoachAnalysisCard {
  const metrics = computeSceneMetrics(scene);
  const base = {
    kind: 'analysis' as const,
    title: buildSceneAnalysisTitle(scene),
    computed: computedAnalysisRows(metrics),
  };
  if ('unavailable' in ai) {
    return { ...base, read: [], readNote: ai.unavailable, takeaway: '' };
  }
  return { ...base, read: ai.read, takeaway: ai.takeaway, ...(ai.drill ? { drill: ai.drill } : {}) };
}

// ── Pending state (typing dots on the Coach page while the read is fetched) ─

let analysisPending = false;
const pendingListeners = new Set<() => void>();

function setAnalysisPending(value: boolean): void {
  if (analysisPending === value) return;
  analysisPending = value;
  for (const fn of [...pendingListeners]) fn();
}

export function isSceneAnalysisPending(): boolean {
  return analysisPending;
}

export function subscribeSceneAnalysisPending(fn: () => void): () => void {
  pendingListeners.add(fn);
  return () => { pendingListeners.delete(fn); };
}

/** Live pending flag for feed surfaces (typing dots while the AI read runs). */
export function useSceneAnalysisPending(): boolean {
  return useSyncExternalStore(subscribeSceneAnalysisPending, isSceneAnalysisPending);
}

// ── Run flow ────────────────────────────────────────────────────────────────

/** Wait for the shared coach store to finish its lazy vault init. */
function whenStoreReady(store: ReturnType<typeof getAgentSessionStore>): Promise<void> {
  if (!store.getSnapshot().loading) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = store.subscribe(() => {
      if (!store.getSnapshot().loading) {
        unsubscribe();
        resolve();
      }
    });
  });
}

/** Same scene-context shape the Coach chat sends (useCoachConversation). */
function buildSceneContext(scene: Pick<Scene, 'title'> & { blocks: Scene['blocks'] }): string {
  return `Scene: "${scene.title}"\n\n${scene.blocks.map((b) => b.content).join('\n\n')}`;
}

export type SceneAnalysisOutcome = 'appended' | 'skipped';

/**
 * Run the full §5.4 analysis for `scene` and append the card to the shared
 * coach conversation. Mirrors the prototype's `viewFullAnalysis` (HTML 7259):
 * when the newest message is already this scene's analysis card, nothing is
 * re-appended — the caller just navigates to the Coach page.
 */
export async function runFullSceneAnalysis(scene: Scene): Promise<SceneAnalysisOutcome> {
  if (analysisPending) return 'skipped';

  const store = getAgentSessionStore('coach');
  await whenStoreReady(store);

  const turns = store.getSnapshot().activeSession?.turns ?? [];
  const last = turns[turns.length - 1];
  if (last && last.role === 'agent') {
    const card = decodeCoachCard(last.text);
    if (card?.kind === 'analysis' && card.title === buildSceneAnalysisTitle(scene)) {
      return 'skipped';
    }
  }

  setAnalysisPending(true);
  try {
    let ai: CoachReadResult | { unavailable: string };
    const ask = window.api?.agentWritingAssistant;
    if (typeof ask !== 'function') {
      ai = { unavailable: READ_UNAVAILABLE_NOTE };
    } else {
      try {
        const response = await ask(buildCoachReadPrompt(), buildSceneContext(scene));
        ai = parseCoachRead(response.text)
          ?? { unavailable: "Coach's read unavailable — the coach replied in an unexpected shape. Run Full Analysis again to retry." };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ai = { unavailable: `Coach's read unavailable — ${msg || 'the model could not be reached.'}` };
      }
    }
    const card = buildAnalysisCard(scene, ai);
    await store.actions.appendTurns([
      { role: 'agent', text: encodeCoachCard(card), at: new Date().toISOString() },
    ]);
    return 'appended';
  } finally {
    setAnalysisPending(false);
  }
}

// ── Right-panel helpers (Scene Analysis card, §5.4 card rows) ───────────────

/**
 * Newest persisted analysis card for `scene` in the active coach session —
 * lets the right-panel card surface the AI verdicts (Purpose/Tension…) once a
 * Full Analysis has run. Null until then: those rows honestly show a dash.
 */
export function latestAnalysisCardForScene(
  turns: readonly AgentSessionTurn[] | undefined,
  scene: Pick<Scene, 'title' | 'order'> | null,
): CoachAnalysisCard | null {
  if (!turns || !scene) return null;
  const title = buildSceneAnalysisTitle(scene);
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.role !== 'agent') continue;
    const card = decodeCoachCard(turn.text);
    if (card?.kind === 'analysis' && card.title === title) return card;
  }
  return null;
}

const COMPACT_READ_MAX = 30;

/**
 * Compact a teaching clause to its verdict for the tight panel rows:
 * `Rising — steady climb after the token beat` → `Rising`.
 */
export function compactReadValue(clause: string): string {
  const verdict = clause.split(/\s+—\s+|\s+--\s+/)[0].trim() || clause.trim();
  if (verdict.length <= COMPACT_READ_MAX) return verdict;
  return `${verdict.slice(0, COMPACT_READ_MAX - 1).trimEnd()}…`;
}
