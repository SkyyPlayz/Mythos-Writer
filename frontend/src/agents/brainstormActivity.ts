// SKY-11214 — Brainstorm agent activity store: the live signal behind the
// AGENTS card's Brainstorm row (AgentHubPanel.tsx's resolveAgentStatus).
//
// Mirrors agentActivity.ts's useSyncExternalStore singleton. A module-level
// store is required (not a prop) because BrainstormPage unmounts on every tab
// switch while the AGENTS card (mounted in GlobalRightSidebar) persists —
// there is no ancestor still mounted to prop-drill through.

import { useSyncExternalStore } from 'react';

export interface BrainstormActivitySnapshot {
  /** A real session is underway — the user has sent a message, or a fact has been extracted. */
  active: boolean;
  /** Facts detected this session via the `[FACT:...]` tag protocol (BrainstormPage's `facts.length`). */
  factsCount: number;
  /** Most recent "BEHIND THE SCENES" activity feed entry, if any (BrainstormPage's `activity[0]`). */
  lastActionText: string | null;
  /** A stream error occurred, or a detected fact failed to save to the vault. */
  hasError: boolean;
}

export const IDLE_BRAINSTORM_ACTIVITY: BrainstormActivitySnapshot = {
  active: false,
  factsCount: 0,
  lastActionText: null,
  hasError: false,
};

let snapshot: BrainstormActivitySnapshot = IDLE_BRAINSTORM_ACTIVITY;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

/** BrainstormPage reports its real state here on every change, and resets to idle on unmount. */
export function setBrainstormActivity(next: BrainstormActivitySnapshot): void {
  snapshot = next;
  emit();
}

export function brainstormActivitySnapshot(): BrainstormActivitySnapshot {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** AGENTS card's Brainstorm row reads the live snapshot here. */
export function useBrainstormActivity(): BrainstormActivitySnapshot {
  return useSyncExternalStore(subscribe, brainstormActivitySnapshot, brainstormActivitySnapshot);
}

/** Test-only: reset the module singleton between test cases. */
export function resetBrainstormActivityForTests(): void {
  snapshot = IDLE_BRAINSTORM_ACTIVITY;
  emit();
}
