// Beta 4 M25 — Archive tab quick-add (§8.6): "Add the festival from Ch. 4…"
// → the Archive Agent dates the event and it plots on the axis.
//
// Two-stage dating: ask the Archive agent for a strict-JSON date first; when
// the agent is unavailable (no provider, offline, budget cap) fall back to
// deterministic parsing of the text itself — a chapter reference plots at
// that chapter's axis position, an explicit year plots there, anything else
// lands mid-axis for the user to drag. Quick-add always yields an event.

import type { TimelineCalendar, TimelineEvent } from '../../timelinesTypes';
import { roundWhen, safeEncodeWhen, whenPerYear } from '../axis/calendarCodec';

export interface QuickAddContext {
  timelineId: string;
  calendar: TimelineCalendar;
  /** Axis domain (when-scale) — bounds heuristics + the midpoint fallback. */
  domain: readonly [number, number];
  chapterCount: number;
  whenForChapter: (chapterIndex: number) => number;
  newItemId: (prefix: string) => string;
}

export interface QuickAddParse {
  name: string;
  when: number;
  chapter?: number;
  summary?: string;
  /** Where the date came from — drives the confirmation toast. */
  datedBy: 'agent' | 'chapter' | 'year' | 'fallback';
}

/** Agent reply contract — one strict JSON object, no prose. */
export function quickAddAgentPrompt(text: string, calendar: TimelineCalendar): string {
  return (
    'Date this timeline event from the manuscript context. Reply with ONE JSON object only, no prose: ' +
    '{"title": string, "year": number, "month"?: number, "day"?: number, "hour"?: number, ' +
    '"chapter"?: number, "summary"?: string}. ' +
    `The active calendar runs ${calendar.monthsPerYear} months/year, ${calendar.daysPerMonth} days/month, ` +
    `${calendar.hoursPerDay}h days. The event to add, as the writer described it:\n\n${text}`
  );
}

/** Strip a leading "add …" and a trailing "from ch. N" into a clean title. */
export function titleFromText(text: string): string {
  const cleaned = text
    .replace(/^\s*(add|create|plot)\s+(the\s+)?/i, '')
    .replace(/\s*(from|in)\s+ch(?:apter)?\.?\s*\d+\s*\.?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const title = cleaned || text.trim();
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/** Parse the agent's strict-JSON reply; null when it isn't usable. */
export function parseAgentQuickAdd(
  reply: string,
  ctx: QuickAddContext,
  originalText: string,
): QuickAddParse | null {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const year = typeof obj.year === 'number' && Number.isFinite(obj.year) ? obj.year : null;
  if (year == null) return null;

  const int = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
  const when = safeEncodeWhen(
    {
      year: Math.trunc(year),
      month: int(obj.month, 1, ctx.calendar.monthsPerYear, 1),
      day: int(obj.day, 1, ctx.calendar.daysPerMonth, 1),
      hour: int(obj.hour, 0, ctx.calendar.hoursPerDay - 1, 0),
    },
    ctx.calendar,
  );
  const chapter =
    typeof obj.chapter === 'number' && Number.isInteger(obj.chapter) && obj.chapter >= 1
      ? obj.chapter
      : undefined;
  return {
    name: typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : titleFromText(originalText),
    when,
    chapter,
    summary: typeof obj.summary === 'string' && obj.summary.trim() ? obj.summary.trim() : undefined,
    datedBy: 'agent',
  };
}

/** Deterministic dating when the agent can't answer. */
export function heuristicQuickAdd(text: string, ctx: QuickAddContext): QuickAddParse {
  const [t0, t1] = ctx.domain;
  const name = titleFromText(text);

  const chapterMatch = /\bch(?:apter)?\.?\s*(\d+)\b/i.exec(text);
  if (chapterMatch) {
    const chapter = Math.min(parseInt(chapterMatch[1], 10), Math.max(ctx.chapterCount, 1));
    return {
      name,
      when: roundWhen(ctx.whenForChapter(chapter - 1)),
      chapter,
      datedBy: 'chapter',
    };
  }

  const yearMatch = /\b(\d{1,5}(?:\.\d+)?)\b/.exec(text);
  if (yearMatch) {
    // `when` = hours/10 in the active calendar — scale the year through it.
    const when = roundWhen(parseFloat(yearMatch[1]) * whenPerYear(ctx.calendar));
    if (when >= t0 && when <= t1) {
      return { name, when, datedBy: 'year' };
    }
  }

  return { name, when: roundWhen(t0 + (t1 - t0) / 2), datedBy: 'fallback' };
}

/** Assemble the store event for a parse. */
export function quickAddEvent(parse: QuickAddParse, ctx: QuickAddContext): TimelineEvent {
  return {
    id: ctx.newItemId('event'),
    timelineId: ctx.timelineId,
    name: parse.name,
    when: parse.when,
    chapter: parse.chapter,
    summary: parse.summary,
    written: false,
    icon: '✦',
    source: 'agent',
  };
}

export function quickAddToast(parse: QuickAddParse): string {
  switch (parse.datedBy) {
    case 'agent':
      return `Added “${parse.name}” — the Archive agent dated it and plotted it on the axis`;
    case 'chapter':
      return `Added “${parse.name}” at its chapter's position — fine-tune with the exact-time picker`;
    case 'year':
      return `Added “${parse.name}” at the year you gave — fine-tune with the exact-time picker`;
    default:
      return `Added “${parse.name}” mid-axis — drag it into place or set an exact time`;
  }
}
