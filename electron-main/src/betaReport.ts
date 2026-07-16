// Beta Reader report — pure parsing/formatting helpers (no Electron imports).
// Testable without a running main process. Mirrors writingAssistant.ts's
// "one JSON object per line, skip malformed lines" resilience pattern
// (SKY-6982, Beta 4 M27).

import type { DbBetaReport } from './db.js';
import type {
  BetaReport,
  BetaReportCategory,
  BetaReportFocus,
  BetaReportReaction,
  BetaReportScope,
  BetaReportSummary,
} from './ipc.js';

export type BetaReportReactionKind = 'loved' | 'stumbled' | 'confused';

export interface BetaReportCategoryDef {
  key: 'hook' | 'pacing' | 'clarity' | 'emotion';
  label: string;
}

/** Fixed score-chip categories (§10 FULL-SPEC) — distinct from the 4 FOCUS ON toggles. */
export const BETA_REPORT_CATEGORIES: readonly BetaReportCategoryDef[] = [
  { key: 'hook', label: 'Hook' },
  { key: 'pacing', label: 'Pacing' },
  { key: 'clarity', label: 'Clarity' },
  { key: 'emotion', label: 'Emotion' },
];

export type BetaReportVerdict = 'strong' | 'mixed' | 'weak';

/** Score-chip verdict tiering — shared by the overall chip and every per-category chip. */
export function verdictForScore(score: number): BetaReportVerdict {
  if (score >= 75) return 'strong';
  if (score >= 50) return 'mixed';
  return 'weak';
}

function clampScore(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export interface ParsedBetaReportSummary {
  overallScore: number;
  overallVerdict: BetaReportVerdict;
  categories: Array<{ key: string; label: string; score: number; verdict: BetaReportVerdict }>;
  feedback: string;
}

export interface ParsedBetaReportReaction {
  kind: BetaReportReactionKind;
  sceneId: string;
  quote: string;
  where: string;
  note: string;
}

export interface ParsedBetaReport {
  summary: ParsedBetaReportSummary;
  reactions: ParsedBetaReportReaction[];
}

const VALID_REACTION_KINDS: ReadonlySet<string> = new Set<BetaReportReactionKind>(['loved', 'stumbled', 'confused']);

const FALLBACK_FEEDBACK = 'The Beta Reader could not produce a structured report for this read. Try running it again.';

/**
 * Parse the Beta Reader LLM response — one JSON object per line, tagged by
 * `type: 'summary' | 'reaction'`. Skips malformed lines rather than failing
 * the whole read (mirrors parseBetaReadLines). Always returns a valid report
 * shape, even for empty/garbage input, so the UI never has to special-case a
 * parse failure beyond an empty REACTIONS list.
 */
export function parseBetaReportResponse(text: string): ParsedBetaReport {
  const reactions: ParsedBetaReportReaction[] = [];
  let summary: ParsedBetaReportSummary | null = null;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (parsed.type === 'summary') {
      const rawCategories = (parsed.categories && typeof parsed.categories === 'object')
        ? parsed.categories as Record<string, unknown>
        : {};
      const categories = BETA_REPORT_CATEGORIES.map(({ key, label }) => {
        const score = clampScore(rawCategories[key]);
        return { key, label, score, verdict: verdictForScore(score) };
      });
      const overallScore = clampScore(parsed.overall);
      summary = {
        overallScore,
        overallVerdict: verdictForScore(overallScore),
        categories,
        feedback: typeof parsed.feedback === 'string' && parsed.feedback.trim() ? parsed.feedback.trim() : '',
      };
      continue;
    }

    if (parsed.type === 'reaction') {
      const kind = typeof parsed.kind === 'string' ? parsed.kind.toLowerCase() : '';
      if (!VALID_REACTION_KINDS.has(kind)) continue;
      const sceneId = typeof parsed.sceneId === 'string' ? parsed.sceneId : '';
      const quote = typeof parsed.quote === 'string' ? parsed.quote : '';
      if (!sceneId || !quote.trim()) continue;
      reactions.push({
        kind: kind as BetaReportReactionKind,
        sceneId,
        quote: quote.slice(0, 219),
        where: typeof parsed.where === 'string' ? parsed.where.slice(0, 200) : '',
        note: typeof parsed.note === 'string' ? parsed.note.slice(0, 500) : '',
      });
    }
  }

  return {
    summary: summary ?? {
      overallScore: 0,
      overallVerdict: 'weak',
      categories: BETA_REPORT_CATEGORIES.map(({ key, label }) => ({ key, label, score: 0, verdict: 'weak' as const })),
      feedback: FALLBACK_FEEDBACK,
    },
    reactions,
  };
}

