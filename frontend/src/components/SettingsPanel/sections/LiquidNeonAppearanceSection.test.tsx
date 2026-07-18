// M4 — Appearance page controls bind to liquidNeonV2, apply live, and follow
// the prototype's behaviors (preset pick resets wp to match, swatch pick
// flips to custom, split toggle seeds notes colors, page modes gate config).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import LiquidNeonAppearanceSection from './LiquidNeonAppearanceSection';
import { LIQUID_NEON_PRESETS } from '../../../theme/presets';
import { resetLiquidNeonV2Tokens, type LiquidNeonV2Settings } from '../../../theme/liquidNeonEngine';

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

  it('wp none applies the plain dark backdrop with no restart affordance (B4-2)', async () => {
    const { onChange } = await setup();
    fireEvent.click(screen.getByTestId('lnas-wp-none'));
    expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).wp).toBe('none');
    expect(document.documentElement.style.getPropertyValue('--wp')).toBe('linear-gradient(#07090f,#07090f)');
    expect(screen.queryByTestId('lnas-restart-row')).not.toBeInTheDocument();
  });

  it('reset restores the Neon Classic defaults', async () => {
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
  it('renders exactly the seven spec cards in §3 order (M28 moved the manuscript cards to the Editor page)', async () => {
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

describe('Beta 4 M1 — Background animation card', () => {
  it('segment patches ambMode; Off hides the drift-speed slider', async () => {
    const { onChange } = await setup();
    expect(screen.getByTestId('lnas-ambspeed')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('lnas-amb-off'));
    expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).ambMode).toBe('off');
  });

  it('drift-speed slider patches ambSpeed', async () => {
    const { onChange } = await setup();
    fireEvent.change(screen.getByTestId('lnas-ambspeed'), { target: { value: '150' } });
    expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).ambSpeed).toBe(150);
  });

  it('speed + particle controls are hidden while ambMode is off', async () => {
    await setup({ ambMode: 'off' });
    expect(screen.queryByTestId('lnas-ambspeed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lnas-ambcolor')).not.toBeInTheDocument();
  });

  it('particle color patches ambColor and Reset-to-theme clears it', async () => {
    const { onChange } = await setup({ ambColor: '#9fd4ff' });
    fireEvent.click(screen.getByTestId('lnas-ambcolor-clear'));
    expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).ambColor).toBeNull();
  });
});

describe('Beta 4 M1 — Interface card', () => {
  it('density segment patches density and stamps data-ln-density live', async () => {
    const { onChange } = await setup();
    fireEvent.click(screen.getByTestId('lnas-density-compact'));
    expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).density).toBe('compact');
    expect(document.documentElement.getAttribute('data-ln-density')).toBe('compact');
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
