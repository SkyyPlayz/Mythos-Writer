import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GettingStartedPanel from './GettingStartedPanel';
import { createInitialGettingStartedProgress } from '../../gettingStartedReducer';

describe('GettingStartedPanel', () => {
  it('renders a labelled region with progress and four checklist actions', () => {
    render(
      <GettingStartedPanel
        progress={createInitialGettingStartedProgress('2026-06-11T00:00:00.000Z', 'blank')}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole('region', { name: /getting started/i })).toBeInTheDocument();
    expect(screen.getByText(/0 of 4 complete/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /write your first scene/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /add a character/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /try brainstorm/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /explore your notes vault/i })).toBeInTheDocument();
  });

  it('marks completed items as checked and updates progress', () => {
    const progress = createInitialGettingStartedProgress(undefined, 'blank', {
      completedItems: ['write-scene', 'notes-vault'],
    });

    render(<GettingStartedPanel progress={progress} onAction={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByText(/2 of 4 complete/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /write your first scene/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: /explore your notes vault/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: /add a character/i })).toHaveAttribute('aria-checked', 'false');
  });

  it('fires item actions and dismiss', () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(<GettingStartedPanel progress={createInitialGettingStartedProgress()} onAction={onAction} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /try brainstorm/i }));
    expect(onAction).toHaveBeenCalledWith('brainstorm');

    fireEvent.click(screen.getByRole('button', { name: /dismiss getting started/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
