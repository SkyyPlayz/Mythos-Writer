// Beta 4 M12 — the Coach page's conversation logic (§5.2).
//
// Built on the SHARED `coach` agent-session store (useAgentSessions), so the
// Coach page feed and the right-panel Coach chat render one conversation.
//
// Agent contract (§2, §14.6): the Writing Coach teaches — it NEVER writes
// manuscript prose. This hook's only side effects are (1) asking the coach
// agent for advisory text and (2) appending turns to the vault session file.
// There is deliberately no code path here that touches scenes, blocks, or any
// manuscript write surface, and coachNoGhostwriting.test.ts locks that.

import { useCallback, useMemo, useState } from 'react';
import type { Scene } from '../types';
import { useAgentSessions, type UseAgentSessionsResult } from '../lib/useAgentSessions';
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
  /** Send a prompt to the coach and persist the exchange to the session. */
  send: (prompt: string) => Promise<void>;
}

export function useCoachConversation(scene: Scene | null): CoachConversation {
  const store = useAgentSessions('coach');
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const turns = store.activeSession?.turns;
  const messages = useMemo(() => decodeCoachTurns(turns ?? []), [turns]);

  const send = useCallback(async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed || pendingPrompt !== null) return;
    setError(null);
    setPendingPrompt(trimmed);

    const sceneContext = scene
      ? `Scene: "${scene.title}"\n\n${scene.blocks.map((b) => b.content).join('\n\n')}`
      : undefined;

    try {
      const response = await window.api.agentWritingAssistant(trimmed, sceneContext);
      const now = new Date().toISOString();
      await store.appendTurns([
        { role: 'user', text: trimmed, at: now },
        { role: 'agent', text: response.text, at: new Date().toISOString() },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'Coach unavailable — check your provider settings.');
    } finally {
      setPendingPrompt(null);
    }
  }, [pendingPrompt, scene, store]);

  return {
    store,
    messages,
    pendingPrompt,
    busy: pendingPrompt !== null,
    error,
    send,
  };
}
