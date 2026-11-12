// Purpose: give every flag a severity. Full AI asks a second Classify
// (critical|high|low); unsure, Local Only and AI Off use the script table.
// It never drops a flag.

import { PROPERTY_CONTRADICTION_PAIRS } from '../archiveAgent.js';
import { cdmClassify, type CdmClient } from './cdmClient.js';
import { CLASSIFY_MIN_P } from './boundaryPass.js';
import type { FactMode } from './extract/types.js';

/** Same label set as the continuity scan (archiveContinuityEngine VALID_SEVERITIES). */
export const SEVERITY_LABELS = ['critical', 'high', 'low'] as const;
export type Severity = (typeof SEVERITY_LABELS)[number];

export interface SeverityChange {
  entity: string;
  attribute: string;
  a: string;
  b: string;
  quoteA: string;
  quoteB: string;
}

export interface SeverityContext {
  mode: FactMode;
  client?: CdmClient;
  signal?: AbortSignal;
}

export interface SeverityResult {
  severity: Severity;
  source: 'cdm' | 'script';
}

export const SEVERITY_SYSTEM_PROMPT = [
  'A story entity\'s attribute changed between two scenes with no explanation in the prose.',
  'Rate how much this continuity error matters to a reader: "critical", "high" or "low".',
  'Reply with JSON only: {"top_label":"critical"|"high"|"low","p":<probability 0..1>}.',
].join('\n');

/**
 * The script table, and the single rule for unsure: an attribute that is a
 * PROPERTY_CONTRADICTION_PAIRS key is high, everything else is low.
 */
export function scriptSeverity(attribute: string): Severity {
  const key = attribute.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PROPERTY_CONTRADICTION_PAIRS, key) ? 'high' : 'low';
}

/** Severity Classify payload: the change and its two quotes, no scene text. */
export function severityPayload(change: SeverityChange): Record<string, unknown> {
  return {
    labels: [...SEVERITY_LABELS],
    entity: change.entity,
    attribute: change.attribute,
    from: change.a,
    to: change.b,
    quoteA: change.quoteA,
    quoteB: change.quoteB,
  };
}

export async function classifySeverity(change: SeverityChange, ctx: SeverityContext): Promise<SeverityResult> {
  if (ctx.mode === 'full' && ctx.client) {
    try {
      const verdict = await cdmClassify(ctx.client, SEVERITY_LABELS, SEVERITY_SYSTEM_PROMPT, severityPayload(change), ctx.signal);
      if (verdict && verdict.p >= CLASSIFY_MIN_P) return { severity: verdict.label, source: 'cdm' };
    } catch {
      // Any failure is unsure, and unsure uses the script table below.
    }
  }
  return { severity: scriptSeverity(change.attribute), source: 'script' };
}

/** Severity for every flag, in order. The output always has one entry per input flag. */
export async function assignSeverities<F extends SeverityChange>(
  flags: readonly F[],
  ctx: SeverityContext,
): Promise<Array<F & SeverityResult>> {
  const out: Array<F & SeverityResult> = [];
  for (const flag of flags) {
    out.push({ ...flag, ...(await classifySeverity(flag, ctx)) });
  }
  return out;
}
