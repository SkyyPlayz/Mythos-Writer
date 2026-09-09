// Exact-value tests for the Liquid Neon token engine. Expected strings are the
// prototype's own outputs (renderVals HTML 3934–3967) — if these fail, the
// port has drifted from the spec.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import {
  hexA,
  computeLiquidNeonV2Tokens,
  applyLiquidNeonV2Tokens,
  resetLiquidNeonV2Tokens,
  normalizeLiquidNeonV2,
  wallpaperCss,
  exportLiquidNeonPreset,
  parseLiquidNeonPreset,
  vaultDefaultThemePatch,
  matchWallpaperList,
  matchWallpaperIndex,
  stepMatchWallpaper,
  LIQUID_NEON_V2_DEFAULTS,
  type LiquidNeonV2Settings,
} from './liquidNeonEngine';
import { packWallpapers } from './wallpapers';
import { contrastRatio } from '../theme';
import { LIQUID_NEON_PRESETS } from './presets';

const COSMIC = '/assets/cosmic-bg.webp';
const compute = (over: Parameters<typeof normalizeLiquidNeonV2>[0] = null) =>
  computeLiquidNeonV2Tokens(over, COSMIC);

afterEach(() => resetLiquidNeonV2Tokens());

describe('hexA (verbatim prototype 3305–3309)', () => {
  it('formats rgba with 3-decimal clamped alpha', () => {
    expect(hexA('#00f0ff', 0.5)).toBe('rgba(0,240,255,0.500)');
    expect(hexA('#ff9a3d', 1.1)).toBe('rgba(255,154,61,1.000)');
    expect(hexA('#9b5fff', -0.2)).toBe('rgba(155,95,255,0.000)');
  });
});

describe('token computation at prototype defaults (Neon Nebula, intensity 50 → I=2)', () => {
  const t = compute();

  it('raw slot colors', () => {
    expect(t['--n1']).toBe('#00f0ff');
    expect(t['--n2']).toBe('#9b5fff');
    expect(t['--n6']).toBe('#3d9bff');
  });

  it('border alpha .3+.4I saturates at default intensity', () => {
    expect(t['--b1']).toBe('rgba(0,240,255,1.000)');
  });

  it('glow alpha .18+.5I saturates at default intensity', () => {
    expect(t['--g3']).toBe('rgba(255,77,255,1.000)');
  });

  it('soft fill alpha .05+.13I = .31 at default intensity', () => {
    expect(t['--gs1']).toBe('rgba(0,240,255,0.310)');
  });

  it('grad is the 120deg 6-color gradient', () => {
    expect(t['--grad']).toBe('linear-gradient(120deg,#00f0ff,#9b5fff,#ff4dff,#ff9a3d,#2fe6c8,#3d9bff)');
  });

  it('glass 20% → 0.20; glass2 floors at 0.50', () => {
    expect(t['--glass']).toBe('rgba(13,16,28,0.20)');
    expect(t['--glass2']).toBe('rgba(21,26,45,0.50)');
  });

  it('bw/gr/blur/scrim defaults', () => {
    expect(t['--bw']).toBe('1px');
    expect(t['--gr']).toBe('60px');
    expect(t['--blur']).toBe('1px');
    expect(t['--ln-scrim']).toBe('0.1');
  });

  it('classic + match wallpaper uses the cosmic asset, cover-sized', () => {
    expect(t['--wp']).toBe("url('/assets/cosmic-bg.webp')");
    expect(t['--wpsize']).toBe('cover');
  });

  it('text tokens follow txtCfg with split off', () => {
    expect(t['--txH']).toBe('#f0f3fc');
    expect(t['--txNH']).toBe('#f0f3fc');
    expect(t['--txNB']).toBe('#c8d3e7');
  });
});

