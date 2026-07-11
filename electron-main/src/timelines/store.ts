import fs from 'fs';
import path from 'path';
import type { ArcEntry } from '../ipc.js';
import type { ManifestTimelineEntry, StoryTimeOfDay } from '../vault/manifest/types.js';
import { openManifestV1 } from '../vault/manifest/index.js';
import { encodeWhen } from './codec.js';
import {
  DEFAULT_TIMELINE_CALENDAR,
  type TimelineCalendar,
  type TimelineDefinition,
  type TimelineEvent,
  type TimelineRow,
  type TimelinesStore,
} from './model.js';

export const TIMELINES_FILENAME = 'timelines.json';

interface LegacyMigrationInput {
  manifestPath: string;
  arcsPath?: string;
  now?: string;
}

export function readTimelinesStore(vaultRoot: string): TimelinesStore {
  const storePath = path.join(vaultRoot, TIMELINES_FILENAME);
  if (!fs.existsSync(storePath)) return createSeedTimelinesStore(new Date().toISOString());

  const raw = fs.readFileSync(storePath, 'utf-8');
  const parsed = JSON.parse(raw) as TimelinesStore;
  validateTimelinesStore(parsed);
  return parsed;
}

export function writeTimelinesStore(vaultRoot: string, store: TimelinesStore): void {
  validateTimelinesStore(store);
  fs.writeFileSync(path.join(vaultRoot, TIMELINES_FILENAME), JSON.stringify(store, null, 2), 'utf-8');
}

export function migrateLegacyTimeline(input: LegacyMigrationInput): TimelinesStore {
  const now = input.now ?? new Date().toISOString();
  const manifest = openManifestV1(input.manifestPath);
  const arcs = input.arcsPath && fs.existsSync(input.arcsPath)
    ? (JSON.parse(fs.readFileSync(input.arcsPath, 'utf-8')) as ArcEntry[])
    : [];

  const timeline = createTimeline('story', 'Story Timeline', 'story', DEFAULT_TIMELINE_CALENDAR, now);
  const rows = arcs.map<TimelineRow>((arc) => ({
    id: `arc:${arc.id}`,
    timelineId: timeline.id,
    name: arc.title,
    kind: 'arc',
  }));

  const events = (manifest.timeline ?? []).map<TimelineEvent>((entry) => {
    const day = entry.userOverride?.day ?? entry.inferredDay;
    const time = entry.userOverride?.time ?? entry.inferredTime;
    const scene = manifest.scenes.find((candidate) => candidate.id === entry.sceneId);
    return {
      id: `scene:${entry.sceneId}`,
      timelineId: timeline.id,
      name: scene?.title ?? entry.sceneId,
      when: encodeLegacyDay(day, time, timeline.calendar),
      sceneId: entry.sceneId,
      source: 'migration',
    };
  });

  return {
    schemaVersion: 1,
    activeTimelineId: timeline.id,
    timelines: [timeline],
    eras: [],
    spans: [],
    rows,
    events,
  };
}

export function createSeedTimelinesStore(now: string): TimelinesStore {
  const story = createTimeline('story', 'Story Timeline', 'story', DEFAULT_TIMELINE_CALENDAR, now);
  const world = createTimeline('world', 'World History', 'world', DEFAULT_TIMELINE_CALENDAR, now);
  const universe = createTimeline('universe', 'Universe Timeline', 'universe', DEFAULT_TIMELINE_CALENDAR, now);

  return {
    schemaVersion: 1,
    activeTimelineId: story.id,
    timelines: [story, world, universe],
    eras: [
      { id: 'era:story-opening', timelineId: story.id, name: 'Opening', startWhen: 2.4, endWhen: 12 },
      { id: 'era:world-founding', timelineId: world.id, name: 'Founding Age', startWhen: 0, endWhen: 720 },
    ],
    spans: [
      {
        id: 'span:story-world-history',
        timelineId: story.id,
        name: 'World context',
        startWhen: 24,
        endWhen: 96,
        opensTimelineId: world.id,
      },
      {
        id: 'span:world-universe-myth',
        timelineId: world.id,
        name: 'Cosmic myth',
        startWhen: 120,
        endWhen: 240,
        opensTimelineId: universe.id,
      },
    ],
    rows: [
      { id: 'row:story-main', timelineId: story.id, name: 'Main plot', kind: 'custom' },
      { id: 'row:world-history', timelineId: world.id, name: 'History', kind: 'custom' },
    ],
    events: [
      { id: 'event:inciting', timelineId: story.id, name: 'Inciting incident', when: 2.4, rowId: 'row:story-main', source: 'seed' },
      { id: 'event:founding', timelineId: world.id, name: 'City founded', when: 48, rowId: 'row:world-history', source: 'seed' },
      { id: 'event:first-star', timelineId: universe.id, name: 'First star kindles', when: 0, source: 'seed' },
    ],
  };
}

export function validateTimelinesStore(store: TimelinesStore): void {
  if (store.schemaVersion !== 1) throw new Error('Unsupported timelines schema version');
  if (!store.timelines.some((timeline) => timeline.id === store.activeTimelineId)) {
    throw new Error('Active timeline does not exist');
  }
  const timelineIds = new Set(store.timelines.map((timeline) => timeline.id));
  for (const timeline of store.timelines) {
    if (!timeline.id.trim() || !timeline.name.trim()) throw new Error('Timeline id and name are required');
  }
  for (const item of [...store.eras, ...store.spans, ...store.events]) {
    if (!timelineIds.has(item.timelineId)) throw new Error(`Timeline item references missing timeline: ${item.timelineId}`);
  }
  const eventIds = new Set<string>();
  for (const event of store.events) {
    if (eventIds.has(event.id)) throw new Error(`Duplicate timeline event: ${event.id}`);
    eventIds.add(event.id);
  }
}

function createTimeline(
  id: string,
  name: string,
  kind: TimelineDefinition['kind'],
  calendar: TimelineCalendar,
  now: string,
): TimelineDefinition {
  return {
    id,
    name,
    kind,
    axis: 'calendar',
    calendar,
    createdAt: now,
    updatedAt: now,
  };
}

function encodeLegacyDay(day: number, time: StoryTimeOfDay, calendar: TimelineCalendar): number {
  const normalizedDay = Number.isInteger(day) && day > 0 ? day : 1;
  const zeroBasedDay = normalizedDay - 1;
  const year = Math.floor(zeroBasedDay / (calendar.monthsPerYear * calendar.daysPerMonth));
  const dayOfYear = zeroBasedDay - year * calendar.monthsPerYear * calendar.daysPerMonth;
  const month = Math.floor(dayOfYear / calendar.daysPerMonth) + 1;
  const dayOfMonth = (dayOfYear % calendar.daysPerMonth) + 1;
  return encodeWhen({ year, month, day: dayOfMonth, hour: legacyHour(time, calendar.hoursPerDay) }, calendar);
}

function legacyHour(time: StoryTimeOfDay, hoursPerDay: number): number {
  const fractionByTime: Record<StoryTimeOfDay, number> = {
    midnight: 0,
    dawn: 0.25,
    morning: 0.35,
    noon: 0.5,
    afternoon: 0.65,
    dusk: 0.8,
    night: 0.9,
    unspecified: 0,
  };
  return Math.min(hoursPerDay - 1, Math.round(fractionByTime[time] * hoursPerDay));
}
