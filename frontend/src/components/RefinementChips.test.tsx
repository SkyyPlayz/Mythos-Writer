import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import RefinementChips from './RefinementChips';
import { BUNDLED_PRESETS, REFINEMENT_CHIPS, getEffectiveAxes } from '../presets';

const axes = getEffectiveAxes(BUNDLED_PRESETS[0].id, {});

describe('RefinementChips', () => {
  it('renders all refinement chip labels', () => {
    act(() => {
      render(<RefinementChips effectiveAxes={axes} onRefine={vi.fn()} />);
    });
    for (const chip of REFINEMENT_CHIPS) {
      expect(screen.getByText(chip.label)).toBeInTheDocument();
    }
  });

  it('calls onRefine with the chip object when clicked', () => {
    const onRefine = vi.fn();
    act(() => {
      render(<RefinementChips effectiveAxes={axes} onRefine={onRefine} />);
    });
    fireEvent.click(screen.getByText(REFINEMENT_CHIPS[0].label));
    expect(onRefine).toHaveBeenCalledWith(REFINEMENT_CHIPS[0]);
  });

  it('disables all chips when disabled prop is true', () => {
    act(() => {
      render(<RefinementChips effectiveAxes={axes} onRefine={vi.fn()} disabled />);
    });
    const buttons = screen.getAllByRole('button');
    for (const btn of buttons) {
      expect(btn).toBeDisabled();
    }
  });

  it('marks the active chip with aria-pressed=true', () => {
    act(() => {
      render(
        <RefinementChips
          effectiveAxes={axes}
          onRefine={vi.fn()}
          activeChipId={REFINEMENT_CHIPS[0].id}
        />,
      );
    });
    const activeBtn = screen.getByLabelText(
      `Refine: ${REFINEMENT_CHIPS[0].description}`,
    );
    expect(activeBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders the Refine label', () => {
    act(() => {
      render(<RefinementChips effectiveAxes={axes} onRefine={vi.fn()} />);
    });
    expect(screen.getByText('Refine:')).toBeInTheDocument();
  });
});