describe('intensity scale (old 100% == new 50%)', () => {
  it('intensity 25 → I=1 → border .700 / glow .680 / soft .180', () => {
    const t = compute({ intensity: 25 });
    expect(t['--b1']).toBe('rgba(0,240,255,0.700)');
    expect(t['--g1']).toBe('rgba(0,240,255,0.680)');
    expect(t['--gs1']).toBe('rgba(0,240,255,0.180)');
  });

  it('intensity 0 → floors .300/.180/.050', () => {
    const t = compute({ intensity: 0 });
    expect(t['--b1']).toBe('rgba(0,240,255,0.300)');
    expect(t['--g1']).toBe('rgba(0,240,255,0.180)');
    expect(t['--gs1']).toBe('rgba(0,240,255,0.050)');
  });

  it('reduceGlow caps the contribution at intensity 5 (I=.2)', () => {
    const t = compute({ intensity: 50, reduceGlow: true });
    expect(t['--b1']).toBe('rgba(0,240,255,0.380)');
  });
});

describe('presets & wallpaper modes', () => {
  it('winterlight slots flow through raw tokens', () => {
    const t = compute({ setKey: 'winter', slots: [...LIQUID_NEON_PRESETS.winter.c] });
    expect(t['--n1']).toBe('#eaf6ff');
    expect(t['--n2']).toBe('#9fd4ff');
  });

  it("match on a non-classic preset generates the starfield gradient", () => {
    const t = compute({ setKey: 'aurora', slots: [...LIQUID_NEON_PRESETS.aurora.c] });
    expect(t['--wp']).toContain('radial-gradient(1.6px 1.6px at 12% 22%');
    expect(t['--wp']).toContain('linear-gradient(168deg,#0a0d16,#0b0f20 52%,#070911)');
  });

  it("SKY-11589: a stored 'none' (removed option) normalizes to Theme match", () => {
    const s = normalizeLiquidNeonV2({ wp: 'none' as unknown as LiquidNeonV2Settings['wp'] });
    expect(s.wp).toBe('match');
    expect(compute({ wp: 'none' as unknown as LiquidNeonV2Settings['wp'] })['--wp']).toBe("url('/assets/cosmic-bg.webp')");
    expect(parseLiquidNeonPreset(JSON.stringify({ wp: 'none' }))).toBeNull();
  });

  it("'custom' without an upload falls back to the cosmic asset", () => {
    const s = normalizeLiquidNeonV2({ wp: 'custom' });
    expect(wallpaperCss(s, COSMIC)).toBe("url('/assets/cosmic-bg.webp')");
  });

  it('glass2 tracks glassA+.16 inside the clamp band', () => {
    const t = compute({ glassA: 60 });
    expect(t['--glass2']).toBe('rgba(21,26,45,0.76)');
  });
});

