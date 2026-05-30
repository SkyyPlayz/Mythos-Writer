// SKY-10: MigrationBanner — banner + dry-run modal flow.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MigrationBanner } from './index';

function mkPlan(storyPath: string, legacyFiles: string[]): MigrationPlan {
  return {
    planId: `plan-${storyPath}`,
    storyPath,
    detectedLegacyFiles: legacyFiles,
    changes: legacyFiles.flatMap((file) => [
      {
        kind: 'create-dir',
        path: file.replace(/\.md$/, ''),
        description: `Create chapter folder`,
      },
      {
        kind: 'snapshot-legacy',
        path: file,
        description: `Archive original as migration-intent snapshot`,
      },
    ]),
    createdAt: '2026-05-28T22:00:00Z',
  };
}

function installApi(plans: MigrationPlan[]) {
  const migrationDryRun = vi.fn().mockResolvedValue({ plans });
  const migrationApply = vi.fn().mockResolvedValue({
    result: { planId: '', storyPath: '', appliedChanges: 1, snapshotsWritten: [] },
  });
  (window as unknown as { api: Record<string, unknown> }).api = { migrationDryRun, migrationApply };
  return { migrationDryRun, migrationApply };
}

describe('MigrationBanner', () => {
  beforeEach(() => {
    delete (window as unknown as { api?: unknown }).api;
  });

  it('renders nothing when there are no plans to migrate', async () => {
    installApi([]);
    const { container } = render(<MigrationBanner />);
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('summarises legacy file count and opens the dry-run modal on Review', async () => {
    installApi([
      mkPlan('Manuscript/Story A', ['Manuscript/Story A/01.md', 'Manuscript/Story A/02.md']),
    ]);
    render(<MigrationBanner />);
    await waitFor(() => expect(screen.getByText(/2 legacy chapter files/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /review migration/i }));
    expect(screen.getByRole('dialog', { name: /migration preview/i })).toBeTruthy();
  });

  it('applies all plans on Migrate, then hides the banner', async () => {
    const { migrationApply } = installApi([
      mkPlan('Manuscript/Story A', ['Manuscript/Story A/01.md']),
      mkPlan('Manuscript/Story B', ['Manuscript/Story B/03.md']),
    ]);
    render(<MigrationBanner />);
    await waitFor(() => screen.getByText(/2 legacy chapter files/i));
    fireEvent.click(screen.getByRole('button', { name: /review migration/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Migrate' }));
    await waitFor(() => expect(migrationApply).toHaveBeenCalledTimes(2));
  });

  it('honors initialPlans prop and skips the dry-run call', () => {
    const { migrationDryRun } = installApi([]);
    render(
      <MigrationBanner initialPlans={[mkPlan('Manuscript/Story', ['Manuscript/Story/X.md'])]} />,
    );
    expect(screen.getByText(/1 legacy chapter file/i)).toBeTruthy();
    expect(migrationDryRun).not.toHaveBeenCalled();
  });
});
