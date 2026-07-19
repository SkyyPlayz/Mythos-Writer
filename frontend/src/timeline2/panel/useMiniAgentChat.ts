// Beta 4 M25 — mini-chat logic for the timeline side-tabs (§8.6, §14.5).
//
// Built on the SHARED agent-session stores (useAgentSessions), so the
// Brainstorm mini chat and the Brainstorm page/hub render one conversation —
// same for Archive. Mirrors useCoachConversation: optimistic pending bubble,
// origin-session pinning, and turns persisted to the vault session file.

import { useCallback, useState } from 'react';
import { useAgentSessions, type UseAgentSessionsResult } from '../../lib/useAgentSessions';

export type MiniChatInvoke = (
  prompt: string,
  history: { role: 'user' | 'assistant'; content: string }[],
) => Promise<string>;

export interface MiniAgentChat {
  /** Shared session store — feed the session pill with this. */
  store: UseAgentSessionsResult;
  messages: AgentSessionTurn[];
  /** In-flight user prompt (optimistic bubble + typing dots). */
  pendingPrompt: string | null;
  busy: boolean;
  error: string | null;
  send: (prompt: string) => Promise<void>;
}

/** History cap sent to the agent — matches the IPC-side history limit. */
const MAX_HISTORY_TURNS = 20;

export function useMiniAgentChat(agent: 'brainstorm' | 'archive', invoke: MiniChatInvoke): MiniAgentChat {
  const store = useAgentSessions(agent);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed || pendingPrompt !== null) return;
    setError(null);
    setPendingPrompt(trimmed);

    // Pin this exchange to whichever session is active RIGHT NOW (SKY-7076):
    // if the user switches sessions before the reply lands, the turns still
    // belong to the session they were asked from.
    const originSessionId = store.activeSessionId ?? undefined;
    const history = (store.activeSession?.turns ?? [])
      .slice(-MAX_HISTORY_TURNS)
      .map((t) => ({
        role: t.role === 'agent' ? ('assistant' as const) : ('user' as const),
        content: t.text,
      }));

    try {
      const text = await invoke(trimmed, history);
      const now = new Date().toISOString();
      await store.appendTurns([
        { role: 'user', text: trimmed, at: now },
        { role: 'agent', text, at: new Date().toISOString() },
      ], originSessionId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'Agent unavailable — check your provider settings.');
    } finally {
      setPendingPrompt(null);
    }
  }, [pendingPrompt, store, invoke]);

  return {
    store,
    messages: store.activeSession?.turns ?? [],
    pendingPrompt,
    busy: pendingPrompt !== null,
    error,
    send,
  };
}
