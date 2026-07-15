// Beta 4 M7 — MarginRuler unit tests: drag-to-resize math, keyboard nudge,
// gutter-aware width reservation, live readout while dragging.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MarginRuler, { MARGIN_RULER_GUTTER_WIDTH } from './MarginRuler';

function setup(props: Partial<React.ComponentProps<typeof MarginRuler>> = {}) {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  render(<MarginRuler pageWidth={1000} onChange={onChange} onCommit={onCommit} {...props} />);
  return { onChange, onCommit };
}

describe('MarginRuler', () => {
  it('renders the track, both diamond handles, and no readout while idle', () => {
    setup();
    expect(screen.getByTestId('margin-ruler-track')).toBeInTheDocument();
    expect(screen.getByTestId('margin-ruler-handle-l')).toBeInTheDocument();
    expect(screen.getByTestId('margin-ruler-handle-r')).toBeInTheDocument();
    expect(screen.queryByTestId('margin-ruler-readout')).not.toBeInTheDocument();
  });

  it('reserves the comments-gutter width when gutterOpen is true', () => {
    setup({ gutterOpen: true });
    const root = screen.getByTestId('margin-ruler');
    expect(root.style.marginRight).toBe(`${MARGIN_RULER_GUTTER_WIDTH}px`);
  });

  it('does not reserve gutter width when closed', () => {
    setup({ gutterOpen: false });
    expect(screen.getByTestId('margin-ruler').style.marginRight).toBe('');
  });

  it('dragging the right handle grows the width symmetrically (2x delta) and shows the live readout', () => {
    const { onChange, onCommit } = setup({ pageWidth: 1000 });
    const handle = screen.getByTestId('margin-ruler-handle-r');
    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 550 });
    expect(onChange).toHaveBeenCalledWith(1100); // +50 delta * side(1) * 2
    expect(screen.getByTestId('margin-ruler-readout')).toHaveTextContent('1100 px');
    fireEvent.mouseUp(window, { clientX: 550 });
    expect(onCommit).toHaveBeenCalledWith(1100);
    expect(screen.queryByTestId('margin-ruler-readout')).not.toBeInTheDocument();
  });

  it('dragging the left handle grows the width when moving further left (negated side)', () => {
    const { onChange } = setup({ pageWidth: 1000 });
    const handle = screen.getByTestId('margin-ruler-handle-l');
    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 460 }); // -40 delta * side(-1) * 2 = +80
    expect(onChange).toHaveBeenCalledWith(1080);
  });

  it('clamps to the max when the left handle is dragged far outward', () => {
    const { onChange } = setup({ pageWidth: 1000, min: 520, max: 3000 });
    const handle = screen.getByTestId('margin-ruler-handle-l');
    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: -5000 }); // huge leftward drag -> grows past max
    expect(onChange).toHaveBeenCalledWith(3000);
  });

  it('clamps to the min when the left handle is dragged far inward', () => {
    const { onChange } = setup({ pageWidth: 1000, min: 520, max: 3000 });
    const handle = screen.getByTestId('margin-ruler-handle-l');
    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 5000 }); // huge rightward drag -> shrinks past min
    expect(onChange).toHaveBeenCalledWith(520);
  });

  it('arrow keys nudge the width by 20px and commit immediately', () => {
    const { onCommit } = setup({ pageWidth: 1000 });
    const handle = screen.getByTestId('margin-ruler-handle-r');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenCalledWith(1020);
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(onCommit).toHaveBeenCalledWith(980);
  });

  it('exposes slider semantics for accessibility', () => {
    setup({ pageWidth: 1234, min: 520, max: 3000 });
    const handle = screen.getByTestId('margin-ruler-handle-r');
    expect(handle.getAttribute('role')).toBe('slider');
    expect(handle.getAttribute('aria-valuenow')).toBe('1234');
    expect(handle.getAttribute('aria-valuemin')).toBe('520');
    expect(handle.getAttribute('aria-valuemax')).toBe('3000');
  });
});
