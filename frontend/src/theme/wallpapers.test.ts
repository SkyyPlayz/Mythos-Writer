// SKY-11589 — the wallpaper pack is data (manifest + files). These tests keep
// the two in step: every manifest line has a file, every bundled file is in the
// manifest, and every preset has something to cycle.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';
import manifest from '../assets/wallpapers/manifest.json';
import provenance from '../assets/wallpapers/PROVENANCE.json';
import { bundledWallpaperFiles, packThemeKeys, packWallpapers, wallpaperFileUrl } from './wallpapers';
import { LIQUID_NEON_PRESETS } from './presets';

interface Entry {
  file: string;
  source?: string;
  position?: string;
}
const themes = (manifest as { themes: Record<string, Entry[]> }).themes;
const provThemes = (provenance as {
  themes: Record<string, { file: string; sourceFile: string; sha256: string; cropNote: string | null }[]>;
}).themes;
const ASSET_DIR = resolve(__dirname, '..', 'assets', 'wallpapers');

describe('bundled wallpaper pack (SKY-11589)', () => {
  it('every manifest entry resolves to a bundled file', () => {
    for (const [key, entries] of Object.entries(themes)) {
      for (const e of entries) {
        expect(wallpaperFileUrl(e.file), `${key}: ${e.file} missing on disk`).toBeTruthy();
      }
    }
  });

  it('every bundled file is listed in the manifest (no orphans shipping)', () => {
    const listed = new Set(Object.values(themes).flat().map((e) => e.file));
    for (const f of bundledWallpaperFiles()) {
      expect(listed.has(f), `${f} is bundled but not in manifest.json`).toBe(true);
    }
  });

  it('manifest keys are Liquid Neon preset keys and every preset ships wallpapers', () => {
    const presetKeys = Object.keys(LIQUID_NEON_PRESETS);
    for (const k of Object.keys(themes)) expect(presetKeys).toContain(k);
    for (const k of presetKeys) expect(packWallpapers(k).length, `${k} has no pack wallpapers`).toBeGreaterThan(0);
    expect(packThemeKeys().sort()).toEqual(presetKeys.sort());
    expect(packWallpapers('custom')).toEqual([]);
  });

  it('entries keep manifest order and carry a position (default center)', () => {
    const list = packWallpapers('classic');
    expect(list.map((e) => e.url.split('/').pop()!.replace(/-[A-Za-z0-9_-]{8}\.webp$/, '.webp')))
      .toEqual(themes.classic.map((e) => e.file));
    for (const e of list) expect(e.position).toBeTruthy();
    expect(list[0].position).toBe(themes.classic[0].position ?? 'center');
  });
});

// SKY-11591 — the framing and the paperwork. `position` is the only record of a
// human having looked at an image; `build-pack.py` carries it across a rebuild
// by matching `source`, so an entry with a position but no source would lose its
// framing silently the next time the pack is regenerated.
describe('wallpaper pack provenance and framing (SKY-11591)', () => {
  it('names the original every entry was encoded from', () => {
    for (const [key, entries] of Object.entries(themes)) {
      for (const e of entries) {
        expect(e.source, `${key}: ${e.file} has no source`).toBeTruthy();
      }
    }
  });

  it('writes every position as a CSS background-position the browser accepts', () => {
    // Two values, x then y: a percentage, or one of the axis keywords. The
    // renderer passes this string straight to `background-position`, where an
    // unparseable value is dropped and the image silently reverts to centre.
    const token = /^(-?\d+(\.\d+)?%|left|right|top|bottom|center)$/;
    for (const [key, entries] of Object.entries(themes)) {
      for (const e of entries) {
        if (e.position === undefined) continue;
        const parts = e.position.split(/\s+/);
        expect(parts.length, `${key}: ${e.file} position "${e.position}"`).toBe(2);
        for (const p of parts) expect(p, `${key}: ${e.file} position "${e.position}"`).toMatch(token);
      }
    }
  });

  it('records provenance for every shipped file, and nothing else', () => {
    const manifestFiles = Object.entries(themes).flatMap(([k, v]) => v.map((e) => `${k}/${e.file}`));
    const provFiles = Object.entries(provThemes).flatMap(([k, v]) => v.map((e) => `${k}/${e.file}`));
    expect(provFiles.sort()).toEqual([...manifestFiles].sort());
    for (const [key, rows] of Object.entries(provThemes)) {
      for (const r of rows) {
        expect(r.sha256, `${key}: ${r.file}`).toMatch(/^[0-9a-f]{64}$/);
        expect(r.sourceFile, `${key}: ${r.file}`).toBeTruthy();
        // `cropNote: null` is a deliberate "nobody reviewed this one" marker, so
        // an unreviewed image stays visible rather than looking signed off.
        if (r.cropNote !== null) expect(r.cropNote.length, `${key}: ${r.file}`).toBeGreaterThan(20);
      }
    }
  });

  it('keeps the ownership record next to the files that ship', () => {
    const licence = readFileSync(resolve(ASSET_DIR, 'LICENSE'), 'utf8');
    expect(licence).toMatch(/wholly owned/i);
    expect(licence).toMatch(/SKY-11591/);
  });
});
