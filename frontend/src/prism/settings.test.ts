// Prism (#1764) — per-book settings: defaults, tolerant normalization, the
// prism.json round-trip, patching, and the vault-IPC load/save adapters.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_PRISM_SETTINGS,
  PRISM_FILE_BASENAME,
  PRISM_FILE_VERSION,
  applyPrismPatch,
  loadPrismSettings,
  normalizePrismSettings,
  parsePrismSettings,
  prismFilePath,
  savePrismSettings,
  serializePrismSettings,
} from './settings';
import { PRISM_CHECK_IDS, type PrismCheckId, type PrismSettings } from './types';

function allChecks(value: boolean): Record<PrismCheckId, boolean> {
  return Object.fromEntries(PRISM_CHECK_IDS.map((id) => [id, value])) as Record<
    PrismCheckId,
    boolean
  >;
}

function mkSettings(over: Partial<PrismSettings> = {}): PrismSettings {
  return {
    version: 1,
    flags: true,
    proseColors: true,
    checks: { ...allChecks(true), adverbs: false },
    thresholds: { longSentenceWords: 42, overusedMinRepeats: 4, overusedWindowWords: 250 },
    analyticsOpen: false,
    ...over,
  };
}

describe('DEFAULT_PRISM_SETTINGS', () => {
  it('ships both master switches off and the Analytics section open', () => {
    expect(DEFAULT_PRISM_SETTINGS.version).toBe(PRISM_FILE_VERSION);
    expect(DEFAULT_PRISM_SETTINGS.flags).toBe(false);
    expect(DEFAULT_PRISM_SETTINGS.proseColors).toBe(false);
    expect(DEFAULT_PRISM_SETTINGS.analyticsOpen).toBe(true);
  });

  it('turns every check on except the narrator tint', () => {
    expect(Object.keys(DEFAULT_PRISM_SETTINGS.checks).sort()).toEqual([...PRISM_CHECK_IDS].sort());
    for (const id of PRISM_CHECK_IDS) {
      expect(DEFAULT_PRISM_SETTINGS.checks[id]).toBe(id !== 'narrator');
    }
  });

  it('ships the documented thresholds', () => {
    expect(DEFAULT_PRISM_SETTINGS.thresholds).toEqual({
      longSentenceWords: 30,
      overusedMinRepeats: 3,
      overusedWindowWords: 100,
    });
  });

  it('cannot be mutated through a shared reference', () => {
    expect(Object.isFrozen(DEFAULT_PRISM_SETTINGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_PRISM_SETTINGS.checks)).toBe(true);
    expect(Object.isFrozen(DEFAULT_PRISM_SETTINGS.thresholds)).toBe(true);
  });
});

describe('prismFilePath', () => {
  it('joins the story root with prism.json', () => {
    expect(prismFilePath('stories/abc')).toBe('stories/abc/prism.json');
  });

  it('strips trailing slashes', () => {
    expect(prismFilePath('stories/abc///')).toBe('stories/abc/prism.json');
  });

  it('handles an empty root', () => {
    expect(prismFilePath('')).toBe(PRISM_FILE_BASENAME);
  });

  it('stays inside the vault IPC allow-list (.json, no dotfiles)', () => {
    const p = prismFilePath('stories/abc');
    expect(p.endsWith('.json')).toBe(true);
    expect(p.split('/').some((seg) => seg.startsWith('.'))).toBe(false);
  });
});

