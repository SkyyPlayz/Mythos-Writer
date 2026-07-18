// Beta 4 M28 (§13) — Settings → Editor manuscript cards. The Text colors and
// Manuscript page tests moved here from LiquidNeonAppearanceSection.test.tsx
// when the cards moved to the Editor page; the wiki-link color rows are new.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import EditorManuscriptSection from './EditorManuscriptSection';
import { resetLiquidNeonV2Tokens, type LiquidNeonV2Settings } from '../../../theme/liquidNeonEngine';

async function setup(liquidNeonV2: Partial<LiquidNeonV2Settings> | undefined = undefined) {
  const onChange = vi.fn();
  const setSavedOk = vi.fn();
  await act(async () => {
    render(<EditorManuscriptSection liquidNeonV2={liquidNeonV2} onChange={onChange} setSavedOk={setSavedOk} />);
  });
  return { onChange, setSavedOk };
}

afterEach(() => {
  resetLiquidNeonV2Tokens();
});

describe('EditorManuscriptSection (M28 §13)', () => {
  it('renders the two manuscript cards on the Editor page', async () => {
    await setup();
    const titles = Array.from(document.querySelectorAll('.lnas-card > div:first-child'))
      .map((el) => el.textContent);
    expect(titles).toEqual(['Text colors', 'Manuscript page']);
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

  it('picking Custom texture in the segmented control patches pageCfg.mode', async () => {
    const { onChange } = await setup({ pageCfg: { mode: 'neon', bg: '#0a0d18', op: 66, blur: 0 } });
    fireEvent.click(screen.getByTestId('lnas-page-custom'));
    expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).pageCfg.mode).toBe('custom');
  });

  it('custom texture mode shows the upload row and hides the flat bg controls (M7 §5.1)', async () => {
    await setup({ pageCfg: { mode: 'custom', bg: '#0a0d18', op: 66, blur: 0 } });
    expect(screen.getByTestId('lnas-page-texture-upload')).toBeInTheDocument();
    expect(screen.queryByTestId('lnas-pageop')).not.toBeInTheDocument();
    expect(screen.getByText('No image chosen — cover-fit over the page')).toBeInTheDocument();
  });

  it('choosing a texture image patches pageCfg.textureUrl via the shared image picker', async () => {
    const pickBgImage = vi.fn().mockResolvedValue({ filePath: '/tmp/parchment.png', cancelled: false });
    (window as unknown as { api: Record<string, unknown> }).api = { pickBgImage };
    const { onChange } = await setup({ pageCfg: { mode: 'custom', bg: '#0a0d18', op: 66, blur: 0 } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('lnas-page-texture-upload'));
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls[0][0] as LiquidNeonV2Settings;
    expect(next.pageCfg.mode).toBe('custom');
    expect(next.pageCfg.textureUrl).toBe('/tmp/parchment.png');
    delete (window as unknown as { api?: unknown }).api;
  });

  it('resolves the chosen texture to a data URL when loadBgImage is available (raw fs paths do not load via CSS url())', async () => {
    const pickBgImage = vi.fn().mockResolvedValue({ filePath: '/tmp/parchment.png', cancelled: false });
    const loadBgImage = vi.fn().mockResolvedValue({ dataUrl: 'data:image/png;base64,AAAA' });
    (window as unknown as { api: Record<string, unknown> }).api = { pickBgImage, loadBgImage };
    const { onChange } = await setup({ pageCfg: { mode: 'custom', bg: '#0a0d18', op: 66, blur: 0 } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('lnas-page-texture-upload'));
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls[0][0] as LiquidNeonV2Settings;
    expect(loadBgImage).toHaveBeenCalledWith('/tmp/parchment.png');
    expect(next.pageCfg.textureUrl).toBe('data:image/png;base64,AAAA');
    delete (window as unknown as { api?: unknown }).api;
  });

  // ── M28: Wiki links color row (§13) ──

  it('wiki-link row defaults to the theme color (no --wiki-c token, no reset affordance)', async () => {
    await setup();
    expect(screen.getByText('Theme (slot B)')).toBeInTheDocument();
    expect(screen.queryByTestId('lnas-tx-wiki-clear')).not.toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue('--wiki-c')).toBe('');
  });

  it('picking a wiki-link color patches txtCfg.wiki and applies --wiki-c live', async () => {
    const { onChange } = await setup();
    fireEvent.change(screen.getByTestId('lnas-tx-wiki-links'), { target: { value: '#ff2d95' } });
    const next = onChange.mock.calls[0][0] as LiquidNeonV2Settings;
    expect(next.txtCfg.wiki).toBe('#ff2d95');
    expect(document.documentElement.style.getPropertyValue('--wiki-c')).toBe('#ff2d95');
  });

  it('"Theme color" clears the wiki-link override and removes the token', async () => {
    const { onChange } = await setup({
      txtCfg: { head: '#f0f3fc', body: '#c8d3e7', split: false, nHead: '#f0f3fc', nBody: '#c8d3e7', wiki: '#ff2d95' },
    });
    fireEvent.click(screen.getByTestId('lnas-tx-wiki-clear'));
    const next = onChange.mock.calls[0][0] as LiquidNeonV2Settings;
    expect(next.txtCfg.wiki).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--wiki-c')).toBe('');
  });

  it('NeonToggle split switch is focusable and activates on Space (moved from LNAS a11y suite)', async () => {
    const { onChange } = await setup({ txtCfg: { head: '#111111', body: '#222222', split: false, nHead: '#f0f3fc', nBody: '#c8d3e7' } });
    const toggle = screen.getByTestId('lnas-txsplit');
    expect(toggle).toHaveAttribute('role', 'switch');
    expect(toggle).toHaveAttribute('tabIndex', '0');
    fireEvent.keyDown(toggle, { key: ' ' });
    expect((onChange.mock.calls[0][0] as LiquidNeonV2Settings).txtCfg.split).toBe(true);
  });
});
