// Beta 4 M7 — PageChrome popover unit tests: width slider/input, page-style
// quick-switch, texture upload trigger, outside-click + Escape dismissal.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import PageChrome from './PageChrome';

function setup(overrides: Partial<React.ComponentProps<typeof PageChrome>> = {}) {
  const onClose = vi.fn();
  const onPageWidthChange = vi.fn();
  const props: React.ComponentProps<typeof PageChrome> = {
    open: true,
    onClose,
    pageWidth: 1000,
    min: 520,
    max: 3000,
    onPageWidthChange,
    ...overrides,
  };
  render(<PageChrome {...props} />);
  return { onClose, onPageWidthChange };
}

describe('PageChrome', () => {
  it('renders nothing when closed', () => {
    setup({ open: false });
    expect(screen.queryByTestId('page-chrome-popover')).not.toBeInTheDocument();
  });

  it('the width slider commits immediately', () => {
    const { onPageWidthChange } = setup();
    fireEvent.change(screen.getByTestId('page-chrome-width-slider'), { target: { value: '1400' } });
    expect(onPageWidthChange).toHaveBeenCalledWith(1400);
  });

  it('the numeric input keeps a raw draft while focused and commits on blur', () => {
    const { onPageWidthChange } = setup();
    const input = screen.getByTestId('page-chrome-width-input') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1750' } });
    expect(input.value).toBe('1750');
    expect(onPageWidthChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onPageWidthChange).toHaveBeenCalledWith(1750);
  });

  it('the numeric input commits on Enter', () => {
    const { onPageWidthChange } = setup();
    const input = screen.getByTestId('page-chrome-width-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '900' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPageWidthChange).toHaveBeenCalledWith(900);
  });

  it('clamps a manually typed value to the min/max range', () => {
    const { onPageWidthChange } = setup();
    const input = screen.getByTestId('page-chrome-width-input') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '99999' } });
    fireEvent.blur(input);
    expect(onPageWidthChange).toHaveBeenCalledWith(3000);
  });

  it('hides the page-style quick-switch when onPageStyleChange is not provided', () => {
    setup();
    expect(screen.queryByTestId('page-chrome-style-neon')).not.toBeInTheDocument();
  });

  it('renders the page-style quick-switch and marks the active mode', () => {
    const onPageStyleChange = vi.fn();
    setup({ pageStyleMode: 'scroll', onPageStyleChange });
    expect(screen.getByTestId('page-chrome-style-scroll').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('page-chrome-style-neon'));
    expect(onPageStyleChange).toHaveBeenCalledWith('neon');
  });

  it('shows the texture upload row only in custom mode', () => {
    const onPageStyleChange = vi.fn();
    const onPickPageTexture = vi.fn();
    setup({ pageStyleMode: 'neon', onPageStyleChange, onPickPageTexture });
    expect(screen.queryByTestId('page-chrome-texture-upload')).not.toBeInTheDocument();
    cleanup();

    setup({
      pageStyleMode: 'custom',
      onPageStyleChange,
      onPickPageTexture,
      textureFileName: 'parchment.png',
    });
    expect(screen.getByTestId('page-chrome-texture-upload')).toBeInTheDocument();
    expect(screen.getByText('parchment.png')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('page-chrome-texture-upload'));
    expect(onPickPageTexture).toHaveBeenCalled();
  });

  it('closes on outside click', () => {
    const { onClose } = setup();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when clicking inside the popover', () => {
    const { onClose } = setup();
    fireEvent.mouseDown(screen.getByTestId('page-chrome-popover'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
