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
  /**
   * True only when a real `type:"summary"` object was found in the response.
   * `summary` is always populated (falling back to a zero-score placeholder)
   * so this function's shape stays simple to consume, but callers that need
   * to tell "the model gave us a report" apart from "nothing parsed" —
   * e.g. to surface a visible error instead of silently saving a placeholder
   * (SKY-11816 AC2) — must check this flag, not `summary` truthiness.
   */
  summaryFound: boolean;
}

const VALID_REACTION_KINDS: ReadonlySet<string> = new Set<BetaReportReactionKind>(['loved', 'stumbled', 'confused']);

const FALLBACK_FEEDBACK = 'The Beta Reader could not produce a structured report for this read. Try running it again.';

/**
 * Scan `text` for top-level `{...}` objects and parse each as JSON,
 * independent of line breaks or surrounding prose/markdown fences.
 *
 * SKY-11816: the original parser required each JSON object to sit alone on
 * its own line (`trimmed.startsWith('{')` + `JSON.parse(trimmed)`). Compliant
 * models (e.g. Claude) follow the "one compact JSON object per line"
 * instruction closely, but local reasoning models (LM Studio / DeepSeek-R1
 * distills etc.) routinely pretty-print the JSON across multiple indented
 * lines even when told not to — every line of a pretty-printed object fails
 * the single-line check, so the whole report silently vanished. Scanning for
 * balanced braces (string-aware, so a `{`/`}` inside a quoted value can't
 * desync the count) finds each object regardless of internal formatting, and
 * markdown code fences or leading/trailing prose are simply text that never
 * matches a brace and gets skipped over.
 */
function extractJsonObjects(text: string): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    if (text[i] !== '{') {
      i += 1;
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let j = i; j < len; j++) {
      const ch = text[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }

    if (end === -1) {
      // No balanced close from here — either this '{' starts a genuinely
      // truncated object, or it's a false start (e.g. a stray brace inside
      // unterminated prose) that swallowed a real object further along by
      // over-counting depth. Either way, retry from the next character
      // rather than giving up on the rest of the text.
      i += 1;
      continue;
    }

    const candidate = text.slice(i, end + 1);
    try {
      objects.push(JSON.parse(candidate) as Record<string, unknown>);
      i = end + 1;
    } catch {
      i += 1; // not valid JSON (e.g. a stray '{' in prose) — keep scanning
    }
  }

  return objects;
}

/**
 * Parse the Beta Reader LLM response into a report, tagged by
 * `type: 'summary' | 'reaction'`. Tolerant of markdown fences, leading/
 * trailing prose, and multi-line pretty-printed JSON (SKY-11816) — skips
 * anything that isn't a balanced, parseable object rather than failing the
 * whole read (mirrors parseBetaReadLines' malformed-line resilience). Always
 * returns a valid report shape, even for empty/garbage input, so callers that
 * don't care about the empty case can consume it directly; callers that must
 * distinguish "no report was found" check `summaryFound`.
 */
export function parseBetaReportResponse(text: string): ParsedBetaReport {
  const reactions: ParsedBetaReportReaction[] = [];
  let summary: ParsedBetaReportSummary | null = null;

  for (const parsed of extractJsonObjects(text)) {
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
    summaryFound: summary !== null,
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
 *
 * SKY-11411: `entityContext` is an optional continuity dossier block, already
 * rendered by readerPerspective.renderEntityDossier (so it carries its own
 * <entity_context> delimiters). The Beta Reader is a reader-perspective role, so
 * the caller MUST pass a reveal-point-filtered dossier (buildReaderEntityContext)
 * — an unfiltered dossier would hand the model a not-yet-revealed identity and
 * defeat the SKY-10741 AC2 spoiler-safety guarantee. `''` (the default) injects
 * no block at all, preserving the pre-SKY-11411 prompt verbatim.
 */
export function buildBetaReportUserContent(
  scopeLabel: string,
  focus: { pacing: boolean; clarity: boolean; character: boolean; plot: boolean },
  sourceText: string,
  entityContext = '',
): string {
  const focusOn = (['pacing', 'clarity', 'character', 'plot'] as const).filter((k) => focus[k]);
  const focusLine = focusOn.length > 0 ? focusOn.join(', ') : 'overall impression';
  const continuityBlock = entityContext.trim()
    ? [
        // Reinforce the reveal-order contract in-band: the dossier is already
        // filtered, but the instruction stops the model from "reading ahead"
        // and inferring an identity the manuscript has not yet disclosed.
        '<!-- Continuity notes: ONLY entities the reader has met by this point are listed. Never reference an identity that does not appear below or in the manuscript. -->',
        entityContext,
        '',
      ]
    : [];
  return [
    `You are reading "${scopeLabel}" as a first-time reader. Focus on: ${focusLine}.`,
    '',
    ...continuityBlock,
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