// SKY-11589 — Theme match cycles the preset's wallpapers: built-in first, then
// the bundled pack (manifest order); the pick lives in liquidNeonV2.wpPick.
describe('Theme match wallpaper cycle (SKY-11589)', () => {
  const classic = normalizeLiquidNeonV2({ setKey: 'classic' });
  const aurora = normalizeLiquidNeonV2({ setKey: 'aurora', slots: [...LIQUID_NEON_PRESETS.aurora.c] });

  it('index 0 is the built-in wallpaper: cosmic for Neon Nebula, starfield elsewhere', () => {
    expect(matchWallpaperList(classic, COSMIC)[0].css).toBe("url('/assets/cosmic-bg.webp')");
    expect(matchWallpaperList(aurora, COSMIC)[0].css).toContain('radial-gradient(1.6px 1.6px at 12% 22%');
    expect(matchWallpaperList(aurora, COSMIC)[0].url).toBeUndefined();
  });

  it('the pack follows the built-in, in manifest order, for every preset', () => {
    for (const key of Object.keys(LIQUID_NEON_PRESETS) as (keyof typeof LIQUID_NEON_PRESETS)[]) {
      const s = normalizeLiquidNeonV2({ setKey: key, slots: [...LIQUID_NEON_PRESETS[key].c] });
      const list = matchWallpaperList(s, COSMIC);
      const pack = packWallpapers(key);
      expect(pack.length, `${key} ships pack wallpapers`).toBeGreaterThan(0);
      expect(list).toHaveLength(pack.length + 1);
      pack.forEach((e, i) => expect(list[i + 1].css).toBe("url('" + e.url + "')"));
    }
  });

  it('custom palettes cycle nothing (starfield only)', () => {
    const s = normalizeLiquidNeonV2({ setKey: 'custom' });
    expect(matchWallpaperList(s, COSMIC)).toHaveLength(1);
    expect(stepMatchWallpaper(s, 1, 1)).toBeNull();
  });

  it('--wp follows wpPick for the active preset and wraps both ways', () => {
    const list = matchWallpaperList(classic, COSMIC);
    const n = list.length;
    expect(compute({ wpPick: { classic: 1 } })['--wp']).toBe(list[1].css);
    expect(compute({ wpPick: { classic: n } })['--wp']).toBe(list[0].css);
    // Negative stored picks are garbage, dropped by normalize → index 0.
    expect(compute({ wpPick: { classic: -1 } })['--wp']).toBe(list[0].css);
    expect(matchWallpaperIndex({ ...classic, wpPick: { classic: -1 } }, n)).toBe(n - 1);
    // A pick under another preset's key does not move this one.
    expect(compute({ wpPick: { aurora: 2 } })['--wp']).toBe(list[0].css);
  });

  it('stepMatchWallpaper wraps, keeps other presets\' picks, and selects match', () => {
    const n = matchWallpaperList(classic, COSMIC).length;
    const s = { ...classic, wp: 'deep' as const, wpPick: { aurora: 2 } };
    const p1 = stepMatchWallpaper(s, 1, n)!;
    expect(p1).toEqual({ wpPick: { aurora: 2, classic: 1 }, wp: 'match' });
    const back = stepMatchWallpaper({ ...s, ...p1 }, -1, n)!;
    expect(back.wpPick).toEqual({ aurora: 2, classic: 0 });
    const wrapped = stepMatchWallpaper({ ...s, wpPick: { classic: 0 } }, -1, n)!;
    expect(wrapped.wpPick?.classic).toBe(n - 1);
    expect(matchWallpaperIndex({ ...classic, wpPick: { classic: n - 1 } }, n)).toBe(n - 1);
  });

  it('--wppos carries the manifest anchor for pack images and center otherwise', () => {
    const t = compute({ wpPick: { classic: 1 } });
    expect(t['--wppos']).toBe(matchWallpaperList(classic, COSMIC)[1].position);
    expect(compute({ wp: 'deep' })['--wppos']).toBe('center');
  });

  it('normalize drops garbage picks and keeps valid ones', () => {
    const s = normalizeLiquidNeonV2({ wpPick: { classic: 2, aurora: -1, nope: 3, ice: 1.5, winter: 'x' } as unknown as LiquidNeonV2Settings['wpPick'] });
    expect(s.wpPick).toEqual({ classic: 2 });
    expect(normalizeLiquidNeonV2({ wpPick: [1, 2] as unknown as LiquidNeonV2Settings['wpPick'] }).wpPick).toEqual({});
  });

  it('export omits wpPick (the pack may differ between installs)', () => {
    const json = exportLiquidNeonPreset({ ...classic, wpPick: { classic: 2 } });
    expect(JSON.parse(json)).not.toHaveProperty('wpPick');
  });
});

describe('notes text split', () => {
  it('split=true routes nHead/nBody to the notes tokens', () => {
    const t = compute({ txtCfg: { ...LIQUID_NEON_V2_DEFAULTS.txtCfg, split: true, nHead: '#ffffff', nBody: '#aabbcc' } });
    expect(t['--txNH']).toBe('#ffffff');
    expect(t['--txNB']).toBe('#aabbcc');
    expect(t['--txH']).toBe('#f0f3fc');
  });
});

describe('apply/reset', () => {
  it('applies to the element and reset removes every applied property', () => {
    const el = document.createElement('div');
    applyLiquidNeonV2Tokens(null, COSMIC, el);
    expect(el.style.getPropertyValue('--n1')).toBe('#00f0ff');
    resetLiquidNeonV2Tokens(el);
    expect(el.style.getPropertyValue('--n1')).toBe('');
  });
});

