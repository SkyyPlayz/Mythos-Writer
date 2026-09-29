// Beta 4 M12 — the Coach page's conversation logic (§5.2).
//
// F3#1 — Built on the SHARED partner session store (`PARTNER_SESSION_AGENT` /
// brainstorm) so Coach page, Agent Hub, Timeline partner tab, Beta chat, and
// WA float-out render ONE conversation. Send path is invokeBrainstorm only —
// coach IPC is not granted to the partner thread.
//
// Agent contract (§2, §14.6): the Writing Coach teaches — it NEVER writes
// manuscript prose. This hook's only side effects are (1) asking the partner
// agent for advisory text and (2) appending turns to the vault session file.
// There is deliberately no code path here that touches scenes, blocks, or any
// manuscript write surface, and coachNoGhostwriting.test.ts locks that.

import { useCallback, useMemo, useState } from 'react';
import type { Scene } from '../types';
import { useAgentSessions, type UseAgentSessionsResult } from '../lib/useAgentSessions';
import { PARTNER_SESSION_AGENT } from '../agents/partnerIdentity';
import { invokeBrainstorm } from '../timeline2/panel/BrainstormTab';
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
  /** Send a prompt to the partner and persist the exchange to the session. */
  send: (prompt: string) => Promise<void>;
}

export function useCoachConversation(scene: Scene | null): CoachConversation {
  const store = useAgentSessions(PARTNER_SESSION_AGENT);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const turns = store.activeSession?.turns;
  const messages = useMemo(() => decodeCoachTurns(turns ?? []), [turns]);

  const send = useCallback(async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed || pendingPrompt !== null) return;
    setError(null);
    setPendingPrompt(trimmed);

    // Pin this exchange to whichever session is active RIGHT NOW. If the user
    // switches sessions before the reply comes back, the turns still belong
    // in the session they were asked from, never wherever the picker lands.
    const originSessionId = store.activeSessionId ?? undefined;
    const history = (store.activeSession?.turns ?? [])
      .slice(-20)
      .map((t) => ({
        role: t.role === 'agent' ? ('assistant' as const) : ('user' as const),
        content: t.text,
      }));

    // Scene context rides in the prompt text (plain), not as a separate IPC —
    // send path stays invokeBrainstorm only (security bar a).
    const withScene = scene
      ? `${trimmed}\n\n(Scene context: "${scene.title}")`
      : trimmed;

    try {
      const result = await invokeBrainstorm(withScene, history);
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
