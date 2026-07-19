// SKY-6306 M21 — Frontend-local mirror of the M21 TimelinesStore types.
// These must stay in sync with electron-main/src/timelines/model.ts.
// Only `import type` — no runtime code here.

export type TimelineKind = 'story' | 'world' | 'universe' | 'custom';
export type TimelineAxis = 'calendar' | 'relative';
export type CalendarPreset = 'standard' | 'aeon-13' | 'custom';

/**
 * Provenance marker mirrored from model.ts. `'seed'` is the canonical DEMO
 * marker (owner ruling on PR #914) — the picker renders a "Demo" badge for
 * timelines carrying it so demo content is always distinguishable from the
 * user's own work.
 */
export type TimelineItemSource = 'migration' | 'seed' | 'manual' | 'agent';

export interface TimelineCalendar {
  preset: CalendarPreset;
  monthsPerYear: number;
  daysPerMonth: number;
  hoursPerDay: number;
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

export interface TimelineEvent {
  id: string;
  timelineId: string;
  name: string;
  when: number;
  rowId?: string;
  sceneId?: string;
  source?: TimelineItemSource;
  /** Legacy per-scene manifest.timeline entry carried through migration (opaque here). */
  legacy?: unknown;
  // ── Beta 4 M23 (§8.4) — optional story-lane fields ──
  /** 1-based narrative chapter (plotline cards + key-event "Ch. N" line). */
  chapter?: number;
  /** Template beat card (dashed until replaced with a real scene). */
  beat?: boolean;
  /** Progress-mode written/planned split; undefined = unknown. */
  written?: boolean;
  /** Two-line card description (key events / plotline cards). */
  summary?: string;
  /** Key-event icon glyph (prototype tlEvents icons). */
  icon?: string;
  // ── Beta 4 M25 (§8.6) — optional Inspector event-editor fields ──
  /** Point-of-view character name (event editor POV field). */
  pov?: string;
  /** Where the event happens (event editor LOCATION field). */
  location?: string;
  /** Impact tags, comma-separated; rendered as chips in the static view. */
  impact?: string;
}

// M22: era / span / row item shapes (mirrors model.ts — kept `unknown[]`
// until the axis engine needed them).
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
  /** Beta 4 M23: 'plotline' rows are the §8.4 PLOTLINES lanes. */
  kind: 'custom' | 'arc' | 'entity' | 'plotline';
  /** M23: plotline dot/chip color (prototype tlPal). */
  color?: string;
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
