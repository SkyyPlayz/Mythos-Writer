// Writing Assistant — pure parsing helpers (no Electron imports).
// Testable without a running main process.

import type { DbSuggestion } from './db.js';
import type { BetaReadComment } from './ipc.js';

/**
 * Parse a JSON-array LLM response for writing tips.
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
 * Convert a list of writing tips into proposed DbSuggestion rows.
 * Each tip becomes one manuscript-targeted suggestion.
 */
export function buildScanSuggestions(
  tips: string[],
  sceneId: string,
  scenePath: string,
  scannedAt: string,
  uuidFn: () => string,
): DbSuggestion[] {
  return tips.map((tip) => ({
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
