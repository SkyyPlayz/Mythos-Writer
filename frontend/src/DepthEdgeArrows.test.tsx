import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DepthEdgeArrows from './DepthEdgeArrows';

function makeProps(overrides: Partial<Parameters<typeof DepthEdgeArrows>[0]> = {}) {
  return {
    depth: 'scene' as const,
    canPrev: true,
    canNext: true,
    onPrev: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  };
}

describe('DepthEdgeArrows (GH #631 / AC-C-4)', () => {
  it('renders prev/next buttons with depth-specific labels at scene depth', () => {
    render(<DepthEdgeArrows {...makeProps()} />);
    expect(screen.getByRole('button', { name: 'Previous scene' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next scene' })).toBeInTheDocument();
  });

  it('labels the arrows by depth (chapter)', () => {
    render(<DepthEdgeArrows {...makeProps({ depth: 'chapter' })} />);
    expect(screen.getByRole('button', { name: 'Previous chapter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next chapter' })).toBeInTheDocument();
  });

  it('labels the arrows by depth (book → story)', () => {
    render(<DepthEdgeArrows {...makeProps({ depth: 'book' })} />);
    expect(screen.getByRole('button', { name: 'Previous story' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next story' })).toBeInTheDocument();
  });

  it('invokes the step handlers on click', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<DepthEdgeArrows {...makeProps({ onPrev, onNext })} />);
    fireEvent.click(screen.getByTestId('edge-arrow-prev'));
    expect(onPrev).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('edge-arrow-next'));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('disables arrows at the boundaries (TC-DS-07 bounded semantics)', () => {
    render(<DepthEdgeArrows {...makeProps({ canPrev: false, canNext: false })} />);
    expect(screen.getByTestId('edge-arrow-prev')).toBeDisabled();
    expect(screen.getByTestId('edge-arrow-next')).toBeDisabled();
  });

  it('prevents mousedown default so editor focus is not stolen', () => {
    render(<DepthEdgeArrows {...makeProps()} />);
    const evt = fireEvent.mouseDown(screen.getByTestId('edge-arrow-next'));
    // fireEvent returns false when preventDefault was called.
    expect(evt).toBe(false);
  });
});
