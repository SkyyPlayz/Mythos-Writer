// Exact-value tests for the M2 background stack — expected strings are the
// prototype's mkAmb outputs (HTML 4649–4669).
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BackgroundStack, { ambienceLayerStyle } from './BackgroundStack';
import { LIQUID_NEON_PRESETS } from './presets';

describe('ambienceLayerStyle (verbatim mkAmb)', () => {
  it('Neon Classic layer 0: white dots, lnRise 46s, opacity .4', () => {
    const st = ambienceLayerStyle({ setKey: 'classic', slots: [...LIQUID_NEON_PRESETS.classic.c] }, 0)!;
    expect(st.backgroundImage).toBe(
      'radial-gradient(1.8px 1.8px at 25% 30%,rgba(255,255,255,.75),transparent 100%),radial-gradient(1.4px 1.4px at 65% 72%,rgba(255,255,255,.75),transparent 100%)',
    );
    expect(st.backgroundSize).toBe('230px 230px,190px 190px');
    expect(st.animation).toBe('lnRise 46s linear infinite');
    expect(st.opacity).toBe(0.4);
  });

  it('Neon Classic layer 1: slot-B tinted dots at .7 scale, lnRise 70s', () => {
    const st = ambienceLayerStyle({ setKey: 'classic', slots: [...LIQUID_NEON_PRESETS.classic.c] }, 1)!;
    // hexA('#9b5fff', .5) — layer color derives from the LIVE palette.
    expect(st.backgroundImage).toContain('rgba(155,95,255,0.500)');
    expect(st.backgroundImage).toContain('radial-gradient(1.3px 1.3px at 25% 30%');
    expect(st.backgroundSize).toBe('150px 150px,110px 110px');
    expect(st.animation).toBe('lnRise 70s linear infinite');
    expect(st.opacity).toBe(0.28);
  });

  it('Cyberpunk rains: lnSnow with tall 1.4×15 streaks', () => {
    const st = ambienceLayerStyle({ setKey: 'cyber', slots: [...LIQUID_NEON_PRESETS.cyber.c] }, 0)!;
    expect(st.animation).toBe('lnSnow 7s linear infinite');
    expect(st.backgroundImage).toContain('1.4px 15.0px at 25% 30%');
  });

  it('custom palettes have no ambience', () => {
    expect(ambienceLayerStyle({ setKey: 'custom' }, 0)).toBeNull();
  });
});

describe('<BackgroundStack>', () => {
  it('renders wallpaper, two ambience layers, scrim, and vignette for a preset', () => {
    render(<BackgroundStack settings={{ setKey: 'winter', slots: [...LIQUID_NEON_PRESETS.winter.c] }} />);
    expect(screen.getByTestId('ln-bg-wallpaper')).toBeInTheDocument();
    expect(screen.getByTestId('ln-bg-ambience-1')).toBeInTheDocument();
    expect(screen.getByTestId('ln-bg-ambience-2')).toBeInTheDocument();
    expect(screen.getByTestId('ln-bg-scrim')).toBeInTheDocument();
  });

  it('omits ambience for custom palettes', () => {
    render(<BackgroundStack settings={{ setKey: 'custom' }} />);
    expect(screen.queryByTestId('ln-bg-ambience-1')).not.toBeInTheDocument();
  });

  it('is aria-hidden decoration', () => {
    render(<BackgroundStack settings={null} />);
    expect(screen.getByTestId('ln-bg-stack')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('hidden-window animation pause (audit P4)', () => {
  const setVisibility = (value: DocumentVisibilityState) => {
    Object.defineProperty(document, 'visibilityState', { value, configurable: true });
  };

  afterEach(() => {
    // Restore the jsdom prototype getter ('visible') for other tests.
    delete (document as unknown as Record<string, unknown>).visibilityState;
    document.documentElement.classList.remove('ln-anim-paused');
  });

  it('toggles ln-anim-paused on <html> with document visibility', () => {
    render(<BackgroundStack settings={null} />);
    // Visible on mount: no class, so nothing changes visually.
    expect(document.documentElement.classList.contains('ln-anim-paused')).toBe(false);

    setVisibility('hidden');
    fireEvent(document, new Event('visibilitychange'));
    expect(document.documentElement.classList.contains('ln-anim-paused')).toBe(true);

    setVisibility('visible');
    fireEvent(document, new Event('visibilitychange'));
    expect(document.documentElement.classList.contains('ln-anim-paused')).toBe(false);
  });

  it('removes the class and listener on unmount', () => {
    const { unmount } = render(<BackgroundStack settings={null} />);
    setVisibility('hidden');
    fireEvent(document, new Event('visibilitychange'));
    expect(document.documentElement.classList.contains('ln-anim-paused')).toBe(true);

    unmount();
    expect(document.documentElement.classList.contains('ln-anim-paused')).toBe(false);

    // Listener is gone: further events no longer re-add the class.
    fireEvent(document, new Event('visibilitychange'));
    expect(document.documentElement.classList.contains('ln-anim-paused')).toBe(false);
  });
});
