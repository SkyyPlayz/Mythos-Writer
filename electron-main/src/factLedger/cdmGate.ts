// Purpose: the main-side gate for CDM story-facts calls. CDM_FACTS_FLAG here is
// the single source of truth for the feature flag; the renderer has no flag of
// its own. Flipping the feature on edits only that constant.

import type { FactMode } from './extract/types.js';

/** Single source of truth for CDM story facts. Ships off. */
export const CDM_FACTS_FLAG: boolean = false;

/** Default for the user opt-in. Settings start here; only a saved literal `true` opts in. */
export const DEFAULT_CDM_SETTINGS: Readonly<{ cdmOptIn: false }> = Object.freeze({ cdmOptIn: false });

/**
 * The flag, plus a test-only override. Reads process.env on every call, never
 * at import. MYTHOS_CDM_FACTS_E2E=1 counts only when MYTHOS_E2E is '1' and
 * MYTHOS_IS_PACKAGED is exactly '0' (main.ts sets '0' only when unpackaged).
 * Unset MYTHOS_IS_PACKAGED counts as packaged, so the override fails closed.
 */
export function cdmFlagOn(): boolean {
  if (CDM_FACTS_FLAG) return true;
  const env = process.env;
  return env.MYTHOS_E2E === '1' && env.MYTHOS_IS_PACKAGED === '0' && env.MYTHOS_CDM_FACTS_E2E === '1';
}

/** A settings object opts in only with the literal boolean `true`. */
export function readCdmOptIn(settings: unknown): boolean {
  if (typeof settings !== 'object' || settings === null) return false;
  return (settings as { cdmOptIn?: unknown }).cdmOptIn === true;
}

export interface CdmGateInput {
  flag: unknown;
  optIn: unknown;
  effectiveMode: unknown;
}

/** True only when the flag is on, the opt-in is strictly `true`, and the mode is Full AI. */
export function cdmAllowed({ flag, optIn, effectiveMode }: CdmGateInput): boolean {
  const full: FactMode = 'full';
  return flag === true && optIn === true && effectiveMode === full;
}
