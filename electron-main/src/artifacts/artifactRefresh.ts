// Refresh proposes text only. It never writes, never self-triggers, and stays inside the caps.

import { AI_DISABLED_MESSAGE, isAiMasterOn } from '../provider.js';

export const REFRESH_CALLS_PER_ACTION = 3;
export const REFRESH_OUTPUT_TOKEN_CAP = 8000;

export interface RefreshProposal {
  artifactId: string;
  text: string;
  outputTokens: number;
}

const callsThisAction = new Map<string, number>();

export function resetRefreshAction(artifactId?: string): void {
  if (artifactId) callsThisAction.delete(artifactId);
  else callsThisAction.clear();
}

export function refreshArtifact(input: {
  artifactId: string;
  selfTrigger?: boolean;
  outputTokens: number;
  usage: { used: number; cap: number };
  propose: () => string;
  aiOn?: () => boolean;
}): { ok: true; proposal: RefreshProposal } | { ok: false; error: string } {
  const aiOn = input.aiOn ?? isAiMasterOn;
  try {
    if (!aiOn()) return { ok: false, error: AI_DISABLED_MESSAGE };
    if (input.selfTrigger) return { ok: false, error: 'self_trigger' };
    const used = (callsThisAction.get(input.artifactId) ?? 0) + 1;
    if (used > REFRESH_CALLS_PER_ACTION) return { ok: false, error: 'call_cap' };
    callsThisAction.set(input.artifactId, used);
    if (input.outputTokens > REFRESH_OUTPUT_TOKEN_CAP) return { ok: false, error: 'output_cap' };
    if (input.usage.used + input.outputTokens > input.usage.cap) return { ok: false, error: 'usage_cap' };
    const text = input.propose();
    return {
      ok: true,
      proposal: { artifactId: input.artifactId, text, outputTokens: input.outputTokens },
    };
  } catch {
    return { ok: false, error: 'fail_closed' };
  }
}
