import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders icon, heading, and hint', () => {
    render(<EmptyState icon={<svg />} heading="No items yet" hint="Add one to get started." />);
    expect(screen.getByRole('heading', { name: 'No items yet' })).toBeTruthy();
    expect(screen.getByText('Add one to get started.')).toBeTruthy();
  });

  it('omits the action button when none is given', () => {
    render(<EmptyState icon={<svg />} heading="No items yet" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders and wires the action button when given', () => {
    const onClick = vi.fn();
    render(<EmptyState icon={<svg />} heading="No items yet" action={{ label: 'Add one', onClick }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add one' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
