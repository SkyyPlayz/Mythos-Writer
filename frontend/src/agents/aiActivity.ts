// aiActivity.ts — SKY-11223: renderer-side mirror of the main-process
// AiActivityRegistry, the single source of truth for "what is the app doing
// right now." Before this, that question had four independent, inconsistent
// answers (a boolean counter fed by ad hoc per-panel `loading` flags, a
// hardcoded Brainstorm status string, and silence for Beta Reader). This
// store carries real identity — which agent, which surface, which provider,
// which model — and feeds the always-visible activity indicator, the
// AgentHubPanel status dots, and per-surface cancel buttons from one place.
//
// The main process pushes the full snapshot on every change; this module
// never polls. `getAiActivitySnapshot()` is called once on first subscribe
// so a freshly mounted renderer (or a fresh window) isn't blind to work
// already running.

import { useSyncExternalStore } from 'react';

export type AiActivityAgentId = 'writingAssistant' | 'brainstorm' | 'archive' | 'betaReader';

// A terminal outcome stays in the "recently finished" list for this long so
// a fast success/empty/error/cancel is still visible for a moment — silence
// is never the end state, per SKY-11223 AC4.
const TERMINAL_VISIBLE_MS = 6000;
const MAX_RECENT_TERMINALS = 5;

let entries: AiActivityEntry[] = [];
let recentTerminals: AiActivityTerminalEvent[] = [];
const listeners = new Set<() => void>();
let started = false;

function emit(): void {
  listeners.forEach((l) => l());
}

function pruneExpiredTerminals(): void {
  const cutoff = Date.now() - TERMINAL_VISIBLE_MS;
  const next = recentTerminals.filter((t) => t.endedAt >= cutoff);
  if (next.length !== recentTerminals.length) {
    recentTerminals = next;
    emit();
  }
}

/**
 * Wires the IPC subscriptions exactly once, no matter how many components
 * mount. Guards each bridge method individually (not just `window.api` as a
 * whole) — many component tests mount panels against a partial `window.api`
 * mock that predates this registry, and a missing method here must not
 * break them.
 */
function ensureStarted(): void {
  if (started) return;
  started = true;
  if (typeof window === 'undefined' || !window.api) return;
  window.api.getAiActivitySnapshot?.()
    .then((snapshot) => {
      entries = snapshot;
      emit();
    })
    .catch(() => { /* main process not ready yet — the push channel will catch up */ });
  window.api.onAiActivityUpdate?.((next) => {
    entries = next;
    emit();
  });
  window.api.onAiActivityTerminal?.((event) => {
    recentTerminals = [event, ...recentTerminals].slice(0, MAX_RECENT_TERMINALS);
    emit();
    setTimeout(pruneExpiredTerminals, TERMINAL_VISIBLE_MS + 100);
  });
}

function getEntriesSnapshot(): AiActivityEntry[] {
  return entries;
}

function getRecentTerminalsSnapshot(): AiActivityTerminalEvent[] {
  return recentTerminals;
}

function subscribe(listener: () => void): () => void {
  ensureStarted();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Every AI request currently in flight, across every agent and surface. */
export function useAiActivities(): AiActivityEntry[] {
  return useSyncExternalStore(subscribe, getEntriesSnapshot, getEntriesSnapshot);
}

/** Recently finished requests (done/empty/error/cancelled) — a real terminal state instead of silence. */
export function useRecentAiActivityTerminals(): AiActivityTerminalEvent[] {
  return useSyncExternalStore(subscribe, getRecentTerminalsSnapshot, getRecentTerminalsSnapshot);
}

/** True while any request for the given agent is running — feeds AgentHubPanel's status dots. */
export function useIsAgentActive(agent: AiActivityAgentId): boolean {
  return useAiActivities().some((e) => e.agent === agent);
}

/** The running request for a given agent, if any — feeds AgentHubPanel's live status text. */
export function useAgentRunningEntry(agent: AiActivityAgentId): AiActivityEntry | null {
  return useAiActivities().find((e) => e.agent === agent) ?? null;
}

/**
 * The most recent finished request for a given agent, while still within its
 * visible window — feeds AgentHubPanel's "produced nothing" / "needs
 * attention" states. `recentTerminals` is newest-first, so `.find` is the
 * latest match.
 */
export function useAgentRecentTerminal(agent: AiActivityAgentId): AiActivityTerminalEvent | null {
  return useRecentAiActivityTerminals().find((e) => e.agent === agent) ?? null;
}

/** True while any AI request at all is running — feeds the always-visible chip. */
export function useAnyAiActivityRunning(): boolean {
  return useAiActivities().length > 0;
}

/** Cancel a specific in-flight request. No-op if it already finished. */
export function cancelAiActivity(requestId: string): void {
  window.api?.cancelAiActivity?.(requestId);
}

/** Test-only: clear all tracked state between test cases. */
export function resetAiActivityForTests(): void {
  entries = [];
  recentTerminals = [];
  started = false;
}
