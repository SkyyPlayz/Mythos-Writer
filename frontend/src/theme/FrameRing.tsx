// Beta 3 "Liquid Neon" — animated neon window frame (M3). Exact port of
// prototype HTML 2667–2677: two full-viewport conic layers masked to the
// window edges — a crisp --bw ring plus a 7px blurred halo at half opacity —
// spun by lnSpin (Cycle) or hue-shifted by lnHue (Sparkle). Hidden entirely
// when animGlow is off (the "static, laptop-friendly" toggle).
import { useMemo } from 'react';
import { normalizeLiquidNeonV2, type LiquidNeonV2Settings } from './liquidNeonEngine';
import { frameSpinStyle } from './neonAnimation';
import './liquidNeon.css';

export interface FrameRingProps {
  settings?: Partial<LiquidNeonV2Settings> | null;
}

export default function FrameRing({ settings }: FrameRingProps) {
  const S = useMemo(() => normalizeLiquidNeonV2(settings), [settings]);
  const spin = useMemo(() => frameSpinStyle(settings), [settings]);
  if (S.animGlow === false) return null;
  return (
    <div className="ln-frame" aria-hidden="true" data-testid="ln-frame">
      <div className="ln-frame-mask">
        <div data-testid="ln-frame-spin" style={spin} />
      </div>
      <div className="ln-frame-mask ln-frame-mask--halo">
        <div data-testid="ln-frame-spin-halo" style={spin} />
      </div>
    </div>
  );
}
