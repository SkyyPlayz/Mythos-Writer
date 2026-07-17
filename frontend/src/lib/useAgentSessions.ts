// SKY-6228: M15 — agent chat session store hook.
// Per §11: every chat surface has a session dropdown with rename/duplicate/delete-last behaviour.
//
// M12 — the store is a module-level singleton per agent key so every surface
// mounting `useAgentSessions('coach')` (Coach page feed AND the right-panel
// Coach chat) shares ONE conversation: same session list, same active session,
// same turns. Mutations made on one surface render on the other immediately.

import { useCallback, useSyncExternalStore } from 'react';

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
  /**
   * Append turns to a session (for persistent chat). Pass `sessionId` pinned
   * to whatever was active when the request was SENT — by the time an async
   * agent reply resolves the user may have switched sessions, and the reply
   * must still land in the session it was asked from, never the one that
   * happens to be active at completion time. Omitting it falls back to
   * whatever is active right now (fine for synchronous callers).
   */
  appendTurns: (turns: AgentSessionTurn[], sessionId?: string) => Promise<void>;
  /** Reload sessions from vault. */
  refresh: () => Promise<AgentSessionSummary[] | undefined>;
}

interface AgentSessionStoreState {
  sessions: AgentSessionSummary[];
  activeSessionId: string | null;
  activeSession: AgentSessionFile | null;
  loading: boolean;
}

interface AgentSessionStore {
  state: AgentSessionStoreState;
  listeners: Set<() => void>;
  initialised: boolean;
  subscribe: (fn: () => void) => () => void;
  getSnapshot: () => AgentSessionStoreState;
  actions: Omit<UseAgentSessionsResult, keyof AgentSessionStoreState>;
}

type AgentSessionsApi = NonNullable<Window['api']['agentSessions']>;

const stores = new Map<string, AgentSessionStore>();

/** Test hook: drop all shared stores so each test starts from a clean init. */
export function __resetAgentSessionStores(): void {
  stores.clear();
}

function getApi(): AgentSessionsApi | undefined {
  return window.api?.agentSessions;
}

