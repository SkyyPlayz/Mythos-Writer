// Purpose: the AI Off and fallback extractor. No model, no network. It reuses
// runEntityPrePass (which entity is mentioned, which attribute phrases occur)
// and the PROPERTY_CONTRADICTION_PAIRS phrase table, and emits exact spans.

import type { ArchiveIndex, VaultEntityRecord } from '../../archiveAgent.js';
import { PROPERTY_CONTRADICTION_PAIRS } from '../../archiveAgent.js';
import { runEntityPrePass } from '../../archiveContinuityEngine.js';
import { QUOTE_CONTEXT_UNITS } from '../quoteCheck.js';
import { PROMPT_VERSION, type ExtractedFact, type Extractor, type ExtractorInput, type ExtractorOutput } from './types.js';

interface PhraseRule {
  attribute: string;
  phrase: string;
  value: string;
}

/**
 * Scene-side phrases per attribute, from PROPERTY_CONTRADICTION_PAIRS. Pronoun
 * entries (padded with spaces, like ' she ') are skipped: a pronoun is not a
 * fact about a named entity, and attributing one would invent changes.
 * The value drops a trailing attribute word: 'dark hair' -> 'dark'.
 */
function phraseRules(): PhraseRule[] {
  const rules: PhraseRule[] = [];
  for (const [attribute, pairs] of Object.entries(PROPERTY_CONTRADICTION_PAIRS)) {
    const seen = new Set<string>();
    for (const [, phrase] of pairs) {
      if (phrase !== phrase.trim() || seen.has(phrase)) continue;
      seen.add(phrase);
      const suffix = ` ${attribute}`;
      const value = phrase.endsWith(suffix) ? phrase.slice(0, -suffix.length) : phrase;
      rules.push({ attribute, phrase, value });
    }
  }
  return rules;
}

const RULES = phraseRules();

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordRegex(text: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(text)}(?![\\p{L}\\p{N}_])`, 'giu');
}

/**
 * Every offset where a sentence starts after a break, ascending: just after a
 * line break, or just after . ! ? that is followed by whitespace. One pass, so
 * finding the sentence that holds an offset is a binary search, not a walk back.
 */
function sentenceStarts(prose: string): number[] {
  const starts: number[] = [];
  for (let i = 0; i < prose.length; i += 1) {
    const ch = prose[i];
    if (ch === '\n' || ch === '\r') starts.push(i + 1);
    else if ((ch === '.' || ch === '!' || ch === '?') && /\s/.test(prose[i + 1] ?? '')) starts.push(i + 1);
  }
  return starts;
}

/** Index of the last item whose position is below `limit` (or at most `limit` when `inclusive`), or -1. */
function lastIndexBefore<T>(sorted: readonly T[], pos: (item: T) => number, limit: number, inclusive: boolean): number {
  let lo = 0;
  let hi = sorted.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const p = pos(sorted[mid]);
    if (p < limit || (inclusive && p === limit)) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Synthetic index for runEntityPrePass: every vault phrase is "present", so a key comes back when the scene has a matching phrase. */
function prePassIndex(input: ExtractorInput): ArchiveIndex {
  const properties: Record<string, string> = {};
  for (const [attribute, pairs] of Object.entries(PROPERTY_CONTRADICTION_PAIRS)) {
    properties[attribute] = pairs.map(([vaultPhrase]) => vaultPhrase).join(' | ');
  }
  return {
    builtAt: '',
    entities: input.names.map(
      (n): VaultEntityRecord => ({
        id: n.name,
        name: n.name,
        type: 'other',
        aliases: [...n.aliases],
        path: '',
        properties,
        prose: '',
      }),
    ),
  };
}

/**
 * Deterministic extraction. A phrase belongs to the nearest entity mention
 * (name or alias) earlier in the same sentence; a phrase with no mention
 * before it in its sentence is missed on purpose (no pronoun resolution).
 */
export function extractByScript(input: ExtractorInput): ExtractorOutput {
  const { prose } = input;
  const candidates = runEntityPrePass(prose, prePassIndex(input));
  if (candidates.length === 0) return { facts: [] };

  const mentions: Array<{ at: number; entity: string }> = [];
  for (const c of candidates) {
    for (const term of [c.entityName, ...c.aliases]) {
      for (const m of prose.matchAll(wordRegex(term))) mentions.push({ at: m.index ?? 0, entity: c.entityName });
    }
  }
  mentions.sort((x, y) => x.at - y.at);
  const wantedKeys = new Set(candidates.flatMap((c) => c.potentialMismatchKeys));
  const starts = sentenceStarts(prose);

  const facts: Array<ExtractedFact & { at: number }> = [];
  for (const rule of RULES) {
    if (!wantedKeys.has(rule.attribute)) continue;
    for (const m of prose.matchAll(wordRegex(rule.phrase))) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      const s = lastIndexBefore(starts, (b) => b, start, true);
      const from = s === -1 ? 0 : starts[s];
      const o = lastIndexBefore(mentions, (x) => x.at, start, false);
      const owner = o === -1 ? undefined : mentions[o];
      if (!owner || owner.at < from) continue;
      facts.push({
        at: start,
        entity: owner.entity,
        attribute: rule.attribute,
        value: rule.value,
        quote: prose.slice(start, end),
        contextBefore: prose.slice(Math.max(0, start - QUOTE_CONTEXT_UNITS), start),
        contextAfter: prose.slice(end, end + QUOTE_CONTEXT_UNITS),
      });
    }
  }
  facts.sort((x, y) => x.at - y.at);
  return { facts: facts.map(({ at: _at, ...fact }) => fact) };
}

export function createScriptExtractor(): Extractor {
  return {
    id: 'script',
    promptVersion: PROMPT_VERSION.script,
    async extract(input: ExtractorInput, signal: AbortSignal): Promise<ExtractorOutput> {
      signal.throwIfAborted();
      return extractByScript(input);
    },
  };
}
