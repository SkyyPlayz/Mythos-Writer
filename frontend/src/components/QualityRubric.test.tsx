import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QualityRubric from './QualityRubric';

describe('QualityRubric', () => {
  it('renders the panel with all 6 criteria', () => {
    render(<QualityRubric onClose={vi.fn()} />);
    expect(screen.getByText(/Specificity/i)).toBeInTheDocument();
    expect(screen.getByText(/Coherence/i)).toBeInTheDocument();
    expect(screen.getByText(/Genre Fit/i)).toBeInTheDocument();
    expect(screen.getByText(/Constraint Respect/i)).toBeInTheDocument();
    expect(screen.getByText(/Usefulness as Starter/i)).toBeInTheDocument();
    expect(screen.getByText(/Actionability/i)).toBeInTheDocument();
  });

  it('renders 3 star buttons per criterion', () => {
    render(<QualityRubric onClose={vi.fn()} />);
    // 6 criteria × 3 stars = 18 star buttons
    const starBtns = screen.getAllByRole('button', { name: /star/i });
    expect(starBtns.length).toBe(18);
  });

  it('shows no average when no stars are rated', () => {
    render(<QualityRubric onClose={vi.fn()} />);
    expect(screen.queryByText(/Score:/i)).not.toBeInTheDocument();
  });

  it('shows average score after rating a criterion', () => {
    render(<QualityRubric onClose={vi.fn()} />);
    const twoStarBtn = screen.getAllByRole('button', { name: /2 star/i })[0];
    fireEvent.click(twoStarBtn);
    expect(screen.getByText(/Score:/i)).toBeInTheDocument();
    expect(screen.getByText(/2\.0/)).toBeInTheDocument();
  });

  it('calculates average across multiple rated criteria', () => {
    render(<QualityRubric onClose={vi.fn()} />);
    // Rate criterion 1 = 3 stars, criterion 2 = 1 star → avg = 2.0
    const threeStarBtns = screen.getAllByRole('button', { name: /3 star/i });
    const oneStarBtns = screen.getAllByRole('button', { name: /1 star/i });
    fireEvent.click(threeStarBtns[0]);
    fireEvent.click(oneStarBtns[1]);
    expect(screen.getByText(/Score:/i)).toBeInTheDocument();
    expect(screen.getByText(/2\.0/)).toBeInTheDocument();
  });

  it('shows low-score warning when avg < 2', () => {
    render(<QualityRubric onClose={vi.fn()} />);
    const oneStarBtns = screen.getAllByRole('button', { name: /1 star/i });
    fireEvent.click(oneStarBtns[0]);
    expect(screen.getByText(/consider refining or rejecting/i)).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<QualityRubric onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close quality rubric/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn();
    render(<QualityRubric onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows anchor text when a star is selected', () => {
    render(<QualityRubric onClose={vi.fn()} />);
    // Click 1-star on Specificity (first criterion)
    fireEvent.click(screen.getAllByRole('button', { name: /1 star/i })[0]);
    // Anchor text for specificity 1-star
    expect(screen.getByText(/Vague, clichéd, or generic phrasing/i)).toBeInTheDocument();
  });

  it('marks star as aria-pressed when selected', () => {
    render(<QualityRubric onClose={vi.fn()} />);
    const threeStarBtn = screen.getAllByRole('button', { name: /3 star/i })[0];
    fireEvent.click(threeStarBtn);
    expect(threeStarBtn).toHaveAttribute('aria-pressed', 'true');
  });
});
