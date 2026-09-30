// Coach free-text invoke — writingAssistant provider only (Probe P4 / Ivy privacy).
// Never agentBrainstorm. History is folded into the prompt because the WA IPC
// takes (prompt, context), not a history array. Scene prose goes in `context`.

import type { MiniChatInvoke } from '../timeline2/panel/useMiniAgentChat';
import { MAX_HISTORY_TURNS } from '../timeline2/panel/useMiniAgentChat';
import {
  assertAgentProviderReady,
  type PartnerLlmAgent,
} from './partnerProviderGate';
import { historyContentForModel } from '../coach/coachMessages';

/**
 * Main rejects agent prompts over 32_000 chars (`MAX_AGENT_PROMPT_LENGTH`).
 * Leave a small margin for separators / the final "User: …" line.
 */
export const COACH_PROMPT_CHAR_BUDGET = 31_500;

export function formatHistoryForWritingAssistant(
  history: { role: 'user' | 'assistant'; content: string }[],
): string {
  if (history.length === 0) return '';
  const capped = history.slice(-MAX_HISTORY_TURNS);
  return capped
    .map((t) => `${t.role === 'user' ? 'User' : 'Coach'}: ${t.content}`)
    .join('\n\n');
}

/**
 * Fold capped history into the WA prompt, then trim oldest turns until the
 * composed prompt stays under `COACH_PROMPT_CHAR_BUDGET` (Critic hard 4 / N1).
 */
export function buildCoachInvokePrompt(
  userPrompt: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  budget: number = COACH_PROMPT_CHAR_BUDGET,
): string {
  let turns = history.slice(-MAX_HISTORY_TURNS);
  const suffix = turns.length === 0 ? userPrompt : `\n\nUser: ${userPrompt}`;
  let composed = userPrompt;
  while (turns.length > 0) {
    const prior = formatHistoryForWritingAssistant(turns);
    composed = prior ? `${prior}${suffix}` : userPrompt;
    if (composed.length <= budget) return composed;
    turns = turns.slice(1);
  }
  return userPrompt;
}

/** Full scene prose for WA `context` (not title-only). */
export function buildFullSceneContext(
  scene: { title: string; blocks?: Array<{ content?: string }> } | null,
): string | undefined {
  if (!scene) return undefined;
  const body = (scene.blocks ?? []).map((b) => b.content ?? '').filter(Boolean).join('\n\n');
  if (!body) return `Scene: "${scene.title}"`;
  return `Scene: "${scene.title}"\n\n${body}`;
}

export async function loadSettingsForProviderGate(): Promise<AppSettings | null> {
  try {
    return (await window.api?.settingsGet?.()) ?? null;
  } catch {
    return null;
  }
}

export async function refuseUnlessProviderReady(agent: PartnerLlmAgent): Promise<void> {
  const settings = await loadSettingsForProviderGate();
  assertAgentProviderReady(settings, agent);
}

/**
 * Map persisted turns → model history, stripping raw card JSON (Critic N2).
 */
export function turnsToCoachHistory(
  turns: readonly AgentSessionTurn[],
): { role: 'user' | 'assistant'; content: string }[] {
  return turns.slice(-MAX_HISTORY_TURNS).map((t) => ({
    role: t.role === 'agent' ? ('assistant' as const) : ('user' as const),
    content: historyContentForModel(t),
  }));
}

/**
 * Coach chat invoke — writingAssistant provider. Caller supplies scene context
 * separately via the closure below.
 */
/** Slot pin (Shield batch R4) — Coach free-text always uses writingAssistant. */
export const COACH_INVOKE_PROVIDER_SLOT: PartnerLlmAgent = 'writingAssistant';

export function makeCoachInvoke(getSceneContext: () => string | undefined): MiniChatInvoke {
  return async (prompt, history) => {
    await refuseUnlessProviderReady(COACH_INVOKE_PROVIDER_SLOT);
    const api = window.api;
    if (typeof api?.agentWritingAssistant !== 'function') {
      throw new Error('Writing Coach unavailable — check your provider settings.');
    }
    const composed = buildCoachInvokePrompt(prompt, history);
    const response = await api.agentWritingAssistant(composed, getSceneContext());
    // Residual 6 / Shield batch — wrapIpcHandler may return `{ error }` instead of throwing.
    if (response && typeof response === 'object' && 'error' in response
        && typeof (response as { error?: unknown }).error === 'string') {
      throw new Error((response as { error: string }).error);
    }
    if (response == null || typeof response !== 'object'
        || typeof (response as { text?: unknown }).text !== 'string') {
      throw new Error('Writing Coach returned no text.');
    }
    return (response as { text: string }).text;
  };
}
