// SKY-2450 — TimelineHeader unit tests (vitest + @testing-library/react).

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import TimelineHeader from './TimelineHeader';
import type { TimelineHeaderProps } from './TimelineHeader';

function makeProps(overrides: Partial<TimelineHeaderProps> = {}): TimelineHeaderProps {
  return {
    title: 'The Last Ember',
    currentZoom: 1.0,
    onZoomChange: vi.fn(),
    onZoomFit: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('TimelineHeader — rendering', () => {
  it('renders the story title with prefix', () => {
    render(<TimelineHeader {...makeProps()} />);
    expect(screen.getByText('Story Timeline: The Last Ember')).toBeInTheDocument();
  });

  it('displays the zoom level as a percentage', () => {
    render(<TimelineHeader {...makeProps({ currentZoom: 1.5 })} />);
    expect(screen.getByTestId('zoom-level')).toHaveTextContent('150%');
  });

  it('displays 100% at default zoom', () => {
    render(<TimelineHeader {...makeProps({ currentZoom: 1.0 })} />);
    expect(screen.getByTestId('zoom-level')).toHaveTextContent('100%');
  });

  it('displays 50% at minimum zoom (default min)', () => {
    render(<TimelineHeader {...makeProps({ currentZoom: 0.5 })} />);
    expect(screen.getByTestId('zoom-level')).toHaveTextContent('50%');
  });

  it('has role="toolbar" with a label', () => {
    render(<TimelineHeader {...makeProps()} />);
    expect(screen.getByRole('toolbar', { name: 'Timeline controls' })).toBeInTheDocument();
  });

  it('zoom buttons have ARIA labels', () => {
    render(<TimelineHeader {...makeProps()} />);
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom to fit all scenes' })).toBeInTheDocument();
  });

  it('zoom level has aria-live="polite" for screen readers', () => {
    render(<TimelineHeader {...makeProps()} />);
    expect(screen.getByTestId('zoom-level')).toHaveAttribute('aria-live', 'polite');
  });
});

describe('TimelineHeader — zoom button behaviour', () => {
  it('[+] calls onZoomChange with currentZoom + 0.1', () => {
    const onZoomChange = vi.fn();
    render(<TimelineHeader {...makeProps({ currentZoom: 1.0, onZoomChange })} />);
    fireEvent.click(screen.getByTestId('zoom-in-btn'));
    expect(onZoomChange).toHaveBeenCalledOnce();
    expect(onZoomChange).toHaveBeenCalledWith(1.1);
  });

  it('[−] calls onZoomChange with currentZoom − 0.1', () => {
    const onZoomChange = vi.fn();
    render(<TimelineHeader {...makeProps({ currentZoom: 1.0, onZoomChange })} />);
    fireEvent.click(screen.getByTestId('zoom-out-btn'));
    expect(onZoomChange).toHaveBeenCalledOnce();
    expect(onZoomChange).toHaveBeenCalledWith(0.9);
  });

  it('[Fit] calls onZoomFit', () => {
    const onZoomFit = vi.fn();
    render(<TimelineHeader {...makeProps({ onZoomFit })} />);
    fireEvent.click(screen.getByTestId('zoom-fit-btn'));
    expect(onZoomFit).toHaveBeenCalledOnce();
  });

  it('[+] clamps to maxZoom, not beyond', () => {
    const onZoomChange = vi.fn();
    render(<TimelineHeader {...makeProps({ currentZoom: 2.9, maxZoom: 3.0, onZoomChange })} />);
    fireEvent.click(screen.getByTestId('zoom-in-btn'));
    expect(onZoomChange).toHaveBeenCalledWith(3.0);
  });

  it('[−] clamps to minZoom, not below', () => {
    const onZoomChange = vi.fn();
    render(<TimelineHeader {...makeProps({ currentZoom: 0.6, minZoom: 0.5, onZoomChange })} />);
    fireEvent.click(screen.getByTestId('zoom-out-btn'));
    expect(onZoomChange).toHaveBeenCalledWith(0.5);
  });
});

describe('TimelineHeader — disabled states', () => {
  it('[+] is disabled when currentZoom === maxZoom', () => {
    render(<TimelineHeader {...makeProps({ currentZoom: 3.0, maxZoom: 3.0 })} />);
    expect(screen.getByTestId('zoom-in-btn')).toBeDisabled();
  });

  it('[−] is disabled when currentZoom === minZoom', () => {
    render(<TimelineHeader {...makeProps({ currentZoom: 0.5, minZoom: 0.5 })} />);
    expect(screen.getByTestId('zoom-out-btn')).toBeDisabled();
  });

  it('[+] is enabled when currentZoom < maxZoom', () => {
    render(<TimelineHeader {...makeProps({ currentZoom: 1.0, maxZoom: 3.0 })} />);
    expect(screen.getByTestId('zoom-in-btn')).toBeEnabled();
  });

  it('[−] is enabled when currentZoom > minZoom', () => {
    render(<TimelineHeader {...makeProps({ currentZoom: 1.0, minZoom: 0.5 })} />);
    expect(screen.getByTestId('zoom-out-btn')).toBeEnabled();
  });

  it('[Fit] is never disabled', () => {
    render(<TimelineHeader {...makeProps({ currentZoom: 3.0, maxZoom: 3.0 })} />);
    expect(screen.getByTestId('zoom-fit-btn')).toBeEnabled();
  });
});

describe('TimelineHeader — keyboard shortcuts', () => {
  it('Ctrl+= fires zoom in', () => {
    const onZoomChange = vi.fn();
    render(<TimelineHeader {...makeProps({ currentZoom: 1.0, onZoomChange })} />);
    fireEvent.keyDown(document, { key: '=', ctrlKey: true });
    expect(onZoomChange).toHaveBeenCalledWith(1.1);
  });

  it('Ctrl++ fires zoom in', () => {
    const onZoomChange = vi.fn();
    render(<TimelineHeader {...makeProps({ currentZoom: 1.0, onZoomChange })} />);
    fireEvent.keyDown(document, { key: '+', ctrlKey: true });
    expect(onZoomChange).toHaveBeenCalledWith(1.1);
  });

  it('Ctrl+- fires zoom out', () => {
    const onZoomChange = vi.fn();
    render(<TimelineHeader {...makeProps({ currentZoom: 1.0, onZoomChange })} />);
    fireEvent.keyDown(document, { key: '-', ctrlKey: true });
    expect(onZoomChange).toHaveBeenCalledWith(0.9);
  });

  it('Ctrl+0 fires onZoomFit', () => {
    const onZoomFit = vi.fn();
    render(<TimelineHeader {...makeProps({ onZoomFit })} />);
    fireEvent.keyDown(document, { key: '0', ctrlKey: true });
    expect(onZoomFit).toHaveBeenCalledOnce();
  });

  it('Cmd+= fires zoom in (Mac)', () => {
    const onZoomChange = vi.fn();
    render(<TimelineHeader {...makeProps({ currentZoom: 1.0, onZoomChange })} />);
    fireEvent.keyDown(document, { key: '=', metaKey: true });
    expect(onZoomChange).toHaveBeenCalledWith(1.1);
  });

  it('Cmd+- fires zoom out (Mac)', () => {
    const onZoomChange = vi.fn();
    render(<TimelineHeader {...makeProps({ currentZoom: 1.0, onZoomChange })} />);
    fireEvent.keyDown(document, { key: '-', metaKey: true });
    expect(onZoomChange).toHaveBeenCalledWith(0.9);
  });

  it('Cmd+0 fires onZoomFit (Mac)', () => {
    const onZoomFit = vi.fn();
    render(<TimelineHeader {...makeProps({ onZoomFit })} />);
    fireEvent.keyDown(document, { key: '0', metaKey: true });
    expect(onZoomFit).toHaveBeenCalledOnce();
  });

  it('bare = key (no modifier) does not fire zoom', () => {
    const onZoomChange = vi.fn();
    render(<TimelineHeader {...makeProps({ onZoomChange })} />);
    fireEvent.keyDown(document, { key: '=' });
    expect(onZoomChange).not.toHaveBeenCalled();
  });

  it('keyboard zoom clamps at maxZoom boundary', () => {
    const onZoomChange = vi.fn();
    render(<TimelineHeader {...makeProps({ currentZoom: 2.9, maxZoom: 3.0, onZoomChange })} />);
    fireEvent.keyDown(document, { key: '=', ctrlKey: true });
    expect(onZoomChange).toHaveBeenCalledWith(3.0);
  });

  it('keyboard zoom clamps at minZoom boundary', () => {
    const onZoomChange = vi.fn();
    render(<TimelineHeader {...makeProps({ currentZoom: 0.6, minZoom: 0.5, onZoomChange })} />);
    fireEvent.keyDown(document, { key: '-', ctrlKey: true });
    expect(onZoomChange).toHaveBeenCalledWith(0.5);
  });

  it('listener is removed on unmount', () => {
    const onZoomChange = vi.fn();
    const { unmount } = render(<TimelineHeader {...makeProps({ onZoomChange })} />);
    unmount();
    fireEvent.keyDown(document, { key: '=', ctrlKey: true });
    expect(onZoomChange).not.toHaveBeenCalled();
  });
});

describe('TimelineHeader — mouse wheel', () => {
  it('Ctrl+wheel up fires zoom in', () => {
    const onZoomChange = vi.fn();
    render(<TimelineHeader {...makeProps({ currentZoom: 1.0, onZoomChange })} />);
    fireEvent.wheel(document, { deltaY: -100, ctrlKey: true });
    expect(onZoomChange).toHaveBeenCalledWith(1.1);
  });

  it('Ctrl+wheel down fires zoom out', () => {
    const onZoomChange = vi.fn();
    render(<TimelineHeader {...makeProps({ currentZoom: 1.0, onZoomChange })} />);
    fireEvent.wheel(document, { deltaY: 100, ctrlKey: true });
    expect(onZoomChange).toHaveBeenCalledWith(0.9);
  });

  it('wheel without modifier does not fire zoom', () => {
    const onZoomChange = vi.fn();
    render(<TimelineHeader {...makeProps({ onZoomChange })} />);
    fireEvent.wheel(document, { deltaY: -100 });
    expect(onZoomChange).not.toHaveBeenCalled();
  });
});
