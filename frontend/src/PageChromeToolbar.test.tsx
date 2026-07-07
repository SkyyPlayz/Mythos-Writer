import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import PageChromeToolbar from './PageChromeToolbar';
import { STORY_PAGE_DEFAULTS } from './theme';
import type { StoryPagePrefs } from './theme';

// theme.ts imports browser globals — stub them for jsdom
vi.mock('./theme', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./theme')>();
  return {
    ...actual,
    applyStoryPageTokens: vi.fn(),
    resetStoryPageTokens: vi.fn(),
  };
});

const defaultPrefs: StoryPagePrefs = { ...STORY_PAGE_DEFAULTS };

afterEach(() => {
  cleanup();
});

describe('PageChromeToolbar', () => {
  it('renders preset buttons', () => {
    render(<PageChromeToolbar prefs={defaultPrefs} onPrefsChange={() => {}} />);
    expect(screen.getByRole('button', { name: /letter/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /a4/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /a5/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /manuscript/i })).toBeDefined();
  });

  it('marks the active preset as pressed', () => {
    render(<PageChromeToolbar prefs={{ ...defaultPrefs, sizePreset: 'a4' }} onPrefsChange={() => {}} />);
    const a4 = screen.getByRole('button', { name: /a4/i });
    expect(a4.getAttribute('aria-pressed')).toBe('true');
    const letter = screen.getByRole('button', { name: /letter/i });
    expect(letter.getAttribute('aria-pressed')).toBe('false');
  });

  it('calls onPrefsChange when a preset is clicked', () => {
    const onChange = vi.fn();
    render(<PageChromeToolbar prefs={defaultPrefs} onPrefsChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /a4/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].sizePreset).toBe('a4');
  });

  it('calls onPrefsChange when margin slider changes', () => {
    const onChange = vi.fn();
    render(<PageChromeToolbar prefs={defaultPrefs} onPrefsChange={onChange} />);
    const slider = screen.getByRole('slider', { name: /margins/i });
    fireEvent.change(slider, { target: { value: '60' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const updated: StoryPagePrefs = onChange.mock.calls[0][0];
    expect(updated.marginVertPx).toBe(60);
    expect(updated.marginHorizPx).toBe(60);
  });

  it('calls onPrefsChange when font size slider changes', () => {
    const onChange = vi.fn();
    render(<PageChromeToolbar prefs={defaultPrefs} onPrefsChange={onChange} />);
    const slider = screen.getByRole('slider', { name: /font size/i });
    fireEvent.change(slider, { target: { value: '18' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].fontSizePx).toBe(18);
  });

  it('calls onPrefsChange when line-spacing slider changes', () => {
    const onChange = vi.fn();
    render(<PageChromeToolbar prefs={defaultPrefs} onPrefsChange={onChange} />);
    const slider = screen.getByRole('slider', { name: /line spacing/i });
    fireEvent.change(slider, { target: { value: '2.1' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].lineHeight).toBe(2.1);
  });

  it('displays the current line-spacing value', () => {
    render(<PageChromeToolbar prefs={{ ...defaultPrefs, lineHeight: 2 }} onPrefsChange={() => {}} />);
    const slider = screen.getByRole('slider', { name: /line spacing/i });
    expect(slider.getAttribute('value')).toBe('2');
    expect(screen.getByText('2.0×')).toBeDefined();
  });

  it('switches font family when a font button is clicked', () => {
    const onChange = vi.fn();
    render(<PageChromeToolbar prefs={defaultPrefs} onPrefsChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /sans/i }));
    expect(onChange.mock.calls[0][0].fontFamily).toBe('sans');
  });

  it('resets to defaults when reset button is clicked', () => {
    const onChange = vi.fn();
    render(<PageChromeToolbar prefs={{ ...defaultPrefs, fontFamily: 'mono', fontSizePx: 20 }} onPrefsChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /reset page settings/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const reset: StoryPagePrefs = onChange.mock.calls[0][0];
    expect(reset.fontFamily).toBe(STORY_PAGE_DEFAULTS.fontFamily);
    expect(reset.fontSizePx).toBe(STORY_PAGE_DEFAULTS.fontSizePx);
  });

  it('renders the toolbar with role=toolbar and accessible label', () => {
    render(<PageChromeToolbar prefs={defaultPrefs} onPrefsChange={() => {}} />);
    const toolbar = screen.getByRole('toolbar', { name: /page chrome settings/i });
    expect(toolbar).toBeDefined();
  });

  it('shows custom width label when sizePreset is custom', () => {
    render(
      <PageChromeToolbar
        prefs={{ ...defaultPrefs, sizePreset: 'custom', customWidthPx: 850 }}
        onPrefsChange={() => {}}
      />
    );
    // The M10 width slider adds a second 850px readout — scope to the label span.
    const label = document.querySelector('.pct-custom-width');
    expect(label?.textContent).toBe('850px');
  });
});

// ─── GH #842 / Beta 3 M10 — free page-width slider ───────────────────────────

describe('PageChromeToolbar width slider (GH #842)', () => {
  it('renders the width slider showing the effective preset width', () => {
    render(<PageChromeToolbar prefs={defaultPrefs} onPrefsChange={() => {}} />);
    const slider = screen.getByRole('slider', { name: 'Width' }) as HTMLInputElement;
    expect(slider.min).toBe('320');
    expect(slider.max).toBe('1400');
    expect(slider.value).toBe('680'); // letter preset
  });

  it('writes a custom width through onPrefsChange', () => {
    const onChange = vi.fn();
    render(<PageChromeToolbar prefs={defaultPrefs} onPrefsChange={onChange} />);
    fireEvent.change(screen.getByRole('slider', { name: 'Width' }), { target: { value: '900' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const updated: StoryPagePrefs = onChange.mock.calls[0][0];
    expect(updated.sizePreset).toBe('custom');
    expect(updated.customWidthPx).toBe(900);
  });

  it('follows a custom width in prefs', () => {
    render(
      <PageChromeToolbar
        prefs={{ ...defaultPrefs, sizePreset: 'custom', customWidthPx: 1000 }}
        onPrefsChange={() => {}}
      />
    );
    const slider = screen.getByRole('slider', { name: 'Width' }) as HTMLInputElement;
    expect(slider.value).toBe('1000');
  });
});
