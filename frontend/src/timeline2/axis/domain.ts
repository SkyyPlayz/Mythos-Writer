// Beta 4 M22 — Axis engine: axis domain derivation.
// The prototype stored a fixed `axis: [t0, t1]` per timeline; the M21 store
// intentionally does not (its `axis` field is the 'calendar' | 'relative'
// mode). The axis engine derives a stable domain from the timeline's own
// content — min/max across eras, spans and events — padded 5% each side and
// never narrower than one calendar year. Every input is NaN-guarded (§8.2).
import type { TimelinesStore, TimelineCalendar } from '../../timelinesTypes';
import { isValidWhen, roundWhen, whenPerYear } from './calendarCodec';

export type AxisDomain = [number, number];

/** Fallback domain when a timeline has no dated content yet: years 0–5. */
export function emptyDomain(calendar: TimelineCalendar): AxisDomain {
  return [0, roundWhen(whenPerYear(calendar) * 5)];
}

/**
 * Derive the [t0, t1] axis domain for one timeline from the store.
 * Recompute only on timeline switch / store reload — never mid-drag, so
 * dragging an item past the edge doesn't rescale the axis under the cursor.
 */
export function deriveAxisDomain(
  store: Pick<TimelinesStore, 'eras' | 'spans' | 'events'>,
  timelineId: string,
  calendar: TimelineCalendar,
): AxisDomain {
  const whens: number[] = [];
  for (const era of store.eras) {
    if (era.timelineId !== timelineId) continue;
    if (isValidWhen(era.startWhen)) whens.push(era.startWhen);
    if (isValidWhen(era.endWhen)) whens.push(era.endWhen);
  }
  for (const span of store.spans) {
    if (span.timelineId !== timelineId) continue;
    if (isValidWhen(span.startWhen)) whens.push(span.startWhen);
    if (isValidWhen(span.endWhen)) whens.push(span.endWhen);
  }
  for (const event of store.events) {
    if (event.timelineId !== timelineId) continue;
    if (isValidWhen(event.when)) whens.push(event.when);
  }
  if (whens.length === 0) return emptyDomain(calendar);

  let t0 = Math.min(...whens);
  let t1 = Math.max(...whens);

  // Never narrower than one calendar year (a single event still gets an axis).
  const minSpan = whenPerYear(calendar);
  if (t1 - t0 < minSpan) {
    const mid = (t0 + t1) / 2;
    t0 = mid - minSpan / 2;
    t1 = mid + minSpan / 2;
  }

  // 5% breathing room each side.
  const pad = (t1 - t0) * 0.05;
  return [roundWhen(t0 - pad), roundWhen(t1 + pad)];
}
