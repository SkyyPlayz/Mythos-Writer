/**
 * SKY-11590 — guard: the shipped Liquid Neon wallpapers stay in step with the
 * manifest that generated them, and stay inside the installer size budget.
 *
 * The art pipeline lives outside the Node build. `wallpapers.manifest.json`
 * holds the curation and the per-image crop anchors, and
 * `scripts/wallpapers/build_wallpapers.py` turns the owner's PNG originals into
 * `frontend/src/assets/wallpapers/bg-<setKey>-<n>.webp`. That script needs
 * Pillow, which is not a repo dependency and is not installed in CI, so nothing
 * in a normal build re-derives these files.
 *
 * The drift this catches is real: during development the manifest was edited and
 * the WebPs rebuilt while `build-report.json` still described an earlier encode,
 * so the recorded byte sizes disagreed with the bytes on disk. Nothing noticed,
 * because no test read either file.
 *
 * These assertions need no Python and no image decoding, so they run on every
 * PR. They cannot judge whether a crop anchor is *good* — that is a human call,
 * recorded in docs/design/wallpaper-pipeline.md — only that what is committed is
 * what the manifest asked for. `build_wallpapers.py --check` is the byte-exact
 * verification for anyone who has Pillow.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { LIQUID_NEON_PRESETS, type LiquidNeonPresetKey } from './presets';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const ASSET_DIR = resolve(REPO_ROOT, 'frontend/src/assets/wallpapers');
const MANIFEST_PATH = resolve(REPO_ROOT, 'scripts/wallpapers/wallpapers.manifest.json');
const REPORT_PATH = resolve(REPO_ROOT, 'scripts/wallpapers/build-report.json');

interface Manifest {
  encode: { targetBytes: number; maxBytes: number };
  sets: Record<
    string,
    { presetName: string; images: { src: string; anchor: number; note: string }[] }
  >;
}
interface Report {
  images: { file: string; bytes: number; outputSize: [number, number] }[];
  totalBytes: number;
}

const manifest: Manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const report: Report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));

/** `bg-<setKey>-<n>.webp`, n starting at 1 — the name a picker resolves. */
const expected = Object.entries(manifest.sets).flatMap(([setKey, spec]) =>
  spec.images.map((_, i) => `bg-${setKey}-${i + 1}.webp`),
);

/**
 * The whole pack's share of the installer. Held above the current 1.84 MB so
 * recuration has room, but low enough that adding a second pack without a
 * conversation trips it.
 */
const TOTAL_BUDGET_BYTES = 2_400_000;

/** The owner's originals top out at 1672x941, so this is the no-upscale ceiling. */
const MAX_OUTPUT = { w: 1672, h: 940 };

describe('Liquid Neon wallpaper assets', () => {
  it('names every set after a real preset', () => {
    for (const [setKey, spec] of Object.entries(manifest.sets)) {
      const preset = LIQUID_NEON_PRESETS[setKey as LiquidNeonPresetKey];
      expect(preset, setKey).toBeDefined();
      // The owner's source folders are named differently ("Neon Nebula" is
      // `classic`, "cyberpunk" is `cyber`), so a set that drifted off its preset
      // would otherwise be invisible.
      expect(preset.name, setKey).toBe(spec.presetName);
    }
  });

  it('covers all ten colour sets with 3-4 wallpapers each', () => {
    expect(Object.keys(manifest.sets).sort()).toEqual(Object.keys(LIQUID_NEON_PRESETS).sort());
    for (const [setKey, spec] of Object.entries(manifest.sets)) {
      expect(spec.images.length, setKey).toBeGreaterThanOrEqual(3);
      expect(spec.images.length, setKey).toBeLessThanOrEqual(4);
    }
  });

  it('ships exactly the files the manifest describes', () => {
    const onDisk = readdirSync(ASSET_DIR)
      .filter((f) => f.endsWith('.webp'))
      .sort();
    expect(onDisk).toEqual([...expected].sort());
  });

  it('gives every image a deliberate crop anchor and a reason', () => {
    for (const [setKey, spec] of Object.entries(manifest.sets)) {
      for (const img of spec.images) {
        const where = `${setKey} ${img.src}`;
        // A 16:9 window on these sources can only reach about 0.37-0.63;
        // anything outside this band would silently clamp back toward centre.
        expect(img.anchor, where).toBeGreaterThanOrEqual(0.3);
        expect(img.anchor, where).toBeLessThanOrEqual(0.7);
        expect(img.note.length, where).toBeGreaterThan(20);
      }
    }
  });

  it('writes real WebP files', () => {
    for (const file of expected) {
      const head = readFileSync(resolve(ASSET_DIR, file)).subarray(0, 12);
      expect(head.subarray(0, 4).toString('latin1'), file).toBe('RIFF');
      expect(head.subarray(8, 12).toString('latin1'), file).toBe('WEBP');
    }
  });

  it('holds every wallpaper under the per-image byte cap', () => {
    for (const file of expected) {
      const bytes = statSync(resolve(ASSET_DIR, file)).size;
      expect(bytes, file).toBeGreaterThan(0);
      expect(bytes, file).toBeLessThanOrEqual(manifest.encode.maxBytes);
    }
  });

  it('holds the whole pack under the installer budget', () => {
    const total = expected.reduce((sum, f) => sum + statSync(resolve(ASSET_DIR, f)).size, 0);
    expect(total).toBeLessThanOrEqual(TOTAL_BUDGET_BYTES);
  });

  it('keeps build-report.json in step with the bytes on disk', () => {
    expect(report.images.map((r) => r.file)).toEqual(expected);
    for (const row of report.images) {
      expect(statSync(resolve(ASSET_DIR, row.file)).size, row.file).toBe(row.bytes);
    }
    expect(report.totalBytes).toBe(report.images.reduce((sum, r) => sum + r.bytes, 0));
  });

  it('crops to 16:9 and never upscales', () => {
    for (const row of report.images) {
      const [w, h] = row.outputSize;
      expect(w, row.file).toBeLessThanOrEqual(MAX_OUTPUT.w);
      expect(h, row.file).toBeLessThanOrEqual(MAX_OUTPUT.h);
      expect(Math.abs(w / h - 16 / 9), row.file).toBeLessThan(0.01);
    }
  });
});
