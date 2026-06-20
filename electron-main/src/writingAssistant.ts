// Writing Assistant — pure parsing helpers (no Electron imports).
// Testable without a running main process.

import type { DbSuggestion, SuggestionCategory } from './db.js';
import type { BetaReadComment } from './ipc.js';
import { categorizeSuggestion } from './suggestionCategory.js';

const VALID_CATEGORIES: ReadonlySet<string> = new Set<SuggestionCategory>([
  'punctuation', 'spelling', 'grammar', 'sentence-structure', 'style-tone', 'other',
]);

/**
 * Extract the first syntactically balanced JSON array from `text`, respecting
 * quoted strings and nested delimiters.
 *
 * Unlike a greedy regex such as `/\[[\s\S]*\]/`, this scanner finds the matching
 * `]` for each candidate `[` by counting depth and skipping string contents.
 * It tries each `[` left-to-right until one produces a valid JSON array.
 *
 * Fixes GH #638 / SKY-2965: the prior greedy regex consumed bracketed prose
 * (e.g. "[example]:\n[\"tip\"]") as if it were syntax, causing JSON.parse to
 * fail and the array to be silently discarded.
 */
export function extractFirstJsonArray(text: string): unknown[] | null {
  const len = text.length;
  let i = 0;

  while (i < len) {
    const start = text.indexOf('[', i);
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

      if (ch === '[') {
        depth++;
      } else if (ch === ']') {
        depth--;
        if (depth === 0) { end = j; break; }
      }
    }

    if (end !== -1) {
      try {
        const parsed: unknown = JSON.parse(text.slice(start, end + 1));
        if (Array.isArray(parsed)) return parsed as unknown[];
      } catch { /* not valid JSON — try next `[` */ }
    }

    i = start + 1;
  }

  return null;
}

/**
 * Parse a JSON-array LLM response for writing tips (plain string format).
 * Falls back to splitting on newlines if no valid JSON array is found.
 * Returns at most `limit` tips.
 */
export function parseScanTips(text: string, limit = 5): string[] {
  const parsed = extractFirstJsonArray(text);
  const tips = parsed !== null
    ? (parsed as unknown[]).map(String).filter(Boolean)
    : text.split('\n').map((l) => l.trim()).filter(Boolean);
  return tips.slice(0, limit);
}

/**
 * Parse a JSON-array LLM response for categorized writing tips.
 * Expects [{category, tip}, ...] objects; falls back to parseScanTips with null categories.
 * Returns at most `limit` items.
 */
export function parseScanTipsStructured(
  text: string,
  limit = 5,
): { tip: string; category: SuggestionCategory | null }[] {
  const parsed = extractFirstJsonArray(text);
  if (parsed !== null) {
    const structured = (parsed as unknown[])
      .filter((item) => item && typeof item === 'object' && typeof (item as Record<string, unknown>).tip === 'string' && (item as Record<string, unknown>).tip)
      .map((item) => {
        const obj = item as Record<string, unknown>;
        return {
          tip: String(obj.tip),
          category: VALID_CATEGORIES.has(String(obj.category))
            ? (obj.category as SuggestionCategory)
            : null,
        };
      });
    if (structured.length > 0) return structured.slice(0, limit);
  }
  return parseScanTips(text, limit).map((tip) => ({ tip, category: null }));
}

/**
 * Convert a list of writing tips into proposed DbSuggestion rows.
 * Each tip becomes one manuscript-targeted suggestion.
 * Pass optional `categories` to set per-row category; defaults to null for all.
 */
export function buildScanSuggestions(
  tips: string[],
  sceneId: string,
  scenePath: string,
  scannedAt: string,
  uuidFn: () => string,
): DbSuggestion[] {
  return tips.map((tip, i) => ({
    id: uuidFn(),
    source_agent: 'writing-assistant',
    confidence: 0.7,
    rationale: tip,
    target_kind: 'manuscript' as const,
    target_path: scenePath,
    target_anchor: null,
    payload_json: JSON.stringify({ sceneId, tip }),
    status: 'proposed' as const,
    created_at: scannedAt,
    applied_at: null,
    applied_run_id: null,
    budget_exceeded: 0,
    category: categorizeSuggestion(tip),
  }));
}

/**
 * Parse the beta-reader LLM response — one JSON object per line.
 * Returns only well-formed { anchor, comment } pairs.
 */
export function parseBetaReadLines(text: string): Array<{ anchor: string; comment: string }> {
  const results: Array<{ anchor: string; comment: string }> = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed) as { anchor?: unknown; comment?: unknown };
      if (
        typeof parsed.anchor === 'string' && parsed.anchor &&
        typeof parsed.comment === 'string' && parsed.comment
      ) {
        results.push({ anchor: parsed.anchor.slice(0, 200), comment: parsed.comment });
      }
    } catch { /* skip malformed lines */ }
  }
  return results;
}

/**
 * Build the user-content string for a Writing Assistant invocation.
 *
 * Scene context is attacker-controlled (imported vault content). Wrap it in
 * explicit XML delimiters so the LLM treats it as data, not instructions
 * (defense-in-depth against indirect prompt injection — SEC-6).
 */
export function buildWritingAssistantUserContent(
  context: string | null | undefined,
  prompt: string,
): string {
  if (!context) return prompt;
  return `<scene_context>\n${context}\n</scene_context>\n\nWriter's prompt: ${prompt}`;
}

/**
 * Convert parsed beta-read lines into BetaReadComment rows.
 */
export function buildBetaReadComments(
  parsed: Array<{ anchor: string; comment: string }>,
  sceneId: string,
  scannedAt: string,
  uuidFn: () => string,
): BetaReadComment[] {
  return parsed.map(({ anchor, comment }) => ({
    id: uuidFn(),
    scene_id: sceneId,
    anchor_text: anchor,
    comment_text: comment,
    created_at: scannedAt,
    dismissed_at: null,
  }));
}
