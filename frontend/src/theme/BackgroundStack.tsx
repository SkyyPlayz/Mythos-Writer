// Beta 3 "Liquid Neon" — background stack (M2): wallpaper (drifting), the
// per-preset two-layer animated ambience, wallpaper scrim, and vignette.
// Exact port of prototype HTML 45–54 + mkAmb (4649–4669).
import { useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { hexA, normalizeLiquidNeonV2, type LiquidNeonV2Settings } from './liquidNeonEngine';
import { LIQUID_NEON_PRESETS, type AmbienceColor, type LiquidNeonPresetKey } from './presets';
import './liquidNeon.css';

function resolveAmbColor(color: AmbienceColor, slots: LiquidNeonV2Settings['slots']): string {
  return typeof color === 'string' ? color : hexA(slots[color.slot], color.a);
}

/**
 * Style for ambience layer `i` (0 or 1) — v2 prototype `mkAmb` (HTML 6800):
 * two repeating radial-gradient dot fields at different scales. W0.5
 * (PERFORMANCE §3): the layer is oversized (`inset: -72vh 0`) and scrolled by
 * the compositor-only lnSnowT/lnRiseT translate3d keyframes with
 * `will-change: transform` — never by background-position.
 */
export function ambienceLayerStyle(settings: Partial<LiquidNeonV2Settings> | null | undefined, i: 0 | 1): CSSProperties | null {
  const S = normalizeLiquidNeonV2(settings);
  const preset = LIQUID_NEON_PRESETS[S.setKey as LiquidNeonPresetKey];
  let ac = preset?.ambience;
  if (!ac) return null; // `custom` palettes have no ambience (prototype 4662–4667)
  // Beta 4 M1 — Background animation card (prototype ambMode 6793–6798):
  // `off` removes the layers; Snowfall/Rising force the field's direction.
  const ambMode = S.ambMode || 'match';
  if (ambMode === 'off') return null;
  if (ambMode === 'snow') ac = { ...ac, anim: 'lnSnow', dur: [22, 34] };
  else if (ambMode === 'rise') ac = { ...ac, anim: 'lnRise', dur: [26, 40] };
  // Particle color override (prototype 6799) — else theme-matched.
  const color = S.ambColor
    ? hexA(S.ambColor, i ? .45 : .65)
    : resolveAmbColor(ac.colors[i], S.slots);
  return {
    inset: '-72vh 0 -72vh 0',
    willChange: 'transform',
    backgroundImage:
      'radial-gradient(' + (ac.dot[0] * (i ? .7 : 1)).toFixed(1) + 'px ' + (ac.dot[1] * (i ? .7 : 1)).toFixed(1) + 'px at 25% 30%,' + color + ',transparent 100%),' +
      'radial-gradient(' + (ac.dot[0] * (i ? .55 : .8)).toFixed(1) + 'px ' + (ac.dot[1] * (i ? .55 : .8)).toFixed(1) + 'px at 65% 72%,' + color + ',transparent 100%)',
    backgroundSize: (i ? '150px 150px' : '230px 230px') + ',' + (i ? '110px 110px' : '190px 190px'),
    // Drift speed % (prototype 6803): 100 = preset speed; 200 = twice as fast.
    animation: ac.anim + 'T ' + (ac.dur[i] * 100 / (S.ambSpeed || 100)).toFixed(1) + 's linear infinite',
    opacity: ac.op[i],
  };
}

export interface BackgroundStackProps {
  settings?: Partial<LiquidNeonV2Settings> | null;
}

/** SKY-8566: no pointer/keyboard activity for this long freezes the ambient
 *  loops (see the effect below). Reuses the "5s of no recent input" recency
 *  window already established by useWritingScheduler (SKY-8224) and
 *  useArchiveScheduler's SAVE_DEBOUNCE_MS elsewhere in this codebase. */
const IDLE_PAUSE_MS = 5_000;

export default function BackgroundStack({ settings }: BackgroundStackProps) {
  const amb1 = useMemo(() => ambienceLayerStyle(settings, 0), [settings]);
  const amb2 = useMemo(() => ambienceLayerStyle(settings, 1), [settings]);

  // Audit P4 + SKY-8566: freeze the always-on Liquid Neon loops (wallpaper
  // drift, ambience, border breathe) while the window is hidden/minimized OR
  // the user hasn't touched the pointer/keyboard for IDLE_PAUSE_MS. The class
  // rides on <html> so the CSS rule in liquidNeon.css also reaches the
  // BorderOverlay layers, which render elsewhere in the shell; BackgroundStack
  // is the stack's owner and is always mounted, making it the natural home
  // for the listener.
  //
  // SKY-8566 root cause: these three layers animate continuously regardless
  // of `prefers-reduced-motion` actually taking effect (Electron's
  // `--force-prefers-reduced-motion` does not flip the media query in this
  // build — confirmed via `matchMedia` + `document.getAnimations()` against
  // the packaged app), which keeps the compositor ticking a full-viewport
  // `backdrop-filter` blur pass at 60fps indefinitely — the PERFORMANCE.md
  // §2 "backdrop-filter is a per-frame tax" driver behind the idle-CPU miss.
  // Pausing on genuine inactivity (this) stops that tick without touching the
  // OS-level reduced-motion path at all.
  useEffect(() => {
    let idle = false;
    let idleTimer: number | null = null;

    const syncClass = () => {
      document.documentElement.classList.toggle(
        'ln-anim-paused',
        document.visibilityState === 'hidden' || idle,
      );
    };

    const armIdleTimer = () => {
      if (idleTimer != null) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        idle = true;
        syncClass();
      }, IDLE_PAUSE_MS);
    };

    const onActivity = () => {
      if (idle) {
        idle = false;
        syncClass();
      }
      armIdleTimer();
    };

    const onVisibility = () => syncClass();

    const activityEvents = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const;
    syncClass();
    armIdleTimer();
    document.addEventListener('visibilitychange', onVisibility);
    activityEvents.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }));

    return () => {
      if (idleTimer != null) window.clearTimeout(idleTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      activityEvents.forEach((evt) => window.removeEventListener(evt, onActivity));
      document.documentElement.classList.remove('ln-anim-paused');
    };
  }, []);
  return (
    <div className="ln-bg-stack" aria-hidden="true" data-testid="ln-bg-stack">
      <div className="ln-bg-wallpaper" data-testid="ln-bg-wallpaper" />
      {amb1 && <div className="ln-bg-ambience" data-testid="ln-bg-ambience-1" style={amb1} />}
      {amb2 && <div className="ln-bg-ambience" data-testid="ln-bg-ambience-2" style={amb2} />}
      <div className="ln-bg-scrim" data-testid="ln-bg-scrim" />
      <div className="ln-bg-vignette" />
    </div>
  );
}
