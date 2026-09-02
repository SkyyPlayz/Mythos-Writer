import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import PageSetupPopover from './PageSetupPopover';
import type { PageStyle } from './PageSetupPopover';
import { STORY_PAGE_DEFAULTS } from './theme';

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  prefs: STORY_PAGE_DEFAULTS,
  onPrefsChange: vi.fn(),
  pageStyle: 'off' as PageStyle,
  onPageStyleChange: vi.fn(),
};

describe('PageSetupPopover', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(<PageSetupPopover {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the popover when isOpen is true', () => {
    render(<PageSetupPopover {...defaultProps} />);
    expect(screen.getByRole('dialog', { name: /page setup/i })).toBeInTheDocument();
  });

  it('renders all 5 page style buttons', () => {
    render(<PageSetupPopover {...defaultProps} />);
    expect(screen.getByRole('button', { name: /neon/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /no glow/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /scroll/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /texture/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^off$/i })).toBeInTheDocument();
  });

  it('calls onPageStyleChange with the correct key when a style button is clicked', () => {
    const onPageStyleChange = vi.fn();
    render(<PageSetupPopover {...defaultProps} onPageStyleChange={onPageStyleChange} />);
    fireEvent.click(screen.getByRole('button', { name: /neon/i }));
    expect(onPageStyleChange).toHaveBeenCalledWith('neon');
  });

  it('emits the engine mode keys — No Glow is "default", Custom texture is "custom"', () => {
    const onPageStyleChange = vi.fn();
    render(<PageSetupPopover {...defaultProps} onPageStyleChange={onPageStyleChange} />);
    fireEvent.click(screen.getByRole('button', { name: /no glow/i }));
    expect(onPageStyleChange).toHaveBeenCalledWith('default');
    fireEvent.click(screen.getByRole('button', { name: /custom texture/i }));
    expect(onPageStyleChange).toHaveBeenCalledWith('custom');
  });

  it('shows texture upload button when pageStyle is custom', () => {
    render(<PageSetupPopover {...defaultProps} pageStyle="custom" />);
    expect(screen.getByRole('button', { name: /choose texture image/i })).toBeInTheDocument();
  });

  it('uses the native picker instead of the file input when onPickPageTexture is wired', () => {
    const onPickPageTexture = vi.fn();
    render(
      <PageSetupPopover
        {...defaultProps}
        pageStyle="custom"
        onPickPageTexture={onPickPageTexture}
        textureFileName="parchment.png"
      />
    );
    const btn = screen.getByRole('button', { name: /texture: parchment\.png/i });
    fireEvent.click(btn);
    expect(onPickPageTexture).toHaveBeenCalled();
  });

  it('does not show texture upload button for other styles', () => {
    render(<PageSetupPopover {...defaultProps} pageStyle="off" />);
    expect(screen.queryByRole('button', { name: /choose texture image/i })).not.toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<PageSetupPopover {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close page setup/i }));
    expect(onClose).toHaveBeenCalled();
  });

  // ── M1-S3: canonical prefs (one pref set with the ruler + toolbar) ────────

  it('width controls read and write the canonical pageWidthPx (520–3000)', () => {
    const onPrefsChange = vi.fn();
    render(
      <PageSetupPopover
        {...defaultProps}
        prefs={{ ...STORY_PAGE_DEFAULTS, pageWidthPx: 1000 }}
        onPrefsChange={onPrefsChange}
      />
    );
    const slider = screen.getByLabelText('Page width slider') as HTMLInputElement;
    expect(slider.value).toBe('1000');
    expect(slider.min).toBe('520');
    expect(slider.max).toBe('3000');
    fireEvent.change(slider, { target: { value: '1400' } });
    expect(onPrefsChange).toHaveBeenCalledWith(
      expect.objectContaining({ pageWidthPx: 1400 })
    );
  });

  it('margin slider reads pageMarginPx, clamps its range to [12, floor(w/2)-60], and writes pageMarginPx', () => {
    const onPrefsChange = vi.fn();
    render(
      <PageSetupPopover
        {...defaultProps}
        prefs={{ ...STORY_PAGE_DEFAULTS, pageWidthPx: 1000, pageMarginPx: 84 }}
        onPrefsChange={onPrefsChange}
      />
    );
    const slider = screen.getByLabelText(/^margin$/i) as HTMLInputElement;
    expect(slider.value).toBe('84');
    expect(slider.min).toBe('12');
    expect(slider.max).toBe('440'); // floor(1000/2) - 60
    fireEvent.change(slider, { target: { value: '120' } });
    expect(onPrefsChange).toHaveBeenCalledWith(
      expect.objectContaining({ pageMarginPx: 120 })
    );
  });

  it('font select + size slider write fontName / fontSizeStep', () => {
    const onPrefsChange = vi.fn();
    render(
      <PageSetupPopover
        {...defaultProps}
        prefs={{ ...STORY_PAGE_DEFAULTS, fontName: 'Lora', fontSizeStep: 12 }}
        onPrefsChange={onPrefsChange}
      />
    );
    fireEvent.change(screen.getByLabelText('Manuscript font'), { target: { value: 'Inter' } });
    expect(onPrefsChange).toHaveBeenCalledWith(expect.objectContaining({ fontName: 'Inter' }));
    const size = screen.getByLabelText(/^size$/i) as HTMLInputElement;
    expect(size.min).toBe('9');
    expect(size.max).toBe('18');
    fireEvent.change(size, { target: { value: '14' } });
    expect(onPrefsChange).toHaveBeenCalledWith(expect.objectContaining({ fontSizeStep: 14 }));
  });

  // ── SKY-11239: drop cap on/off toggle ─────────────────────────────────────

  it('renders the drop cap toggle with an aria-label, defaulting to unchecked', () => {
    render(<PageSetupPopover {...defaultProps} />);
    const toggle = screen.getByLabelText('Drop cap') as HTMLInputElement;
    expect(toggle).toBeInTheDocument();
    expect(toggle.type).toBe('checkbox');
    expect(toggle.checked).toBe(false);
  });

  it('reflects prefs.dropCapEnabled when true', () => {
    render(<PageSetupPopover {...defaultProps} prefs={{ ...STORY_PAGE_DEFAULTS, dropCapEnabled: true }} />);
    expect((screen.getByLabelText('Drop cap') as HTMLInputElement).checked).toBe(true);
  });

  it('fires onPrefsChange with the flipped dropCapEnabled value', () => {
    const onPrefsChange = vi.fn();
    render(
      <PageSetupPopover
        {...defaultProps}
        prefs={{ ...STORY_PAGE_DEFAULTS, dropCapEnabled: false }}
        onPrefsChange={onPrefsChange}
      />
    );
    fireEvent.click(screen.getByLabelText('Drop cap'));
    expect(onPrefsChange).toHaveBeenCalledWith(expect.objectContaining({ dropCapEnabled: true }));
  });
});
