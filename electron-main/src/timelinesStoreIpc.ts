// SKY-6306 M21: IPC handlers for the multi-timeline TimelinesStore.
// Pure handler logic (no ipcMain imports) so functions are unit-testable.
import { randomUUID } from 'crypto';
import {
  readTimelinesStore,
  writeTimelinesStore,
} from './timelines/store.js';
import { assertValidWhen } from './timelines/codec.js';
import {
  DEFAULT_TIMELINE_CALENDAR,
  type TimelineEra,
  type TimelineEvent,
  type TimelineRow,
  type TimelineSpan,
  type TimelinesStore,
} from './timelines/model.js';
import type {
  TimelinesGetStorePayload,
  TimelinesGetStoreResponse,
  TimelinesUpsertPayload,
  TimelinesUpsertResponse,
  TimelinesSetActivePayload,
  TimelinesSetActiveResponse,
  TimelinesUpsertItemPayload,
  TimelinesUpsertItemResponse,
  TimelinesDeleteItemPayload,
  TimelinesDeleteItemResponse,
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

  // Create new timeline (user action → source 'manual'; see TimelineItemSource)
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
    source: 'manual',
  });
  writeTimelinesStore(vaultRoot, store);
  return { ok: true, id, store: readTimelinesStore(vaultRoot) };
}

// ─── Beta 4 M22: Axis engine item persistence ───

type ItemKey = 'eras' | 'spans' | 'events' | 'rows';

const ITEM_KEY_BY_TYPE: Record<TimelinesUpsertItemPayload['type'], ItemKey> = {
  era: 'eras',
  span: 'spans',
  event: 'events',
  row: 'rows',
};

const ROW_KINDS = new Set(['custom', 'arc', 'entity', 'plotline']);

/**
 * Validate one axis item against the M21 schema. Throws RangeError/Error on
 * invalid input — the handler converts that into `{ ok: false, error }` so a
 * malformed renderer payload can never corrupt timelines.json.
 */
function assertItemValid(store: TimelinesStore, payload: TimelinesUpsertItemPayload): void {
  const item = payload.item as Partial<TimelineEra & TimelineSpan & TimelineEvent & TimelineRow>;
  if (!item || typeof item !== 'object') throw new Error('item is required');
  if (typeof item.id !== 'string' || !item.id.trim()) throw new Error('item.id is required');
  if (typeof item.timelineId !== 'string' || !store.timelines.some((t) => t.id === item.timelineId)) {
    throw new Error('item.timelineId must reference an existing timeline');
  }
  if (typeof item.name !== 'string' || !item.name.trim()) throw new Error('item.name is required');

  switch (payload.type) {
    case 'era':
    case 'span': {
      assertValidWhen(item.startWhen as number);
      assertValidWhen(item.endWhen as number);
      if ((item.endWhen as number) <= (item.startWhen as number)) {
        throw new RangeError('endWhen must be greater than startWhen');
      }
      if (payload.type === 'span' && item.opensTimelineId != null) {
        if (!store.timelines.some((t) => t.id === item.opensTimelineId)) {
          throw new Error('opensTimelineId must reference an existing timeline');
        }
      }
      break;
    }
    case 'event': {
      assertValidWhen(item.when as number);
      // M23 optional story-lane fields: reject malformed values so NaN /
      // wrong-typed payloads can never reach timelines.json (§8.2 discipline).
      if (item.chapter != null) {
        if (typeof item.chapter !== 'number' || !Number.isFinite(item.chapter) || item.chapter < 1) {
          throw new RangeError('event.chapter must be a number ≥ 1');
        }
      }
      if (item.beat != null && typeof item.beat !== 'boolean') throw new Error('event.beat must be a boolean');
      if (item.written != null && typeof item.written !== 'boolean') throw new Error('event.written must be a boolean');
      if (item.summary != null && typeof item.summary !== 'string') throw new Error('event.summary must be a string');
      if (item.icon != null && typeof item.icon !== 'string') throw new Error('event.icon must be a string');
      break;
    }
    case 'row':
      if (!ROW_KINDS.has(item.kind as string)) throw new Error('row.kind is invalid');
      if (item.color != null && typeof item.color !== 'string') throw new Error('row.color must be a string');
      break;
  }
}

export function handleTimelinesUpsertItem(
  vaultRoot: string,
  payload: TimelinesUpsertItemPayload,
): TimelinesUpsertItemResponse {
  const store = readTimelinesStore(vaultRoot);
  const key = ITEM_KEY_BY_TYPE[payload?.type as TimelinesUpsertItemPayload['type']];
  if (!key) return { ok: false, store, error: 'Unknown item type' };

  try {
    assertItemValid(store, payload);
  } catch (err) {
    return { ok: false, store, error: err instanceof Error ? err.message : String(err) };
  }

  const list = store[key] as { id: string }[];
  const idx = list.findIndex((existing) => existing.id === (payload.item as { id: string }).id);
  if (idx === -1) list.push(payload.item as never);
  else list[idx] = payload.item as never;

  writeTimelinesStore(vaultRoot, store);
  return { ok: true, store: readTimelinesStore(vaultRoot) };
}

export function handleTimelinesDeleteItem(
  vaultRoot: string,
  payload: TimelinesDeleteItemPayload,
): TimelinesDeleteItemResponse {
  const store = readTimelinesStore(vaultRoot);
  const key = ITEM_KEY_BY_TYPE[payload?.type as TimelinesDeleteItemPayload['type']];
  if (!key || typeof payload.id !== 'string') return { ok: false, store, error: 'Unknown item type' };

  const list = store[key] as { id: string }[];
  const idx = list.findIndex((existing) => existing.id === payload.id);
  if (idx === -1) return { ok: false, store, error: 'Item not found' };
  const removed = list[idx];
  list.splice(idx, 1);

  // Deleting a custom row removes the spans plotted on it (prototype delRow
  // drops the whole row including its items). M23: a plotline row owns its
  // scene-card events outright — deleting the plotline deletes the cards;
  // other row kinds just unlink their events.
  if (payload.type === 'row') {
    store.spans = store.spans.filter((span) => span.rowId !== payload.id);
    const rowKind = (removed as TimelineRow).kind;
    store.events = rowKind === 'plotline'
      ? store.events.filter((event) => event.rowId !== payload.id)
      : store.events.map((event) =>
          event.rowId === payload.id ? { ...event, rowId: undefined } : event,
        );
  }

  writeTimelinesStore(vaultRoot, store);
  return { ok: true, store: readTimelinesStore(vaultRoot) };
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
