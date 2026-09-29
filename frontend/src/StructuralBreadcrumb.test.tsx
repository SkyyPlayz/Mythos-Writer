import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import StructuralBreadcrumb from './StructuralBreadcrumb';

describe('StructuralBreadcrumb (F4#6/#7)', () => {
  it('renders the full structural path in order', () => {
    render(
      <StructuralBreadcrumb crumbs={['Book', 'Part 1', 'Chapter 2', 'Scene A']} />
    );
    const nav = screen.getByTestId('struct-breadcrumb');
    expect(nav.textContent).toContain('Book');
    expect(nav.textContent).toContain('Part 1');
    expect(nav.textContent).toContain('Chapter 2');
    expect(nav.textContent).toContain('Scene A');
  });

  it('marks the root crumb and gives it flex-shrink 0 (truncate last)', () => {
    render(<StructuralBreadcrumb crumbs={['Root Book', 'Ch. 1', 'Opening']} />);
    const root = screen.getByTestId('struct-breadcrumb-root');
    expect(root).toHaveClass('struct-breadcrumb__item--root');
    expect(root.style.flexShrink).toBe('0');
    const leaf = screen.getByTestId('struct-breadcrumb-item-2');
    expect(Number(leaf.style.flexShrink)).toBeGreaterThan(0);
  });

  it('applies full-outline current class on the active crumb', () => {
    render(<StructuralBreadcrumb crumbs={['Book', 'Part', 'Scene']} />);
    const current = screen.getByTestId('struct-breadcrumb-item-2');
    expect(current).toHaveClass('struct-breadcrumb__item--current');
    expect(current).toHaveAttribute('aria-current', 'location');
  });
});
