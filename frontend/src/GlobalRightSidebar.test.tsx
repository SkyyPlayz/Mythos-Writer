import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import GlobalRightSidebar from './GlobalRightSidebar';

const noop = vi.fn();

const defaultProps = {
  visible: true,
  width: 300,
  onVisibilityChange: noop,
  onWidthChange: noop,
};

describe('GlobalRightSidebar M6 — thin wrapper', () => {
  it('renders the sidebar when visible=true', () => {
    render(<GlobalRightSidebar {...defaultProps} />);
    expect(screen.getByTestId('global-right-sidebar')).toBeInTheDocument();
  });

  it('renders collapsed edge with show button when visible=false', () => {
    render(<GlobalRightSidebar {...defaultProps} visible={false} />);
    expect(screen.queryByTestId('global-right-sidebar')).toBeNull();
    expect(screen.getByTestId('grs-edge')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show right sidebar/i })).toBeInTheDocument();
  });

  it('calls onVisibilityChange(false) when hide button is clicked', () => {
    const onVisibilityChange = vi.fn();
    render(<GlobalRightSidebar {...defaultProps} onVisibilityChange={onVisibilityChange} />);
    fireEvent.click(screen.getByRole('button', { name: /hide right sidebar/i }));
    expect(onVisibilityChange).toHaveBeenCalledWith(false);
  });

  it('calls onVisibilityChange(true) when show button is clicked from collapsed', () => {
    const onVisibilityChange = vi.fn();
    render(<GlobalRightSidebar {...defaultProps} visible={false} onVisibilityChange={onVisibilityChange} />);
    fireEvent.click(screen.getByRole('button', { name: /show right sidebar/i }));
    expect(onVisibilityChange).toHaveBeenCalledWith(true);
  });

  it('renders children inside the sidebar', () => {
    render(
      <GlobalRightSidebar {...defaultProps}>
        <div data-testid="sidebar-child">content</div>
      </GlobalRightSidebar>
    );
    expect(screen.getByTestId('sidebar-child')).toBeInTheDocument();
  });

  // M11b via SKY-9825: continuity flags are an AI surface — the whole section
  // (header + badge, not just the body) collapses when the master toggle is
  // off. In M6, GlobalRightSidebar itself is a thin content-agnostic wrapper —
  // Continuity now lives inside ContinuityPanel (rendered via the
  // `continuityPanel` slot passed through AgentHubPanel), which self-gates on
  // useAiEnabled(). That gating is covered by
  // ContinuityPanel.test.tsx ("ContinuityPanel — M11 master AI gate
  // (SKY-9825)"); nothing AI-toggle-specific remains to assert here.

  it('renders headerContent when passed (backward compat)', () => {
    render(
      <GlobalRightSidebar {...defaultProps} headerContent={<div data-testid="gs-panel">Getting Started</div>} />
    );
    expect(screen.getByTestId('gs-panel')).toBeInTheDocument();
  });

  it('has no panel controls — no Add Panel, no drag handles', () => {
    render(<GlobalRightSidebar {...defaultProps} />);
    expect(screen.queryByText(/add panel/i)).not.toBeInTheDocument();
    expect(screen.queryByText('⧉')).not.toBeInTheDocument();
  });

  it('applies the correct width style', () => {
    render(<GlobalRightSidebar {...defaultProps} width={350} />);
    const sidebar = screen.getByTestId('global-right-sidebar');
    expect(sidebar).toHaveStyle({ width: '350px' });
  });
});
