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
 * Style for ambience layer `i` (0 or 1) — verbatim `mkAmb` (prototype 4663–4669):
 * two repeating radial-gradient dot fields at different scales, animated by
 * lnSnow (falling) or lnRise (rising).
 */
export function ambienceLayerStyle(settings: Partial<LiquidNeonV2Settings> | null | undefined, i: 0 | 1): CSSProperties | null {
  const S = normalizeLiquidNeonV2(settings);
  const preset = LIQUID_NEON_PRESETS[S.setKey as LiquidNeonPresetKey];
  const ac = preset?.ambience;
  if (!ac) return null; // `custom` palettes have no ambience (prototype 4662–4667)
  const color = resolveAmbColor(ac.colors[i], S.slots);
  return {
    backgroundImage:
      'radial-gradient(' + (ac.dot[0] * (i ? .7 : 1)).toFixed(1) + 'px ' + (ac.dot[1] * (i ? .7 : 1)).toFixed(1) + 'px at 25% 30%,' + color + ',transparent 100%),' +
      'radial-gradient(' + (ac.dot[0] * (i ? .55 : .8)).toFixed(1) + 'px ' + (ac.dot[1] * (i ? .55 : .8)).toFixed(1) + 'px at 65% 72%,' + color + ',transparent 100%)',
    backgroundSize: (i ? '150px 150px' : '230px 230px') + ',' + (i ? '110px 110px' : '190px 190px'),
    animation: ac.anim + ' ' + ac.dur[i] + 's linear infinite',
    opacity: ac.op[i],
  };
}

export interface BackgroundStackProps {
  settings?: Partial<LiquidNeonV2Settings> | null;
}

export default function BackgroundStack({ settings }: BackgroundStackProps) {
  const amb1 = useMemo(() => ambienceLayerStyle(settings, 0), [settings]);
  const amb2 = useMemo(() => ambienceLayerStyle(settings, 1), [settings]);

  // Audit P4: freeze the always-on Liquid Neon loops (wallpaper drift,
  // ambience, frame ring, border breathe) while the window is hidden or
  // minimized. The class rides on <html> so the CSS rule in liquidNeon.css
  // also reaches the FrameRing and BorderOverlay layers, which render
  // elsewhere in the shell; BackgroundStack is the stack's owner and is
  // always mounted, making it the natural home for the listener.
  useEffect(() => {
    const sync = () => {
      document.documentElement.classList.toggle(
        'ln-anim-paused',
        document.visibilityState === 'hidden',
      );
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
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
