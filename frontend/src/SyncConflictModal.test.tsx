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
  it('renders the dialog heading', () => {
    render(<SyncConflictModal resolved={[]} lockfileConflict={null} onContinue={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText(/sync conflict detected/i)).toBeDefined();
  });

  it('shows resolved conflict file list', () => {
    render(<SyncConflictModal resolved={sampleResolved} lockfileConflict={null} onContinue={vi.fn()} />);
    expect(screen.getByText(/Manuscript\/Ch01\/scene\.md/)).toBeDefined();
    expect(screen.getByText('Dropbox')).toBeDefined();
    expect(screen.getByText(/archived older copy/i)).toBeDefined();
  });

  it('shows concurrent-session warning when lockfileConflict is provided', () => {
    render(<SyncConflictModal resolved={[]} lockfileConflict={sampleLockfile} onContinue={vi.fn()} />);
    expect(screen.getByText(/concurrent session warning/i)).toBeDefined();
    expect(screen.getByText(/other-machine\.local/)).toBeDefined();
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
