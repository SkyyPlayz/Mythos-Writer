// W0.5 — pre-blurred wallpaper (PERFORMANCE §2). jsdom has no real canvas,
// so these tests cover the URL parsing, the skip/clear paths, and the
// graceful fallback to the sharp wallpaper when rendering is unavailable.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  wallpaperImageUrl,
  schedulePreBlurredWallpaper,
  resetPreBlurredWallpaperForTests,
  PRE_BLUR_MAX_DIM,
} from './preBlurWallpaper';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => resetPreBlurredWallpaperForTests());

describe('wallpaperImageUrl', () => {
  it('extracts quoted and unquoted url() targets', () => {
    expect(wallpaperImageUrl("url('/assets/cosmic-bg.webp')")).toBe('/assets/cosmic-bg.webp');
    expect(wallpaperImageUrl('url("data:image/webp;base64,AAA")')).toBe('data:image/webp;base64,AAA');
    expect(wallpaperImageUrl('url(blob:file:///abc)')).toBe('blob:file:///abc');
  });

  it('returns null for gradients and the plain dark backdrop', () => {
    expect(wallpaperImageUrl('linear-gradient(#07090f,#07090f)')).toBeNull();
    expect(wallpaperImageUrl('radial-gradient(90% 70% at 15% 10%,rgba(0,0,0,.4),transparent)')).toBeNull();
    expect(wallpaperImageUrl('')).toBeNull();
  });

  it('caps the render size at the quality factor', () => {
    expect(PRE_BLUR_MAX_DIM).toBeLessThanOrEqual(1920);
  });
});

describe('schedulePreBlurredWallpaper', () => {
  it('clears --wp-blur for gradient wallpapers (fallback to sharp var(--wp))', async () => {
    const el = document.createElement('div');
    el.style.setProperty('--wp-blur', 'url("blob:old")');
    schedulePreBlurredWallpaper('linear-gradient(#07090f,#07090f)', 12, el);
    await flush();
    expect(el.style.getPropertyValue('--wp-blur')).toBe('');
  });

  it('clears --wp-blur when blur is 0 even for image wallpapers', async () => {
    const el = document.createElement('div');
    el.style.setProperty('--wp-blur', 'url("blob:old")');
    schedulePreBlurredWallpaper("url('/a.webp')", 0, el);
    await flush();
    expect(el.style.getPropertyValue('--wp-blur')).toBe('');
  });

  it('falls back to sharp when canvas rendering is unavailable (jsdom)', async () => {
    const el = document.createElement('div');
    schedulePreBlurredWallpaper("url('/a.webp')", 8, el);
    // jsdom: Image never fires onload and canvas has no 2d context — the
    // async generate resolves null and must leave the fallback chain intact.
    await flush();
    expect(el.style.getPropertyValue('--wp-blur')).toBe('');
  });

  it('is idempotent for an unchanged (wallpaper, blur) pair', async () => {
    const el = document.createElement('div');
    schedulePreBlurredWallpaper('linear-gradient(#000,#000)', 4, el);
    await flush();
    // Manually poke the property; an identical re-schedule must not touch it.
    el.style.setProperty('--wp-blur', 'url("blob:kept")');
    schedulePreBlurredWallpaper('linear-gradient(#000,#000)', 4, el);
    await flush();
    expect(el.style.getPropertyValue('--wp-blur')).toBe('url("blob:kept")');
  });
});