function createStore(agent: string): AgentSessionStore {
  const store: AgentSessionStore = {
    state: { sessions: [], activeSessionId: null, activeSession: null, loading: true },
    listeners: new Set(),
    initialised: false,
    subscribe(fn) {
      store.listeners.add(fn);
      return () => { store.listeners.delete(fn); };
    },
    getSnapshot() {
      return store.state;
    },
    actions: null as unknown as AgentSessionStore['actions'],
  };

  const set = (patch: Partial<AgentSessionStoreState>) => {
    store.state = { ...store.state, ...patch };
    for (const fn of [...store.listeners]) fn();
  };

  /** Load the full session file (turns included) for the active id. */
  const hydrateActive = async (id: string | null) => {
    const api = getApi();
    if (!id || !api) return;
    if (store.state.activeSession?.id === id) return;
    // Older preloads may not expose `read`; degrade to summaries-only.
    if (typeof api.read !== 'function') return;
    try {
      const { session } = await api.read(id);
      // Only apply if the user hasn't switched away while we were reading.
      if (session && store.state.activeSessionId === id) {
        set({ activeSession: session });
      }
    } catch {
      /* degrade silently — feed shows what it has */
    }
  };

  const refresh = async () => {
    const api = getApi();
    if (!api) return undefined;
    try {
      const { sessions: list } = await api.list(agent);
      set({ sessions: list });
      return list;
    } catch {
      return [];
    }
  };

  const initSession = async () => {
    const api = getApi();
    if (!api) { set({ loading: false }); return; }
    set({ loading: true });
    try {
      const { sessions: list } = await api.list(agent);
      set({ sessions: list });
      if (list.length > 0) {
        set({ activeSessionId: list[0].id });
        await hydrateActive(list[0].id);
      } else {
        // Auto-create the first session for this agent
        const greeting = AGENT_GREETINGS[agent] ?? null;
        const res = await api.create(agent, undefined, greeting ?? undefined);
        set({
          sessions: [toSummary(res.session, res.relPath)],
          activeSession: res.session,
          activeSessionId: res.session.id,
        });
      }
    } catch {
      // no vault; degrade silently — UI shows empty state
    } finally {
      set({ loading: false });
    }
  };

  const ensureInit = () => {
    if (store.initialised) return;
    store.initialised = true;
    void initSession();
  };

  store.actions = {
    switchSession: async (id: string) => {
      if (store.state.activeSessionId === id) return;
      // Drop the stale transcript immediately so the feed never renders the
      // PREVIOUS session's turns under the newly-selected session's label
      // while the read resolves (the "wrong-transcript flash").
      set({ activeSessionId: id, activeSession: null, loading: true });
      try {
        await hydrateActive(id);
      } finally {
        if (store.state.activeSessionId === id) set({ loading: false });
      }
    },
    newSession: async (greeting?: string) => {
      const api = getApi();
      if (!api) return;
      const effectiveGreeting = greeting ?? AGENT_GREETINGS[agent] ?? undefined;
      const res = await api.create(agent, undefined, effectiveGreeting);
      const summary = toSummary(res.session, res.relPath);
      set({
        sessions: [summary, ...store.state.sessions],
        activeSession: res.session,
        activeSessionId: res.session.id,
      });
    },
    renameSession: async (id: string, title: string) => {
      const api = getApi();
      if (!api) return;
      await api.rename(id, title);
      set({
        sessions: store.state.sessions.map((s) => (s.id === id ? { ...s, title } : s)),
      });
    },
    duplicateSession: async (id: string) => {
      const api = getApi();
      if (!api) return;
      const res = await api.duplicate(id);
      const summary = toSummary(res.session, res.relPath);
      set({
        sessions: [summary, ...store.state.sessions],
        activeSession: res.session,
        activeSessionId: res.session.id,
      });
    },
    deleteSession: async (id: string) => {
      const api = getApi();
      if (!api) return;
      const res = await api.delete(id);
      if (!res.ok) return;
      const remaining = store.state.sessions.filter((s) => s.id !== id);
      const next = res.replacement
        ? [toSummary(res.replacement, res.replacementRelPath ?? ''), ...remaining]
        : remaining;
      const patch: Partial<AgentSessionStoreState> = { sessions: next };
      if (store.state.activeSessionId === id) {
        const nextId = res.replacement?.id ?? remaining[0]?.id ?? null;
        patch.activeSessionId = nextId;
        patch.activeSession = res.replacement ?? null;
        set(patch);
        if (!res.replacement) await hydrateActive(nextId);
        return;
      }
      set(patch);
    },
    appendTurns: async (turns: AgentSessionTurn[], sessionId?: string) => {
      const api = getApi();
      // Pin the write to the id the caller captured at send time; never to
      // whatever happens to be active when this promise settles.
      const id = sessionId ?? store.state.activeSessionId;
      if (!api || !id) return;
      const res = await api.appendTurns(id, turns);
      if (res.session) {
        const s = res.session;
        set({
          // Only refresh the rendered transcript if the user is still on
          // this session — otherwise the write lands on disk correctly but
          // must not clobber whatever session is now on screen.
          activeSession: store.state.activeSessionId === s.id ? s : store.state.activeSession,
          sessions: store.state.sessions.map((x) =>
            x.id === s.id ? { ...x, turnCount: s.turns.length, updatedAt: s.updatedAt } : x,
          ),
        });
      }
    },
    refresh,
  };

  // Kick off init lazily on first use.
  ensureInit();
  return store;
}

/** Get (or create) the shared session store for one agent key. */
export function getAgentSessionStore(agent: string): AgentSessionStore {
  let store = stores.get(agent);
  if (!store) {
    store = createStore(agent);
    stores.set(agent, store);
  }
  return store;
}

export function useAgentSessions(agent: string): UseAgentSessionsResult {
  const store = getAgentSessionStore(agent);
  const subscribe = useCallback(
    (fn: () => void) => store.subscribe(fn),
    [store],
  );
  const state = useSyncExternalStore(subscribe, store.getSnapshot);
  return {
    ...state,
    ...store.actions,
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
