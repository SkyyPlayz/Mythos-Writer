// Beta 3 M10 — Manuscript page modes (Neon / No glow / Scroll / Off).
//
// Exact port of the prototype's sheetBoxSt computation and scroll-parchment
// rune overlays (design-handoff/prototype/"Mythos Writer - Liquid Neon.dc.html":
// sheetBoxSt 4607–4617, runeSt 4623, runeVSt 4818, rune rows 855–859).
// The mode + parchment settings come from M4's Appearance page and live in
// settings.liquidNeonV2 (pageCfg / scrollTint / scrollOp).

import type { CSSProperties } from 'react';
import {
  hexA,
  normalizeLiquidNeonV2,
  type LiquidNeonPageCfg,
  type LiquidNeonV2Settings,
} from '../theme/liquidNeonEngine';

export interface PageModeChrome {
  mode: LiquidNeonPageCfg['mode'];
  /** Scroll mode: glowing archaic edge symbols toggle (prototype pc.sym). */
  sym: boolean;
  /** Inline style for the page sheet — background, border, glow, padding. */
  sheetStyle: CSSProperties;
}

export interface PageModeChromeOpts {
  /**
   * Include the prototype's per-mode sheet padding. The manuscript sheet wants
   * it; the scene editor page keeps its own --story-page-pad-* padding system.
   */
  includePadding?: boolean;
}

/** Prototype sheetBoxSt (4607–4617), keyed by pageCfg.mode. */
export function pageModeChrome(
  settings: Partial<LiquidNeonV2Settings> | null | undefined,
  opts?: PageModeChromeOpts,
): PageModeChrome {
  const S = normalizeLiquidNeonV2(settings);
  const pc = S.pageCfg;
  const includePadding = opts?.includePadding !== false;
  const pcBg = hexA(pc.bg, pc.op / 100);
  // W0.5 (PERFORMANCE §2): `none` creates no backdrop root; only an explicit
  // page blur > 0 pays for a live backdrop-filter (the one allowed surface).
  const blurCss = pc.blur > 0 ? 'blur(' + pc.blur + 'px)' : 'none';
  let sheetStyle: CSSProperties;
  if (pc.mode === 'off') {
    sheetStyle = {
      position: 'relative',
      background: 'transparent',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
      border: 'none',
      borderRadius: '0',
      boxShadow: 'none',
      ...(includePadding ? { padding: '10px 8px 80px' } : {}),
    };
  } else if (pc.mode === 'scroll') {
    const st2 = S.scrollTint || '#2b2213';
    const so = (S.scrollOp != null ? S.scrollOp : 92) / 100;
    sheetStyle = {
      position: 'relative',
      background:
        'radial-gradient(60% 40% at 20% 12%, rgba(0,0,0,.28), transparent 60%),radial-gradient(45% 30% at 82% 70%, rgba(0,0,0,.24), transparent 65%),repeating-linear-gradient(97deg, transparent 0 110px, rgba(0,0,0,.14) 110px 111px, transparent 111px 240px),repeating-linear-gradient(3deg, transparent 0 160px, rgba(0,0,0,.1) 160px 161px, transparent 161px 300px),linear-gradient(173deg,' +
        hexA(st2, so) + ',' + hexA(st2, Math.max(0, so - 0.18)) + ' 55%,' + hexA('#0f0a02', so) + ')',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
      border: 'var(--bw,1px) solid rgba(214,183,121,.45)',
      borderRadius: '10px',
      boxShadow: '0 18px 60px rgba(2,4,10,.55), inset 0 0 80px rgba(0,0,0,.5), inset 0 0 12px rgba(90,64,20,.35)',
      ...(includePadding ? { padding: '76px 96px 96px' } : {}),
    };
  } else if (pc.mode === 'custom') {
    // M7 (§5.1): user-uploaded texture image, cover-fit. Falls back to the
    // 'No glow' flat background until an image is chosen.
    sheetStyle = {
      position: 'relative',
      background: pc.textureUrl ? "url('" + pc.textureUrl + "') center / cover no-repeat" : pcBg,
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
      border: '1px solid rgba(255,255,255,.08)',
      borderRadius: '12px',
      boxShadow: '0 18px 60px rgba(2,4,10,.55),inset 0 1px 0 rgba(255,255,255,.04)',
      ...(includePadding ? { padding: '64px 84px 90px' } : {}),
    };
  } else if (pc.mode === 'neon') {
    sheetStyle = {
      position: 'relative',
      background: pcBg,
      backdropFilter: blurCss,
      WebkitBackdropFilter: blurCss,
      border: 'var(--bw,1px) solid var(--b2,rgba(155,95,255,.5))',
      borderRadius: '12px',
      boxShadow: '0 0 var(--gr,26px) -7px var(--g2,rgba(155,95,255,.4)), 0 18px 60px rgba(2,4,10,.55)',
      ...(includePadding ? { padding: '64px 84px 90px' } : {}),
    };
  } else {
    // 'default' — the "No glow" option.
    sheetStyle = {
      position: 'relative',
      background: pcBg,
      backdropFilter: blurCss,
      WebkitBackdropFilter: blurCss,
      border: '1px solid rgba(255,255,255,.06)',
      borderRadius: '12px',
      boxShadow: '0 18px 60px rgba(2,4,10,.55),inset 0 1px 0 rgba(255,255,255,.04)',
      ...(includePadding ? { padding: '64px 84px 90px' } : {}),
    };
  }
  return { mode: pc.mode, sym: !!pc.sym, sheetStyle };
}