/**
 * Build the user-content string for a Beta Reader run. `sourceText` is
 * pre-assembled by the renderer with `<<SCENE id="..." title="...">>` markers
 * around each scene in scope (see frontend/src/beta/textAssembly.ts) so the
 * model can cite an exact sceneId per reaction instead of a fuzzy "where"
 * guess. Scene text is attacker-controlled (imported vault content) — kept
 * inside explicit delimiters, same defense-in-depth as
 * buildWritingAssistantUserContent.
 */
export function buildBetaReportUserContent(
  scopeLabel: string,
  focus: { pacing: boolean; clarity: boolean; character: boolean; plot: boolean },
  sourceText: string,
): string {
  const focusOn = (['pacing', 'clarity', 'character', 'plot'] as const).filter((k) => focus[k]);
  const focusLine = focusOn.length > 0 ? focusOn.join(', ') : 'overall impression';
  return [
    `You are reading "${scopeLabel}" as a first-time reader. Focus on: ${focusLine}.`,
    '',
    '<manuscript>',
    sourceText,
    '</manuscript>',
    '',
    'Respond with ONE JSON object per line — no prose outside the JSON lines, no markdown fences.',
    'Line 1 — exactly one summary line:',
    '{"type":"summary","overall":<0-100>,"categories":{"hook":<0-100>,"pacing":<0-100>,"clarity":<0-100>,"emotion":<0-100>},"feedback":"<2-4 sentence overall reaction>"}',
    'Then 3-8 reaction lines, one per notable moment, each citing the exact sceneId it belongs to:',
    '{"type":"reaction","kind":"loved|stumbled|confused","sceneId":"<scene id from a <<SCENE id=\\"...\\">> marker>","quote":"<short exact excerpt from that scene, under 200 chars>","where":"<human-readable location, e.g. Chapter 2 - Scene 1>","note":"<one sentence reaction, in first-person reader voice>"}',
    'Never rewrite or suggest edits — you only react. Nothing is rewritten.',
  ].join('\n');
}

/** Deserialize a DB row (persisted via insertBetaReport) into the renderer-facing shape. */
export function dbRowToBetaReport(row: DbBetaReport): BetaReport {
  return {
    id: row.id,
    storyId: row.story_id,
    scope: { kind: row.scope_kind as BetaReportScope['kind'], id: row.scope_id, label: row.scope_label },
    focus: JSON.parse(row.focus_json) as BetaReportFocus,
    overall: { score: row.overall_score, verdict: row.overall_verdict as BetaReport['overall']['verdict'] },
    categories: JSON.parse(row.categories_json) as BetaReportCategory[],
    feedback: row.feedback,
    reactions: JSON.parse(row.reactions_json) as BetaReportReaction[],
    createdAt: row.created_at,
  };
}

/** Lightweight summary for the BETA READS history list — avoids parsing the (larger) reactions/categories JSON. */
export function dbRowToBetaReportSummary(row: DbBetaReport): BetaReportSummary {
  return {
    id: row.id,
    storyId: row.story_id,
    scope: { kind: row.scope_kind as BetaReportScope['kind'], id: row.scope_id, label: row.scope_label },
    overall: { score: row.overall_score, verdict: row.overall_verdict as BetaReport['overall']['verdict'] },
    createdAt: row.created_at,
  };
}