// SKY-10914: --glass-fill/--blur-panel used to be owned exclusively by the v1
// engine (theme.ts applyLiquidNeonTokens), so the Appearance tab's v2 Glass
// opacity/Backdrop blur sliders — which only ever wrote --glass/--blur — had
// zero visible effect on Settings (or any other --glass-fill/--blur-panel
// consumer). v2 must also bridge those legacy panel tokens so it's the live
// source of truth, matching the "v2 layers on after v1" boot-time ordering.
describe('panel-glass token bridge (SKY-10914)', () => {
  it('derives --glass-fill from glassA using the same color family as --glass', () => {
    const el = document.createElement('div');
    const tokens = applyLiquidNeonV2Tokens({ glassA: 42 }, COSMIC, el);
    expect(el.style.getPropertyValue('--glass-fill')).toBe('rgba(13,16,28,0.420)');
    expect(tokens['--glass']).toBe('rgba(13,16,28,0.42)');
  });

  it('derives --blur-panel directly from the blur px value', () => {
    const el = document.createElement('div');
    applyLiquidNeonV2Tokens({ blur: 17 }, COSMIC, el);
    expect(el.style.getPropertyValue('--blur-panel')).toBe('17px');
  });

  it('sets an opaque --glass-fill-fallback regardless of glassA', () => {
    const el = document.createElement('div');
    applyLiquidNeonV2Tokens({ glassA: 0 }, COSMIC, el);
    expect(el.style.getPropertyValue('--glass-fill-fallback')).toBe('rgb(13,16,28)');
  });

  it('updates live on every re-apply, same as the v2-native tokens', () => {
    const el = document.createElement('div');
    applyLiquidNeonV2Tokens({ glassA: 10, blur: 2 }, COSMIC, el);
    expect(el.style.getPropertyValue('--glass-fill')).toBe('rgba(13,16,28,0.100)');
    applyLiquidNeonV2Tokens({ glassA: 90, blur: 30 }, COSMIC, el);
    expect(el.style.getPropertyValue('--glass-fill')).toBe('rgba(13,16,28,0.900)');
    expect(el.style.getPropertyValue('--blur-panel')).toBe('30px');
  });

  it('reset clears the bridged panel tokens along with the native v2 tokens', () => {
    const el = document.createElement('div');
    applyLiquidNeonV2Tokens({ glassA: 55 }, COSMIC, el);
    expect(el.style.getPropertyValue('--glass-fill')).not.toBe('');
    resetLiquidNeonV2Tokens(el);
    expect(el.style.getPropertyValue('--glass-fill')).toBe('');
    expect(el.style.getPropertyValue('--blur-panel')).toBe('');
    expect(el.style.getPropertyValue('--glass-fill-fallback')).toBe('');
  });
});

