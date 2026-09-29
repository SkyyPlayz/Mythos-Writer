/**
 * Slice C — Mid-task QUEUED + Heartbeat Run now chrome.
 * Heartbeat Vault cleanup Run now → handBusy + QUEUED only (no merge engine).
 */

import type { PartnerHandId } from '../agents/partnerIdentity';
import type { HeartbeatAutomationId } from './partnerSettings';

export interface QueuedPartnerMessage {
  id: string;
  text: string;
  at: string;
}

type Listener = () => void;

let handBusy: PartnerHandId | null = null;
let busyAutomation: HeartbeatAutomationId | null = null;
let queue: QueuedPartnerMessage[] = [];
const listeners = new Set<Listener>();
let runTimer: ReturnType<typeof setTimeout> | null = null;
let drainHandler: ((items: QueuedPartnerMessage[]) => void) | null = null;

function emit(): void {
  for (const l of listeners) l();
}

export function getPartnerHandBusy(): PartnerHandId | null {
  return handBusy;
}

export function getPartnerBusyAutomation(): HeartbeatAutomationId | null {
  return busyAutomation;
}

export function getPartnerMsgQueue(): readonly QueuedPartnerMessage[] {
  return queue;
}

export function subscribePartnerBusy(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setPartnerDrainHandler(
  handler: ((items: QueuedPartnerMessage[]) => void) | null,
): void {
  drainHandler = handler;
}

/** Enqueue while a hand is busy. Returns true if queued (caller should not send). */
export function enqueuePartnerMessage(text: string): boolean {
  if (!handBusy) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  queue = [
    ...queue,
    {
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: trimmed,
      at: new Date().toISOString(),
    },
  ];
  emit();
  return true;
}

function finishBusy(): void {
  const drained = queue;
  queue = [];
  handBusy = null;
  busyAutomation = null;
  if (runTimer) {
    clearTimeout(runTimer);
    runTimer = null;
  }
  emit();
  if (drained.length && drainHandler) {
    drainHandler(drained);
  }
}

/**
 * Heartbeat Run now — sets handBusy for chrome + QUEUED path only.
 * Does NOT run vault merge/rewire engine (Slice C non-goal).
 */
export function runHeartbeatAutomationStub(
  id: HeartbeatAutomationId,
  hand: PartnerHandId,
  durationMs = 1200,
): void {
  if (handBusy) return;
  handBusy = hand;
  busyAutomation = id;
  emit();
  if (runTimer) clearTimeout(runTimer);
  runTimer = setTimeout(() => {
    finishBusy();
  }, durationMs);
}

/** Test helper — clear busy + queue. */
export function __resetPartnerBusyStoreForTests(): void {
  if (runTimer) clearTimeout(runTimer);
  runTimer = null;
  handBusy = null;
  busyAutomation = null;
  queue = [];
  drainHandler = null;
  emit();
}

/** Test helper — force busy without timer. */
export function __setPartnerHandBusyForTests(hand: PartnerHandId | null): void {
  handBusy = hand;
  busyAutomation = hand ? 'dedupe' : null;
  emit();
}
