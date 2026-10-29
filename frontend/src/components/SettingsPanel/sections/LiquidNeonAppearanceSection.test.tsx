// M4 — Appearance page controls bind to liquidNeonV2, apply live, and follow
// the prototype's behaviors (preset pick resets wp to match, swatch pick
// flips to custom, split toggle seeds notes colors, page modes gate config).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import LiquidNeonAppearanceSection from './LiquidNeonAppearanceSection';
import { LIQUID_NEON_PRESETS } from '../../../theme/presets';
import { applyLiquidNeonV2Tokens, matchWallpaperList, matchWallpaperIndex, normalizeLiquidNeonV2, resetLiquidNeonV2Tokens, type LiquidNeonV2Settings } from '../../../theme/liquidNeonEngine';
import { configureAxe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import type { AxeMatchers } from 'vitest-axe/matchers';

// vitest-axe@0.1.0's legacy matcher typing — same registration as accessibility.test.tsx.
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  interface Assertion<T = any> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
expect.extend(axeMatchers);
// colour-contrast needs computed styles jsdom doesn't have.
const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

async function setup(liquidNeonV2: Partial<LiquidNeonV2Settings> | undefined = undefined) {
  const onChange = vi.fn();
  const setSavedOk = vi.fn();
  await act(async () => {
    render(<LiquidNeonAppearanceSection liquidNeonV2={liquidNeonV2} onChange={onChange} setSavedOk={setSavedOk} />);
  });
  return { onChange, setSavedOk };
}

afterEach(() => {
  resetLiquidNeonV2Tokens();
  vi.unstubAllGlobals();
  // showLnToast appends directly to <body>, outside the render container.
  document.querySelectorAll('[data-testid="ln-toast"]').forEach((n) => n.remove());
});

function stubClipboard(over: Partial<{ writeText: (t: string) => Promise<void>; readText: () => Promise<string> }> = {}) {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const readText = vi.fn().mockResolvedValue('');
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText, readText, ...over },
    writable: true,
    configurable: true,
  });
  return { writeText, readText };
}