describe('normalizePrismSettings', () => {
  it('returns defaults for non-object input', () => {
    for (const raw of [null, undefined, 42, 'str', true, [], [1, 2], () => 1]) {
      expect(normalizePrismSettings(raw)).toEqual(DEFAULT_PRISM_SETTINGS);
    }
  });

  it('returns fresh, mutable objects (never the frozen default)', () => {
    const a = normalizePrismSettings(null);
    const b = normalizePrismSettings(null);
    expect(a).not.toBe(DEFAULT_PRISM_SETTINGS);
    expect(a.checks).not.toBe(DEFAULT_PRISM_SETTINGS.checks);
    expect(a.thresholds).not.toBe(DEFAULT_PRISM_SETTINGS.thresholds);
    expect(a.checks).not.toBe(b.checks);
    a.checks.adverbs = false;
    a.thresholds.longSentenceWords = 99;
    expect(DEFAULT_PRISM_SETTINGS.checks.adverbs).toBe(true);
    expect(DEFAULT_PRISM_SETTINGS.thresholds.longSentenceWords).toBe(30);
  });

  it('does not alias the input objects', () => {
    const raw = mkSettings();
    const out = normalizePrismSettings(raw);
    expect(out).toEqual(raw);
    expect(out.checks).not.toBe(raw.checks);
    expect(out.thresholds).not.toBe(raw.thresholds);
  });

  it('keeps valid fields and falls back per field', () => {
    const out = normalizePrismSettings({ flags: true, proseColors: 'yes', analyticsOpen: 0 });
    expect(out.flags).toBe(true);
    expect(out.proseColors).toBe(false);
    expect(out.analyticsOpen).toBe(true);
    expect(out.checks).toEqual(DEFAULT_PRISM_SETTINGS.checks);
    expect(out.thresholds).toEqual(DEFAULT_PRISM_SETTINGS.thresholds);
  });

  it('always writes version 1', () => {
    expect(normalizePrismSettings({ version: 7 }).version).toBe(1);
    expect(normalizePrismSettings({ version: 'one' }).version).toBe(1);
  });

  it('drops unknown top-level, check and threshold keys', () => {
    const out = normalizePrismSettings({
      flags: true,
      extra: 'x',
      checks: { adverbs: false, martian: true },
      thresholds: { longSentenceWords: 40, mystery: 3 },
    });
    expect(Object.keys(out).sort()).toEqual(
      ['analyticsOpen', 'checks', 'flags', 'proseColors', 'thresholds', 'version'].sort()
    );
    expect(Object.keys(out.checks).sort()).toEqual([...PRISM_CHECK_IDS].sort());
    expect(Object.keys(out.thresholds).sort()).toEqual(
      ['longSentenceWords', 'overusedMinRepeats', 'overusedWindowWords'].sort()
    );
    expect(out.checks.adverbs).toBe(false);
    expect(out.thresholds.longSentenceWords).toBe(40);
  });

  it('fills missing checks with defaults and rejects non-boolean values', () => {
    const out = normalizePrismSettings({
      checks: { adverbs: false, narrator: true, dialogue: 'false', 'crutch-words': 0 },
    });
    expect(out.checks.adverbs).toBe(false);
    expect(out.checks.narrator).toBe(true);
    expect(out.checks.dialogue).toBe(true);
    expect(out.checks['crutch-words']).toBe(true);
    expect(out.checks['passive-voice']).toBe(true);
  });

  it('treats non-object checks / thresholds as defaults', () => {
    for (const bad of [null, 5, 'x', [true, false]]) {
      const out = normalizePrismSettings({ checks: bad, thresholds: bad });
      expect(out.checks).toEqual(DEFAULT_PRISM_SETTINGS.checks);
      expect(out.thresholds).toEqual(DEFAULT_PRISM_SETTINGS.thresholds);
    }
  });

  it('rejects non-integer, non-finite and wrong-type thresholds', () => {
    for (const bad of [NaN, Infinity, -Infinity, 30.5, '40', null, true, {}, -5, 0]) {
      const out = normalizePrismSettings({
        thresholds: { longSentenceWords: bad, overusedMinRepeats: bad, overusedWindowWords: bad },
      });
      expect(out.thresholds).toEqual(DEFAULT_PRISM_SETTINGS.thresholds);
    }
  });

  it('enforces threshold bounds, inclusive', () => {
    const lo = normalizePrismSettings({
      thresholds: { longSentenceWords: 8, overusedMinRepeats: 2, overusedWindowWords: 20 },
    });
    expect(lo.thresholds).toEqual({
      longSentenceWords: 8,
      overusedMinRepeats: 2,
      overusedWindowWords: 20,
    });
    const hi = normalizePrismSettings({
      thresholds: { longSentenceWords: 200, overusedMinRepeats: 20, overusedWindowWords: 2000 },
    });
    expect(hi.thresholds).toEqual({
      longSentenceWords: 200,
      overusedMinRepeats: 20,
      overusedWindowWords: 2000,
    });
    const below = normalizePrismSettings({
      thresholds: { longSentenceWords: 7, overusedMinRepeats: 1, overusedWindowWords: 19 },
    });
    expect(below.thresholds).toEqual(DEFAULT_PRISM_SETTINGS.thresholds);
    const above = normalizePrismSettings({
      thresholds: { longSentenceWords: 201, overusedMinRepeats: 21, overusedWindowWords: 2001 },
    });
    expect(above.thresholds).toEqual(DEFAULT_PRISM_SETTINGS.thresholds);
  });

  it('never throws on hostile input', () => {
    const hostile = Object.create(null) as Record<string, unknown>;
    hostile.checks = Object.create(null);
    const throwing = {
      get flags(): boolean {
        throw new Error('boom');
      },
    };
    expect(() => normalizePrismSettings(hostile)).not.toThrow();
    expect(() => normalizePrismSettings(throwing)).not.toThrow();
    expect(normalizePrismSettings(throwing)).toEqual(DEFAULT_PRISM_SETTINGS);
  });
});

