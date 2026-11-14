// Purpose: decide whether the prose explains a change between two bracketing
// scenes. Its input is exactly those two scenes' prose plus factA and factB.
// It never hides a change: implied, absent and unsure all raise a flag.

import { cdmClassify, type CdmClient } from './cdmClient.js';
import type { FactMode } from './extract/types.js';
import type { ClassifyVerdict } from './extract/validateOutput.js';
import { splitFrontmatter } from './quoteCheck.js';

export const BOUNDARY_LABELS = ['shown', 'stated', 'implied', 'absent'] as const;
export type BoundaryLabel = (typeof BOUNDARY_LABELS)[number];
/** A Classify label is used only at or above this probability; below it the answer is unsure. */
export const CLASSIFY_MIN_P = 0.6;

export interface BoundaryFact {
  entity: string;
  attribute: string;
  value: string;
  quote: string;
}

export interface BoundaryScene {
  sceneId: string;
  prose: string;
}

export interface BoundaryInput {
  sceneA: BoundaryScene;
  sceneB: BoundaryScene;
  factA: BoundaryFact;
  factB: BoundaryFact;
}

export interface BoundaryContext {
  mode: FactMode;
  /** Used only in Full AI. Without it, Full AI answers unsure. */
  client?: CdmClient;
  signal?: AbortSignal;
}

export interface BoundaryResult {
  label: BoundaryLabel | 'unsure';
  source: 'cdm' | 'script';
  flag: boolean;
  /** The flag note, or null when the change is shown or stated. */
  note: string | null;
}

export const BOUNDARY_SYSTEM_PROMPT = [
  'Two consecutive scenes of a story are given as "sceneA" and "sceneB". In "factA" an entity\'s attribute has one value;',
  'in "factB" it has another. Classify how the prose explains the change:',
  '"shown" (the change happens on the page), "stated" (the text says it changed), "implied" (only hinted), "absent" (no explanation).',
  'Reply with JSON only: {"top_label":"shown"|"stated"|"implied"|"absent","p":<probability 0..1>}.',
].join('\n');

export function boundaryNote(entity: string, attribute: string, a: string, b: string): string {
  return `${entity}: ${attribute} changed from '${a}' to '${b}' between these scenes; no explanation found.`;
}

function factPayload(fact: BoundaryFact): BoundaryFact {
  return { entity: fact.entity, attribute: fact.attribute, value: fact.value, quote: fact.quote };
}

/** The Classify payload: the two bracketing scenes' prose (no frontmatter) and the two facts, nothing else. */
export function boundaryPayload(input: BoundaryInput): Record<string, unknown> {
  return {
    labels: [...BOUNDARY_LABELS],
    sceneA: splitFrontmatter(input.sceneA.prose).prose,
    sceneB: splitFrontmatter(input.sceneB.prose).prose,
    factA: factPayload(input.factA),
    factB: factPayload(input.factB),
  };
}

function result(label: BoundaryLabel | 'unsure', source: 'cdm' | 'script', input: BoundaryInput): BoundaryResult {
  const flag = label !== 'shown' && label !== 'stated';
  return {
    label,
    source,
    flag,
    note: flag ? boundaryNote(input.factA.entity, input.factA.attribute, input.factA.value, input.factB.value) : null,
  };
}

/**
 * Full AI: one Classify over shown|stated|implied|absent; the top label counts
 * when p >= CLASSIFY_MIN_P, otherwise (or on any CDM failure) unsure.
 * Local Only and AI Off: script, which always answers absent.
 */
export async function runBoundaryPass(input: BoundaryInput, ctx: BoundaryContext): Promise<BoundaryResult> {
  if (ctx.mode !== 'full') return result('absent', 'script', input);
  if (!ctx.client) return result('unsure', 'cdm', input);
  let verdict: ClassifyVerdict<BoundaryLabel> | null = null;
  try {
    verdict = await cdmClassify(ctx.client, BOUNDARY_LABELS, BOUNDARY_SYSTEM_PROMPT, boundaryPayload(input), ctx.signal);
  } catch {
    verdict = null;
  }
  if (!verdict || verdict.p < CLASSIFY_MIN_P) return result('unsure', 'cdm', input);
  return result(verdict.label, 'cdm', input);
}
