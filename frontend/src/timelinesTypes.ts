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
export type TimelineItemSource = 'migration' | 'seed' | 'manual';

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
}

export interface TimelinesStore {
  schemaVersion: 1;
  activeTimelineId: string;
  timelines: TimelineDefinition[];
  eras: unknown[];
  spans: unknown[];
  rows: unknown[];
  events: TimelineEvent[];
}
