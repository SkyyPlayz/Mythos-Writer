import { render, screen, fireEvent } from '@testing-library/react';
import { WritingAssistantStatusBar } from './WritingAssistantStatusBar';

describe('WritingAssistantStatusBar', () => {
  describe('scanning state (AC6)', () => {
    it('renders scanning label with spinner', () => {
      render(<WritingAssistantStatusBar state="scanning" />);
      expect(screen.getByRole('status', { name: 'Scanning' })).toBeInTheDocument();
      expect(screen.getByText('Scanning…')).toBeInTheDocument();
    });

    it('spinner element is present', () => {
      const { container } = render(<WritingAssistantStatusBar state="scanning" />);
      expect(container.querySelector('.wa-spinner')).toBeInTheDocument();
    });
  });

  describe('idle state (AC7)', () => {
    it('renders Ready label with checkmark', () => {
      render(<WritingAssistantStatusBar state="idle" />);
      expect(screen.getByRole('status', { name: 'Ready' })).toBeInTheDocument();
      expect(screen.getByText('Ready')).toBeInTheDocument();
      expect(screen.getByText('✓')).toBeInTheDocument();
    });

    it('shows formatted timestamp when lastScannedAt provided', () => {
      const ts = '2026-06-18T10:30:00.000Z';
      render(<WritingAssistantStatusBar state="idle" lastScannedAt={ts} />);
      const formatted = new Date(ts).toLocaleTimeString();
      expect(screen.getByText(formatted)).toBeInTheDocument();
    });

    it('omits timestamp when lastScannedAt is null', () => {
      const { container } = render(<WritingAssistantStatusBar state="idle" lastScannedAt={null} />);
      expect(container.querySelector('.wa-status-bar__time')).not.toBeInTheDocument();
    });
  });

  describe('empty state (AC8)', () => {
    it('renders encouraging message', () => {
      render(<WritingAssistantStatusBar state="empty" />);
      expect(screen.getByRole('status', { name: 'No suggestions yet' })).toBeInTheDocument();
      expect(screen.getByText(/write a bit more/i)).toBeInTheDocument();
    });
  });

  describe('error state (AC9)', () => {
    it('renders warning icon and error message', () => {
      render(
        <WritingAssistantStatusBar state="error" errorMessage="Provider unavailable." />,
      );
      expect(screen.getByRole('alert', { name: 'Error' })).toBeInTheDocument();
      expect(screen.getByText('⚠')).toBeInTheDocument();
      expect(screen.getByText('Provider unavailable.')).toBeInTheDocument();
    });

    it('shows fallback message when errorMessage is not provided', () => {
      render(<WritingAssistantStatusBar state="error" />);
      expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
    });

    it('renders Retry button and calls onRetry when clicked', () => {
      const onRetry = vi.fn();
      render(
        <WritingAssistantStatusBar state="error" errorMessage="Scan failed." onRetry={onRetry} />,
      );
      const btn = screen.getByRole('button', { name: 'Retry scan' });
      expect(btn).toBeInTheDocument();
      fireEvent.click(btn);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('omits Retry button when onRetry is not provided', () => {
      render(<WritingAssistantStatusBar state="error" errorMessage="Scan failed." />);
      expect(screen.queryByRole('button', { name: 'Retry scan' })).not.toBeInTheDocument();
    });
  });
});
