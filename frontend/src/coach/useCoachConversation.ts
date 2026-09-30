import { useCallback, useMemo, useState } from 'react';
import type { Scene } from '../types';
import { useAgentSessions, type UseAgentSessionsResult } from '../lib/useAgentSessions';
import { PARTNER_SESSION_AGENT } from '../agents/partnerIdentity';
import { buildFullSceneContext, makeCoachInvoke, turnsToCoachHistory } from '../agents/coachInvoke';
import { decodeCoachTurns, type CoachMessage } from './coachMessages';

export interface CoachConversation {
  /** Shared session store — feed the session pill with this. */
  store: UseAgentSessionsResult;
  /** Persisted conversation, decoded for rendering. */
  messages: CoachMessage[];
  /** In-flight user prompt (optimistic bubble + typing dots). */
  pendingPrompt: string | null;
  busy: boolean;
  error: string | null;
  /** Send a prompt to the Writing Coach provider and persist to the partner session. */
  send: (prompt: string) => Promise<void>;
}

export function useCoachConversation(scene: Scene | null): CoachConversation {
  const store = useAgentSessions(PARTNER_SESSION_AGENT);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const turns = store.activeSession?.turns;
  const messages = useMemo(() => decodeCoachTurns(turns ?? []), [turns]);

  const invoke = useMemo(
    () => makeCoachInvoke(() => buildFullSceneContext(scene)),
    [scene],
  );

  const send = useCallback(async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed || pendingPrompt !== null) return;
    setError(null);
    setPendingPrompt(trimmed);

    // Pin this exchange to whichever session is active RIGHT NOW. If the user
    // switches sessions before the reply comes back, the turns still belong
    // in the session they were asked from, never wherever the picker lands.
    const originSessionId = store.activeSessionId ?? undefined;
    // Cap + strip raw card JSON before folding into the WA prompt (Critic N2 / N1).
    const history = turnsToCoachHistory(store.activeSession?.turns ?? []);

    try {
      // Probe P4 — writingAssistant provider + full scene context (never brainstorm).
      const result = await invoke(trimmed, history);
      const agentText = typeof result === 'string' ? result : result.text;
      const now = new Date().toISOString();
      await store.appendTurns([
        { role: 'user', text: trimmed, at: now },
        { role: 'agent', text: agentText, at: new Date().toISOString() },
      ], originSessionId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'Partner unavailable — check your provider settings.');
    } finally {
      setPendingPrompt(null);
    }
  }, [pendingPrompt, store, invoke]);

  return {
    store,
    messages,
    pendingPrompt,
    busy: pendingPrompt !== null,
    error,
    send,
  };
}
