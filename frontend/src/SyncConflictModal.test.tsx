import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SyncConflictModal, { type ResolvedConflictInfo, type LockfileConflictInfo } from './SyncConflictModal';

const sampleResolved: ResolvedConflictInfo[] = [
  {
    conflictPath: 'Manuscript/Ch01/scene (conflicted copy 2024-01-15).md',
    originalPath: 'Manuscript/Ch01/scene.md',
    provider: 'dropbox',
    keptPath: 'Manuscript/Ch01/scene.md',
    archivedPath: '.mythos/.archive/2024-01-15T12-00-00Z/scene (conflicted copy 2024-01-15).md',
    resolvedAt: '2024-01-15T12:00:00.000Z',
  },
];

const sampleLockfile: LockfileConflictInfo = {
  hostname: 'other-machine.local',
  pid: 12345,
  timestamp: '2024-01-15T12:00:00.000Z',
};

describe('SyncConflictModal', () => {
  it('labels the dialog from the visible heading and body', () => {
    render(<SyncConflictModal resolved={sampleResolved} lockfileConflict={null} onContinue={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    const heading = screen.getByRole('heading', { name: /sync conflict detected/i });
    const body = dialog.querySelector('.scm-body');

    expect(dialog.getAttribute('aria-label')).toBeNull();
    expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(dialog.getAttribute('aria-describedby')).toBe(body?.id);
  });

  it('shows resolved conflict file list', () => {
    render(<SyncConflictModal resolved={sampleResolved} lockfileConflict={null} onContinue={vi.fn()} />);
    expect(screen.getByText('scene.md')).toBeDefined();
    expect(screen.queryByText(/Manuscript\/Ch01\/scene\.md/)).toBeNull();
    expect(screen.getByText('Dropbox')).toBeDefined();
    expect(screen.getByText(/older version archived/i)).toBeDefined();
  });

  it('adds the provider-specific class to conflict badges', () => {
    render(<SyncConflictModal resolved={sampleResolved} lockfileConflict={null} onContinue={vi.fn()} />);
    expect(screen.getByText('Dropbox').classList.contains('scm-provider-badge--dropbox')).toBe(true);
  });

  it('shows concurrent-session warning when lockfileConflict is provided', () => {
    render(<SyncConflictModal resolved={[]} lockfileConflict={sampleLockfile} onContinue={vi.fn()} />);
    expect(screen.getByText(/another session is open/i)).toBeDefined();
    expect(screen.getByText(/other-machine\.local/)).toBeDefined();
    expect(screen.queryByText(/12345/)).toBeNull();
  });

  it('calls onContinue(false) when Escape is pressed', () => {
    const onContinue = vi.fn();
    render(<SyncConflictModal resolved={sampleResolved} lockfileConflict={null} onContinue={onContinue} />);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledWith(false);
  });

  it('wraps Tab from Continue to the checkbox', () => {
    render(<SyncConflictModal resolved={sampleResolved} lockfileConflict={null} onContinue={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    const checkbox = screen.getByRole('checkbox');
    const continueButton = screen.getByRole('button', { name: /continue/i });

    continueButton.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });

    expect(document.activeElement).toBe(checkbox);
  });

  it('wraps Shift+Tab from the checkbox to Continue', () => {
    render(<SyncConflictModal resolved={sampleResolved} lockfileConflict={null} onContinue={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    const checkbox = screen.getByRole('checkbox');
    const continueButton = screen.getByRole('button', { name: /continue/i });

    checkbox.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(continueButton);
  });

  it('uses the full kept path as the row title', () => {
    render(<SyncConflictModal resolved={sampleResolved} lockfileConflict={null} onContinue={vi.fn()} />);

    expect(screen.getByText('scene.md').getAttribute('title')).toBe('Manuscript/Ch01/scene.md');
  });

  it('uses a recovery-oriented archive tooltip', () => {
    render(<SyncConflictModal resolved={sampleResolved} lockfileConflict={null} onContinue={vi.fn()} />);

    expect(screen.getByText(/older version archived/i).getAttribute('title')).toBe(
      'Older version saved to: .mythos/.archive/2024-01-15T12-00-00Z/scene (conflicted copy 2024-01-15).md',
    );
  });

  it('calls onContinue(false) when Continue clicked without checking the box', () => {
    const onContinue = vi.fn();
    render(<SyncConflictModal resolved={sampleResolved} lockfileConflict={null} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledWith(false);
  });

  it('calls onContinue(true) when "don\'t show again" is checked before clicking Continue', () => {
    const onContinue = vi.fn();
    render(<SyncConflictModal resolved={sampleResolved} lockfileConflict={null} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onContinue).toHaveBeenCalledWith(true);
  });

  it('renders without crashing when resolved is empty and no lockfile', () => {
    const { container } = render(
      <SyncConflictModal resolved={[]} lockfileConflict={null} onContinue={vi.fn()} />,
    );
    expect(container.querySelector('.scm-dialog')).not.toBeNull();
  });

  it('shows the "don\'t show again" checkbox', () => {
    render(<SyncConflictModal resolved={sampleResolved} lockfileConflict={null} onContinue={vi.fn()} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeDefined();
  });
});