describe('LiquidNeonAppearanceSection', () => {
  it('renders all ten preset cards and marks the active one', async () => {
    await setup({ setKey: 'cyber' });
    for (const k of Object.keys(LIQUID_NEON_PRESETS)) {
      expect(screen.getByTestId(`lnas-preset-${k}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('lnas-preset-cyber').style.border).toContain('rgba(255, 45, 149, 0.7)');
  });

  it('picking a preset applies its slots, wp match, and live tokens', async () => {
    const { onChange } = await setup({ setKey: 'classic', wp: 'deep' });
    fireEvent.click(screen.getByTestId('lnas-preset-winter'));
    const next = onChange.mock.calls[0][0] as LiquidNeonV2Settings;
    expect(next.setKey).toBe('winter');
    expect(next.slots).toEqual([...LIQUID_NEON_PRESETS.winter.c]);
    expect(next.wp).toBe('match');
    // live apply hit the document root with Winterlight's slot A
    expect(document.documentElement.style.getPropertyValue('--n1')).toBe('#eaf6ff');
  });

  it('picking a swatch recolors the slot and flips to the custom set', async () => {
    const { onChange } = await setup();
    fireEvent.click(screen.getByTestId('lnas-slot0-swatch-ff2d95'));
    const next = onChange.mock.calls[0][0] as LiquidNeonV2Settings;
    expect(next.slots[0]).toBe('#ff2d95');
    expect(next.setKey).toBe('custom');
  });

  it('intensity slider patches the value', async () => {
    const { onChange, setSavedOk } = await setup();
    fireEvent.change(screen.getByTestId('lnas-intensity'), { target: { value: '75' } });
    expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).intensity).toBe(75);
    expect(setSavedOk).toHaveBeenCalledWith(false);
  });

  it('speed slider is hidden while frame animation is Off', async () => {
    await setup();
    expect(screen.queryByTestId('lnas-framespeed')).not.toBeInTheDocument();
  });

  it('cycle mode reveals the speed slider and speed quantizes to .25s', async () => {
    const { onChange } = await setup({ frameAnim: 'cycle' });
    const slider = screen.getByTestId('lnas-framespeed');
    expect((slider as HTMLInputElement).value).toBe('48'); // 12s * 4
    fireEvent.change(slider, { target: { value: '29' } });
    expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).frameSpeed).toBe(7.25);
  });

  // M28 (§13): the Text colors + Manuscript page card tests moved to
  // EditorManuscriptSection.test.tsx alongside the cards themselves.

  it('wallpaper card pick patches wp; no custom card without customWp', async () => {
    const { onChange } = await setup();
    expect(screen.queryByTestId('lnas-wp-custom')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('lnas-wp-aurora'));
    expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).wp).toBe('aurora');
  });

  // SKY-11589 — owner directive: `No background` is gone; Theme match carries
  // arrows that cycle the preset's bundled wallpapers (mockup 9.9, dc.html 2657).
  it('SKY-11589: no "No background" card; Theme match shows arrows and a count', async () => {
    await setup();
    expect(screen.queryByTestId('lnas-wp-none')).not.toBeInTheDocument();
    expect(screen.queryByText('No background')).not.toBeInTheDocument();
    const defaults = normalizeLiquidNeonV2(undefined);
    const n = matchWallpaperList(defaults, '').length;
    expect(n).toBeGreaterThan(1);
    // F2#18/H3: fresh default picks classic starfield, appended as the LAST
    // cycle entry (after cosmic + the whole pack), so the count pill reads N/N.
    const idx = matchWallpaperIndex(defaults, n) + 1;
    expect(screen.getByTestId('lnas-wp-match-count')).toHaveTextContent(`${idx}/${n}`);
    expect(screen.getByTestId('lnas-wp-match')).toHaveAttribute('aria-label', `Wallpaper: Theme match, ${idx} of ${n}`);
    expect(screen.getByLabelText('Next wallpaper for Neon Nebula')).toBeInTheDocument();
    expect(screen.getByLabelText('Previous wallpaper for Neon Nebula')).toBeInTheDocument();
  });

  // SKY-11676 (SKY-11592 interaction spec) — deltas from the raw mockup:
  // 24x24 hit target (not 19x19), theme-named accessible name (not the
  // generic "theme wallpaper"), and a 10px-minimum count pill.
  it('SKY-11676: arrows name the active theme, use a 24x24 hit target, and a readable count pill', async () => {
    await setup({ setKey: 'cyber' });
    const next = screen.getByLabelText('Next wallpaper for Cyberpunk');
    const prev = screen.getByLabelText('Previous wallpaper for Cyberpunk');
    expect(next).toBeInTheDocument();
    expect(prev).toBeInTheDocument();
    expect(next).toHaveStyle({ width: '24px', height: '24px' });
    expect(prev).toHaveStyle({ width: '24px', height: '24px' });
    expect(screen.getByTestId('lnas-wp-match-count')).toHaveStyle({ fontSize: '10px' });
  });

  it('SKY-11589: arrows step wpPick for the active preset, select match, and repaint --wp', async () => {
    // Start at cosmic (index 0) with no wpPick so the first Next lands on the
    // first pack image (H3: classic starfield moved to the LAST cycle entry).
    const { onChange } = await setup({ setKey: 'classic', wp: 'deep', wpPick: {} });
    const list = matchWallpaperList(normalizeLiquidNeonV2({ setKey: 'classic', wpPick: {} }), '');
    fireEvent.click(screen.getByTestId('lnas-wp-match-next'));
    const next = onChange.mock.calls[0][0] as LiquidNeonV2Settings;
    expect(next.wp).toBe('match');
    expect(next.wpPick).toEqual({ classic: 1 });
    // Index 1 is now the first bundled pack image (has a file url).
    expect(list[1].url).toBeDefined();
    expect(document.documentElement.style.getPropertyValue('--wp')).toContain("url('");
    expect(onChange).toHaveBeenCalledTimes(1);

    // Previous from index 0 wraps to the last entry (controlled: re-render with the pick).
    fireEvent.click(screen.getByTestId('lnas-wp-match-prev'));
    expect((onChange.mock.calls[1][0] as LiquidNeonV2Settings).wpPick).toEqual({ classic: list.length - 1 });
  });

  it('SKY-11589: Left/Right keys on the Theme match tile cycle; Enter still selects', async () => {
    const { onChange } = await setup({ setKey: 'classic', wp: 'deep' });
    const tile = screen.getByTestId('lnas-wp-match');
    fireEvent.keyDown(tile, { key: 'ArrowRight' });
    expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).wpPick).toEqual({ classic: 1 });
    fireEvent.keyDown(tile, { key: 'Enter' });
    const sel = onChange.mock.calls[1][0] as LiquidNeonV2Settings;
    expect(sel.wp).toBe('match');
    expect(sel.wpPick).toEqual({});
  });

  it('SKY-11589: a custom palette has nothing to cycle — no arrows on Theme match', async () => {
    await setup({ setKey: 'custom' });
    expect(screen.queryByTestId('lnas-wp-match-next')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lnas-wp-match-count')).not.toBeInTheDocument();
    expect(screen.getByTestId('lnas-wp-match')).toHaveAttribute('aria-label', 'Wallpaper: Theme match');
  });

  it('SKY-11589: the Neon Nebula preset card carries the renamed label', async () => {
    await setup();
    expect(screen.getByTestId('lnas-preset-classic')).toHaveTextContent('Neon Nebula');
    expect(screen.queryByText('Neon Classic')).not.toBeInTheDocument();
  });

  it('#1774: reset restores Accent breathe on', async () => {
    const { onChange } = await setup({ accentBreathe: false });
    fireEvent.click(screen.getByTestId('lnas-reset'));
    expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).accentBreathe).toBe(true);
  });

  it('reset restores the Neon Nebula defaults', async () => {
    const { onChange } = await setup({ setKey: 'ember', intensity: 90, wp: 'deep' });
    fireEvent.click(screen.getByTestId('lnas-reset'));
    const next = onChange.mock.calls[0][0] as LiquidNeonV2Settings;
    expect(next.setKey).toBe('classic');
    expect(next.intensity).toBe(50);
    expect(next.wp).toBe('match');
    expect(next.slots).toEqual([...LIQUID_NEON_PRESETS.classic.c]);
  });

  describe('keyboard accessibility (SKY-6012)', () => {
    it('preset cards, swatches, wallpaper cards, and reset are focusable buttons', async () => {
      await setup();
      for (const testId of ['lnas-preset-classic', 'lnas-slot0-swatch-ff2d95', 'lnas-wp-aurora', 'lnas-reset', 'lnas-wp-upload']) {
        const el = screen.getByTestId(testId);
        expect(el).toHaveAttribute('role', 'button');
        expect(el).toHaveAttribute('tabIndex', '0');
      }
    });

    it('Enter activates a preset card the same as a click', async () => {
      const { onChange } = await setup({ setKey: 'classic', wp: 'deep' });
      fireEvent.keyDown(screen.getByTestId('lnas-preset-winter'), { key: 'Enter' });
      const next = onChange.mock.calls[0][0] as LiquidNeonV2Settings;
      expect(next.setKey).toBe('winter');
      expect(next.wp).toBe('match');
    });

    it('Space activates a color swatch the same as a click', async () => {
      const { onChange } = await setup();
      fireEvent.keyDown(screen.getByTestId('lnas-slot0-swatch-ff2d95'), { key: ' ' });
      const next = onChange.mock.calls[0][0] as LiquidNeonV2Settings;
      expect(next.slots[0]).toBe('#ff2d95');
      expect(next.setKey).toBe('custom');
    });

    it('Enter activates the reset control', async () => {
      const { onChange } = await setup({ setKey: 'ember', intensity: 90 });
      fireEvent.keyDown(screen.getByTestId('lnas-reset'), { key: 'Enter' });
      expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).setKey).toBe('classic');
    });

    it('NeonToggle switches (reduce glow) are focusable and activate on Space', async () => {
      const { onChange } = await setup();
      const toggle = screen.getByTestId('lnas-reduceglow');
      expect(toggle).toHaveAttribute('role', 'switch');
      expect(toggle).toHaveAttribute('tabIndex', '0');
      fireEvent.keyDown(toggle, { key: ' ' });
      expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).reduceGlow).toBe(true);
    });

    it('NeonSeg segment options are focusable buttons activated by Enter', async () => {
      const { onChange } = await setup({ frameAnim: 'off' });
      const cycleOption = screen.getByTestId('lnas-frame-cycle');
      expect(cycleOption).toHaveAttribute('role', 'button');
      expect(cycleOption).toHaveAttribute('tabIndex', '0');
      fireEvent.keyDown(cycleOption, { key: 'Enter' });
      expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).frameAnim).toBe('cycle');
    });
  });
});

// ═══ Beta 4 M1 ═══════════════════════════════════════════════════════════════

describe('Beta 4 M1 — Appearance card order (§3)', () => {
  it('renders exactly the eight spec cards in §3 order (M28 moved the manuscript cards to the Editor page; #1774 adds Motion)', async () => {
    await setup();
    const titles = Array.from(document.querySelectorAll('.lnas-card > div:first-child'))
      .map((el) => el.textContent);
    expect(titles).toEqual([
      'Color theme',
      'Neon border colors',
      'Glow & glass',
      'Background',
      'Background animation',
      'Neon animation',
      'Motion',
      'Interface',
    ]);
  });
});

describe('Beta 4 M1 — preset export/import UI', () => {
  const VALID = JSON.stringify({
    slots: [...LIQUID_NEON_PRESETS.ember.c], setKey: 'ember', wp: 'deep', ambMode: 'rise', frameAnim: 'sparkle',
  });

  it('Export preset copies the {slots,setKey,wp,ambMode,frameAnim} JSON to the clipboard AND saves a file', async () => {
    const { writeText } = stubClipboard();
    // jsdom can't navigate to the blob download — intercept the anchor click.
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await setup({ setKey: 'cyber', slots: [...LIQUID_NEON_PRESETS.cyber.c], wp: 'deep', ambMode: 'snow', frameAnim: 'cycle' });
    fireEvent.click(screen.getByTestId('lnas-export'));
    expect(writeText).toHaveBeenCalledTimes(1);
    if (typeof URL.createObjectURL === 'function') {
      expect(anchorClick).toHaveBeenCalledTimes(1); // the file half of "clipboard AND file"
    }
    anchorClick.mockRestore();
    const obj = JSON.parse(writeText.mock.calls[0][0] as string);
    expect(obj).toEqual({
      slots: [...LIQUID_NEON_PRESETS.cyber.c], setKey: 'cyber', wp: 'deep', ambMode: 'snow', frameAnim: 'cycle',
    });
    expect(screen.getByTestId('ln-toast').textContent).toContain('Theme preset exported');
  });

  it('importing a valid preset file applies it live (§14.9 #9 round-trip)', async () => {
    stubClipboard();
    const { onChange } = await setup();
    const file = new File([VALID], 'preset.json', { type: 'application/json' });
    fireEvent.change(screen.getByTestId('lnas-import-file'), { target: { files: [file] } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls[0][0] as LiquidNeonV2Settings;
    expect(next.setKey).toBe('ember');
    expect(next.slots).toEqual([...LIQUID_NEON_PRESETS.ember.c]);
    expect(next.wp).toBe('deep');
    expect(next.ambMode).toBe('rise');
    expect(next.frameAnim).toBe('sparkle');
    expect(screen.getByTestId('ln-toast').textContent).toContain('Theme preset imported');
  });

  it('an invalid file toasts `Not a valid theme preset file` and does not crash or apply', async () => {
    stubClipboard();
    const { onChange } = await setup();
    const file = new File(['this is { not json'], 'broken.json', { type: 'application/json' });
    fireEvent.change(screen.getByTestId('lnas-import-file'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId('ln-toast').textContent).toContain('Not a valid theme preset file'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Paste imports a preset from the clipboard', async () => {
    stubClipboard({ readText: vi.fn().mockResolvedValue(VALID) });
    const { onChange } = await setup();
    fireEvent.click(screen.getByTestId('lnas-import-paste'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).setKey).toBe('ember');
  });

  it('Paste with junk in the clipboard toasts and applies nothing', async () => {
    stubClipboard({ readText: vi.fn().mockResolvedValue('garbage') });
    const { onChange } = await setup();
    fireEvent.click(screen.getByTestId('lnas-import-paste'));
    await waitFor(() => expect(screen.getByTestId('ln-toast').textContent).toContain('Not a valid theme preset file'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('export and both import affordances are keyboard-reachable buttons (CF-7)', async () => {
    stubClipboard();
    await setup();
    for (const id of ['lnas-export', 'lnas-import-paste', 'lnas-import']) {
      const el = screen.getByTestId(id);
      expect(el).toHaveAttribute('role', 'button');
      expect(el).toHaveAttribute('tabIndex', '0');
    }
  });
});

// ═══ #1774 Accent breathe ════════════════════════════════════════════════════

describe('#1774 — Motion card: Accent breathe', () => {
  /** A matchMedia that matches nothing, so the breathe driver is allowed to run. */
  const stubMatchMediaNoMatch = () => vi.stubGlobal('matchMedia', vi.fn((media: string) => ({
    matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));

  it('Accent breathe is on by default and is a switch', async () => {
    await setup();
    const toggle = screen.getByTestId('lnas-accentbreathe');
    expect(toggle).toHaveAttribute('role', 'switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).toHaveAttribute('aria-label', 'Accent breathe');
    expect(toggle).toHaveAttribute('tabIndex', '0');
  });

  it('clicking turns it off live', async () => {
    stubMatchMediaNoMatch();
    applyLiquidNeonV2Tokens(undefined, '/assets/cosmic-bg.webp'); // boot apply (DesktopShell)
    const { onChange } = await setup();
    expect(document.documentElement.getAttribute('data-ln-breathe')).toBe('running');
    fireEvent.click(screen.getByTestId('lnas-accentbreathe'));
    expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).accentBreathe).toBe(false);
    expect(document.documentElement.getAttribute('data-ln-breathe')).toBe('off');
    expect(screen.getByTestId('ln-toast').textContent).toContain('Accent breathe off');
  });

  it('Space key turns it on from off', async () => {
    const { onChange } = await setup({ accentBreathe: false });
    const toggle = screen.getByTestId('lnas-accentbreathe');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.keyDown(toggle, { key: ' ' });
    expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).accentBreathe).toBe(true);
    expect(screen.getByTestId('ln-toast').textContent).toContain('Accent breathe on');
  });

  it('export omits Accent breathe', async () => {
    const { writeText } = stubClipboard();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await setup({ setKey: 'cyber', slots: [...LIQUID_NEON_PRESETS.cyber.c], wp: 'deep', ambMode: 'snow', frameAnim: 'cycle', accentBreathe: false });
    fireEvent.click(screen.getByTestId('lnas-export'));
    anchorClick.mockRestore();
    const obj = JSON.parse(writeText.mock.calls[0][0] as string);
    expect(obj).toEqual({
      slots: [...LIQUID_NEON_PRESETS.cyber.c], setKey: 'cyber', wp: 'deep', ambMode: 'snow', frameAnim: 'cycle',
    });
  });

  it('import keeps the personal Accent breathe', async () => {
    stubClipboard();
    const { onChange } = await setup({ accentBreathe: false });
    const text = JSON.stringify({
      slots: [...LIQUID_NEON_PRESETS.ember.c], setKey: 'ember', wp: 'deep', ambMode: 'rise', frameAnim: 'sparkle', accentBreathe: true,
    });
    const file = new File([text], 'preset.json', { type: 'application/json' });
    fireEvent.change(screen.getByTestId('lnas-import-file'), { target: { files: [file] } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls[0][0] as LiquidNeonV2Settings;
    expect(next.setKey).toBe('ember');
    expect(next.accentBreathe).toBe(false);
  });

  describe('forced-off hint', () => {
    const REDUCE = '(prefers-reduced-motion: reduce)';
    const CONTRAST = '(prefers-contrast: more)';
    const FORCED = '(forced-colors: active)';

    /** Per-query MQL objects with real listeners, so a test can flip a query live. */
    function stubMatchMedia(state: Record<string, boolean> = {}) {
      const lists = new Map<string, { matches: boolean; media: string; listeners: Set<() => void> }>();
      const get = (query: string) => {
        let m = lists.get(query);
        if (!m) {
          m = { matches: state[query] === true, media: query, listeners: new Set() };
          lists.set(query, m);
        }
        return m;
      };
      vi.stubGlobal('matchMedia', vi.fn((q: string) => {
        const m = get(q);
        return {
          get matches() { return m.matches; },
          media: q,
          addEventListener: (_t: string, l: () => void) => { m.listeners.add(l); },
          removeEventListener: (_t: string, l: () => void) => { m.listeners.delete(l); },
        };
      }));
      return {
        fire(query: string, matches: boolean) {
          const m = get(query);
          m.matches = matches;
          act(() => { for (const l of [...m.listeners]) l(); });
        },
      };
    }

    // Still mounted here: the section's MutationObserver sees the removal, so flush it inside act.
    afterEach(async () => {
      await act(async () => { document.documentElement.removeAttribute('data-contrast'); });
    });

    const hint = () => screen.queryByTestId('lnas-accentbreathe-hint');
    const expectDescribed = (text: string) => {
      const toggle = screen.getByTestId('lnas-accentbreathe');
      const h = hint();
      expect(h).not.toBeNull();
      expect(h).toHaveTextContent(text);
      expect(toggle).toHaveAttribute('aria-describedby', h!.id);
      expect(toggle).toHaveAttribute('aria-checked', 'true'); // still the saved setting
    };

    it('in-app Reduce motion: hint names it and the switch points at it', async () => {
      stubMatchMedia();
      await setup({ reduceMotion: true });
      expectDescribed('Off while Reduce motion is on');
    });

    it('OS reduced motion: hint names the system setting', async () => {
      stubMatchMedia({ [REDUCE]: true });
      await setup();
      expectDescribed("Off while your system's reduced-motion setting is on");
    });

    it.each([
      ['prefers-contrast: more', CONTRAST],
      ['forced-colors', FORCED],
    ])('%s: hint names high contrast', async (_n, query) => {
      stubMatchMedia({ [query]: true });
      await setup();
      expectDescribed('Off while high contrast is on');
    });

    it('the app high-contrast attribute: hint names high contrast', async () => {
      stubMatchMedia();
      document.documentElement.dataset.contrast = 'high';
      await setup();
      expectDescribed('Off while high contrast is on');
    });

    it('no hint and no aria-describedby when nothing forces it off', async () => {
      stubMatchMedia();
      await setup();
      expect(hint()).toBeNull();
      expect(screen.getByTestId('lnas-accentbreathe')).not.toHaveAttribute('aria-describedby');
    });

    it('no hint while the setting itself is off, even under a system block', async () => {
      stubMatchMedia({ [REDUCE]: true });
      await setup({ accentBreathe: false });
      expect(hint()).toBeNull();
      expect(screen.getByTestId('lnas-accentbreathe')).not.toHaveAttribute('aria-describedby');
    });

    it('the hint appears and disappears live as the system setting changes', async () => {
      const mm = stubMatchMedia();
      await setup();
      expect(hint()).toBeNull();
      mm.fire(REDUCE, true);
      expectDescribed("Off while your system's reduced-motion setting is on");
      mm.fire(REDUCE, false);
      expect(hint()).toBeNull();
      expect(screen.getByTestId('lnas-accentbreathe')).not.toHaveAttribute('aria-describedby');
    });

    it('the hint follows the app high-contrast attribute live', async () => {
      stubMatchMedia();
      await setup();
      expect(hint()).toBeNull();
      await act(async () => { document.documentElement.dataset.contrast = 'high'; });
      expectDescribed('Off while high contrast is on');
      await act(async () => { document.documentElement.removeAttribute('data-contrast'); });
      expect(hint()).toBeNull();
      expect(screen.getByTestId('lnas-accentbreathe')).not.toHaveAttribute('aria-describedby');
    });

    it('the Motion card has no axe violations with the hint visible', async () => {
      stubMatchMedia({ [REDUCE]: true });
      await setup();
      expect(hint()).not.toBeNull();
      const card = screen.getByTestId('lnas-accentbreathe').closest('.lnas-card') as HTMLElement;
      expect(await axe(card)).toHaveNoViolations();
    });
  });

  it('the Motion card has no axe violations', async () => {
    await setup();
    const card = screen.getByTestId('lnas-accentbreathe').closest('.lnas-card') as HTMLElement;
    expect(card).not.toBeNull();
    const results = await axe(card);
    expect(results).toHaveNoViolations();
  });
});

describe('Beta 4 M1 — Background animation card', () => {
  it('segment patches ambMode; Off hides the drift-speed slider', async () => {
    const { onChange } = await setup({ ambMode: 'match' });
    expect(screen.getByTestId('lnas-ambspeed')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('lnas-amb-off'));
    expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).ambMode).toBe('off');
  });

  it('drift-speed slider patches ambSpeed', async () => {
    const { onChange } = await setup({ ambMode: 'match' });
    fireEvent.change(screen.getByTestId('lnas-ambspeed'), { target: { value: '150' } });
    expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).ambSpeed).toBe(150);
  });

  it('speed + particle controls are hidden while ambMode is off', async () => {
    await setup({ ambMode: 'off' });
    expect(screen.queryByTestId('lnas-ambspeed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lnas-ambcolor')).not.toBeInTheDocument();
  });

  it('particle color patches ambColor and Reset-to-theme clears it', async () => {
    const { onChange } = await setup({ ambColor: '#9fd4ff', ambMode: 'match' });
    fireEvent.click(screen.getByTestId('lnas-ambcolor-clear'));
    expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).ambColor).toBeNull();
  });
});

describe('Beta 4 M1 — Interface card', () => {
  it('density slider commits uiDens + density on pointer-up (rAF preview while dragging)', async () => {
    const { onChange } = await setup();
    const dens = screen.getByTestId('lnas-ui-dens');
    fireEvent.change(dens, { target: { value: '85' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(dens);
    expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).uiDens).toBeCloseTo(0.85);
    expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).density).toBe('compact');
  });

  it('reduce motion is one switch: patches reduceMotion and applies the kill class live', async () => {
    const { onChange } = await setup();
    fireEvent.click(screen.getByTestId('lnas-reducemotion'));
    expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).reduceMotion).toBe(true);
    expect(document.documentElement.classList.contains('ln-reduce-motion')).toBe(true);
  });

  it('nav rail labels toggle round-trips through the navConfig handler', async () => {
    const onNavRailLabelsChange = vi.fn();
    const onChange = vi.fn();
    await act(async () => {
      render(
        <LiquidNeonAppearanceSection
          liquidNeonV2={undefined}
          onChange={onChange}
          setSavedOk={vi.fn()}
          navRailLabels={true}
          onNavRailLabelsChange={onNavRailLabelsChange}
        />,
      );
    });
    fireEvent.click(screen.getByTestId('lnas-raillabels'));
    expect(onNavRailLabelsChange).toHaveBeenCalledWith(false);
  });

  it('nav rail labels row is absent without the handler (panel not wired)', async () => {
    await setup();
    expect(screen.queryByTestId('lnas-raillabels')).not.toBeInTheDocument();
  });

  it('app text + button text color wheels patch uiTextCol / uiBtnCol', async () => {
    const { onChange } = await setup();
    fireEvent.change(screen.getByTestId('lnas-uitext'), { target: { value: '#aabbcc' } });
    expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).uiTextCol).toBe('#aabbcc');
    fireEvent.change(screen.getByTestId('lnas-uibtn'), { target: { value: '#0b0d17' } });
    expect((onChange.mock.calls[1][0] as LiquidNeonV2Settings).uiBtnCol).toBe('#0b0d17');
  });
});
