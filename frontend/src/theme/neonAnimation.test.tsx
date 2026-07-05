// Exact-value tests for M3 — expected strings are the prototype's outputs
// (frameSpinSt 4632, borderAnim 4158–4160, breathe 4161).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { frameSpinStyle, borderAnimation, breatheOverlayStyle } from './neonAnimation';
import FrameRing from './FrameRing';
import BorderOverlay from './BorderOverlay';

describe('frameSpinStyle (verbatim frameSpinSt)', () => {
  it('is a centered 170vmax conic square of --ring', () => {
    const st = frameSpinStyle(null);
    expect(st.width).toBe('170vmax');
    expect(st.height).toBe('170vmax');
    expect(st.marginLeft).toBe('-85vmax');
    expect(st.marginTop).toBe('-85vmax');
    expect(st.background).toBe('conic-gradient(var(--ring,#00f0ff,#9b5fff,#ff4dff,#ff9a3d,#2fe6c8,#3d9bff,#00f0ff))');
  });

  it('defaults (frameAnim off) to no animation', () => {
    expect(frameSpinStyle(null).animation).toBe('none');
  });

  it('cycle spins via lnSpin at frameSpeed', () => {
    expect(frameSpinStyle({ frameAnim: 'cycle' }).animation).toBe('lnSpin 12s linear infinite');
    expect(frameSpinStyle({ frameAnim: 'cycle', frameSpeed: 7.25 }).animation).toBe('lnSpin 7.25s linear infinite');
  });

  it('sparkle hue-shifts via lnHue at frameSpeed', () => {
    expect(frameSpinStyle({ frameAnim: 'sparkle' }).animation).toBe('lnHue 12s linear infinite');
  });
});

describe('borderAnimation (verbatim borderAnim)', () => {
  it('idles on the preset animation with the panel stagger', () => {
    expect(borderAnimation(null, 0)).toBe('lnBreathe 4.6s ease-in-out 0s infinite');
    expect(borderAnimation({ setKey: 'winter' }, 0.8)).toBe('lnShimmer 7s ease-in-out 0.8s infinite');
    expect(borderAnimation({ setKey: 'custom' }, 0)).toBe('lnBreathe 5s ease-in-out 0s infinite');
  });

  it('cycle overrides the idle with lnHue at frameSpeed', () => {
    expect(borderAnimation({ frameAnim: 'cycle' }, 1.6)).toBe('lnHue 12s linear 1.6s infinite');
  });

  it('sparkle overrides with lnFlicker at half speed, floored at .25s', () => {
    expect(borderAnimation({ frameAnim: 'sparkle' }, 2.2)).toBe('lnFlicker 6.00s steps(1,end) 2.2s infinite');
    expect(borderAnimation({ frameAnim: 'sparkle', frameSpeed: 0.25 }, 0)).toBe('lnFlicker 0.25s steps(1,end) 0s infinite');
  });

  it('animGlow off silences the idle but not Cycle/Sparkle (prototype quirk kept)', () => {
    expect(borderAnimation({ animGlow: false }, 0)).toBe('none');
    expect(borderAnimation({ animGlow: false, frameAnim: 'cycle' }, 0)).toBe('lnHue 12s linear 0s infinite');
  });
});

describe('breatheOverlayStyle (verbatim breathe)', () => {
  it('borders and inner-glows from the slot tokens', () => {
    const st = breatheOverlayStyle(null, 6, 2.2);
    expect(st.border).toBe('var(--bw,1px) solid var(--b6)');
    expect(st.boxShadow).toBe('inset 0 0 28px var(--gs6), inset 0 0 4px var(--gs6)');
    expect(st.borderRadius).toBe('inherit');
    expect(st.animation).toBe('lnBreathe 4.6s ease-in-out 2.2s infinite');
  });
});

describe('<FrameRing>', () => {
  it('renders the crisp ring + blurred halo, both spinning layers', () => {
    render(<FrameRing settings={{ frameAnim: 'cycle' }} />);
    expect(screen.getByTestId('ln-frame')).toBeInTheDocument();
    expect(screen.getByTestId('ln-frame-spin')).toHaveStyle({ animation: 'lnSpin 12s linear infinite' });
    expect(screen.getByTestId('ln-frame-spin-halo')).toBeInTheDocument();
  });

  it('is hidden entirely when animGlow is off (prototype sc-if 2668)', () => {
    render(<FrameRing settings={{ animGlow: false }} />);
    expect(screen.queryByTestId('ln-frame')).not.toBeInTheDocument();
  });
});

describe('<BorderOverlay>', () => {
  it('renders an aria-hidden inset overlay for its slot', () => {
    render(<BorderOverlay settings={{ setKey: 'cyber' }} slot={1} delay={0} />);
    const el = screen.getByTestId('ln-border-1');
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el.style.border).toBe('var(--bw,1px) solid var(--b1)');
    expect(el.style.animation).toBe('lnFlicker 3.4s steps(1,end) 0s infinite');
  });
});
