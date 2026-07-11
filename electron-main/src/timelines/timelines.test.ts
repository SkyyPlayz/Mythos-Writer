/**
 * Timelines module — unit tests for model, codec, and store/migration (M21).
 *
 * Coverage targets per acceptance criteria:
 *  - Calendar round-trip exactness: standard (12×30×24), aeon-13 (13×28×18), custom
 *  - `when` codec: encode / decode / NaN-guard / out-of-range guards
 *  - Migration: M20-era events/eras/arcs → new TimelinesStore schema
 *  - Store: read-new-vault (seed), validate, write round-trip
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { encodeWhen, decodeWhen, assertValidWhen, normalizeCalendar } from './codec.js';
import {
  CALENDAR_PRESETS,
  DEFAULT_TIMELINE_CALENDAR,
  EMPTY_TIMELINES_STORE,
  type TimelineCalendar,
  type TimelineInstant,
} from './model.js';
import {
  readTimelinesStore,
  writeTimelinesStore,
  migrateLegacyTimeline,
  createSeedTimelinesStore,
  validateTimelinesStore,
  TIMELINES_FILENAME,
} from './store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function allInstants(cal: TimelineCalendar): TimelineInstant[] {
  const out: TimelineInstant[] = [];
  for (let year = 0; year <= 2; year++) {
    for (let month = 1; month <= cal.monthsPerYear; month++) {
      for (let day = 1; day <= cal.daysPerMonth; day++) {
        for (let hour = 0; hour < cal.hoursPerDay; hour++) {
          out.push({ year, month, day, hour });
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// codec — normalizeCalendar
// ---------------------------------------------------------------------------

describe('normalizeCalendar', () => {
  it('fills defaults when given undefined', () => {
    expect(normalizeCalendar(undefined)).toEqual(DEFAULT_TIMELINE_CALENDAR);
  });

  it('fills defaults when given empty object', () => {
    expect(normalizeCalendar({})).toEqual(DEFAULT_TIMELINE_CALENDAR);
  });

  it('preserves explicit values', () => {
    const cal = normalizeCalendar({ monthsPerYear: 13, daysPerMonth: 28, hoursPerDay: 18 });
    expect(cal.monthsPerYear).toBe(13);
    expect(cal.daysPerMonth).toBe(28);
    expect(cal.hoursPerDay).toBe(18);
  });

  it('throws on non-positive monthsPerYear', () => {
    expect(() => normalizeCalendar({ monthsPerYear: 0 })).toThrow('monthsPerYear');
    expect(() => normalizeCalendar({ monthsPerYear: -1 })).toThrow('monthsPerYear');
  });

  it('throws on fractional value', () => {
    expect(() => normalizeCalendar({ daysPerMonth: 30.5 })).toThrow('daysPerMonth');
  });

  it('throws on value exceeding 10 000', () => {
    expect(() => normalizeCalendar({ hoursPerDay: 10_001 })).toThrow('hoursPerDay');
  });
});

// ---------------------------------------------------------------------------
// codec — standard calendar (12 × 30 × 24) round-trips
// ---------------------------------------------------------------------------

describe('codec — standard calendar (12×30×24) round-trips', () => {
  const cal = CALENDAR_PRESETS['standard'];

  it('encodes year-0 month-1 day-1 hour-0 as 0', () => {
    expect(encodeWhen({ year: 0, month: 1, day: 1, hour: 0 }, cal)).toBe(0);
  });

  it('encodes year-1 correctly (one full year offset)', () => {
    const hoursPerYear = cal.monthsPerYear * cal.daysPerMonth * cal.hoursPerDay; // 8640
    const expected = hoursPerYear / 10;
    expect(encodeWhen({ year: 1, month: 1, day: 1, hour: 0 }, cal)).toBe(expected);
  });

  it('round-trips all instants in 3 sample years', () => {
    for (const instant of allInstants(cal)) {
      const encoded = encodeWhen(instant, cal);
      const decoded = decodeWhen(encoded, cal);
      expect(decoded).toEqual(instant);
    }
  });

  it('encodes to a multiple of 0.1', () => {
    const when = encodeWhen({ year: 2, month: 6, day: 15, hour: 12 }, cal);
    expect(Math.round(when * 10)).toBe(when * 10);
  });
});

// ---------------------------------------------------------------------------
// codec — aeon-13 calendar (13 × 28 × 18) round-trips
// ---------------------------------------------------------------------------

describe('codec — aeon-13 calendar (13×28×18) round-trips', () => {
  const cal = CALENDAR_PRESETS['aeon-13'];

  it('encodes year-0 month-1 day-1 hour-0 as 0', () => {
    expect(encodeWhen({ year: 0, month: 1, day: 1, hour: 0 }, cal)).toBe(0);
  });

  it('round-trips all instants in 3 sample years', () => {
    for (const instant of allInstants(cal)) {
      const encoded = encodeWhen(instant, cal);
      const decoded = decodeWhen(encoded, cal);
      expect(decoded).toEqual(instant);
    }
  });

  it('first month, last hour encodes correctly', () => {
    const instant: TimelineInstant = { year: 0, month: 1, day: 1, hour: 17 };
    const encoded = encodeWhen(instant, cal);
    expect(decodeWhen(encoded, cal)).toEqual(instant);
  });

  it('last month, last day, last hour of year 5 round-trips', () => {
    const instant: TimelineInstant = { year: 5, month: 13, day: 28, hour: 17 };
    const encoded = encodeWhen(instant, cal);
    expect(decodeWhen(encoded, cal)).toEqual(instant);
  });
});

// ---------------------------------------------------------------------------
// codec — custom calendar
// ---------------------------------------------------------------------------

describe('codec — custom calendar', () => {
  const cal: TimelineCalendar = { preset: 'custom', monthsPerYear: 10, daysPerMonth: 36, hoursPerDay: 20 };

  it('round-trips instants in 2 sample years', () => {
    for (const instant of allInstants(cal)) {
      const encoded = encodeWhen(instant, cal);
      const decoded = decodeWhen(encoded, cal);
      expect(decoded).toEqual(instant);
    }
  });
});

// ---------------------------------------------------------------------------
// codec — guard rails
// ---------------------------------------------------------------------------

describe('codec — guard rails', () => {
  const cal = DEFAULT_TIMELINE_CALENDAR;

  it('throws on month = 0', () => {
    expect(() => encodeWhen({ year: 0, month: 0, day: 1, hour: 0 }, cal)).toThrow('month');
  });

  it('throws on month > monthsPerYear', () => {
    expect(() => encodeWhen({ year: 0, month: 13, day: 1, hour: 0 }, cal)).toThrow('month');
  });

  it('throws on day = 0', () => {
    expect(() => encodeWhen({ year: 0, month: 1, day: 0, hour: 0 }, cal)).toThrow('day');
  });

  it('throws on day > daysPerMonth', () => {
    expect(() => encodeWhen({ year: 0, month: 1, day: 31, hour: 0 }, cal)).toThrow('day');
  });

  it('throws on negative hour', () => {
    expect(() => encodeWhen({ year: 0, month: 1, day: 1, hour: -1 }, cal)).toThrow('hour');
  });

  it('throws on hour >= hoursPerDay', () => {
    expect(() => encodeWhen({ year: 0, month: 1, day: 1, hour: 24 }, cal)).toThrow('hour');
  });

  it('throws on fractional year', () => {
    expect(() => encodeWhen({ year: 1.5, month: 1, day: 1, hour: 0 }, cal)).toThrow('year');
  });

  it('assertValidWhen accepts 0', () => {
    expect(() => assertValidWhen(0)).not.toThrow();
  });

  it('assertValidWhen rejects NaN', () => {
    expect(() => assertValidWhen(NaN)).toThrow();
  });

  it('assertValidWhen rejects Infinity', () => {
    expect(() => assertValidWhen(Infinity)).toThrow();
  });

  it('assertValidWhen rejects -Infinity', () => {
    expect(() => assertValidWhen(-Infinity)).toThrow();
  });

  it('assertValidWhen rejects value with sub-0.1 precision', () => {
    // 0.15 has only 1 decimal of precision but cannot be represented as year×10 ticks
    expect(() => assertValidWhen(0.15)).toThrow();
  });

  it('decodeWhen throws on NaN', () => {
    expect(() => decodeWhen(NaN, cal)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// store — createSeedTimelinesStore
// ---------------------------------------------------------------------------

describe('createSeedTimelinesStore', () => {
  it('produces a valid store', () => {
    const store = createSeedTimelinesStore('2026-01-01T00:00:00.000Z');
    expect(() => validateTimelinesStore(store)).not.toThrow();
  });

  it('contains story, world, and universe timelines', () => {
    const store = createSeedTimelinesStore('2026-01-01T00:00:00.000Z');
    const kinds = store.timelines.map((t) => t.kind).sort();
    expect(kinds).toEqual(['story', 'universe', 'world']);
  });

  it('sets activeTimelineId to story timeline', () => {
    const store = createSeedTimelinesStore('2026-01-01T00:00:00.000Z');
    const story = store.timelines.find((t) => t.kind === 'story')!;
    expect(store.activeTimelineId).toBe(story.id);
  });

  it('has seed events whose when values are valid', () => {
    const store = createSeedTimelinesStore('2026-01-01T00:00:00.000Z');
    for (const event of store.events) {
      expect(() => assertValidWhen(event.when)).not.toThrow();
    }
  });

  it('all spans reference existing timelines', () => {
    const store = createSeedTimelinesStore('2026-01-01T00:00:00.000Z');
    const ids = new Set(store.timelines.map((t) => t.id));
    for (const span of store.spans) {
      expect(ids.has(span.timelineId)).toBe(true);
      if (span.opensTimelineId) expect(ids.has(span.opensTimelineId)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// store — validateTimelinesStore
// ---------------------------------------------------------------------------

describe('validateTimelinesStore', () => {
  it('accepts EMPTY_TIMELINES_STORE-like structure', () => {
    const store = createSeedTimelinesStore('2026-01-01T00:00:00.000Z');
    expect(() => validateTimelinesStore(store)).not.toThrow();
  });

  it('rejects wrong schema version', () => {
    const store = { ...createSeedTimelinesStore('2026-01-01T00:00:00.000Z'), schemaVersion: 2 as unknown as 1 };
    expect(() => validateTimelinesStore(store)).toThrow('schema version');
  });

  it('rejects missing active timeline', () => {
    const store = createSeedTimelinesStore('2026-01-01T00:00:00.000Z');
    const bad = { ...store, activeTimelineId: 'does-not-exist' };
    expect(() => validateTimelinesStore(bad)).toThrow('Active timeline');
  });

  it('rejects event referencing unknown timelineId', () => {
    const store = createSeedTimelinesStore('2026-01-01T00:00:00.000Z');
    const bad = {
      ...store,
      events: [...store.events, { id: 'bad-event', timelineId: 'ghost', name: 'Ghost', when: 0, source: 'manual' as const }],
    };
    expect(() => validateTimelinesStore(bad)).toThrow('ghost');
  });

  it('rejects duplicate event ids', () => {
    const store = createSeedTimelinesStore('2026-01-01T00:00:00.000Z');
    const dup = { ...store.events[0] };
    const bad = { ...store, events: [...store.events, dup] };
    expect(() => validateTimelinesStore(bad)).toThrow('Duplicate');
  });
});

// ---------------------------------------------------------------------------
// store — readTimelinesStore / writeTimelinesStore round-trip on disk
// ---------------------------------------------------------------------------

describe('readTimelinesStore / writeTimelinesStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-tl-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns seed store when timelines.json absent', () => {
    const store = readTimelinesStore(tmpDir);
    expect(store.schemaVersion).toBe(1);
    expect(store.timelines.length).toBeGreaterThan(0);
  });

  it('round-trips written store back to identical value', () => {
    const original = createSeedTimelinesStore('2026-01-01T00:00:00.000Z');
    writeTimelinesStore(tmpDir, original);
    const loaded = readTimelinesStore(tmpDir);
    expect(loaded).toEqual(original);
  });

  it('writes human-readable JSON (2-space indent)', () => {
    const original = createSeedTimelinesStore('2026-01-01T00:00:00.000Z');
    writeTimelinesStore(tmpDir, original);
    const raw = fs.readFileSync(path.join(tmpDir, TIMELINES_FILENAME), 'utf-8');
    expect(raw).toContain('\n  ');
  });

  it('rejects writing an invalid store', () => {
    const bad = { ...createSeedTimelinesStore('t'), activeTimelineId: 'ghost' };
    expect(() => writeTimelinesStore(tmpDir, bad)).toThrow('Active timeline');
  });
});

// ---------------------------------------------------------------------------
// store — migrateLegacyTimeline
// ---------------------------------------------------------------------------

describe('migrateLegacyTimeline', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-migrate-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeManifest(scenes: object[], timeline?: object[]): string {
    const manifest = {
      schemaVersion: 1,
      version: '1.0.0',
      vaultRoot: tmpDir,
      scenes,
      entities: [],
      suggestions: [],
      provenance: [],
      boards: [],
      timeline: timeline ?? [],
    };
    const p = path.join(tmpDir, 'manifest.json');
    fs.writeFileSync(p, JSON.stringify(manifest));
    return p;
  }

  function writeArcs(arcs: object[]): string {
    const p = path.join(tmpDir, 'arcs.json');
    fs.writeFileSync(p, JSON.stringify(arcs));
    return p;
  }

  it('produces a valid store from an empty manifest', () => {
    const manifestPath = writeManifest([]);
    const store = migrateLegacyTimeline({ manifestPath, now: '2026-01-01T00:00:00.000Z' });
    expect(() => validateTimelinesStore(store)).not.toThrow();
  });

  it('creates a story timeline with kind=story', () => {
    const manifestPath = writeManifest([]);
    const store = migrateLegacyTimeline({ manifestPath, now: '2026-01-01T00:00:00.000Z' });
    expect(store.timelines[0].kind).toBe('story');
  });

  function makeScene(id: string, title: string, order: number) {
    return { id, path: `scenes/${id}.md`, title, order, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
  }

  function makeTimelineEntry(sceneId: string, inferredDay: number, inferredTime: string, userOverride?: { day: number; time: string }) {
    const entry: Record<string, unknown> = { sceneId, inferredDay, inferredTime, confidence: 0.9, rawCue: 'test cue' };
    if (userOverride) {
      entry.userOverride = { day: userOverride.day, time: userOverride.time, setAt: '2026-01-01T00:00:00.000Z' };
    }
    return entry;
  }

  it('migrates timeline entries to events with source=migration', () => {
    const scenes = [makeScene('s1', 'Scene 1', 0)];
    const timeline = [makeTimelineEntry('s1', 3, 'morning')];
    const manifestPath = writeManifest(scenes, timeline);
    const store = migrateLegacyTimeline({ manifestPath, now: '2026-01-01T00:00:00.000Z' });
    expect(store.events).toHaveLength(1);
    expect(store.events[0].source).toBe('migration');
    expect(store.events[0].sceneId).toBe('s1');
    expect(store.events[0].name).toBe('Scene 1');
  });

  it('migrated event when values pass assertValidWhen', () => {
    const tods = ['midnight', 'dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night', 'unspecified'] as const;
    const timeline = tods.map((time, i) => makeTimelineEntry(`s${i}`, i + 1, time));
    const allScenes = tods.map((_, i) => makeScene(`s${i}`, `Scene ${i}`, i));
    const manifestPath = writeManifest(allScenes, timeline);
    const store = migrateLegacyTimeline({ manifestPath, now: '2026-01-01T00:00:00.000Z' });
    for (const event of store.events) {
      expect(() => assertValidWhen(event.when)).not.toThrow();
    }
  });

  it('migrates arcs to rows with kind=arc', () => {
    const arc = {
      id: 'arc1',
      title: 'Main Arc',
      color: '#ff0000',
      colorIsCustom: false,
      scenes: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const manifestPath = writeManifest([]);
    const arcsPath = writeArcs([arc]);
    const store = migrateLegacyTimeline({ manifestPath, arcsPath, now: '2026-01-01T00:00:00.000Z' });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].kind).toBe('arc');
    expect(store.rows[0].name).toBe('Main Arc');
  });

  it('handles missing arcs file gracefully', () => {
    const manifestPath = writeManifest([]);
    const store = migrateLegacyTimeline({
      manifestPath,
      arcsPath: path.join(tmpDir, 'nonexistent.json'),
      now: '2026-01-01T00:00:00.000Z',
    });
    expect(store.rows).toHaveLength(0);
  });

  it('uses userOverride day/time when present', () => {
    const scenes = [makeScene('s1', 'Scene 1', 0)];
    const timeline = [makeTimelineEntry('s1', 1, 'midnight', { day: 5, time: 'noon' })];
    const manifestPath = writeManifest(scenes, timeline);
    const store = migrateLegacyTimeline({ manifestPath, now: '2026-01-01T00:00:00.000Z' });
    // noon on day 5 should encode to a larger when than midnight on day 1
    const noOverrideScenes = [makeScene('s2', 'Scene 2', 0)];
    const noOverrideTimeline = [makeTimelineEntry('s2', 1, 'midnight')];
    const manifestPath2 = writeManifest(noOverrideScenes, noOverrideTimeline);
    const store2 = migrateLegacyTimeline({ manifestPath: manifestPath2, now: '2026-01-01T00:00:00.000Z' });
    expect(store.events[0].when).toBeGreaterThan(store2.events[0].when);
  });

  it('falls back to sceneId as name when scene is not in manifest', () => {
    const timeline = [makeTimelineEntry('orphan-scene', 1, 'noon')];
    const manifestPath = writeManifest([], timeline);
    const store = migrateLegacyTimeline({ manifestPath, now: '2026-01-01T00:00:00.000Z' });
    expect(store.events[0].name).toBe('orphan-scene');
  });
});

// ---------------------------------------------------------------------------
// codec — symmetry across all standard calendar instants (exhaustive for year 0-2)
// ---------------------------------------------------------------------------

describe('codec exhaustive symmetry — standard calendar', () => {
  const cal = CALENDAR_PRESETS['standard'];
  const instants = allInstants(cal);

  it(`round-trips ${instants.length} instants`, () => {
    let failures = 0;
    for (const instant of instants) {
      const encoded = encodeWhen(instant, cal);
      const decoded = decodeWhen(encoded, cal);
      if (
        decoded.year !== instant.year ||
        decoded.month !== instant.month ||
        decoded.day !== instant.day ||
        decoded.hour !== instant.hour
      ) {
        failures++;
      }
    }
    expect(failures).toBe(0);
  });
});

describe('codec exhaustive symmetry — aeon-13 calendar', () => {
  const cal = CALENDAR_PRESETS['aeon-13'];
  const instants = allInstants(cal);

  it(`round-trips ${instants.length} instants`, () => {
    let failures = 0;
    for (const instant of instants) {
      const encoded = encodeWhen(instant, cal);
      const decoded = decodeWhen(encoded, cal);
      if (
        decoded.year !== instant.year ||
        decoded.month !== instant.month ||
        decoded.day !== instant.day ||
        decoded.hour !== instant.hour
      ) {
        failures++;
      }
    }
    expect(failures).toBe(0);
  });
});
