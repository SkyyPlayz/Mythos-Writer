import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConcurrentSessionModal, { type LockfileConflictInfo } from './ConcurrentSessionModal';

const sampleLockfile: LockfileConflictInfo = {
  hostname: 'other-machine.local',
  pid: 12345,
  timestamp: '2024-01-15T12:00:00.000Z',
};

describe('ConcurrentSessionModal', () => {
  it('names the host holding the vault lock', () => {
    render(<ConcurrentSessionModal lockfileConflict={sampleLockfile} onContinue={vi.fn()} />);
    expect(screen.getByText('other-machine.local')).toBeDefined();
    expect(screen.getByText(/already open elsewhere/i)).toBeDefined();
  });

  it('raises the concurrent-session warning as an alert', () => {
    render(<ConcurrentSessionModal lockfileConflict={sampleLockfile} onContinue={vi.fn()} />);
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('calls onContinue(false) when Continue is clicked without suppressing', () => {
    const onContinue = vi.fn();
    render(<ConcurrentSessionModal lockfileConflict={sampleLockfile} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledWith(false);
  });

  it('calls onContinue(true) when "don\'t show again" is checked', () => {
    const onContinue = vi.fn();
    render(<ConcurrentSessionModal lockfileConflict={sampleLockfile} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledWith(true);
  });

  it('labels the dialog and links its description for screen readers', () => {
    render(<ConcurrentSessionModal lockfileConflict={sampleLockfile} onContinue={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('SKY-11804: carries no branded cloud-provider copy', () => {
    const { container } = render(
      <ConcurrentSessionModal lockfileConflict={sampleLockfile} onContinue={vi.fn()} />,
    );
    expect(container.textContent).not.toMatch(/dropbox|icloud|onedrive|google drive|syncthing/i);
  });
});
