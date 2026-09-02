// aiActivityRegistry.ts — SKY-11223: single source of truth for in-flight AI work.
//
// Before this, "is the app doing anything?" had four independent, inconsistent
// answers: a boolean counter (agentActivity.ts) fed by ad hoc per-panel
// `loading` flags, a hardcoded Brainstorm status string, and no signal at all
// for Beta Reader. None of them carried *identity* (which agent, which
// provider, which model) or a way to cancel.
//
// Every streaming/generation call site in main.ts registers itself here right
// after creating its AbortController and reports a terminal outcome in its
// `finally` block. Renderers never poll — the full snapshot is pushed over
// IPC on every change, and a getter exists for a freshly-created window to
// catch up on work already in flight.

import { BrowserWindow, ipcMain } from 'electron';
import type { AgentPersonaName } from './agentPersona.js';
import type { ProviderConfig } from './provider.js';
import { isFromTopFrame } from './ipc.js';

export type AiActivitySurface =
  | 'brainstorm-chat'
  | 'archive-chat'
  | 'writing-coach'
  | 'vault-check'
  | 'beta-reader-scan'
  | 'beta-reader-report';

export const AI_ACTIVITY_SURFACE_LABELS: Record<AiActivitySurface, string> = {
  'brainstorm-chat': 'Brainstorm chat',
  'archive-chat': 'Archive chat',
  'writing-coach': 'Writing Coach',
  'vault-check': 'Continuity check',
  'beta-reader-scan': 'Beta Reader — scene scan',
  'beta-reader-report': 'Beta Reader — report',
};

export interface AiActivityEntry {
  requestId: string;
  agent: AgentPersonaName;
  agentLabel: string;
  surface: AiActivitySurface;
  surfaceLabel: string;
  provider: { kind: ProviderConfig['kind']; model: string };
  startedAt: number;
}

export type AiActivityTerminalStatus = 'done' | 'empty' | 'error' | 'cancelled';

export interface AiActivityTerminalEvent {
  requestId: string;
  agent: AgentPersonaName;
  agentLabel: string;
  surface: AiActivitySurface;
  surfaceLabel: string;
  status: AiActivityTerminalStatus;
  reason: string | null;
  endedAt: number;
}

export const AI_ACTIVITY_UPDATE_CHANNEL = 'ai-activity:update';
export const AI_ACTIVITY_TERMINAL_CHANNEL = 'ai-activity:terminal';
export const AI_ACTIVITY_CANCEL_CHANNEL = 'ai-activity:cancel';
export const AI_ACTIVITY_SNAPSHOT_CHANNEL = 'ai-activity:get-snapshot';

const activity = new Map<string, AiActivityEntry>();

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function snapshot(): AiActivityEntry[] {
  return Array.from(activity.values());
}

/** Register a new in-flight AI request. Call right after the AbortController exists. */
export function registerAiActivity(entry: AiActivityEntry): void {
  activity.set(entry.requestId, entry);
  broadcast(AI_ACTIVITY_UPDATE_CHANNEL, snapshot());
}

/**
 * Report a terminal outcome and drop the request from the live registry.
 * No-ops for an unknown requestId so a stray double-call (e.g. an already
 * cancelled+cleaned-up request racing a second `finally`) never throws.
 */
export function endAiActivity(
  requestId: string,
  status: AiActivityTerminalStatus,
  reason: string | null = null,
): void {
  const entry = activity.get(requestId);
  if (!entry) return;
  activity.delete(requestId);
  const event: AiActivityTerminalEvent = {
    requestId,
    agent: entry.agent,
    agentLabel: entry.agentLabel,
    surface: entry.surface,
    surfaceLabel: entry.surfaceLabel,
    status,
    reason,
    endedAt: Date.now(),
  };
  broadcast(AI_ACTIVITY_TERMINAL_CHANNEL, event);
  broadcast(AI_ACTIVITY_UPDATE_CHANNEL, snapshot());
}

/** Current in-flight snapshot — for a freshly-created/reloaded window to catch up. */
export function getAiActivitySnapshot(): AiActivityEntry[] {
  return snapshot();
}

/**
 * Whether a completed run (already known to be neither cancelled nor errored)
 * should terminate as `empty` ("Produced nothing") rather than `done`.
 *
 * "Empty" means the *model streamed no usable text* — it must NOT be inferred
 * from a run yielding zero discrete artifacts. A beta scan of a clean scene
 * (a real "no issues here" answer that parses to zero margin comments) and a
 * beta report with a score/verdict but zero LOVED/STUMBLED/CONFUSED reactions
 * are both genuine successes; labeling them "Produced nothing — try again"
 * contradicts the saved, on-screen result (SKY-11223 AC2/AC4). This is the one
 * canonical predicate every tracked call site uses so the four text-streaming
 * agents and the two beta surfaces can never drift apart again.
 */
export function isEmptyModelOutput(text: string): boolean {
  return text.trim().length === 0;
}

/**
 * Registers the IPC surface: a pull channel for the initial snapshot (a
 * fresh renderer isn't blind to work already running) and the generic cancel
 * channel. Cancellation itself is delegated to `abort` — the registry only
 * tracks identity/status, `agentControllers` in main.ts owns the real
 * AbortControllers, so this module never needs to know about them.
 */
export function registerAiActivityIpcHandlers(abort: (requestId: string) => void): void {
  ipcMain.handle(AI_ACTIVITY_SNAPSHOT_CHANNEL, (event) => {
    if (!isFromTopFrame(event)) return [];
    return snapshot();
  });
  ipcMain.on(AI_ACTIVITY_CANCEL_CHANNEL, (event, { requestId }: { requestId: string }) => {
    if (!isFromTopFrame(event)) return;
    abort(requestId);
  });
}

/** Test-only: clear all tracked activity between test cases. */
export function resetAiActivityRegistryForTests(): void {
  activity.clear();
}
