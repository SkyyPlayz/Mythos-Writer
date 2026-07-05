// Beta 3 "Liquid Neon" — per-panel breathing border overlay (M3). One inset
// layer per glass panel, tinted by the panel's slot (prototype brL/brC/brR/
// brRail, renderVals 4961). Rendered even when animGlow is off — the border
// and inner glow stay as a static frame; only the animation is gated.
import { useMemo } from 'react';
import type { LiquidNeonV2Settings } from './liquidNeonEngine';
import { breatheOverlayStyle, type LiquidNeonSlot } from './neonAnimation';

export interface BorderOverlayProps {
  settings?: Partial<LiquidNeonV2Settings> | null;
  /** Panel slot 1–6 (A–F). Prototype: left 1 · center 2 · right 3 · rail 6. */
  slot: LiquidNeonSlot;
  /** Animation stagger in seconds (prototype: 0 / .8 / 1.6 / 2.2). */
  delay: number;
}

export default function BorderOverlay({ settings, slot, delay }: BorderOverlayProps) {
  const style = useMemo(() => breatheOverlayStyle(settings, slot, delay), [settings, slot, delay]);
  return <div className="ln-border-overlay" aria-hidden="true" data-testid={`ln-border-${slot}`} style={style} />;
}
