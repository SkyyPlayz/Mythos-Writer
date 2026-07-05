// Beta 3 "Liquid Neon" M4 — the prototype's color "wheel": a conic-gradient
// swatch wrapping an invisible native color input (template 1674–1677).
import type { CSSProperties } from 'react';

export interface ColorWheelProps {
  value: string;
  onChange: (hex: string) => void;
  title?: string;
  /** Overrides the wheel gradient (the Scroll tint wheel uses parchment hues). */
  gradient?: string;
  'data-testid'?: string;
}

const WHEEL_GRADIENT = 'conic-gradient(#ff004d,#ffd319,#39ff8c,#00e5ff,#7a5cff,#ff2d95,#ff004d)';

const wheelStyle = (gradient: string): CSSProperties => ({
  width: 23,
  height: 23,
  borderRadius: 8,
  cursor: 'pointer',
  background: gradient,
  border: '2px solid rgba(255,255,255,.3)',
  position: 'relative',
  overflow: 'hidden',
  flex: 'none',
  transition: 'transform .12s ease',
  display: 'inline-block',
});

export default function ColorWheel({ value, onChange, title, gradient, 'data-testid': testId }: ColorWheelProps) {
  return (
    <label title={title ?? 'Custom color — pick anything'} style={wheelStyle(gradient ?? WHEEL_GRADIENT)}>
      <input
        type="color"
        value={value}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
      />
    </label>
  );
}
