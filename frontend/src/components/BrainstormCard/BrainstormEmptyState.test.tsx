import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrainstormEmptyState } from './BrainstormEmptyState';

describe('BrainstormEmptyState', () => {
  it('renders heading and Notes Vault sub-copy', () => {
    render(<BrainstormEmptyState onSeedPrompt={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /no facts yet/i })).toBeTruthy();
    expect(screen.getByText(/Notes Vault/)).toBeTruthy();
    expect(screen.getByText(/not your Story Vault/)).toBeTruthy();
  });

  it('renders 3 CTA buttons', () => {
    render(<BrainstormEmptyState onSeedPrompt={vi.fn()} />);
    const btns = screen.getAllByRole('button');
    expect(btns.length).toBe(3);
  });

  it('calls onSeedPrompt with a non-empty string when a CTA is clicked', () => {
    const seed = vi.fn();
    render(<BrainstormEmptyState onSeedPrompt={seed} />);
    fireEvent.click(screen.getByRole('button', { name: /describe a character/i }));
    expect(seed).toHaveBeenCalledTimes(1);
    const arg: unknown = seed.mock.calls[0][0];
    expect(typeof arg).toBe('string');
    expect((arg as string).length).toBeGreaterThan(0);
  });

  it('calls onSeedPrompt for each CTA with distinct text', () => {
    const seed = vi.fn();
    render(<BrainstormEmptyState onSeedPrompt={seed} />);
    for (const btn of screen.getAllByRole('button')) {
      fireEvent.click(btn);
    }
    const texts = seed.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(new Set(texts).size).toBe(3);
  });
});
