// SKY-795 — Filter bar smoke tests covering the user-visible spec behaviours.

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TimelineFilterBar from './TimelineFilterBar';
import { DEFAULT_FILTERS } from './timelineFilters';

const ARCS = [
  { id: 'arc-alpha', title: 'Alpha Arc', color: '#7c6af7' },
  { id: 'arc-beta', title: 'Beta Arc', color: '#00f0ff' },
];
const CHARS = [{ id: 'char-1', name: 'Alice' }, { id: 'char-2', name: 'Bob' }];
const LOCS = [{ id: 'loc-1', name: 'Castle' }];

describe('TimelineFilterBar', () => {
  it('renders all four entity tabs', () => {
    render(
      <TimelineFilterBar
        filters={DEFAULT_FILTERS}
        onFiltersChange={vi.fn()}
        arcs={ARCS}
        characters={CHARS}
        locations={LOCS}
      />,
    );
    expect(screen.getByRole('tab', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Character' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Arc' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Location' })).toBeInTheDocument();
  });

  it('marks the active tab with aria-selected', () => {
    render(
      <TimelineFilterBar
        filters={{ ...DEFAULT_FILTERS, entityTab: 'arc' }}
        onFiltersChange={vi.fn()}
        arcs={ARCS}
        characters={CHARS}
        locations={LOCS}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Arc' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'false');
  });

  it('clicking a tab calls onFiltersChange with the new tab and clears entityValue', () => {
    const onChange = vi.fn();
    render(
      <TimelineFilterBar
        filters={{ ...DEFAULT_FILTERS, entityTab: 'character', entityValue: 'char-1' }}
        onFiltersChange={onChange}
        arcs={ARCS}
        characters={CHARS}
        locations={LOCS}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Arc' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ entityTab: 'arc', entityValue: '' }),
    );
  });

  it('renders the entity-value selector with character options when on the character tab', () => {
    render(
      <TimelineFilterBar
        filters={{ ...DEFAULT_FILTERS, entityTab: 'character' }}
        onFiltersChange={vi.fn()}
        arcs={ARCS}
        characters={CHARS}
        locations={LOCS}
      />,
    );
    const select = screen.getByLabelText('Filter to a single character');
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Alice' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Bob' })).toBeInTheDocument();
  });

  it('arc-focus selector lists every arc and emits focusedArcId on change', () => {
    const onChange = vi.fn();
    render(
      <TimelineFilterBar
        filters={DEFAULT_FILTERS}
        onFiltersChange={onChange}
        arcs={ARCS}
        characters={CHARS}
        locations={LOCS}
      />,
    );
    const focusSelect = screen.getByLabelText(/selected arc stays vivid/i);
    fireEvent.change(focusSelect, { target: { value: 'arc-beta' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ focusedArcId: 'arc-beta' }),
    );
  });

  it('date inputs emit dateFrom / dateTo updates', () => {
    const onChange = vi.fn();
    render(
      <TimelineFilterBar
        filters={DEFAULT_FILTERS}
        onFiltersChange={onChange}
        arcs={ARCS}
        characters={CHARS}
        locations={LOCS}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Hide scenes before this date/), {
      target: { value: '2024-06-01' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ dateFrom: '2024-06-01' }),
    );

    fireEvent.change(screen.getByLabelText(/Hide scenes after this date/), {
      target: { value: '2024-12-31' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ dateTo: '2024-12-31' }),
    );
  });

  it('shows a Clear button only when a date range is set', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TimelineFilterBar
        filters={DEFAULT_FILTERS}
        onFiltersChange={onChange}
        arcs={ARCS}
        characters={CHARS}
        locations={LOCS}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Clear date range' })).toBeNull();

    rerender(
      <TimelineFilterBar
        filters={{ ...DEFAULT_FILTERS, dateFrom: '2024-06-01' }}
        onFiltersChange={onChange}
        arcs={ARCS}
        characters={CHARS}
        locations={LOCS}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear date range' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '', dateTo: '' }),
    );
  });
});
