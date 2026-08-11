import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import GlobalRightSidebar, { DEFAULT_PANELS } from './GlobalRightSidebar';

const defaultProps = {
  visible: true,
  width: 300,
  onVisibilityChange: vi.fn(),
  onWidthChange: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GlobalRightSidebar (M6 thin shell)', () => {
  it('renders data-testid="global-right-sidebar" when visible=true', () => {
    render(<GlobalRightSidebar {...defaultProps} />);
    expect(screen.getByTestId('global-right-sidebar')).toBeInTheDocument();
  });

  it('renders grs-edge and show button when visible=false', () => {
    render(<GlobalRightSidebar {...defaultProps} visible={false} />);
    expect(screen.getByTestId('grs-edge')).toBeInTheDocument();
    expect(screen.queryByTestId('global-right-sidebar')).toBeNull();
    expect(screen.getByRole('button', { name: /show right sidebar/i })).toBeInTheDocument();
  });

  it('calls onVisibilityChange(false) when hide button clicked', () => {
    const onVisibilityChange = vi.fn();
    render(<GlobalRightSidebar {...defaultProps} onVisibilityChange={onVisibilityChange} />);
    fireEvent.click(screen.getByRole('button', { name: /hide right sidebar/i }));
    expect(onVisibilityChange).toHaveBeenCalledWith(false);
  });

  it('calls onVisibilityChange(true) when show button clicked from collapsed', () => {
    const onVisibilityChange = vi.fn();
    render(<GlobalRightSidebar {...defaultProps} visible={false} onVisibilityChange={onVisibilityChange} />);
    fireEvent.click(screen.getByRole('button', { name: /show right sidebar/i }));
    expect(onVisibilityChange).toHaveBeenCalledWith(true);
  });

  it('has no panel controls (no "Add Panel", no drag handles, no ⧉ buttons)', () => {
    render(<GlobalRightSidebar {...defaultProps} />);
    expect(screen.queryByRole('button', { name: /add panel/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /move /i })).toBeNull();
    expect(screen.queryByTitle('Float to window')).toBeNull();
  });

  it('renders children inside the sidebar', () => {
    render(
      <GlobalRightSidebar {...defaultProps}>
        <div data-testid="agent-hub">Agent Hub</div>
      </GlobalRightSidebar>,
    );
    expect(screen.getByTestId('agent-hub')).toBeInTheDocument();
  });

  it('renders headerContent when passed', () => {
    render(
      <GlobalRightSidebar
        {...defaultProps}
        headerContent={<div data-testid="header-content">Getting Started</div>}
      />,
    );
    expect(screen.getByTestId('header-content')).toBeInTheDocument();
  });

  it('DEFAULT_PANELS export is an empty array', () => {
    expect(DEFAULT_PANELS).toEqual([]);
  });
});
