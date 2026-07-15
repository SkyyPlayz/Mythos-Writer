// SKY-6306 M21 — Frontend-local mirror of the M21 TimelinesStore types.
// These must stay in sync with electron-main/src/timelines/model.ts.
// Only `import type` — no runtime code here.

export type TimelineKind = 'story' | 'world' | 'universe' | 'custom';
export type TimelineAxis = 'calendar' | 'relative';
export type CalendarPreset = 'standard' | 'aeon-13' | 'custom';

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
}

export interface TimelineEvent {
  id: string;
  timelineId: string;
  name: string;
  when: number;
  rowId?: string;
  sceneId?: string;
  source?: 'migration' | 'seed' | 'manual';
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
}

export interface TimelineRow {
  id: string;
  timelineId: string;
  name: string;
  kind: 'custom' | 'arc' | 'entity';
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
