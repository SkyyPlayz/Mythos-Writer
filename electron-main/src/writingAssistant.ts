// Writing Assistant — pure parsing helpers (no Electron imports).
// Testable without a running main process.

import type { DbSuggestion, SuggestionCategory } from './db.js';
import type { BetaReadComment } from './ipc.js';

const VALID_CATEGORIES: ReadonlySet<string> = new Set<SuggestionCategory>([
  'punctuation', 'spelling', 'grammar', 'sentence-structure', 'style',
]);

/**
 * Parse a JSON-array LLM response for writing tips (plain string format).
 * Falls back to splitting on newlines if JSON parsing fails.
 * Returns at most `limit` tips.
 */
export function parseScanTips(text: string, limit = 5): string[] {
  let tips: string[] = [];
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) tips = parsed.map(String).filter(Boolean);
    }
  } catch { /* fallback below */ }
  if (tips.length === 0) {
    tips = text.split('\n').map((l) => l.trim()).filter(Boolean);
  }
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
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        const structured = parsed
          .filter((item) => item && typeof item === 'object' && typeof item.tip === 'string' && item.tip)
          .map((item) => ({
            tip: String(item.tip),
            category: VALID_CATEGORIES.has(String(item.category))
              ? (item.category as SuggestionCategory)
              : null,
          }));
        if (structured.length > 0) return structured.slice(0, limit);
      }
    }
  } catch { /* fallback below */ }
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
  categories?: (SuggestionCategory | null)[],
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
    category: categories?.[i] ?? null,
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