describe('serialize → parse round-trip', () => {
  it('preserves every field', () => {
    const s = mkSettings();
    expect(parsePrismSettings(serializePrismSettings(s))).toEqual(s);
  });

  it('round-trips the defaults', () => {
    expect(parsePrismSettings(serializePrismSettings(DEFAULT_PRISM_SETTINGS))).toEqual(
      DEFAULT_PRISM_SETTINGS
    );
  });

  it('writes pretty JSON with a trailing newline and version 1', () => {
    const raw = serializePrismSettings(mkSettings());
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('\n  "flags": true');
    expect((JSON.parse(raw) as { version: number }).version).toBe(PRISM_FILE_VERSION);
  });

  it('normalizes on write (no junk keys reach disk)', () => {
    const dirty = { ...mkSettings(), junk: 1 } as unknown as PrismSettings;
    expect(serializePrismSettings(dirty)).not.toContain('junk');
  });
});

describe('parsePrismSettings tolerance', () => {
  it('returns defaults on malformed JSON', () => {
    expect(parsePrismSettings('{nope')).toEqual(DEFAULT_PRISM_SETTINGS);
    expect(parsePrismSettings('')).toEqual(DEFAULT_PRISM_SETTINGS);
  });

  it('returns defaults on non-object payloads', () => {
    for (const raw of ['42', '"str"', 'null', '[]', 'true']) {
      expect(parsePrismSettings(raw)).toEqual(DEFAULT_PRISM_SETTINGS);
    }
  });

  it('merges a partial file over defaults', () => {
    const out = parsePrismSettings('{"flags": true, "thresholds": {"longSentenceWords": 25}}');
    expect(out.flags).toBe(true);
    expect(out.thresholds).toEqual({ ...DEFAULT_PRISM_SETTINGS.thresholds, longSentenceWords: 25 });
  });
});

describe('applyPrismPatch', () => {
  it('merges top-level, checks and thresholds without mutating the input', () => {
    const base = mkSettings();
    const snapshot = JSON.stringify(base);
    const out = applyPrismPatch(base, {
      flags: false,
      checks: { adverbs: true, narrator: false },
      thresholds: { overusedMinRepeats: 5 },
    });
    expect(JSON.stringify(base)).toBe(snapshot);
    expect(out).not.toBe(base);
    expect(out.flags).toBe(false);
    expect(out.proseColors).toBe(true);
    expect(out.checks.adverbs).toBe(true);
    expect(out.checks.narrator).toBe(false);
    expect(out.checks.dialogue).toBe(true);
    expect(out.thresholds).toEqual({
      longSentenceWords: 42,
      overusedMinRepeats: 5,
      overusedWindowWords: 250,
    });
  });

  it('accepts a frozen base (the shipped defaults)', () => {
    const out = applyPrismPatch(DEFAULT_PRISM_SETTINGS, { analyticsOpen: false });
    expect(out.analyticsOpen).toBe(false);
    expect(DEFAULT_PRISM_SETTINGS.analyticsOpen).toBe(true);
  });

  it('ignores invalid patch values, keeping the current value', () => {
    const base = mkSettings();
    const out = applyPrismPatch(base, {
      flags: 'on' as unknown as boolean,
      checks: { adverbs: 1 as unknown as boolean, martian: true } as Partial<
        Record<PrismCheckId, boolean>
      >,
      thresholds: { longSentenceWords: 5000, overusedWindowWords: NaN },
    });
    expect(out).toEqual(base);
    expect(Object.keys(out.checks)).not.toContain('martian');
  });

  it('returns an equal copy for an empty patch', () => {
    const base = mkSettings();
    const out = applyPrismPatch(base, {});
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
    expect(out.checks).not.toBe(base.checks);
  });
});

