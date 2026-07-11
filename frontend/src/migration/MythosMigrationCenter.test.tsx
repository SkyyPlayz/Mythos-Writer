// Beta 4 M5 — migration prompt + wizard flow tests (IPC mocked).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import MythosMigrationCenter, { openMythosMigrationWizard } from './MythosMigrationCenter';

const v04Status: MythosMigrationStatus = {
  format: 'v0.4-twin-root',
  shouldPrompt: true,
  storyVaultRoot: '/vaults/My Vault/Story Vault',
  notesVaultRoot: '/vaults/My Vault/Notes Vault',
  vaultName: 'My Vault',
  suggestedTarget: '/vaults/My Vault (MythosVault)',
};

const planResult: MythosMigrationPlanResult = {
  ok: true,
  plan: {
    targetRoot: '/vaults/My Vault (MythosVault)',
    vaultName: 'My Vault',
    stories: 2, chapters: 3, scenes: 4, noteFiles: 5,
    commentFiles: 1, betaCommentRows: 1,
    versionSnapshots: 2, fileSnapshots: 1, dbSnapshotRows: 0,
    timelineArcs: 1, timelineSceneEntries: 1,
    warnings: [],
  },
};

const runResult: MythosMigrationRunResult = {
  ok: true,
  targetRoot: '/vaults/My Vault (MythosVault)',
  counts: { stories: 2, chapters: 3, scenes: 4, notes: 5, comments: 2, drafts: 3, extras: 1 },
  verified: { scenesChecked: 4, notesChecked: 5, mismatches: [] },
};

const mockStatus = vi.fn();
const mockPlan = vi.fn();
const mockRun = vi.fn();
const mockConfirm = vi.fn();
const mockDismiss = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockStatus.mockResolvedValue(v04Status);
  mockPlan.mockResolvedValue(planResult);
  mockRun.mockResolvedValue(runResult);
  mockConfirm.mockResolvedValue({ switched: true, vaultRoot: '/x', notesVaultRoot: '/y' });
  mockDismiss.mockResolvedValue({ dismissed: true });
  Object.defineProperty(window, 'api', {
    value: {
      mythosMigrationStatus: mockStatus,
      mythosMigrationPlan: mockPlan,
      mythosMigrationRun: mockRun,
      mythosMigrationConfirm: mockConfirm,
      mythosMigrationDismiss: mockDismiss,
    },
    writable: true,
    configurable: true,
  });
});

describe('MythosMigrationCenter', () => {
  it('renders nothing for a v2 vault', async () => {
    mockStatus.mockResolvedValue({ ...v04Status, format: 'mythos-v2', shouldPrompt: false });
    render(<MythosMigrationCenter />);
    await waitFor(() => expect(mockStatus).toHaveBeenCalled());
    expect(screen.queryByTestId('mythos-migration-prompt')).toBeNull();
    expect(screen.queryByTestId('mythos-migration-wizard')).toBeNull();
  });

  it('renders nothing when the prompt was dismissed for this vault', async () => {
    mockStatus.mockResolvedValue({ ...v04Status, shouldPrompt: false });
    render(<MythosMigrationCenter />);
    await waitFor(() => expect(mockStatus).toHaveBeenCalled());
    expect(screen.queryByTestId('mythos-migration-prompt')).toBeNull();
  });

  it('shows the prompt for a detected v0.4 vault and dismisses persistently', async () => {
    render(<MythosMigrationCenter />);
    const prompt = await screen.findByTestId('mythos-migration-prompt');
    expect(prompt.textContent).toContain('My Vault');
    fireEvent.click(screen.getByTestId('mythos-migration-prompt-dismiss'));
    expect(screen.queryByTestId('mythos-migration-prompt')).toBeNull();
    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });

  it('walks intro → plan → run → report → confirm', async () => {
    render(<MythosMigrationCenter />);
    fireEvent.click(await screen.findByTestId('mythos-migration-prompt-upgrade'));

    // Intro: safety promise + target path.
    const intro = await screen.findByTestId('mythos-migration-step-intro');
    expect(intro.textContent).toContain('never modified');
    expect(intro.textContent).toContain('/vaults/My Vault (MythosVault)');

    // Plan: inventory counts.
    fireEvent.click(screen.getByTestId('mythos-migration-review'));
    const plan = await screen.findByTestId('mythos-migration-step-plan');
    await waitFor(() => expect(mockPlan).toHaveBeenCalled());
    await waitFor(() => expect(plan.textContent).toContain('Stories'));
    expect(plan.textContent).toContain('4'); // scenes

    // Run → report.
    fireEvent.click(screen.getByTestId('mythos-migration-run'));
    await waitFor(() => expect(mockRun).toHaveBeenCalled());
    const report = await screen.findByTestId('mythos-migration-step-report');
    expect(report.textContent).toContain('Verified');
    expect(report.textContent).toContain('untouched');

    // Confirm → switched.
    fireEvent.click(screen.getByTestId('mythos-migration-confirm'));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    await screen.findByTestId('mythos-migration-step-switched');
  });

  it('surfaces a failed run and offers only Close', async () => {
    mockRun.mockResolvedValue({
      ...runResult,
      ok: false,
      error: 'Verification found 1 mismatch(es); the original vault is untouched.',
      verified: { scenesChecked: 4, notesChecked: 5, mismatches: ['scene prose mismatch: "X"'] },
    });
    render(<MythosMigrationCenter />);
    fireEvent.click(await screen.findByTestId('mythos-migration-prompt-upgrade'));
    fireEvent.click(screen.getByTestId('mythos-migration-review'));
    fireEvent.click(await screen.findByTestId('mythos-migration-run'));
    const report = await screen.findByTestId('mythos-migration-step-report');
    expect(report.textContent).toContain('untouched');
    expect(report.textContent).toContain('scene prose mismatch');
    expect(screen.queryByTestId('mythos-migration-confirm')).toBeNull();
  });

  it('a failed confirm keeps the report open with the error', async () => {
    mockConfirm.mockResolvedValue({ switched: false, error: 'The migrated vault folder is missing.' });
    render(<MythosMigrationCenter />);
    fireEvent.click(await screen.findByTestId('mythos-migration-prompt-upgrade'));
    fireEvent.click(screen.getByTestId('mythos-migration-review'));
    fireEvent.click(await screen.findByTestId('mythos-migration-run'));
    fireEvent.click(await screen.findByTestId('mythos-migration-confirm'));
    await waitFor(() =>
      expect(screen.getByTestId('mythos-migration-step-report').textContent).toContain(
        'The migrated vault folder is missing.',
      ),
    );
  });

  it('opens via the global event (Settings card entry point)', async () => {
    mockStatus.mockResolvedValue({ ...v04Status, shouldPrompt: false });
    render(<MythosMigrationCenter />);
    await waitFor(() => expect(mockStatus).toHaveBeenCalled());
    act(() => {
      openMythosMigrationWizard();
    });
    await screen.findByTestId('mythos-migration-wizard');
  });
});
