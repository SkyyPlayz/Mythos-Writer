// SKY-11589 — the wallpaper pack is data (manifest + files). These tests keep
// the two in step: every manifest line has a file, every bundled file is in the
// manifest, and every preset has something to cycle.
import { describe, it, expect } from 'vitest';
import manifest from '../assets/wallpapers/manifest.json';
import { bundledWallpaperFiles, packThemeKeys, packWallpapers, wallpaperFileUrl } from './wallpapers';
import { LIQUID_NEON_PRESETS } from './presets';

const themes = (manifest as { themes: Record<string, { file: string; position?: string }[]> }).themes;

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
