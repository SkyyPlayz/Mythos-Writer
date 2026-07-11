// SKY-6306 M21: IPC handlers for the multi-timeline TimelinesStore.
// Pure handler logic (no ipcMain imports) so functions are unit-testable.
import { randomUUID } from 'crypto';
import {
  readTimelinesStore,
  writeTimelinesStore,
} from './timelines/store.js';
import {
  DEFAULT_TIMELINE_CALENDAR,
  type TimelinesStore,
} from './timelines/model.js';
import type {
  TimelinesGetStorePayload,
  TimelinesGetStoreResponse,
  TimelinesUpsertPayload,
  TimelinesUpsertResponse,
  TimelinesSetActivePayload,
  TimelinesSetActiveResponse,
} from './ipc.js';

export function handleTimelinesGetStore(
  vaultRoot: string,
  _payload: TimelinesGetStorePayload,
): TimelinesGetStoreResponse {
  const store = readTimelinesStore(vaultRoot);
  return { store };
}

export function handleTimelinesUpsert(
  vaultRoot: string,
  payload: TimelinesUpsertPayload,
): TimelinesUpsertResponse {
  const store = readTimelinesStore(vaultRoot);
  const now = new Date().toISOString();

  if (payload.id) {
    // Update existing timeline
    const idx = store.timelines.findIndex((t) => t.id === payload.id);
    if (idx === -1) {
      return { ok: false, id: payload.id, store };
    }
    store.timelines[idx] = {
      ...store.timelines[idx],
      name: payload.name,
      kind: payload.kind,
      calendar: payload.calendar
        ? { ...store.timelines[idx].calendar, ...payload.calendar }
        : store.timelines[idx].calendar,
      updatedAt: now,
    };
    writeTimelinesStore(vaultRoot, store);
    return { ok: true, id: payload.id, store: readTimelinesStore(vaultRoot) };
  }

  // Create new timeline
  const id = randomUUID();
  const calendar = {
    ...DEFAULT_TIMELINE_CALENDAR,
    ...payload.calendar,
  };
  store.timelines.push({
    id,
    name: payload.name,
    kind: payload.kind,
    axis: 'calendar',
    calendar,
    createdAt: now,
    updatedAt: now,
  });
  writeTimelinesStore(vaultRoot, store);
  return { ok: true, id, store: readTimelinesStore(vaultRoot) };
}

export function handleTimelinesSetActive(
  vaultRoot: string,
  payload: TimelinesSetActivePayload,
): TimelinesSetActiveResponse {
  const store = readTimelinesStore(vaultRoot);
  if (!store.timelines.some((t) => t.id === payload.timelineId)) {
    return { ok: false, store };
  }
  const updated: TimelinesStore = { ...store, activeTimelineId: payload.timelineId };
  writeTimelinesStore(vaultRoot, updated);
  return { ok: true, store: readTimelinesStore(vaultRoot) };
}
