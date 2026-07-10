// Exact-value tests for M3 — expected strings are the prototype's outputs
// (borderAnim 4158–4160, breathe 4161). B4-1: the window frame ring
// (frameSpinSt / <FrameRing>) is deleted; panel border overlays remain.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { borderAnimation, breatheOverlayStyle } from './neonAnimation';
import BorderOverlay from './BorderOverlay';

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


describe('<BorderOverlay>', () => {
  it('renders an aria-hidden inset overlay for its slot', () => {
    render(<BorderOverlay settings={{ setKey: 'cyber' }} slot={1} delay={0} />);
    const el = screen.getByTestId('ln-border-1');
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el.style.border).toBe('var(--bw,1px) solid var(--b1)');
    expect(el.style.animation).toBe('lnFlicker 3.4s steps(1,end) 0s infinite');
  });
});
