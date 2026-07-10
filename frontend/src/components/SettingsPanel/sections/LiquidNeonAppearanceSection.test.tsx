// M4 — Appearance page controls bind to liquidNeonV2, apply live, and follow
// the prototype's behaviors (preset pick resets wp to match, swatch pick
// flips to custom, split toggle seeds notes colors, page modes gate config).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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
});

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

  it('split toggle seeds notes colors from story colors', async () => {
    const { onChange } = await setup({ txtCfg: { head: '#111111', body: '#222222', split: false, nHead: '#f0f3fc', nBody: '#c8d3e7' } });
    expect(screen.queryByText('Notes headings')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('lnas-txsplit'));
    const next = onChange.mock.calls[0][0] as LiquidNeonV2Settings;
    expect(next.txtCfg.split).toBe(true);
    expect(next.txtCfg.nHead).toBe('#111111');
    expect(next.txtCfg.nBody).toBe('#222222');
  });

  it('page modes gate their config: neon shows bg controls, scroll shows parchment controls', async () => {
    await setup({ pageCfg: { mode: 'neon', bg: '#0a0d18', op: 66, blur: 0 } });
    expect(screen.getByTestId('lnas-pageop')).toBeInTheDocument();
    expect(screen.queryByTestId('lnas-scrollop')).not.toBeInTheDocument();
  });

  it('scroll mode shows tint, opacity, and symbols toggle', async () => {
    await setup({ pageCfg: { mode: 'scroll', bg: '#0a0d18', op: 66, blur: 0 } });
    expect(screen.getByTestId('lnas-scrollop')).toBeInTheDocument();
    expect(screen.getByTestId('lnas-scrolltint')).toBeInTheDocument();
    expect(screen.getByTestId('lnas-pagesym')).toBeInTheDocument();
    expect(screen.queryByTestId('lnas-pageop')).not.toBeInTheDocument();
  });

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

    it('NeonToggle switches (split, reduce glow) are focusable and activate on Space', async () => {
      const { onChange } = await setup({ txtCfg: { head: '#111111', body: '#222222', split: false, nHead: '#f0f3fc', nBody: '#c8d3e7' } });
      const toggle = screen.getByTestId('lnas-txsplit');
      expect(toggle).toHaveAttribute('role', 'switch');
      expect(toggle).toHaveAttribute('tabIndex', '0');
      fireEvent.keyDown(toggle, { key: ' ' });
      expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).txtCfg.split).toBe(true);
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
