import { render, screen, fireEvent, act } from '@testing-library/react';
import Toast from './index';

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders message and close button', () => {
    render(<Toast message="Template saved as 'My Novel'" onDismiss={vi.fn()} />);
    expect(screen.getByTestId('app-toast')).toHaveTextContent("Template saved as 'My Novel'");
    expect(screen.getByTestId('app-toast-close')).toBeInTheDocument();
  });

  it('applies success variant class by default', () => {
    render(<Toast message="ok" onDismiss={vi.fn()} />);
    expect(screen.getByTestId('app-toast')).toHaveClass('app-toast--success');
  });

  it('applies error variant class when variant=error', () => {
    render(<Toast message="Something failed" variant="error" onDismiss={vi.fn()} />);
    expect(screen.getByTestId('app-toast')).toHaveClass('app-toast--error');
  });

  it('calls onDismiss when close button is clicked', () => {
    const onDismiss = vi.fn();
    render(<Toast message="ok" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('app-toast-close'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses after durationMs (default 4000ms)', () => {
    const onDismiss = vi.fn();
    render(<Toast message="ok" onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(4000); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses after custom durationMs', () => {
    const onDismiss = vi.fn();
    render(<Toast message="ok" onDismiss={onDismiss} durationMs={1500} />);
    act(() => { vi.advanceTimersByTime(1499); });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('uses role=status for success variant', () => {
    render(<Toast message="ok" variant="success" onDismiss={vi.fn()} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('uses role=alert for error variant', () => {
    render(<Toast message="err" variant="error" onDismiss={vi.fn()} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
