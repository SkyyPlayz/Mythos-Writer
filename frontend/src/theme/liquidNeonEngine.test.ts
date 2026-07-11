// Exact-value tests for the Liquid Neon token engine. Expected strings are the
// prototype's own outputs (renderVals HTML 3934–3967) — if these fail, the
// port has drifted from the spec.
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
  LIQUID_NEON_V2_DEFAULTS,
} from './liquidNeonEngine';
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

describe('token computation at prototype defaults (Neon Classic, intensity 50 → I=2)', () => {
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

  it("'none' is a plain dark backdrop (B4-2: transparency removed)", () => {
    const t = compute({ wp: 'none' });
    expect(t['--wp']).toBe('linear-gradient(#07090f,#07090f)');
    expect(t['--wpsize']).toBe('cover');
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
