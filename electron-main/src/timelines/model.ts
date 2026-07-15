import type { ManifestTimelineEntry } from '../vault/manifest/types.js';

export type TimelineKind = 'story' | 'world' | 'universe' | 'custom';
export type TimelineAxis = 'calendar' | 'relative';
export type CalendarPreset = 'standard' | 'aeon-13' | 'custom';

/**
 * Provenance marker for every entity kind in the TimelinesStore.
 *
 * Canonical vocabulary (owner ruling on PR #914 — demo content is approved
 * but must be unmistakably labelled):
 * - `'seed'`      — DEMO content created by `createSeedTimelinesStore`. The UI
 *                   renders a visible "Demo" badge for it (TimelinePicker);
 *                   it must never mask real data: a vault with legacy
 *                   `manifest.timeline` data is migrated instead of seeded.
 * - `'migration'` — created by the legacy `manifest.timeline` → TimelinesStore
 *                   migration (real user data).
 * - `'manual'`    — created by a direct user action (IPC upsert paths).
 *
 * The field is optional so items written by other paths (e.g. the M22 axis
 * engine) remain valid; absent means "user content" (treated like 'manual').
 */
export type TimelineItemSource = 'migration' | 'seed' | 'manual';

export const TIMELINE_ITEM_SOURCES: ReadonlyArray<TimelineItemSource> = [
  'migration',
  'seed',
  'manual',
];

export interface TimelineCalendar {
  preset: CalendarPreset;
  monthsPerYear: number;
  daysPerMonth: number;
  hoursPerDay: number;
}

export interface TimelineInstant {
  year: number;
  month: number;
  day: number;
  hour: number;
}

export interface TimelineEra {
  id: string;
  timelineId: string;
  name: string;
  startWhen: number;
  endWhen: number;
  color?: string;
  source?: TimelineItemSource;
}

export interface TimelineSpan {
  id: string;
  timelineId: string;
  name: string;
  startWhen: number;
  endWhen: number;
  rowId?: string;
  color?: string;
  opensTimelineId?: string;
  source?: TimelineItemSource;
}

export interface TimelineRow {
  id: string;
  timelineId: string;
  name: string;
  /** Beta 4 M23: 'plotline' rows are the §8.4 PLOTLINES lanes — their items
   *  are events with `rowId` pointing here (scene-card chips / grid cards). */
  kind: 'custom' | 'arc' | 'entity' | 'plotline';
  /** M23: plotline dot/chip color (prototype tlPal). */
  color?: string;
  source?: TimelineItemSource;
}

export interface TimelineEvent {
  id: string;
  timelineId: string;
  name: string;
  when: number;
  rowId?: string;
  sceneId?: string;
  source?: TimelineItemSource;
  /**
   * SKY-6306 unification: the legacy per-scene `manifest.timeline` entry this
   * event was migrated from (or upserted through the legacy `timeline:upsert`
   * channel). The legacy `timeline:list` / `timeline:upsert` IPC channels are
   * compatibility views over these entries — `timelines.json` is the single
   * source of truth; `manifest.timeline` is no longer read or written by the
   * timeline feature after migration.
   */
  legacy?: ManifestTimelineEntry;
  // ── Beta 4 M23 (§8.4) — optional story-lane fields ──
  /** 1-based narrative chapter (plotline cards + key-event "Ch. N" line;
   *  chronology ≠ narrative computes the FLASHBACK badge from this). */
  chapter?: number;
  /** Template beat card (dashed until replaced with a real scene). */
  beat?: boolean;
  /** Progress-mode written/planned split; undefined = unknown. */
  written?: boolean;
  /** Two-line card description (key events / plotline cards). */
  summary?: string;
  /** Key-event icon glyph (prototype tlEvents icons). */
  icon?: string;
}

export interface TimelineDefinition {
  id: string;
  name: string;
  kind: TimelineKind;
  axis: TimelineAxis;
  calendar: TimelineCalendar;
  createdAt: string;
  updatedAt: string;
  source?: TimelineItemSource;
}

export interface TimelinesStore {
  schemaVersion: 1;
  activeTimelineId: string;
  timelines: TimelineDefinition[];
  eras: TimelineEra[];
  spans: TimelineSpan[];
  rows: TimelineRow[];
  events: TimelineEvent[];
}

export const DEFAULT_TIMELINE_CALENDAR: TimelineCalendar = {
  preset: 'standard',
  monthsPerYear: 12,
  daysPerMonth: 30,
  hoursPerDay: 24,
};

export const CALENDAR_PRESETS: Record<Exclude<CalendarPreset, 'custom'>, TimelineCalendar> = {
  standard: DEFAULT_TIMELINE_CALENDAR,
  'aeon-13': {
    preset: 'aeon-13',
    monthsPerYear: 13,
    daysPerMonth: 28,
    hoursPerDay: 18,
  },
};

export const EMPTY_TIMELINES_STORE: TimelinesStore = {
  schemaVersion: 1,
  activeTimelineId: 'story',
  timelines: [],
  eras: [],
  spans: [],
  rows: [],
  events: [],
};
