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
import {
  COACHING_ASSISTANT_MARKER,
  COACHING_TEACHER_MARKER,
  effectiveCoachingMode,
  QUIET_ASSISTANT_DIRECTIVE,
  TEACHER_DIRECTIVE,
} from '../partner/partnerPersonality';
import { buildPersonalityPromptAddenda } from '../partner/partnerSettings';

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

/** Thrown before any request when the mode prefix + the writer's message cannot fit. */
export class CoachPromptBudgetError extends Error {
  readonly code = 'coach-prompt-budget' as const;
  constructor() {
    super('That message is too long for the Writing Coach — shorten it and try again. No request was sent.');
    this.name = 'CoachPromptBudgetError';
  }
}

/**
 * Fold capped history into the WA prompt, then trim oldest turns until the
 * composed prompt stays under `COACH_PROMPT_CHAR_BUDGET` (Critic hard 4 / N1).
 *
 * PLAN-COACHING-OPT-IN: a non-empty `prefix` (the coaching mode prefix) opens
 * the prompt and counts against the same budget. History is trimmed first;
 * when even `prefix + userPrompt` exceeds the budget this throws
 * `CoachPromptBudgetError` so the caller refuses before invoking.
 */
export function buildCoachInvokePrompt(
  userPrompt: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  budget: number = COACH_PROMPT_CHAR_BUDGET,
  prefix = '',
): string {
  const head = prefix ? `${prefix}\n\n` : '';
  if (head && head.length + userPrompt.length > budget) throw new CoachPromptBudgetError();
  const room = budget - head.length;
  let turns = history.slice(-MAX_HISTORY_TURNS);
  const suffix = turns.length === 0 ? userPrompt : `\n\nUser: ${userPrompt}`;
  while (turns.length > 0) {
    const prior = formatHistoryForWritingAssistant(turns);
    const composed = prior ? `${prior}${suffix}` : userPrompt;
    if (composed.length <= room) return `${head}${composed}`;
    turns = turns.slice(1);
  }
  return `${head}${userPrompt}`;
}

/**
 * PLAN-COACHING-OPT-IN — the mode prefix every Coach chat prompt opens with.
 *
 * - Coaching off (default) → the quiet assistant directive only.
 * - Assistant → assistant marker + quiet directive + non-teaching personality.
 * - Teacher → teacher marker + teaching directive + full personality.
 *
 * Teaching text appears only when effectiveCoachingMode(settings) === 'teacher'.
 */
export function buildCoachModePrefix(settings: AppSettings | null | undefined): string {
  const mode = effectiveCoachingMode(settings);
  if (mode === 'off') return QUIET_ASSISTANT_DIRECTIVE;
  const addenda = buildPersonalityPromptAddenda(settings);
  const opening = mode === 'teacher'
    ? [COACHING_TEACHER_MARKER, TEACHER_DIRECTIVE]
    : [COACHING_ASSISTANT_MARKER, QUIET_ASSISTANT_DIRECTIVE];
  return [...opening, ...addenda].join('\n');
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

/** Same copy main uses (provider.ts AI_DISABLED_MESSAGE) + the no-request promise. */
export const COACH_AI_OFF_MESSAGE =
  'AI features are off — every tool is manual. Turn them back on in Settings → Model & keys. No request was sent.';

/**
 * Coach surfaces (chat send + Full Analysis): ONE settings read that both
 * gates the call and supplies the coaching mode, so the coaching toggle adds
 * no IPC. Refuses before any request when AI is off (master switch) or the
 * slot's provider cannot resolve.
 */
export async function loadCoachReadySettings(agent: PartnerLlmAgent): Promise<AppSettings | null> {
  const settings = await loadSettingsForProviderGate();
  if (settings?.ai?.enabled === false) throw new Error(COACH_AI_OFF_MESSAGE);
  assertAgentProviderReady(settings, agent);
  return settings;
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
    const settings = await loadCoachReadySettings(COACH_INVOKE_PROVIDER_SLOT);
    const api = window.api;
    if (typeof api?.agentWritingAssistant !== 'function') {
      throw new Error('Writing Coach unavailable — check your provider settings.');
    }
    const composed = buildCoachInvokePrompt(
      prompt,
      history,
      COACH_PROMPT_CHAR_BUDGET,
      buildCoachModePrefix(settings),
    );
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
