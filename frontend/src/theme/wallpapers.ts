// SKY-11589 — bundled "Theme match" wallpaper pack.
//
// Every preset ships several wallpapers. The set is data, not code: the
// manifest (assets/wallpapers/manifest.json) lists, per preset key, the files
// (in assets/wallpapers/pack/) that follow the preset's built-in wallpaper, and
// Vite's glob import turns each file into a hashed asset URL at build time.
// Replacing the pack is a file drop + manifest edit
// (scripts/wallpapers/build-pack.py regenerates both).
//
// Only `pack/` is globbed: sibling files in assets/wallpapers/ (other asset
// sets, licences, docs) are neither bundled nor counted as pack orphans.
//
// Index 0 of a preset's cycle is always the built-in wallpaper the theme had
// before the pack existed (Neon Nebula: cosmic-bg.webp; every other preset: the
// generated starfield gradient) — the pack adds to it, it never replaces it.
import manifest from '../assets/wallpapers/manifest.json';
import type { LiquidNeonSetKey } from './presets';

export interface WallpaperEntry {
  /** Resolved asset URL (Vite-emitted). */
  url: string;
  /** CSS background-position for the cover crop. */
  position: string;
}

interface ManifestEntry {
  file: string;
  position?: string;
  width?: number;
  height?: number;
}

interface WallpaperManifest {
  position?: string;
  themes: Record<string, ManifestEntry[]>;
}

const DEFAULT_POSITION = 'center';

// `?url` + eager: the module holds only the URL strings; the browser fetches an
// image the first time its CSS url() is painted, so unselected wallpapers cost
// nothing at runtime.
const FILE_URLS = import.meta.glob('../assets/wallpapers/pack/*.{webp,avif,jpg,png}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** Asset URL for a manifest file name, or undefined when the file is missing. */
export function wallpaperFileUrl(file: string): string | undefined {
  return FILE_URLS['../assets/wallpapers/pack/' + file];
}

/** Every file the glob found, by bare file name (test guard for manifest drift). */
export function bundledWallpaperFiles(): string[] {
  return Object.keys(FILE_URLS).map((p) => p.slice(p.lastIndexOf('/') + 1)).sort();
}

const PACK: Readonly<Record<string, readonly WallpaperEntry[]>> = (() => {
  const m = manifest as WallpaperManifest;
  const out: Record<string, WallpaperEntry[]> = {};
  for (const [key, entries] of Object.entries(m.themes ?? {})) {
    const list: WallpaperEntry[] = [];
    for (const e of entries) {
      const url = wallpaperFileUrl(e.file);
      // A manifest line without a file on disk is skipped rather than
      // producing a broken url(): the cycle just gets one entry shorter.
      if (url) list.push({ url, position: e.position || m.position || DEFAULT_POSITION });
    }
    out[key] = list;
  }
  return out;
})();

/** The pack's wallpapers for a preset, in manifest order (empty for `custom`). */
export function packWallpapers(setKey: LiquidNeonSetKey | string): readonly WallpaperEntry[] {
  return PACK[setKey] ?? [];
}

/** Preset keys that have at least one pack wallpaper. */
export function packThemeKeys(): string[] {
  return Object.keys(PACK).filter((k) => PACK[k].length > 0);
}
