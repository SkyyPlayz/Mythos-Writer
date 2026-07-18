import { describe, it, expect } from 'vitest';
import {
  SPAN_DRAG_THRESHOLD_PX,
  EVENT_DRAG_THRESHOLD_PX,
  dragArmed,
  pixelsToWhen,
  applySpanDrag,
  applyEventDrag,
} from './drag';

describe('drag thresholds', () => {
  it('span-likes arm past 2px, events past 3px (prototype values)', () => {
    expect(SPAN_DRAG_THRESHOLD_PX).toBe(2);
    expect(EVENT_DRAG_THRESHOLD_PX).toBe(3);
  });

  it('dragArmed is symmetric and strict', () => {
    expect(dragArmed(100, 102, 2)).toBe(false);
    expect(dragArmed(100, 103, 2)).toBe(true);
    expect(dragArmed(100, 97, 2)).toBe(true);
    expect(dragArmed(100, 103, 3)).toBe(false);
    expect(dragArmed(100, 104, 3)).toBe(true);
  });
});

describe('pixelsToWhen', () => {
  it('maps pixel deltas across the row width to when deltas', () => {
    expect(pixelsToWhen(100, 1000, 0, 864)).toBeCloseTo(86.4, 10);
    expect(pixelsToWhen(-500, 1000, 0, 864)).toBeCloseTo(-432, 10);
  });

  it('degenerate rect widths yield 0, never NaN/Infinity', () => {
    expect(pixelsToWhen(100, 0, 0, 864)).toBe(0);
    expect(pixelsToWhen(100, -5, 0, 864)).toBe(0);
    expect(pixelsToWhen(100, NaN, 0, 864)).toBe(0);
    expect(pixelsToWhen(NaN, 1000, 0, 864)).toBe(0);
  });
});

describe('applySpanDrag — prototype mkAxisDrag math', () => {
  const T0 = 0;
  const T1 = 1000; // minSep = 10

  it('move shifts both edges and snaps to the 0.1 grid', () => {
    expect(applySpanDrag('move', 100, 200, 55.55, T0, T1)).toEqual({ startWhen: 155.6, endWhen: 255.6 });
  });

  it('resize-left moves only the start edge', () => {
    expect(applySpanDrag('resize-left', 100, 200, -50, T0, T1)).toEqual({ startWhen: 50, endWhen: 200 });
  });

  it('resize-left cannot cross within 1% of the end edge', () => {
    // nf = min(200 − 10, 100 + 500) = 190
    expect(applySpanDrag('resize-left', 100, 200, 500, T0, T1)).toEqual({ startWhen: 190, endWhen: 200 });
  });

  it('resize-right moves only the end edge', () => {
    expect(applySpanDrag('resize-right', 100, 200, 100, T0, T1)).toEqual({ startWhen: 100, endWhen: 300 });
  });

  it('resize-right cannot cross within 1% of the start edge', () => {
    // nt = max(100 + 10, 200 − 500) = 110
    expect(applySpanDrag('resize-right', 100, 200, -500, T0, T1)).toEqual({ startWhen: 100, endWhen: 110 });
  });

  it('results are always tick-aligned (codec 0.1 precision)', () => {
    const r = applySpanDrag('move', 0.3, 0.7, 0.123456, T0, T1);
    expect(r.startWhen * 10).toBeCloseTo(Math.round(r.startWhen * 10), 10);
    expect(r.endWhen * 10).toBeCloseTo(Math.round(r.endWhen * 10), 10);
  });
});

describe('applyEventDrag — prototype tlEvDrag math', () => {
  it('moves the point and snaps to the grid', () => {
    expect(applyEventDrag(100, 55.55, 0, 1000)).toBe(155.6);
  });

  it('clamps to the axis (rough placement stays on the timeline)', () => {
    expect(applyEventDrag(100, -500, 0, 1000)).toBe(0);
    expect(applyEventDrag(900, 500, 0, 1000)).toBe(1000);
  });

  it('falls back to the axis start for a NaN when (§8.2)', () => {
    expect(applyEventDrag(NaN, 10, 50, 1000)).toBe(60);
  });
});
