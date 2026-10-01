// Coach free-text invoke — writingAssistant provider only (Probe P4 / Ivy privacy).
// Never agentBrainstorm. History is folded into the prompt because the WA IPC
// takes (prompt, context), not a history array. Scene prose goes in `context`.

import type { MiniChatInvoke } from '../timeline2/panel/useMiniAgentChat';
import { MAX_HISTORY_TURNS } from '../timeline2/panel/useMiniAgentChat';
import {
  assertAgentProviderReady,
  type PartnerLlmAgent,
} from './partnerProviderGate';

export function formatHistoryForWritingAssistant(
  history: { role: 'user' | 'assistant'; content: string }[],
): string {
  if (history.length === 0) return '';
  const capped = history.slice(-MAX_HISTORY_TURNS);
  return capped
    .map((t) => `${t.role === 'user' ? 'User' : 'Coach'}: ${t.content}`)
    .join('\n\n');
}

export function buildCoachInvokePrompt(
  userPrompt: string,
  history: { role: 'user' | 'assistant'; content: string }[],
): string {
  const prior = formatHistoryForWritingAssistant(history);
  if (!prior) return userPrompt;
  return `${prior}\n\nUser: ${userPrompt}`;
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
 * Coach chat invoke — writingAssistant provider. Caller supplies scene context
 * separately via the closure below.
 */
export function makeCoachInvoke(getSceneContext: () => string | undefined): MiniChatInvoke {
  return async (prompt, history) => {
    await refuseUnlessProviderReady('writingAssistant');
    const api = window.api;
    if (typeof api?.agentWritingAssistant !== 'function') {
      throw new Error('Writing Coach unavailable — check your provider settings.');
    }
    const composed = buildCoachInvokePrompt(prompt, history);
    const response = await api.agentWritingAssistant(composed, getSceneContext());
    return response.text;
  };
}
