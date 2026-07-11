import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MarginRuler from './MarginRuler';

describe('MarginRuler', () => {
  it('renders with ARIA roles', () => {
    render(<MarginRuler widthPx={794} onWidthChange={vi.fn()} />);
    expect(screen.getByRole('presentation')).toBeInTheDocument();
    expect(screen.getByLabelText(/left page margin handle/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/right page margin handle/i)).toBeInTheDocument();
  });

  it('displays width readout matching widthPx prop', () => {
    render(<MarginRuler widthPx={794} onWidthChange={vi.fn()} />);
    expect(screen.getByText('794 px')).toBeInTheDocument();
  });

  it('calls onWidthChange with clamped value when widthPx > 3000', () => {
    const onWidthChange = vi.fn();
    render(<MarginRuler widthPx={9999} onWidthChange={onWidthChange} />);
    // useEffect on mount clamps and calls onWidthChange with 3000
    expect(onWidthChange).toHaveBeenCalledWith(3000);
  });

  it('calls onWidthChange with clamped value when widthPx < 520', () => {
    const onWidthChange = vi.fn();
    render(<MarginRuler widthPx={100} onWidthChange={onWidthChange} />);
    expect(onWidthChange).toHaveBeenCalledWith(520);
  });

  it('does not call onWidthChange when widthPx is within range', () => {
    const onWidthChange = vi.fn();
    render(<MarginRuler widthPx={794} onWidthChange={onWidthChange} />);
    expect(onWidthChange).not.toHaveBeenCalled();
  });
});
