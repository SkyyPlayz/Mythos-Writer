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

/** Start of the sentence that contains `at`: after the last . ! ? or line break before it. */
function sentenceStart(prose: string, at: number): number {
  for (let i = at - 1; i >= 0; i -= 1) {
    const ch = prose[i];
    if (ch === '\n' || ch === '\r') return i + 1;
    if ((ch === '.' || ch === '!' || ch === '?') && /\s/.test(prose[i + 1] ?? '')) return i + 1;
  }
  return 0;
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

  const facts: Array<ExtractedFact & { at: number }> = [];
  for (const rule of RULES) {
    if (!wantedKeys.has(rule.attribute)) continue;
    for (const m of prose.matchAll(wordRegex(rule.phrase))) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      const from = sentenceStart(prose, start);
      const owner = mentions.filter((x) => x.at >= from && x.at < start).pop();
      if (!owner) continue;
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
