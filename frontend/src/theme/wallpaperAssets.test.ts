/**
 * SKY-11591 — guard: the shipped Liquid Neon wallpapers stay in step with the
 * manifest that generated them, and stay inside the installer size budget.
 *
 * The art pipeline lives outside the Node build: `wallpapers.manifest.json`
 * holds the curation and per-image crop anchors, and
 * `scripts/wallpapers/build_wallpapers.py` turns the owner's PNG originals into
 * `frontend/src/assets/wallpapers/bg-<setKey>-<n>.webp`. That script needs
 * Pillow, which is not a repo dependency and is not installed in CI, so nothing
 * in a normal build re-derives these files.
 *
 * The failure that motivates this test already happened once during SKY-11591:
 * the manifest was edited, the WebPs were rebuilt, and `build-report.json` was
 * left describing an earlier encode — so the recorded byte sizes disagreed with
 * the bytes actually on disk, and one wallpaper had silently shipped at 94 KB
 * against a 62 KB cap. Nothing caught it, because no test read either file.
 *
 * These assertions need no Python and no image decoding, so they run on every
 * PR. They cannot verify the crop anchors are *good* — that is a human call,
 * recorded in docs/design/wallpaper-pipeline.md — only that what is committed is
 * what the manifest asks for.
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
  sets: Record<string, { presetName: string; images: { src: string; anchor: number; note: string }[] }>;
}
interface Report {
  images: { file: string; set: string; order: number; bytes: number; outputSize: [number, number] }[];
  totalBytes: number;
}

const manifest: Manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const report: Report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));

/** `bg-<setKey>-<n>.webp`, n starting at 1 — the name the picker resolves. */
const expected = Object.entries(manifest.sets).flatMap(([setKey, spec]) =>
  spec.images.map((_, i) => `bg-${setKey}-${i + 1}.webp`),
);

/**
 * The whole pack's share of the installer. Held a little above the current
 * 1.76 MB so recuration has room, but low enough that adding a second pack
 * without a conversation trips it.
 */
const TOTAL_BUDGET_BYTES = 2_400_000;

describe('Liquid Neon wallpaper assets', () => {
  it('names every set after a real preset key', () => {
    for (const [setKey, spec] of Object.entries(manifest.sets)) {
      expect(LIQUID_NEON_PRESETS[setKey as LiquidNeonPresetKey]).toBeDefined();
      // The owner's source folders are named differently ("Neon Nebula" ->
      // `classic`), so a set that drifts off its preset would be invisible.
      expect(LIQUID_NEON_PRESETS[setKey as LiquidNeonPresetKey].name).toBe(spec.presetName);
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
    const onDisk = readdirSync(ASSET_DIR).filter((f) => f.endsWith('.webp')).sort();
    expect(onDisk).toEqual([...expected].sort());
  });

  it('keeps the licence record next to the shipped assets', () => {
    // The ownership record for this art travels with the files that ship, the
    // same way electron-main/resources/kokoro/LICENSE does for the TTS weights.
    const licence = readFileSync(resolve(ASSET_DIR, 'LICENSE'), 'utf8');
    expect(licence).toMatch(/owner-authored/i);
    expect(licence).toMatch(/SKY-11591/);
  });

  it('gives every image a deliberate crop anchor and a note', () => {
    for (const [setKey, spec] of Object.entries(manifest.sets)) {
      for (const img of spec.images) {
        // Clamped to what a 16:9 window can reach on these sources; an anchor
        // outside this range would silently degrade to a centre-ish crop.
        expect(img.anchor, `${setKey} ${img.src}`).toBeGreaterThanOrEqual(0.3);
        expect(img.anchor, `${setKey} ${img.src}`).toBeLessThanOrEqual(0.7);
        expect(img.note.length, `${setKey} ${img.src}`).toBeGreaterThan(20);
      }
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

  it('writes real WebP files', () => {
    for (const file of expected) {
      const head = readFileSync(resolve(ASSET_DIR, file)).subarray(0, 12);
      expect(head.subarray(0, 4).toString('latin1'), file).toBe('RIFF');
      expect(head.subarray(8, 12).toString('latin1'), file).toBe('WEBP');
    }
  });

  it('keeps build-report.json in step with the bytes on disk', () => {
    expect(report.images.map((r) => r.file)).toEqual(expected);
    for (const row of report.images) {
      expect(statSync(resolve(ASSET_DIR, row.file)).size, row.file).toBe(row.bytes);
    }
    expect(report.totalBytes).toBe(report.images.reduce((sum, r) => sum + r.bytes, 0));
  });

  it('never upscales past the smallest source bucket', () => {
    // The owner's originals top out at 1672x941; anything taller than the
    // largest 16:9 window that fits would mean the build started upscaling.
    for (const row of report.images) {
      const [w, h] = row.outputSize;
      expect(w, row.file).toBeLessThanOrEqual(1672);
      expect(h, row.file).toBeLessThanOrEqual(940);
      expect(Math.abs(w / h - 16 / 9), row.file).toBeLessThan(0.01);
    }
  });
});