// ── Scroll-parchment rune overlays (prototype 855–859, runeSt 4623 / runeVSt 4818) ──

const RUNE_GLOW = '0 0 12px var(--g4,rgba(255,154,61,.5)),0 0 4px var(--n4,#ff9a3d)';

/** Horizontal rune band base style (prototype runeSt 4623). */
export function runeRowStyle(sym: boolean): CSSProperties {
  return {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    letterSpacing: '.9em',
    fontSize: '13px',
    color: 'rgba(214,183,121,' + (sym ? '.85' : '.4') + ')',
    userSelect: 'none',
    pointerEvents: 'none',
    fontFamily: 'serif',
    ...(sym ? { textShadow: RUNE_GLOW } : {}),
  };
}

/** Vertical rune column base style (prototype runeVSt 4818). */
export function runeColStyle(sym: boolean): CSSProperties {
  return {
    position: 'absolute',
    top: '80px',
    bottom: '80px',
    width: '20px',
    textAlign: 'center',
    fontSize: '15px',
    lineHeight: 2.1,
    overflow: 'hidden',
    userSelect: 'none',
    pointerEvents: 'none',
    fontFamily: 'serif',
    whiteSpace: 'pre-line',
    color: 'rgba(214,183,121,' + (sym ? '.85' : '.38') + ')',
    ...(sym ? { textShadow: RUNE_GLOW } : {}),
  };
}

/** Rune glyph sequences, verbatim from the prototype (855–859). */
export const RUNE_ROWS = [
  'ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚷ ᚹ ᚺ ᚾ ᛁ ᛃ ᛄ ᛅ',
  'ᛆ ᛇ ᛈ ᛉ ᛋ ᛏ ᛒ ᛖ ᛗ ᛚ ᛜ ᛞ ᛟ ᛠ ᛡ ᛢ',
  'ᛈ ᛇ ᛉ ᛊ ᛏ ᛒ ᛖ ᛗ ᛚ ᛜ ᛞ ᛟ ᚠ ᚱ',
] as const;

export const RUNE_COL_LEFT = ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚷ', 'ᚹ', 'ᚺ', 'ᚾ', 'ᛁ', 'ᛃ', 'ᛈ', 'ᛇ'].join('\n');
export const RUNE_COL_RIGHT = ['ᛉ', 'ᛊ', 'ᛏ', 'ᛒ', 'ᛖ', 'ᛗ', 'ᛚ', 'ᛜ', 'ᛞ', 'ᛟ', 'ᚠ', 'ᚢ', 'ᚦ', 'ᚨ'].join('\n');

/**
 * The four page-edge rune bands + two vertical columns rendered inside a
 * position:relative page while pageCfg.mode === 'scroll'.
 */
export function PageModeRunes({ sym }: { sym: boolean }) {
  return (
    <div aria-hidden="true" data-testid="lnpm-runes">
      <div style={{ ...runeRowStyle(sym), top: '20px', fontSize: '19px' }}>{RUNE_ROWS[0]}</div>
      <div style={{ ...runeRowStyle(sym), top: '48px', fontSize: '12px', opacity: 0.65 }}>{RUNE_ROWS[1]}</div>
      <div style={{ ...runeRowStyle(sym), bottom: '24px', fontSize: '19px' }}>{RUNE_ROWS[2]}</div>
      <div style={{ ...runeColStyle(sym), left: '26px' }}>{RUNE_COL_LEFT}</div>
      <div style={{ ...runeColStyle(sym), right: '26px' }}>{RUNE_COL_RIGHT}</div>
    </div>
  );
}