// SKY-11133 gave Settings and popups their own tier so they stay legible at
// the owner's preferred LOW global glass — but derived it as glassA/blur ×
// 1.25, which at the shipped defaults (20 / 1px) is a 25% fill behind a
// 1.25px blur: every dialog moved onto the tier became thinner than the
// frozen literal it replaced (SKY-11480 OT-1). The owner mockup never lets
// the sliders touch floating chrome — every dialog and popover is the same
// rgba(15,19,33,.97) / blur(24px) at any slider position — so the tier is a
// fixed recipe owned by tokens.css and the engine must leave it alone.
describe('overlay tier is a fixed recipe, not a slider derivative (SKY-11491)', () => {
  const TOKENS_CSS = readFileSync(resolve(__dirname, '../tokens.css'), 'utf8');
  const block = (re: RegExp) => re.exec(TOKENS_CSS)?.[1] ?? '';

  it('tokens.css pins the mockup recipe: rgba(15,19,33,.97) over blur(24px)', () => {
    const root = block(/:root\s*\{([^}]*)\}/);
    expect(root).toMatch(/--glass-fill-overlay:\s*rgba\(15,\s*19,\s*33,\s*0?\.97\);/);
    expect(root).toMatch(/--blur-panel-overlay:\s*24px;/);
  });

  it.each([
    [0, 0],
    [20, 1],
    [96, 40],
  ])('the engine never writes the tier — glassA %i / blur %ipx', (glassA, blur) => {
    const el = document.createElement('div');
    const tokens = applyLiquidNeonV2Tokens({ glassA, blur }, COSMIC, el);
    expect(el.style.getPropertyValue('--glass-fill-overlay')).toBe('');
    expect(el.style.getPropertyValue('--blur-panel-overlay')).toBe('');
    expect(tokens).not.toHaveProperty('--glass-fill-overlay');
    expect(tokens).not.toHaveProperty('--blur-panel-overlay');
  });

  it('the panel tier still tracks the sliders — the two tiers are independent', () => {
    const el = document.createElement('div');
    applyLiquidNeonV2Tokens({ glassA: 10, blur: 4 }, COSMIC, el);
    expect(el.style.getPropertyValue('--glass-fill')).toBe('rgba(13,16,28,0.100)');
    expect(el.style.getPropertyValue('--blur-panel')).toBe('4px');
  });

  it('the accessibility paths still flatten the recipe', () => {
    // App high-contrast toggle (K8) — declared on every element via :where(*).
    const k8 = block(/:root\[data-contrast="high"\][^{]*\{([^}]*)\}/);
    expect(k8).toMatch(/--glass-fill-overlay:\s*#15191f;/);
    expect(k8).toMatch(/--blur-panel-overlay:\s*0px;/);
    // OS reduce-transparency — now honoured, since nothing inline outranks it.
    const reduced = block(/@media \(prefers-reduced-transparency: reduce\)\s*\{\s*:root\s*\{([^}]*)\}/);
    expect(reduced).toMatch(/--glass-fill-overlay:\s*var\(--glass-fill-fallback\);/);
    expect(reduced).toMatch(/--blur-panel-overlay:\s*0px;/);
    // No backdrop-filter at all — opaque fill.
    const noBackdrop = block(/@supports not \(\(backdrop-filter: blur\(1px\)\)[^{]*\{\s*:root\s*\{([^}]*)\}/);
    expect(noBackdrop).toMatch(/--glass-fill-overlay:\s*var\(--glass-fill-fallback\);/);
  });
});

// SKY-11491 (SKY-11480 SC-1): the hairline set the mockup stamps beside
// --bw/--gr/--b1/--g1 (dc.html 7193–7194) — half glow-width floored at .5px,
// half glow radius, and the slot-1 border/glow at half the *formula's* alpha.
// Until now the engine emitted none of the four: four stylesheets read them
// and silently painted their literal fallbacks, and Scene Crafter hand-rolled
// a color-mix stand-in that halved the clamped --b1 instead.
describe('hairline tokens --bwh / --grh / --bh / --glowH (SKY-11491)', () => {
  it('defaults: .5px width, 30px radius, .550 border alpha, .590 glow alpha', () => {
    const t = compute();
    expect(t['--bwh']).toBe('0.5px');
    expect(t['--grh']).toBe('30px');
    expect(t['--bh']).toBe('rgba(0,240,255,0.550)');
    expect(t['--glowH']).toBe('0 0 30px -7px rgba(0,240,255,0.590)');
  });

  it('width is half of glowW, floored at .5px', () => {
    expect(compute({ glowW: 4 })['--bwh']).toBe('2px');
    expect(compute({ glowW: 1 })['--bwh']).toBe('0.5px');
    expect(compute({ glowW: 0 })['--bwh']).toBe('0.5px'); // `glowW || 1`, same as --bw
  });

  it('radius is half of glowR, rounded, and shapes both --grh and the glow', () => {
    const t = compute({ glowR: 27 });
    expect(t['--grh']).toBe('14px');
    expect(t['--glowH']).toMatch(/^0 0 14px -7px /);
    expect(compute({ glowR: 0 })['--grh']).toBe('13px'); // `glowR || 26`, same as --gr
  });

  it('alphas halve the formula, not the clamped --b1/--g1', () => {
    // intensity 100 → I=4: --b1 saturates at 1.000 but --bh keeps climbing.
    const hi = compute({ intensity: 100 });
    expect(hi['--b1']).toBe('rgba(0,240,255,1.000)');
    expect(hi['--bh']).toBe('rgba(0,240,255,0.950)');
    expect(hi['--glowH']).toBe('0 0 30px -7px rgba(0,240,255,1.000)');
    const lo = compute({ intensity: 0 });
    expect(lo['--bh']).toBe('rgba(0,240,255,0.150)');
    expect(lo['--glowH']).toBe('0 0 30px -7px rgba(0,240,255,0.090)');
  });

  it('follow slot 1 and reduceGlow exactly like the full-strength tokens', () => {
    const slots = [...LIQUID_NEON_PRESETS.cyber.c] as typeof LIQUID_NEON_V2_DEFAULTS.slots;
    const t = compute({ slots, reduceGlow: true }); // I = min(50, 5) / 25 = .2
    expect(t['--bh']).toBe(hexA(slots[0], 0.19));
    expect(t['--glowH']).toBe('0 0 30px -7px ' + hexA(slots[0], 0.14));
  });

  it('are applied to the element and cleared by reset like every other token', () => {
    const el = document.createElement('div');
    applyLiquidNeonV2Tokens(null, COSMIC, el);
    expect(el.style.getPropertyValue('--bwh')).toBe('0.5px');
    expect(el.style.getPropertyValue('--glowH')).toBe('0 0 30px -7px rgba(0,240,255,0.590)');
    resetLiquidNeonV2Tokens(el);
    expect(el.style.getPropertyValue('--bwh')).toBe('');
    expect(el.style.getPropertyValue('--glowH')).toBe('');
  });
});

// ═══ Beta 4 M1 ═══════════════════════════════════════════════════════════════

describe('preset import/export (§3; prototype 7191–7192)', () => {
  it('export → import round-trips slots, setKey, wp, ambMode, frameAnim (§14.9 #9)', () => {
    const json = exportLiquidNeonPreset({
      setKey: 'cyber',
      slots: [...LIQUID_NEON_PRESETS.cyber.c],
      wp: 'deep',
      ambMode: 'snow',
      frameAnim: 'cycle',
      intensity: 90, // NOT part of the preset payload
    });
    const parsed = parseLiquidNeonPreset(json)!;
    expect(parsed).toEqual({
      slots: [...LIQUID_NEON_PRESETS.cyber.c],
      setKey: 'cyber',
      wp: 'deep',
      ambMode: 'snow',
      frameAnim: 'cycle',
    });
  });

  it('export contains exactly the five preset keys', () => {
    const obj = JSON.parse(exportLiquidNeonPreset(null));
    expect(Object.keys(obj).sort()).toEqual(['ambMode', 'frameAnim', 'setKey', 'slots', 'wp']);
  });

  it('invalid JSON → null (caller toasts, no crash)', () => {
    expect(parseLiquidNeonPreset('not json {')).toBeNull();
    expect(parseLiquidNeonPreset('')).toBeNull();
    expect(parseLiquidNeonPreset('42')).toBeNull();
    expect(parseLiquidNeonPreset('[1,2,3]')).toBeNull();
    expect(parseLiquidNeonPreset('null')).toBeNull();
  });

  it('valid JSON with none of the five keys → null', () => {
    expect(parseLiquidNeonPreset('{"foo":"bar"}')).toBeNull();
  });

  it('garbage-typed fields are dropped, valid ones survive', () => {
    const parsed = parseLiquidNeonPreset(JSON.stringify({
      slots: 'nope',
      setKey: 'not-a-preset',
      wp: 'deep',
      ambMode: 12,
      frameAnim: 'sparkle',
    }))!;
    expect(parsed).toEqual({ wp: 'deep', frameAnim: 'sparkle' });
  });

  it('slots must be six #rrggbb strings', () => {
    expect(parseLiquidNeonPreset(JSON.stringify({ slots: ['#fff', '#000', '#111', '#222', '#333'] }))).toBeNull();
    expect(parseLiquidNeonPreset(JSON.stringify({ slots: ['red', '#000000', '#111111', '#222222', '#333333', '#444444'] }))).toBeNull();
  });
});

describe('per-vault default theme (§3; prototype cardH 7111)', () => {
  it('returns setKey + slots + wp:match for the stored preset', () => {
    const res = vaultDefaultThemePatch(
      { '/vaults/A/Story Vault': 'ice' },
      { setKey: 'classic', wp: 'deep', intensity: 80 },
      '/vaults/A/Story Vault',
    )!;
    expect(res.presetName).toBe('Ice Mono');
    expect(res.liquidNeonV2.setKey).toBe('ice');
    expect(res.liquidNeonV2.slots).toEqual([...LIQUID_NEON_PRESETS.ice.c]);
    expect(res.liquidNeonV2.wp).toBe('match');
    // The rest of the settings survive the switch.
    expect(res.liquidNeonV2.intensity).toBe(80);
  });

  it('null when the vault has no stored default or the key is unknown', () => {
    expect(vaultDefaultThemePatch(undefined, null, '/x')).toBeNull();
    expect(vaultDefaultThemePatch({}, null, '/x')).toBeNull();
    expect(vaultDefaultThemePatch({ '/x': 'not-a-preset' }, null, '/x')).toBeNull();
    expect(vaultDefaultThemePatch({ '/y': 'ice' }, null, '/x')).toBeNull();
  });
});

describe('Interface card engine hooks (Beta 4 M1)', () => {
  it('density stamps data-ln-density (comfortable = absent) and reset clears it', () => {
    const el = document.createElement('div');
    applyLiquidNeonV2Tokens({ density: 'compact' }, COSMIC, el);
    expect(el.getAttribute('data-ln-density')).toBe('compact');
    applyLiquidNeonV2Tokens({ density: 'cozy' }, COSMIC, el);
    expect(el.getAttribute('data-ln-density')).toBe('cozy');
    applyLiquidNeonV2Tokens({ density: 'comfortable' }, COSMIC, el);
    expect(el.hasAttribute('data-ln-density')).toBe(false);
    applyLiquidNeonV2Tokens({ density: 'compact' }, COSMIC, el);
    resetLiquidNeonV2Tokens(el);
    expect(el.hasAttribute('data-ln-density')).toBe(false);
  });

  it("ambMode 'off' stamps data-ln-amb so the mote layers hide live", () => {
    const el = document.createElement('div');
    applyLiquidNeonV2Tokens({ ambMode: 'off' }, COSMIC, el);
    expect(el.getAttribute('data-ln-amb')).toBe('off');
    applyLiquidNeonV2Tokens({ ambMode: 'match' }, COSMIC, el);
    expect(el.hasAttribute('data-ln-amb')).toBe(false);
    applyLiquidNeonV2Tokens({ ambMode: 'off' }, COSMIC, el);
    resetLiquidNeonV2Tokens(el);
    expect(el.hasAttribute('data-ln-amb')).toBe(false);
  });

  it('reduceMotion toggles the ln-reduce-motion kill switch class (§14.9 #9)', () => {
    const el = document.createElement('div');
    applyLiquidNeonV2Tokens({ reduceMotion: true }, COSMIC, el);
    expect(el.classList.contains('ln-reduce-motion')).toBe(true);
    applyLiquidNeonV2Tokens({ reduceMotion: false }, COSMIC, el);
    expect(el.classList.contains('ln-reduce-motion')).toBe(false);
    applyLiquidNeonV2Tokens({ reduceMotion: true }, COSMIC, el);
    resetLiquidNeonV2Tokens(el);
    expect(el.classList.contains('ln-reduce-motion')).toBe(false);
  });

  it('default uiTextCol emits no text tokens (v1 clamped values keep owning them)', () => {
    const t = compute();
    expect(t['--text-body']).toBeUndefined();
    expect(t['--btn-text']).toBeUndefined();
  });

  it('CF-6: a custom app text color is hard-clamped to ≥ 4.5:1 against the glass base', () => {
    const t = compute({ uiTextCol: '#222222' }); // fails badly on dark glass
    expect(t['--text-body']).toBeDefined();
    expect(contrastRatio(t['--text-body'], '#0d101c')).toBeGreaterThanOrEqual(4.5);
    expect(t['--text-secondary']).toBe(t['--text-body']);
  });

  it('a passing custom app text color is kept verbatim', () => {
    const t = compute({ uiTextCol: '#ffffff' });
    expect(t['--text-body']).toBe('#ffffff');
  });

  it('custom button text emits --btn-text + the opt-in attribute; default clears both', () => {
    const el = document.createElement('div');
    applyLiquidNeonV2Tokens({ uiBtnCol: '#0b0d17' }, COSMIC, el);
    expect(el.style.getPropertyValue('--btn-text')).toBe('#0b0d17');
    expect(el.hasAttribute('data-ln-btn-text')).toBe(true);
    applyLiquidNeonV2Tokens({}, COSMIC, el);
    expect(el.style.getPropertyValue('--btn-text')).toBe('');
    expect(el.hasAttribute('data-ln-btn-text')).toBe(false);
  });
});
