// SKY-6228: M15 — agent chat session store hook.
// Per §11: every chat surface has a session dropdown with rename/duplicate/delete-last behaviour.
// Coach page ↔ Coach panel chat share one store keyed on agent='coach'.

import { useState, useCallback, useEffect, useRef } from 'react';

export interface UseAgentSessionsResult {
  sessions: AgentSessionSummary[];
  activeSession: AgentSessionFile | null;
  activeSessionId: string | null;
  loading: boolean;
  /** Switch to an existing session (by id). */
  switchSession: (id: string) => Promise<void>;
  /** Create a new session (with optional greeting) and switch to it. */
  newSession: (greeting?: string) => Promise<void>;
  /** Rename the active session. */
  renameSession: (id: string, title: string) => Promise<void>;
  /** Duplicate a session and switch to the copy. */
  duplicateSession: (id: string) => Promise<void>;
  /** Delete a session. If it was the last, a fresh one is auto-created. */
  deleteSession: (id: string) => Promise<void>;
  /** Append turns to the active session (for persistent chat). */
  appendTurns: (turns: AgentSessionTurn[]) => Promise<void>;
  /** Reload sessions from vault. */
  refresh: () => Promise<AgentSessionSummary[] | undefined>;
}

export function useAgentSessions(agent: string): UseAgentSessionsResult {
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<AgentSessionFile | null>(null);
  const [loading, setLoading] = useState(true);
  const initialised = useRef(false);

  const api = window.api?.agentSessions;

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const { sessions: list } = await api.list(agent);
      setSessions(list);
      return list;
    } catch {
      return [];
    }
  }, [agent, api]);

  const initSession = useCallback(async () => {
    if (!api) { setLoading(false); return; }
    setLoading(true);
    try {
      const { sessions: list } = await api.list(agent);
      setSessions(list);
      if (list.length > 0) {
        setActiveSessionId(list[0].id);
      } else {
        // Auto-create the first session for this agent
        const greeting = AGENT_GREETINGS[agent] ?? null;
        const res = await api.create(agent, undefined, greeting ?? undefined);
        setSessions([toSummary(res.session, res.relPath)]);
        setActiveSession(res.session);
        setActiveSessionId(res.session.id);
      }
    } catch {
      // no vault; degrade silently — UI shows empty state
    } finally {
      setLoading(false);
    }
  }, [agent, api]);

  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    void initSession();
  }, [initSession]);

  // M20: hydrate the full session file when the active session changes.
  // Skips the round-trip when the current activeSession already matches (e.g.
  // right after create/duplicate/appendTurns, whose responses carry the file).
  const activeSessionRef = useRef<AgentSessionFile | null>(null);
  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);
  useEffect(() => {
    if (!activeSessionId || !api || typeof api.read !== 'function') return;
    if (activeSessionRef.current?.id === activeSessionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const { session } = await api.read(activeSessionId);
        if (!cancelled && session && session.id === activeSessionId) {
          setActiveSession(session);
        }
      } catch { /* vault unavailable — keep whatever we have */ }
    })();
    return () => { cancelled = true; };
  }, [activeSessionId, api]);

  const switchSession = useCallback(async (id: string) => {
    setActiveSessionId(id);
  }, []);

  const newSession = useCallback(async (greeting?: string) => {
    if (!api) return;
    const effectiveGreeting = greeting ?? AGENT_GREETINGS[agent] ?? undefined;
    const res = await api.create(agent, undefined, effectiveGreeting);
    const summary = toSummary(res.session, res.relPath);
    setSessions((prev) => [summary, ...prev]);
    setActiveSession(res.session);
    setActiveSessionId(res.session.id);
  }, [agent, api]);

  const renameSession = useCallback(async (id: string, title: string) => {
    if (!api) return;
    await api.rename(id, title);
    setSessions((prev) =>
      prev.map((s) => s.id === id ? { ...s, title } : s),
    );
  }, [api]);

  const duplicateSession = useCallback(async (id: string) => {
    if (!api) return;
    const res = await api.duplicate(id);
    const summary = toSummary(res.session, res.relPath);
    setSessions((prev) => [summary, ...prev]);
    setActiveSession(res.session);
    setActiveSessionId(res.session.id);
  }, [api]);

  const deleteSession = useCallback(async (id: string) => {
    if (!api) return;
    const res = await api.delete(id);
    if (res.ok) {
      setSessions((prev) => {
        const remaining = prev.filter((s) => s.id !== id);
        if (res.replacement) {
          const rSum = toSummary(res.replacement, res.replacementRelPath ?? '');
          return [rSum, ...remaining];
        }
        return remaining;
      });
      if (activeSessionId === id) {
        const nextId = res.replacement?.id ?? sessions.find((s) => s.id !== id)?.id ?? null;
        if (res.replacement) setActiveSession(res.replacement);
        setActiveSessionId(nextId);
      }
    }
  }, [activeSessionId, sessions, api]);

  const appendTurns = useCallback(async (turns: AgentSessionTurn[]) => {
    if (!api || !activeSessionId) return;
    const res = await api.appendTurns(activeSessionId, turns);
    if (res.session) {
      setActiveSession(res.session);
      setSessions((prev) =>
        prev.map((s) =>
          s.id === res.session!.id
            ? { ...s, turnCount: res.session!.turns.length, updatedAt: res.session!.updatedAt }
            : s,
        ),
      );
    }
  }, [activeSessionId, api]);

  return {
    sessions,
    activeSession,
    activeSessionId,
    loading,
    switchSession,
    newSession,
    renameSession,
    duplicateSession,
    deleteSession,
    appendTurns,
    refresh,
  };
}

function toSummary(session: AgentSessionFile, relPath: string): AgentSessionSummary {
  return {
    id: session.id,
    agent: session.agent,
    title: session.title,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    turnCount: session.turns.length,
    relPath,
  };
}

const AGENT_GREETINGS: Record<string, string> = {
  'writing-assistant': "Hi! I'm your Writing Coach — I teach you to write better using your own pages and never ghost-write. What would you like to work on?",
  coach: "Hi! I'm your Writing Coach — I teach you to write better using your own pages and never ghost-write. What would you like to work on?",
  brainstorm: "Hello! I'm the Brainstorm Agent — your vault curator. Share any idea and I'll help you develop it and file notes automatically.",
  archive: "I'm the Archive Agent — continuity guardian and timeline builder. Ask me to check facts, catch inconsistencies, or build your timeline.",
  'beta-reader': "I'm your Beta Reader — I read your pages like a first-time reader and give you honest reactions. Drop me a scene and I'll tell you what lands.",
};
