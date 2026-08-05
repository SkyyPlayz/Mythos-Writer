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

function createStore(agent: string, autoCreate: boolean): AgentSessionStore {
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

  // SKY-9028 (GAP P0 #1): the auto-created first session lives ONLY in memory
  // until the user actually writes to it. Mounting an agent surface (e.g. the
  // Brainstorm panel inside the Notes tab) must never create a Sessions/*.md
  // file in the user's vault — that was the boot path escaping the W0.1
  // seed-once markers. `materialize()` turns the pending session into a real
  // file on the first user-initiated mutation; ids pinned at send time are
  // translated to the materialized id.
  let pending: AgentSessionFile | null = null;
  let materializing: Promise<string | null> | null = null;
  // Pending-id → materialized-id. Callers pin a session id when they SEND a
  // request; by the time the async reply appends its turn the pending session
  // may have materialized under a new id, and the write must follow it.
  const materializedIds = new Map<string, string>();

  const set = (patch: Partial<AgentSessionStoreState>) => {
    store.state = { ...store.state, ...patch };
    for (const fn of [...store.listeners]) fn();
  };

  const makePending = (): AgentSessionFile => {
    const greeting = AGENT_GREETINGS[agent] ?? null;
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      agent,
      startedAt: now,
      updatedAt: now,
      turns: greeting ? [{ role: 'agent', text: greeting, at: now }] : [],
    };
  };

  /** Write the pending in-memory session to the vault; returns its real id. */
  const materialize = async (): Promise<string | null> => {
    const api = getApi();
    const snapshot = pending;
    if (!api || !snapshot) return null;
    if (!materializing) {
      const greeting = snapshot.turns.find((t) => t.role === 'agent')?.text;
      // Pass the pending id so the file is created under the id every mounted
      // surface already renders/pins — the conversation identity is stable
      // across materialization (main enforces UUID shape).
      materializing = api
        .create(agent, snapshot.title, greeting, snapshot.id)
        .then((res) => {
          const wasActive = store.state.activeSessionId === snapshot.id;
          materializedIds.set(snapshot.id, res.session.id);
          pending = null;
          set({
            sessions: [
              toSummary(res.session, res.relPath),
              ...store.state.sessions.filter((s) => s.id !== snapshot.id),
            ],
            ...(wasActive
              ? { activeSession: res.session, activeSessionId: res.session.id }
              : {}),
          });
          return res.session.id;
        })
        .catch(() => {
          // Vault unavailable — keep the pending session so a retry can work.
          materializing = null;
          return null;
        });
    }
    return materializing;
  };

  /** Load the full session file (turns included) for the active id. */
  const hydrateActive = async (id: string | null) => {
    const api = getApi();
    if (!id || !api) return;
    if (pending && id === pending.id) {
      // The pending session only exists in memory — nothing to read.
      if (store.state.activeSessionId === id) set({ activeSession: pending });
      return;
    }
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
      // The pending session is invisible to the vault listing; keep it first
      // (it is the newest) so pickers don't drop the active conversation.
      set({ sessions: pending ? [toSummary(pending, ''), ...list] : list });
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
      } else if (autoCreate) {
        // First session for this agent: greeting renders from memory only.
        // The file is created on the user's first turn (materialize()) —
        // never as a side effect of mounting (SKY-6945, SKY-9028).
        pending = makePending();
        set({
          sessions: [toSummary(pending, '')],
          activeSession: pending,
          activeSessionId: pending.id,
        });
      }
      // else: agent surface isn't active/enabled yet — leave sessions empty
      // rather than writing a session file for a feature the user hasn't used
      // (SKY-6945: was silently creating a Sessions/*.md note in every vault,
      // including disabled-agent and empty-vault fixtures).
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
      if (pending && id === pending.id) {
        // The pending session is already fully in memory — no read round-trip.
        set({ activeSessionId: id, activeSession: pending, loading: false });
        return;
      }
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
      // An untouched pending greeting session is superseded by the explicit
      // new session — drop it rather than leaving a phantom in the picker.
      const dropId = pending?.id;
      pending = null;
      set({
        sessions: [summary, ...store.state.sessions.filter((s) => s.id !== dropId)],
        activeSession: res.session,
        activeSessionId: res.session.id,
      });
    },
    renameSession: async (id: string, title: string) => {
      const api = getApi();
      if (!api) return;
      if (pending && id === pending.id) {
        // Naming an unsaved session is user intent to keep it — persist it
        // under the new title (materialize() reads pending at call time).
        pending = { ...pending, title };
        set({
          sessions: store.state.sessions.map((s) => (s.id === id ? { ...s, title } : s)),
          ...(store.state.activeSessionId === id ? { activeSession: pending } : {}),
        });
        await materialize();
        return;
      }
      await api.rename(id, title);
      set({
        sessions: store.state.sessions.map((s) => (s.id === id ? { ...s, title } : s)),
      });
    },
    duplicateSession: async (id: string) => {
      const api = getApi();
      if (!api) return;
      let realId = id;
      if (pending && id === pending.id) {
        const materialized = await materialize();
        if (!materialized) return;
        realId = materialized;
      }
      const res = await api.duplicate(realId);
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
      if (pending && id === pending.id) {
        // Nothing on disk yet — deleting the unsaved last session just resets
        // it, mirroring the §11 delete-last replacement (still file-free).
        pending = makePending();
        set({
          sessions: [toSummary(pending, ''), ...store.state.sessions.filter((s) => s.id !== id)],
          activeSession: pending,
          activeSessionId: pending.id,
        });
        return;
      }
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
      let id = sessionId ?? store.state.activeSessionId;
      if (!api || !id) return;
      // An id pinned before materialization must follow the real session.
      id = materializedIds.get(id) ?? id;
      if (pending && id === pending.id) {
        // First real write to the deferred session: create the file now and
        // land these turns on the materialized id. Concurrent sends share one
        // create via the single-flight materialize() promise.
        const materialized = await materialize();
        if (!materialized) return;
        id = materialized;
      }
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
export function getAgentSessionStore(agent: string, autoCreate = true): AgentSessionStore {
  let store = stores.get(agent);
  if (!store) {
    store = createStore(agent, autoCreate);
    stores.set(agent, store);
  }
  return store;
}

export function useAgentSessions(agent: string, options?: { autoCreate?: boolean }): UseAgentSessionsResult {
  const autoCreate = options?.autoCreate ?? true;
  const store = getAgentSessionStore(agent, autoCreate);
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
