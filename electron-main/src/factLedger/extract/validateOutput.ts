// Purpose: the one JSON-contract validator for CDM and local model replies.
// Anything that is not valid contract JSON returns null (never throws); the
// caller then uses script for that scene, with 0 retries.

import type { ExtractedFact, ExtractorOutput } from './types.js';

/** Most facts accepted from one scene. More than this is not a contract reply. */
export const MAX_FACTS_PER_SCENE = 256;
/** Longest string accepted in any fact field (UTF-16 code units). */
export const MAX_FACT_FIELD_UNITS = 2000;

const FACT_KEYS = ['entity', 'attribute', 'value', 'quote', 'contextBefore', 'contextAfter'] as const;
const NON_EMPTY_KEYS = new Set<string>(['entity', 'attribute', 'value', 'quote']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function validFact(v: unknown): ExtractedFact | null {
  if (!isPlainObject(v)) return null;
  const keys = Object.keys(v);
  if (keys.length !== FACT_KEYS.length) return null;
  for (const key of FACT_KEYS) {
    const field = v[key];
    if (typeof field !== 'string' || field.length > MAX_FACT_FIELD_UNITS) return null;
    if (NON_EMPTY_KEYS.has(key) && field.trim() === '') return null;
  }
  return {
    entity: v.entity as string,
    attribute: v.attribute as string,
    value: v.value as string,
    quote: v.quote as string,
    contextBefore: v.contextBefore as string,
    contextAfter: v.contextAfter as string,
  };
}

/**
 * Validate an Extract reply. Valid means exactly `{"facts":[...]}` where every
 * fact has exactly the six string fields (entity, attribute, value and quote
 * non-blank). Prose, a cut-off answer, a refusal, a code fence, a wrong shape,
 * an empty string and `{}` all return null.
 */
export function validateOutput(raw: unknown): ExtractorOutput | null {
  const parsed = parseJson(raw);
  if (!isPlainObject(parsed)) return null;
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== 'facts') return null;
  const list = parsed.facts;
  if (!Array.isArray(list) || list.length > MAX_FACTS_PER_SCENE) return null;
  const facts: ExtractedFact[] = [];
  for (const item of list) {
    const fact = validFact(item);
    if (!fact) return null;
    facts.push(fact);
  }
  return { facts };
}

export interface ClassifyVerdict<L extends string> {
  label: L;
  p: number;
}

/**
 * Validate a Classify reply: exactly `{"top_label": <one of labels>, "p": <0..1>}`.
 * Anything else returns null.
 */
export function validateClassifyOutput<L extends string>(
  raw: unknown,
  labels: readonly L[],
): ClassifyVerdict<L> | null {
  const parsed = parseJson(raw);
  if (!isPlainObject(parsed)) return null;
  const keys = Object.keys(parsed);
  if (keys.length !== 2 || !('top_label' in parsed) || !('p' in parsed)) return null;
  const { top_label: label, p } = parsed;
  if (typeof label !== 'string' || !(labels as readonly string[]).includes(label)) return null;
  if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) return null;
  return { label: label as L, p };
}
