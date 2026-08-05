// M11a (SKY-9160): single read point for the master AI switch (manual mode,
// prototype "AI features" toggle, PLAN.md §M11a). Every AI-bearing surface
// reads useAiEnabled(); the Settings → AI Agents master toggle is the only
// writer. Backed by a module store (same pattern as coach/sceneAnalysis.ts) so
// non-React callers can read getAiEnabled() too.
import { useSyncExternalStore } from 'react';

// Defaults to enabled until settingsGet resolves so AI chrome doesn't flash
// off on boot in the common (enabled) case.
let aiEnabled = true;
let loadStarted = false;
const listeners = new Set<() => void>();

export function getAiEnabled(): boolean {
  return aiEnabled;
}

/** Writer — the Settings master toggle calls this after persisting. */
export function setAiEnabled(value: boolean): void {
  if (aiEnabled === value) return;
  aiEnabled = value;
  listeners.forEach((l) => l());
}

/** Lazy one-shot hydrate from persisted settings on first subscriber. */
function ensureLoaded(): void {
  if (loadStarted) return;
  loadStarted = true;
  if (typeof window === 'undefined' || !window.api?.settingsGet) return;
  window.api
    .settingsGet()
    .then((s) => setAiEnabled(s.ai?.enabled !== false))
    .catch(() => {
      // Settings read failed (early boot) — keep the enabled default.
    });
}

export function subscribeAiEnabled(listener: () => void): () => void {
  ensureLoaded();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAiEnabled(): boolean {
  return useSyncExternalStore(subscribeAiEnabled, getAiEnabled);
}

/** Test-only: reset module state between specs. */
export function __resetAiEnabledForTests(): void {
  aiEnabled = true;
  loadStarted = false;
  listeners.clear();
}
