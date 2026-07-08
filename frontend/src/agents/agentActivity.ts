// Beta 3 M22 — app-wide "any agent running" signal.
//
// M6 shipped the workspace tab strip's agents chip (WorkspaceTabBar
// `agentsActive` prop) hardcoded idle, waiting for this milestone. Agent
// surfaces mark their busy windows here (imperatively via beginAgentActivity
// or declaratively via useAgentActivity) and DesktopShell reads the combined
// signal with useAgentsActive to light the chip.

import { useEffect, useSyncExternalStore } from 'react';

let activeCount = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

/**
 * Mark one agent request as running. Returns a release function; releasing
 * twice is a no-op so callers can safely release in both success and cleanup
 * paths.
 */
export function beginAgentActivity(): () => void {
  activeCount += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeCount = Math.max(0, activeCount - 1);
    emit();
  };
}

export function agentsActiveSnapshot(): boolean {
  return activeCount > 0;
}

export function subscribeAgentActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while any tracked agent request is in flight. */
export function useAgentsActive(): boolean {
  return useSyncExternalStore(subscribeAgentActivity, agentsActiveSnapshot, agentsActiveSnapshot);
}

/**
 * Declarative bridge for components that already hold a busy boolean
 * (streaming chats, scans): counts as agent activity while `busy` is true.
 */
export function useAgentActivity(busy: boolean): void {
  useEffect(() => {
    if (!busy) return undefined;
    return beginAgentActivity();
  }, [busy]);
}

/** Test-only: clear leaked activity between test cases. */
export function resetAgentActivityForTests(): void {
  activeCount = 0;
  emit();
}
