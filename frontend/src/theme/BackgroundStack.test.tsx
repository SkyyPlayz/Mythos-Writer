// Exact-value tests for the M2 background stack — expected strings are the
// prototype's mkAmb outputs (HTML 4649–4669).
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BackgroundStack, { ambienceLayerStyle } from './BackgroundStack';
import type { LiquidNeonV2Settings } from './liquidNeonEngine';
import { LIQUID_NEON_PRESETS } from './presets';

describe('ambienceLayerStyle (verbatim mkAmb)', () => {
  it('Neon Classic layer 0: white dots, lnRiseT 46s, opacity .4', () => {
    const st = ambienceLayerStyle({ setKey: 'classic', slots: [...LIQUID_NEON_PRESETS.classic.c] }, 0)!;
    expect(st.backgroundImage).toBe(
      'radial-gradient(1.8px 1.8px at 25% 30%,rgba(255,255,255,.75),transparent 100%),radial-gradient(1.4px 1.4px at 65% 72%,rgba(255,255,255,.75),transparent 100%)',
    );
    expect(st.backgroundSize).toBe('230px 230px,190px 190px');
    expect(st.animation).toBe('lnRiseT 46.0s linear infinite'); // toFixed(1): drift-speed scaling (prototype 6803)
    expect(st.opacity).toBe(0.4);
    // W0.5: compositor-only scrolling — oversized layer moved by transform.
    expect(st.inset).toBe('-72vh 0 -72vh 0');
    expect(st.willChange).toBe('transform');
  });

  it('Neon Classic layer 1: slot-B tinted dots at .7 scale, lnRiseT 70s', () => {
    const st = ambienceLayerStyle({ setKey: 'classic', slots: [...LIQUID_NEON_PRESETS.classic.c] }, 1)!;
    // hexA('#9b5fff', .5) — layer color derives from the LIVE palette.
    expect(st.backgroundImage).toContain('rgba(155,95,255,0.500)');
    expect(st.backgroundImage).toContain('radial-gradient(1.3px 1.3px at 25% 30%');
    expect(st.backgroundSize).toBe('150px 150px,110px 110px');
    expect(st.animation).toBe('lnRiseT 70.0s linear infinite');
    expect(st.opacity).toBe(0.28);
  });

  it('Cyberpunk rains: lnSnowT with tall 1.4×15 streaks', () => {
    const st = ambienceLayerStyle({ setKey: 'cyber', slots: [...LIQUID_NEON_PRESETS.cyber.c] }, 0)!;
    expect(st.animation).toBe('lnSnowT 7.0s linear infinite');
    expect(st.backgroundImage).toContain('1.4px 15.0px at 25% 30%');
  });

  it('custom palettes have no ambience', () => {
    expect(ambienceLayerStyle({ setKey: 'custom' }, 0)).toBeNull();
  });
});

describe('Beta 4 M1 — Background animation card (prototype ambMode 6793–6803)', () => {
  const classic: Partial<LiquidNeonV2Settings> = { setKey: 'classic', slots: [...LIQUID_NEON_PRESETS.classic.c] };

  it('ambMode off removes the layers', () => {
    expect(ambienceLayerStyle({ ...classic, ambMode: 'off' }, 0)).toBeNull();
    expect(ambienceLayerStyle({ ...classic, ambMode: 'off' }, 1)).toBeNull();
  });

  it('Snowfall forces lnSnowT at the 22/34 preset-independent durations', () => {
    expect(ambienceLayerStyle({ ...classic, ambMode: 'snow' }, 0)!.animation).toBe('lnSnowT 22.0s linear infinite');
    expect(ambienceLayerStyle({ ...classic, ambMode: 'snow' }, 1)!.animation).toBe('lnSnowT 34.0s linear infinite');
  });

  it('Rising forces lnRiseT at 26/40', () => {
    expect(ambienceLayerStyle({ setKey: 'winter', slots: [...LIQUID_NEON_PRESETS.winter.c], ambMode: 'rise' }, 0)!.animation)
      .toBe('lnRiseT 26.0s linear infinite');
  });

  it('drift speed scales duration: 200% halves it, 50% doubles it', () => {
    expect(ambienceLayerStyle({ ...classic, ambSpeed: 200 }, 0)!.animation).toBe('lnRiseT 23.0s linear infinite');
    expect(ambienceLayerStyle({ ...classic, ambSpeed: 50 }, 0)!.animation).toBe('lnRiseT 92.0s linear infinite');
  });

  it('particle color override tints both layers at .65/.45 alpha (prototype 6799)', () => {
    const l0 = ambienceLayerStyle({ ...classic, ambColor: '#9fd4ff' }, 0)!;
    const l1 = ambienceLayerStyle({ ...classic, ambColor: '#9fd4ff' }, 1)!;
    expect(l0.backgroundImage).toContain('rgba(159,212,255,0.650)');
    expect(l1.backgroundImage).toContain('rgba(159,212,255,0.450)');
  });

  it('off wins even for presets with ambience in <BackgroundStack>', () => {
    render(<BackgroundStack settings={{ setKey: 'winter', slots: [...LIQUID_NEON_PRESETS.winter.c], ambMode: 'off' }} />);
    expect(screen.queryByTestId('ln-bg-ambience-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ln-bg-ambience-2')).not.toBeInTheDocument();
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
