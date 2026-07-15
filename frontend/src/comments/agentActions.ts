// Beta 3 M11 — agent-action dispatch for archive (continuity) comments.
//
// Archive comments carry the prototype's three actions (comment card 836–840,
// gutter 953–956): "Edit notes to match / Suggest story change / Ignore".
// They dispatch through the EXISTING `archive:confirm` IPC
// (`window.api.archiveConfirm(suggestionId, action)` — the same contract
// ArchiveConfirmDialog.tsx uses), then resolve the comment locally.
//
// Availability tiers (the M15 disabled-affordance pattern):
//   'live'     — kind 'archive' AND a `suggestionId` is attached: buttons work.
//   'disabled' — kind 'archive' without a suggestion: buttons render as
//                clearly-marked disabled affordances until the M23 archive
//                plumbing starts attaching suggestion ids.
//   'none'     — user/writing/beta comments have no agent-action row at all
//                (prototype renders actions only for archive comments).

import { commentsStore } from './store';
import type { StoryComment } from './types';

/** Mirrors ArchiveConfirmAction (ArchiveConfirmDialog.tsx) / archive:confirm IPC. */
export type AgentAction = 'match_archive' | 'suggest_story_change' | 'ignore';

export interface AgentActionDef {
  action: AgentAction;
  /** Button copy, verbatim from the v2 prototype open card (1073–1075). */
  label: string;
}

export const AGENT_ACTIONS: readonly AgentActionDef[] = [
  { action: 'match_archive', label: 'Edit notes to match' },
  { action: 'suggest_story_change', label: 'Suggest story change' },
  { action: 'ignore', label: 'Ignore' },
];

/**
 * Beta 4 M9 — the GUTTER card's compact action row (v2 prototype 1195–1198):
 * only the two archive verbs, short labels; Resolve renders separately and
 * "Ignore" lives on the open comment card only.
 */
export const GUTTER_AGENT_ACTIONS: readonly AgentActionDef[] = [
  { action: 'match_archive', label: 'Edit notes' },
  { action: 'suggest_story_change', label: 'Suggest change' },
];

/** Post-action toast copy (v2 prototype actEdit/actStory 6771–6773; ignore is silent). */
export const AGENT_ACTION_SUCCESS_TOAST: Record<AgentAction, string | null> = {
  match_archive: 'Note updated to match the story',
  suggest_story_change: 'Suggested edit drafted — see Writing Coach',
  ignore: null,
};

export type AgentActionAvailability = 'live' | 'disabled' | 'none';

export function agentActionAvailability(comment: StoryComment): AgentActionAvailability {
  if (comment.kind !== 'archive') return 'none';
  return comment.suggestionId ? 'live' : 'disabled';
}

export interface AgentActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Dispatch one of the three actions for an archive comment. On success the
 * comment is resolved (removed + persisted). Never throws — failures come
 * back as `{ ok: false, error }` so the UI can toast them.
 */
export async function runAgentAction(
  comment: StoryComment,
  action: AgentAction
): Promise<AgentActionResult> {
  if (!comment.suggestionId) {
    return { ok: false, error: 'No linked suggestion — run a continuity scan to link one.' };
  }
  const api = window.api;
  if (typeof api?.archiveConfirm !== 'function') {
    return { ok: false, error: 'Archive agent is unavailable.' };
  }
  try {
    const result = (await api.archiveConfirm(comment.suggestionId, action)) as
      | { error?: string }
      | undefined;
    if (result && typeof result === 'object' && result.error) {
      return { ok: false, error: String(result.error) };
    }
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? 'Archive action failed.' };
  }
  commentsStore.resolve(comment.storyId, comment.id);
  return { ok: true };
}
