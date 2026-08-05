// Beta 4 M7 / M1-S3 — MarginRuler unit tests: drag-to-resize math for both
// diamond pairs (outer = page width, inner = margins), the locked-pair rule,
// keyboard nudges, gutter-aware width reservation, and the onDragLive feed
// that drives the page-corner value badge.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MarginRuler, { MARGIN_RULER_GUTTER_WIDTH } from './MarginRuler';

function setup(props: Partial<React.ComponentProps<typeof MarginRuler>> = {}) {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  const onMarginChange = vi.fn();
  const onMarginCommit = vi.fn();
  const onDragLive = vi.fn();
  render(
    <MarginRuler
      pageWidth={1000}
      marginPx={84}
      onChange={onChange}
      onCommit={onCommit}
      onMarginChange={onMarginChange}
      onMarginCommit={onMarginCommit}
      onDragLive={onDragLive}
      {...props}
    />
  );
  return { onChange, onCommit, onMarginChange, onMarginCommit, onDragLive };
}

describe('MarginRuler', () => {
  it('renders the track and BOTH diamond pairs (outer width + inner margin)', () => {
    setup();
    expect(screen.getByTestId('margin-ruler-track')).toBeInTheDocument();
    expect(screen.getByTestId('margin-ruler-handle-l')).toBeInTheDocument();
    expect(screen.getByTestId('margin-ruler-handle-r')).toBeInTheDocument();
    expect(screen.getByTestId('margin-ruler-margin-handle-l')).toBeInTheDocument();
    expect(screen.getByTestId('margin-ruler-margin-handle-r')).toBeInTheDocument();
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

  it('dragging the right handle grows the width symmetrically (2x delta) and feeds onDragLive', () => {
    const { onChange, onCommit, onDragLive } = setup({ pageWidth: 1000 });
    const handle = screen.getByTestId('margin-ruler-handle-r');
    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 550 });
    expect(onChange).toHaveBeenCalledWith(1100); // +50 delta * side(1) * 2
    expect(onDragLive).toHaveBeenCalledWith({ kind: 'width', px: 1100 });
    fireEvent.mouseUp(window, { clientX: 550 });
    expect(onCommit).toHaveBeenCalledWith(1100);
    expect(onDragLive).toHaveBeenLastCalledWith(null);
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

  it('exposes slider semantics for accessibility on both pairs', () => {
    setup({ pageWidth: 1234, marginPx: 96, min: 520, max: 3000 });
    const width = screen.getByTestId('margin-ruler-handle-r');
    expect(width.getAttribute('role')).toBe('slider');
    expect(width.getAttribute('aria-valuenow')).toBe('1234');
    expect(width.getAttribute('aria-valuemin')).toBe('520');
    expect(width.getAttribute('aria-valuemax')).toBe('3000');
    const margin = screen.getByTestId('margin-ruler-margin-handle-l');
    expect(margin.getAttribute('role')).toBe('slider');
    expect(margin.getAttribute('aria-valuenow')).toBe('96');
    expect(margin.getAttribute('aria-valuemin')).toBe('12');
    expect(margin.getAttribute('aria-valuemax')).toBe(String(Math.floor(1234 / 2) - 60));
  });

  // ── Inner pair (M1-S3) ──────────────────────────────────────────────────

  it('dragging the LEFT margin diamond toward the center grows the margin 1:1', () => {
    const { onMarginChange, onMarginCommit, onDragLive, onChange } = setup({ marginPx: 84 });
    const handle = screen.getByTestId('margin-ruler-margin-handle-l');
    fireEvent.mouseDown(handle, { clientX: 200 });
    fireEvent.mouseMove(window, { clientX: 230 }); // +30 toward center
    expect(onMarginChange).toHaveBeenCalledWith(114);
    expect(onDragLive).toHaveBeenCalledWith({ kind: 'margin', px: 114 });
    fireEvent.mouseUp(window, { clientX: 230 });
    expect(onMarginCommit).toHaveBeenCalledWith(114);
    expect(onDragLive).toHaveBeenLastCalledWith(null);
    expect(onChange).not.toHaveBeenCalled(); // margin drag never touches width
  });

  it('dragging the RIGHT margin diamond toward the center grows the margin', () => {
    const { onMarginChange } = setup({ marginPx: 84 });
    const handle = screen.getByTestId('margin-ruler-margin-handle-r');
    fireEvent.mouseDown(handle, { clientX: 800 });
    fireEvent.mouseMove(window, { clientX: 780 }); // -20 => toward center
    expect(onMarginChange).toHaveBeenCalledWith(104);
  });

  it('clamps the margin drag to [12, floor(w/2)-60]', () => {
    const { onMarginChange } = setup({ pageWidth: 1000, marginPx: 84 });
    const handle = screen.getByTestId('margin-ruler-margin-handle-l');
    fireEvent.mouseDown(handle, { clientX: 200 });
    fireEvent.mouseMove(window, { clientX: 5000 });
    expect(onMarginChange).toHaveBeenCalledWith(440); // floor(1000/2)-60
    fireEvent.mouseMove(window, { clientX: -5000 });
    expect(onMarginChange).toHaveBeenCalledWith(12);
  });

  it('arrow keys nudge the margin by 4px and commit immediately', () => {
    const { onMarginCommit } = setup({ marginPx: 84 });
    const handle = screen.getByTestId('margin-ruler-margin-handle-r');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onMarginCommit).toHaveBeenCalledWith(88);
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(onMarginCommit).toHaveBeenCalledWith(80);
  });

  it('locked pairs: an outer width drag moves the margin diamonds with the page edges but never calls the margin callbacks', () => {
    const { onMarginChange, onMarginCommit } = setup({ pageWidth: 1000, marginPx: 84 });
    const handle = screen.getByTestId('margin-ruler-handle-r');
    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 560 });
    fireEvent.mouseUp(window, { clientX: 560 });
    expect(onMarginChange).not.toHaveBeenCalled();
    expect(onMarginCommit).not.toHaveBeenCalled();
    // margin aria value is unchanged — the stored margin px never moved
    expect(
      screen.getByTestId('margin-ruler-margin-handle-l').getAttribute('aria-valuenow')
    ).toBe('84');
  });
});
