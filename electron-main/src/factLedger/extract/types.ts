// Purpose: the extractor contract shared by every fact extractor (CDM, local,
// the KEV slot and script): input, output, prompt and prompt version.
// extract/ never imports the DB; see blindness.test.ts and eslint.config.js.

import { splitFrontmatter } from '../quoteCheck.js';

export type ExtractorId = 'cdm' | 'local' | 'kev' | 'script';

/** Effective AI mode for story facts: Full AI, Local Only, AI Off. */
export type FactMode = 'full' | 'local' | 'off';

/**
 * Prompt/schema version per extractor. A coverage row stores the version its
 * facts came from, so a bump makes the next scan re-extract those scenes.
 * Bump rule: any change to EXTRACT_SYSTEM_PROMPT, extractUserContent, the
 * ExtractorOutput schema, or an extractor's own matching rules bumps that
 * extractor's integer (a shared prompt change bumps cdm and local together).
 */
export const PROMPT_VERSION: Readonly<Record<ExtractorId, number>> = Object.freeze({
  cdm: 1,
  local: 1,
  kev: 1,
  script: 1,
});

export interface EntityNames {
  readonly name: string;
  readonly aliases: readonly string[];
}

/** Type-only brand (no runtime value), so an object literal cannot pose as an ExtractorInput. */
export declare const extractorInputBrand: unique symbol;

/**
 * What an extractor may see: one scene's prose (frontmatter removed) and the
 * entity names with their aliases. Nothing else: no ledger values, no other
 * scene, no vault properties. Build it only with buildExtractorInput.
 */
export interface ExtractorInput {
  readonly prose: string;
  readonly names: readonly EntityNames[];
  readonly [extractorInputBrand]: true;
}

export interface ExtractedFact {
  entity: string;
  attribute: string;
  value: string;
  /** Exact prose text that states the fact. */
  quote: string;
  /** Up to 32 code units of prose before the quote. */
  contextBefore: string;
  /** Up to 32 code units of prose after the quote. */
  contextAfter: string;
}

export interface ExtractorOutput {
  facts: ExtractedFact[];
}

export interface Extractor {
  readonly id: ExtractorId;
  readonly promptVersion: number;
  /** Resolves null when the extractor is unsure; the caller then uses script for that scene. */
  extract(input: ExtractorInput, signal: AbortSignal): Promise<ExtractorOutput | null>;
}

function copyNames(names: readonly EntityNames[]): EntityNames[] {
  const out: EntityNames[] = [];
  for (const entry of names) {
    if (!entry || typeof entry.name !== 'string' || entry.name.trim() === '') continue;
    const aliases = Array.isArray(entry.aliases)
      ? entry.aliases.filter((a): a is string => typeof a === 'string' && a.trim() !== '')
      : [];
    out.push(Object.freeze({ name: entry.name, aliases: Object.freeze([...aliases]) }));
  }
  return out;
}

/**
 * The only constructor for ExtractorInput. Frontmatter is cut off here, and
 * only each entry's `name` and string `aliases` are copied, so a richer record
 * (with properties or ledger values) cannot leak into a payload.
 */
export function buildExtractorInput(prose: string, names: readonly EntityNames[]): ExtractorInput {
  const input = {
    prose: splitFrontmatter(typeof prose === 'string' ? prose : '').prose,
    names: Object.freeze(copyNames(Array.isArray(names) ? names : [])),
  };
  return Object.freeze(input) as ExtractorInput;
}

/** System prompt for Extract (CDM and local). Changing it bumps PROMPT_VERSION.cdm and .local. */
export const EXTRACT_SYSTEM_PROMPT = [
  'You extract physical and descriptive facts about named story entities from one scene.',
  'Use only the scene text in "prose". Report an entity by its "name" from "names", even when the scene uses an alias.',
  'Reply with JSON only, no prose and no code fence, exactly in this shape:',
  '{"facts":[{"entity":string,"attribute":string,"value":string,"quote":string,"contextBefore":string,"contextAfter":string}]}',
  '"quote" is copied character for character from the prose. "contextBefore" and "contextAfter" are the 32 characters of prose',
  'directly before and after the quote (fewer at the start or end of the prose). Reply {"facts":[]} when there are none.',
].join('\n');

/** The user message for Extract: the prose and the names, nothing else. */
export function extractUserContent(input: ExtractorInput): string {
  return JSON.stringify({ names: input.names, prose: input.prose });
}
