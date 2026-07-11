export type TimelineKind = 'story' | 'world' | 'universe' | 'custom';
export type TimelineAxis = 'calendar' | 'relative';
export type CalendarPreset = 'standard' | 'aeon-13' | 'custom';

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

export interface TimelineEvent {
  id: string;
  timelineId: string;
  name: string;
  when: number;
  rowId?: string;
  sceneId?: string;
  source?: 'migration' | 'seed' | 'manual';
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
