import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PaneTip from './PaneTip';

describe('PaneTip', () => {
  it('renders tip text when not seen', () => {
    render(<PaneTip tipKey="editor" text="This is your writing canvas." seen={false} onDismiss={vi.fn()} />);
    expect(screen.getByTestId('pane-tip-editor')).toBeInTheDocument();
    expect(screen.getByText('This is your writing canvas.')).toBeInTheDocument();
  });

  it('renders nothing when seen=true', () => {
    render(<PaneTip tipKey="editor" text="This is your writing canvas." seen={true} onDismiss={vi.fn()} />);
    expect(screen.queryByTestId('pane-tip-editor')).not.toBeInTheDocument();
  });

  it('calls onDismiss with the tipKey when dismiss button clicked', () => {
    const onDismiss = vi.fn();
    render(<PaneTip tipKey="left-rail" text="Browse your stories here." seen={false} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('pane-tip-left-rail-dismiss'));
    expect(onDismiss).toHaveBeenCalledWith('left-rail');
  });

  it('dismiss button has accessible label', () => {
    render(<PaneTip tipKey="brainstorm" text="Generate ideas here." seen={false} onDismiss={vi.fn()} />);
    expect(screen.getByRole('button', { name: /dismiss tip/i })).toBeInTheDocument();
  });

  it('has role="note" for screen readers', () => {
    render(<PaneTip tipKey="notes" text="Your notes vault." seen={false} onDismiss={vi.fn()} />);
    expect(screen.getByRole('note')).toBeInTheDocument();
  });
});
