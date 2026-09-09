/**
 * SKY-11590 — guard on the shipped Liquid Neon wallpaper set.
 *
 * `scripts/wallpapers/wallpapers.manifest.json` is the curation record: which
 * PNG original becomes which shipped WebP, in what order, at what crop anchor.
 * `scripts/wallpapers/build_wallpapers.py` turns it into the files under
 * `frontend/src/assets/wallpapers/`.
 *
 * Nothing in the app build re-runs that script, so the two can drift: someone
 * reorders the manifest and forgets to rebuild, or drops a hand-edited PNG-sized
 * WebP into the assets folder. Either way the installer silently grows or the
 * picker points at a file that is not there.
 *
 * This checks the cheap, durable half of that contract — the file set matches
 * the manifest and the byte budget holds. It deliberately does not decode the
 * images; `python3 scripts/wallpapers/build_wallpapers.py --check` is the
 * byte-exact verification, and it needs Pillow, which CI does not install.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const WALLPAPER_DIR = resolve(REPO_ROOT, 'frontend/src/assets/wallpapers');
const MANIFEST = resolve(REPO_ROOT, 'scripts/wallpapers/wallpapers.manifest.json');

/**
 * Per-image ceiling. The set averages ~50 KB, matching the ~44 KB discipline of
 * the original `cosmic-bg.webp`. A handful of detail-dense frames (dense
 * starfields, gold line work) sit above that because the build clamps quality at
 * 70 rather than smearing them — `bg-royal-4.webp` is the largest at ~92 KB.
 */
const MAX_BYTES_PER_IMAGE = 100 * 1024;

/** Whole-set ceiling: this is the installer delta the wallpapers cost. */
const MAX_TOTAL_BYTES = 2.5 * 1024 * 1024;

interface Manifest {
  sets: Record<string, { images: { src: string; anchor: number; note: string }[] }>;
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;

const expectedFiles = Object.entries(manifest.sets).flatMap(([setKey, spec]) =>
  spec.images.map((_, i) => `bg-${setKey}-${i + 1}.webp`),
);

describe('shipped Liquid Neon wallpapers', () => {
  const actualFiles = readdirSync(WALLPAPER_DIR)
    .filter((f) => f.endsWith('.webp'))
    .sort();

  it('ships exactly the images the manifest curates', () => {
    expect(actualFiles).toEqual([...expectedFiles].sort());
  });

  it('covers all ten Liquid Neon presets', () => {
    expect(Object.keys(manifest.sets).sort()).toEqual([
      'aurora', 'classic', 'cyber', 'ember', 'ice',
      'noir', 'royal', 'sunset', 'verdant', 'winter',
    ]);
  });

  it.each(expectedFiles)('%s stays inside the per-image budget', (file) => {
    const bytes = statSync(resolve(WALLPAPER_DIR, file)).size;
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(MAX_BYTES_PER_IMAGE);
  });

  it('stays inside the whole-set installer budget', () => {
    const total = actualFiles.reduce(
      (sum, f) => sum + statSync(resolve(WALLPAPER_DIR, f)).size,
      0,
    );
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  });

  it('records a deliberate crop anchor and a reason for every image', () => {
    for (const [setKey, spec] of Object.entries(manifest.sets)) {
      for (const [i, image] of spec.images.entries()) {
        const where = `${setKey}[${i}]`;
        expect(image.anchor, where).toBeGreaterThanOrEqual(0);
        expect(image.anchor, where).toBeLessThanOrEqual(1);
        expect(image.note.length, where).toBeGreaterThan(20);
      }
    }
  });
});