describe('vault IPC adapters', () => {
  const readVault = vi.fn();
  const writeVault = vi.fn();

  beforeEach(() => {
    readVault.mockReset();
    writeVault.mockReset();
    Object.defineProperty(window, 'api', {
      value: { readVault, writeVault },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    delete (window as { api?: unknown }).api;
  });

  it('loadPrismSettings reads <storyPath>/prism.json and parses it', async () => {
    const s = mkSettings();
    readVault.mockResolvedValue({
      content: serializePrismSettings(s),
      path: 'stories/abc/prism.json',
    });
    await expect(loadPrismSettings('stories/abc')).resolves.toEqual(s);
    expect(readVault).toHaveBeenCalledWith('stories/abc/prism.json');
  });

  it('loadPrismSettings treats a read failure (ENOENT) as defaults', async () => {
    readVault.mockRejectedValue(new Error('ENOENT'));
    await expect(loadPrismSettings('stories/abc')).resolves.toEqual(DEFAULT_PRISM_SETTINGS);
  });

  it('loadPrismSettings treats a synchronous bridge throw as defaults', async () => {
    readVault.mockImplementation(() => {
      throw new Error('bridge exploded');
    });
    await expect(loadPrismSettings('stories/abc')).resolves.toEqual(DEFAULT_PRISM_SETTINGS);
  });

  it('loadPrismSettings treats bad JSON or a missing content field as defaults', async () => {
    readVault.mockResolvedValueOnce({ content: '{broken', path: 'x' });
    await expect(loadPrismSettings('stories/abc')).resolves.toEqual(DEFAULT_PRISM_SETTINGS);
    readVault.mockResolvedValueOnce({ path: 'x' });
    await expect(loadPrismSettings('stories/abc')).resolves.toEqual(DEFAULT_PRISM_SETTINGS);
    readVault.mockResolvedValueOnce(undefined);
    await expect(loadPrismSettings('stories/abc')).resolves.toEqual(DEFAULT_PRISM_SETTINGS);
  });

  it('loadPrismSettings yields defaults without the bridge', async () => {
    delete (window as { api?: unknown }).api;
    await expect(loadPrismSettings('stories/abc')).resolves.toEqual(DEFAULT_PRISM_SETTINGS);
  });

  it('loadPrismSettings returns a fresh object each time', async () => {
    readVault.mockRejectedValue(new Error('ENOENT'));
    const a = await loadPrismSettings('stories/abc');
    expect(a).not.toBe(DEFAULT_PRISM_SETTINGS);
    a.flags = true;
    expect(DEFAULT_PRISM_SETTINGS.flags).toBe(false);
  });

  it('savePrismSettings writes the serialized settings through writeVault', async () => {
    writeVault.mockResolvedValue({ path: 'stories/abc/prism.json', bytes: 10 });
    const s = mkSettings();
    await savePrismSettings('stories/abc', s);
    expect(writeVault).toHaveBeenCalledWith('stories/abc/prism.json', serializePrismSettings(s));
  });

  it('savePrismSettings rejects a fulfilled write refusal', async () => {
    writeVault.mockResolvedValue({
      path: 'stories/abc/prism.json',
      bytes: 0,
      error: "Couldn't save prism.json: the disk is full.",
    });
    await expect(savePrismSettings('stories/abc', mkSettings())).rejects.toThrow(/disk is full/);
  });

  it('savePrismSettings propagates a rejected write', async () => {
    writeVault.mockRejectedValue(new Error('EACCES'));
    await expect(savePrismSettings('stories/abc', mkSettings())).rejects.toThrow(/EACCES/);
  });

  it('savePrismSettings no-ops without the bridge', async () => {
    delete (window as { api?: unknown }).api;
    await expect(savePrismSettings('stories/abc', mkSettings())).resolves.toBeUndefined();
  });
});
