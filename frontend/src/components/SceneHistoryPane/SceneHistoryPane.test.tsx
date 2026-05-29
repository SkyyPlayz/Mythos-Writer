// SKY-10: SceneHistoryPane component tests.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SceneHistoryPane } from './index';

type Version = SceneVersion;

function mkVersion(ts: string, intent: VersionIntent, content: string): Version {
  return {
    sceneId: 'scene-1',
    ts,
    content,
    intent,
    contentHash: 'aa'.repeat(32),
  };
}

function installApi(versions: Version[]) {
  const versionList = vi.fn().mockResolvedValue({ versions });
  const versionRollback = vi.fn().mockResolvedValue({
    restoredVersion: versions[versions.length - 1] ?? mkVersion('x', 'save', ''),
    preRollbackVersion: mkVersion('z', 'pre-rollback', 'current'),
  });
  (window as unknown as { api: Record<string, unknown> }).api = {
    versionList,
    versionRollback,
  };
  return { versionList, versionRollback };
}

describe('SceneHistoryPane', () => {
  beforeEach(() => {
    delete (window as unknown as { api?: unknown }).api;
  });

  it('renders an empty-state hint when no scene is selected', () => {
    render(<SceneHistoryPane sceneId={null} currentLength={0} />);
    expect(screen.getByText(/open a scene to see its history/i)).toBeTruthy();
  });

  it('lists snapshots newest-first with intent + delta info', async () => {
    installApi([
      mkVersion('2026-05-28T22-31-04-123Z-aabbccdd', 'save', 'twelve chars'),
      mkVersion('2026-05-28T22-30-00-000Z-11223344', 'auto', 'five'),
    ]);
    render(<SceneHistoryPane sceneId="scene-1" currentLength={10} />);
    await waitFor(() => expect(screen.getAllByRole('option').length).toBe(2));
    const rows = screen.getAllByRole('option');
    expect(rows[0].getAttribute('data-testid')).toContain('aabbccdd');
    expect(rows[0].textContent).toMatch(/save/);
    expect(rows[1].textContent).toMatch(/auto/);
  });

  it('shows a confirm dialog before restoring and only fires rollback on confirm', async () => {
    const { versionRollback } = installApi([
      mkVersion('2026-05-28T22-31-04-123Z-aabbccdd', 'save', 'body'),
    ]);
    render(<SceneHistoryPane sceneId="scene-1" currentLength={10} />);
    await waitFor(() => expect(screen.getAllByRole('option').length).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: /restore snapshot/i }));
    expect(screen.getByRole('dialog', { name: /confirm restore/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(versionRollback).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /restore snapshot/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore', hidden: false }));
    await waitFor(() => expect(versionRollback).toHaveBeenCalledOnce());
  });

  it('renders an empty list message when versionList returns no snapshots', async () => {
    installApi([]);
    render(<SceneHistoryPane sceneId="scene-1" currentLength={0} />);
    await waitFor(() => expect(screen.getByText(/no previous versions yet/i)).toBeTruthy());
  });

  it('surfaces version-list errors in an alert role', async () => {
    const versionList = vi.fn().mockRejectedValue(new Error('disk gone'));
    (window as unknown as { api: Record<string, unknown> }).api = {
      versionList,
      versionRollback: vi.fn(),
    };
    render(<SceneHistoryPane sceneId="scene-1" currentLength={0} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/disk gone/));
  });

  it('keyboard nav: ArrowDown / ArrowUp move the active row, Shift+Enter opens confirm', async () => {
    installApi([
      mkVersion('2026-05-28T22-31-04-123Z-aabbccdd', 'save', 'body-1'),
      mkVersion('2026-05-28T22-30-00-000Z-11223344', 'auto', 'body-2'),
    ]);
    render(<SceneHistoryPane sceneId="scene-1" currentLength={5} />);
    await waitFor(() => expect(screen.getAllByRole('option').length).toBe(2));

    const list = screen.getByRole('listbox');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(list, { key: 'Enter', shiftKey: true });
    expect(screen.getByRole('dialog', { name: /confirm restore/i })).toBeTruthy();
  });
});
