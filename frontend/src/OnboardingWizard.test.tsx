import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import OnboardingWizard from './OnboardingWizard';

const BASE_SETTINGS: AppSettings = {
  apiKey: '',
  agents: {
    writingAssistant: {
      enabled: true,
      model: 'claude-sonnet-4-6',
      scanIntervalSeconds: 30,
      autoApply: false,
      confidenceThreshold: 0.8,
      maxTokensPerHour: 10000,
      maxSuggestionsPerHour: 20,
      heartbeatIntervalMinutes: 5,
      maxTokensPerDay: 100000,
    },
    brainstorm: {
      enabled: true,
      model: 'claude-sonnet-4-6',
      autoApply: false,
      confidenceThreshold: 0.8,
      maxTokensPerHour: 10000,
      maxSuggestionsPerHour: 20,
      heartbeatIntervalMinutes: 5,
      maxTokensPerDay: 100000,
    },
    archive: {
      enabled: true,
      model: 'claude-sonnet-4-6',
      continuityCheckIntervalSeconds: 60,
      autoApply: false,
      confidenceThreshold: 0.8,
      maxTokensPerHour: 10000,
      maxSuggestionsPerHour: 20,
      heartbeatIntervalMinutes: 5,
      maxTokensPerDay: 100000,
    },
  },
  theme: 'dark',
};

const mockDryRun = {
  notesCount: 42,
  brokenLinks: [],
  nameCollisions: [],
  missingFrontmatter: [],
  fatalError: null,
  restructured: [{ from: 'World/Cities.md', to: 'notes/world/cities.md' }],
  leftAsIs: ['Characters/Elara.md'],
};

beforeEach(() => {
  (window as unknown as { api: unknown }).api = {
    pickFolder: vi.fn().mockResolvedValue({
      vaultRoot: '/home/user/my-vault',
      cancelled: false,
      registrationToken: 'token-abc',
    }),
    obsidianDryRun: vi.fn().mockResolvedValue(mockDryRun),
    obsidianRegister: vi.fn().mockResolvedValue({ vaultRoot: '/home/user/my-vault', notesIndexed: 42 }),
    vaultSetPaths: vi.fn().mockResolvedValue({ ok: true }),
    loadSampleTwoVault: vi.fn().mockResolvedValue({
      storyVaultPath: '/home/user/Mythos Sample/Story Vault',
      notesVaultPath: '/home/user/Mythos Sample/Notes Vault',
    }),
    validatePath: vi.fn().mockResolvedValue({ exists: false, isEmpty: true, writable: true }),
    obsidianPickFolderByPath: vi.fn().mockResolvedValue({ vaultRoot: '/home/user/dropped', registrationToken: 'drop-token' }),
    onboardingComplete: vi.fn().mockResolvedValue({ ok: true }),
  };
});

describe('OnboardingWizard — S0 Welcome screen', () => {
  it('renders the welcome screen on first render', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('screen-welcome')).toBeInTheDocument();
    expect(screen.getByText('Mythos Writer')).toBeInTheDocument();
    expect(screen.getByText('Write the world before you write the book.')).toBeInTheDocument();
  });

  it('shows four picker cards (default / blank / import / sample)', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('card-default')).toBeInTheDocument();
    expect(screen.getByTestId('card-blank')).toBeInTheDocument();
    expect(screen.getByTestId('card-import')).toBeInTheDocument();
    expect(screen.getByTestId('card-sample')).toBeInTheDocument();
  });

  it('shows the Recommended badge on the default card', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByText('Recommended')).toBeInTheDocument();
    const defaultCard = screen.getByTestId('card-default');
    expect(defaultCard.textContent).toContain('Recommended');
  });

  it('clicking Default card goes to S1a (default-path screen)', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-default'));
    expect(screen.getByTestId('screen-default-path')).toBeInTheDocument();
  });

  it('clicking Blank card goes to S1b (blank-path screen)', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    expect(screen.getByTestId('screen-blank-path')).toBeInTheDocument();
  });

  it('clicking Import card goes to S2a (import-source screen)', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-import'));
    expect(screen.getByTestId('screen-import-source')).toBeInTheDocument();
  });

  it('clicking Sample card goes to S3a (sample-path screen)', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-sample'));
    expect(screen.getByTestId('screen-sample-path')).toBeInTheDocument();
  });

  it('shows step label "Step 1 of 3" on import-source screen', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-import'));
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
  });
});

describe('OnboardingWizard — S1a Default layout', () => {
  it('shows the default-path screen with path field and status hint', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-default'));
    expect(screen.getByTestId('default-path-input')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('default-path-input-hint')).toBeInTheDocument());
  });

  it('back button returns to welcome screen', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-default'));
    fireEvent.click(screen.getByRole('button', { name: /← Back/i }));
    expect(screen.getByTestId('screen-welcome')).toBeInTheDocument();
  });

  it('Create vaults calls vaultSetPaths with seedMode=default and advances to done', async () => {
    const onComplete = vi.fn();
    const api = (window as unknown as { api: { vaultSetPaths: ReturnType<typeof vi.fn>; validatePath: ReturnType<typeof vi.fn> } }).api;
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('card-default'));
    await waitFor(() => expect(api.validatePath).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('create-default-vault'));
    await waitFor(() => expect(api.vaultSetPaths).toHaveBeenCalledWith(
      expect.stringMatching(/Story Vault$/),
      expect.stringMatching(/Notes Vault$/),
      { seedMode: 'default' }
    ));
    await waitFor(() => expect(screen.getByTestId('screen-done')).toBeInTheDocument());
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ onboardingComplete: true }));
  });

  it('shows error when vaultSetPaths fails', async () => {
    (window as unknown as { api: { vaultSetPaths: ReturnType<typeof vi.fn>; validatePath: ReturnType<typeof vi.fn> } }).api.vaultSetPaths =
      vi.fn().mockResolvedValue({ error: 'Disk full' });
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-default'));
    await waitFor(() => {});
    fireEvent.click(screen.getByTestId('create-default-vault'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert').textContent).toContain('Disk full');
  });
});

describe('OnboardingWizard — S1b Start blank', () => {
  it('shows the blank-path screen with path field and status hint', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    expect(screen.getByTestId('blank-path-input')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('blank-path-input-hint')).toBeInTheDocument());
  });

  it('back button returns to welcome screen', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    fireEvent.click(screen.getByRole('button', { name: /← Back/i }));
    expect(screen.getByTestId('screen-welcome')).toBeInTheDocument();
  });

  it('Create blank vaults calls vaultSetPaths with seedMode=blank and advances to done', async () => {
    const onComplete = vi.fn();
    const api = (window as unknown as { api: { vaultSetPaths: ReturnType<typeof vi.fn>; validatePath: ReturnType<typeof vi.fn> } }).api;
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    await waitFor(() => expect(api.validatePath).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('create-blank-vault'));
    await waitFor(() => expect(api.vaultSetPaths).toHaveBeenCalledWith(
      expect.stringMatching(/Story Vault$/),
      expect.stringMatching(/Notes Vault$/),
      { seedMode: 'blank' }
    ));
    await waitFor(() => expect(screen.getByTestId('screen-done')).toBeInTheDocument());
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ onboardingComplete: true }));
  });

  it('shows error when vaultSetPaths fails on blank path', async () => {
    (window as unknown as { api: { vaultSetPaths: ReturnType<typeof vi.fn>; validatePath: ReturnType<typeof vi.fn> } }).api.vaultSetPaths =
      vi.fn().mockResolvedValue({ error: 'Not writable' });
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    await waitFor(() => {});
    fireEvent.click(screen.getByTestId('create-blank-vault'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert').textContent).toContain('Not writable');
  });
});

describe('OnboardingWizard — S2a Import source', () => {
  it('shows the import-source screen with drop zone', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-import'));
    expect(screen.getByTestId('import-drop-zone')).toBeInTheDocument();
  });

  it('Pick folder button opens folder picker and advances to dry-run screen', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-import'));
    fireEvent.click(screen.getByTestId('import-drop-zone-btn'));
    await waitFor(() => expect(screen.getByTestId('screen-import-dryrun')).toBeInTheDocument());
  });

  it('stays on import-source if folder picker is cancelled', async () => {
    (window as unknown as { api: { pickFolder: ReturnType<typeof vi.fn> } }).api.pickFolder =
      vi.fn().mockResolvedValue({ vaultRoot: null, cancelled: true, registrationToken: null });
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-import'));
    fireEvent.click(screen.getByTestId('import-drop-zone-btn'));
    await waitFor(() => expect(screen.getByTestId('screen-import-source')).toBeInTheDocument());
  });

  it('shows E-perm error when pickFolder returns permission-denied', async () => {
    (window as unknown as { api: { pickFolder: ReturnType<typeof vi.fn> } }).api.pickFolder =
      vi.fn().mockResolvedValue({ vaultRoot: null, cancelled: false, registrationToken: null, error: 'permission-denied' });
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-import'));
    fireEvent.click(screen.getByTestId('import-drop-zone-btn'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert').textContent).toMatch(/macOS blocked access/);
  });

  it('shows E-not-obsidian error when dry-run fatalError indicates no vault', async () => {
    (window as unknown as { api: { obsidianDryRun: ReturnType<typeof vi.fn> } }).api.obsidianDryRun =
      vi.fn().mockResolvedValue({ notesCount: 0, brokenLinks: [], nameCollisions: [], missingFrontmatter: [], fatalError: 'no .obsidian directory found' });
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-import'));
    fireEvent.click(screen.getByTestId('import-drop-zone-btn'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert').textContent).toMatch(/doesn't look like an Obsidian vault/);
  });
});

describe('OnboardingWizard — S2b Dry-run report', () => {
  async function goToDryRun() {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-import'));
    fireEvent.click(screen.getByTestId('import-drop-zone-btn'));
    await waitFor(() => expect(screen.getByTestId('screen-import-dryrun')).toBeInTheDocument());
  }

  it('shows the dry-run report with notes count', async () => {
    await goToDryRun();
    expect(screen.getByTestId('dry-run-report')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('notes found')).toBeInTheDocument();
  });

  it('shows Restructured section when data present', async () => {
    await goToDryRun();
    expect(screen.getByTestId('section-restructured')).toBeInTheDocument();
    expect(screen.getByText(/World\/Cities\.md/)).toBeInTheDocument();
  });

  it('shows Left-as-is section when data present', async () => {
    await goToDryRun();
    expect(screen.getByTestId('section-left-as-is')).toBeInTheDocument();
  });

  it('shows snapshot promise text', async () => {
    await goToDryRun();
    expect(screen.getByText(/A snapshot is taken before any change/)).toBeInTheDocument();
  });

  it('back button on dry-run returns to import-source', async () => {
    await goToDryRun();
    fireEvent.click(screen.getByRole('button', { name: /← Back/i }));
    expect(screen.getByTestId('screen-import-source')).toBeInTheDocument();
  });

  it('Import → button advances to progress screen', async () => {
    await goToDryRun();
    fireEvent.click(screen.getByTestId('confirm-import'));
    await waitFor(() => expect(screen.getByTestId('screen-import-progress')).toBeInTheDocument());
  });

  it('forwards registrationToken from pickFolder to obsidianDryRun', async () => {
    await goToDryRun();
    const api = (window as unknown as { api: { obsidianDryRun: ReturnType<typeof vi.fn> } }).api;
    expect(api.obsidianDryRun).toHaveBeenCalledWith('/home/user/my-vault', 'token-abc');
  });

  it('shows dry-run-ok when no issues found and no restructured', async () => {
    (window as unknown as { api: { obsidianDryRun: ReturnType<typeof vi.fn> } }).api.obsidianDryRun =
      vi.fn().mockResolvedValue({ notesCount: 10, brokenLinks: [], nameCollisions: [], missingFrontmatter: [], fatalError: null });
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-import'));
    fireEvent.click(screen.getByTestId('import-drop-zone-btn'));
    await waitFor(() => expect(screen.getByTestId('dry-run-ok')).toBeInTheDocument());
  });
});

describe('OnboardingWizard — S2c Import progress', () => {
  it('shows cancel button during import (spec: always reachable)', async () => {
    (window as unknown as { api: { obsidianRegister: ReturnType<typeof vi.fn> } }).api.obsidianRegister =
      vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ vaultRoot: '/v', notesIndexed: 42 }), 100)));
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-import'));
    fireEvent.click(screen.getByTestId('import-drop-zone-btn'));
    await waitFor(() => expect(screen.getByTestId('screen-import-dryrun')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('confirm-import'));
    await waitFor(() => expect(screen.getByTestId('screen-import-progress')).toBeInTheDocument());
    expect(screen.getByTestId('cancel-import')).toBeInTheDocument();
  });

  it('cancel button shows confirm dialog', async () => {
    (window as unknown as { api: { obsidianRegister: ReturnType<typeof vi.fn> } }).api.obsidianRegister =
      vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ vaultRoot: '/v', notesIndexed: 42 }), 500)));
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-import'));
    fireEvent.click(screen.getByTestId('import-drop-zone-btn'));
    await waitFor(() => expect(screen.getByTestId('screen-import-dryrun')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('confirm-import'));
    await waitFor(() => expect(screen.getByTestId('screen-import-progress')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('cancel-import'));
    expect(screen.getByTestId('cancel-confirm-dialog')).toBeInTheDocument();
  });

  it('"Keep going" on confirm dialog dismisses it', async () => {
    (window as unknown as { api: { obsidianRegister: ReturnType<typeof vi.fn> } }).api.obsidianRegister =
      vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ vaultRoot: '/v', notesIndexed: 42 }), 500)));
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-import'));
    fireEvent.click(screen.getByTestId('import-drop-zone-btn'));
    await waitFor(() => expect(screen.getByTestId('screen-import-dryrun')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('confirm-import'));
    await waitFor(() => expect(screen.getByTestId('screen-import-progress')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('cancel-import'));
    fireEvent.click(screen.getByTestId('cancel-confirm-dialog-primary'));
    expect(screen.queryByTestId('cancel-confirm-dialog')).not.toBeInTheDocument();
  });
});

describe('OnboardingWizard — S2d Import success', () => {
  it('shows success screen with note count and Continue button after successful import', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-import'));
    fireEvent.click(screen.getByTestId('import-drop-zone-btn'));
    await waitFor(() => expect(screen.getByTestId('screen-import-dryrun')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('confirm-import'));
    await waitFor(() => expect(screen.getByTestId('screen-import-success')).toBeInTheDocument());
    expect(screen.getByText(/42 notes are now/)).toBeInTheDocument();
    expect(screen.getByTestId('import-success-continue')).toBeInTheDocument();
  });

  it('shows snapshot path when returned by main process', async () => {
    (window as unknown as { api: { obsidianRegister: ReturnType<typeof vi.fn> } }).api.obsidianRegister =
      vi.fn().mockResolvedValue({ vaultRoot: '/v', notesIndexed: 10, snapshotPath: '/home/user/my-vault-snapshot-2026' });
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-import'));
    fireEvent.click(screen.getByTestId('import-drop-zone-btn'));
    await waitFor(() => expect(screen.getByTestId('screen-import-dryrun')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('confirm-import'));
    await waitFor(() => expect(screen.getByTestId('screen-import-success')).toBeInTheDocument());
    expect(screen.getByText('/home/user/my-vault-snapshot-2026')).toBeInTheDocument();
  });

  it('Continue → advances directly to done (no api-key step)', async () => {
    const onComplete = vi.fn();
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('card-import'));
    fireEvent.click(screen.getByTestId('import-drop-zone-btn'));
    await waitFor(() => expect(screen.getByTestId('screen-import-dryrun')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('confirm-import'));
    await waitFor(() => expect(screen.getByTestId('screen-import-success')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('import-success-continue'));
    expect(screen.getByTestId('screen-done')).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ onboardingComplete: true }));
  });
});

describe('OnboardingWizard — S3a Sample project', () => {
  it('shows sample-path screen with default path and contents list', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-sample'));
    expect(screen.getByTestId('screen-sample-path')).toBeInTheDocument();
    expect(screen.getByText(/Argent/)).toBeInTheDocument();
    expect(screen.getByText(/The Glass Library/)).toBeInTheDocument();
  });

  it('back button returns to welcome', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-sample'));
    fireEvent.click(screen.getByRole('button', { name: /← Back/i }));
    expect(screen.getByTestId('screen-welcome')).toBeInTheDocument();
  });

  it('Open sample calls loadSampleTwoVault with parentPath and advances to done', async () => {
    const onComplete = vi.fn();
    const api = (window as unknown as { api: { loadSampleTwoVault: ReturnType<typeof vi.fn> } }).api;
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('card-sample'));
    fireEvent.click(screen.getByTestId('open-sample'));
    await waitFor(() => expect(api.loadSampleTwoVault).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('screen-done')).toBeInTheDocument());
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ onboardingComplete: true }));
  });

  it('shows E-sample-copy error when loadSampleTwoVault rejects', async () => {
    (window as unknown as { api: { loadSampleTwoVault: ReturnType<typeof vi.fn> } }).api.loadSampleTwoVault =
      vi.fn().mockRejectedValue(new Error('Permission denied'));
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-sample'));
    fireEvent.click(screen.getByTestId('open-sample'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert').textContent).toMatch(/couldn't copy the sample/);
  });

  it('shows disk-full error when ENOSPC thrown during sample copy', async () => {
    (window as unknown as { api: { loadSampleTwoVault: ReturnType<typeof vi.fn> } }).api.loadSampleTwoVault =
      vi.fn().mockRejectedValue(new Error('ENOSPC: no space left on device'));
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-sample'));
    fireEvent.click(screen.getByTestId('open-sample'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert').textContent).toMatch(/disk space/);
  });

  it('shows error when loadSampleTwoVault returns an error object', async () => {
    (window as unknown as { api: { loadSampleTwoVault: ReturnType<typeof vi.fn> } }).api.loadSampleTwoVault =
      vi.fn().mockResolvedValue({ error: 'Target not empty' });
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-sample'));
    fireEvent.click(screen.getByTestId('open-sample'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert').textContent).toContain('Target not empty');
  });
});

describe('OnboardingWizard — S4 Done', () => {
  it('shows "You\'re all set!" on done screen after blank path', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    await waitFor(() => {});
    fireEvent.click(screen.getByTestId('create-blank-vault'));
    await waitFor(() => expect(screen.getByTestId('screen-done')).toBeInTheDocument());
    expect(screen.getByText(/You're all set!/)).toBeInTheDocument();
  });

  it('no api-key screen exists anywhere in the wizard flow', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.queryByTestId('screen-api-key')).not.toBeInTheDocument();
    expect(screen.queryByTestId('api-key-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('save-api-key')).not.toBeInTheDocument();
    expect(screen.queryByTestId('skip-api-key')).not.toBeInTheDocument();
  });
});

describe('OnboardingWizard — keyboard focus trap', () => {
  const FOCUSABLE_SELECTOR =
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  it('Tab at the last focusable element wraps to the first', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    const overlay = document.querySelector('.onboarding-overlay') as HTMLElement;
    const focusable = Array.from(overlay.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    expect(focusable.length).toBeGreaterThan(0);
    const last = focusable[focusable.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab', bubbles: true });
    expect(document.activeElement).toBe(focusable[0]);
  });

  it('Shift+Tab at the first focusable element wraps to the last', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    const overlay = document.querySelector('.onboarding-overlay') as HTMLElement;
    const focusable = Array.from(overlay.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    expect(focusable.length).toBeGreaterThan(0);
    const first = focusable[0];
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true, bubbles: true });
    expect(document.activeElement).toBe(focusable[focusable.length - 1]);
  });

  it('focus moves to the screen heading on screen transition', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-default'));
    const heading = await screen.findByText('Where should we put your vaults?');
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });
});

describe('OnboardingWizard — error states from spec §6', () => {
  it('E-perm: shows macOS-specific copy including System Settings link text', async () => {
    (window as unknown as { api: { pickFolder: ReturnType<typeof vi.fn> } }).api.pickFolder =
      vi.fn().mockResolvedValue({ vaultRoot: null, cancelled: false, registrationToken: null, error: 'permission-denied' });
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    fireEvent.click(screen.getByRole('button', { name: /Browse/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert').textContent).toMatch(/macOS blocked access/);
    expect(screen.getByRole('alert').textContent).toMatch(/System Settings/);
  });

  it('E-import-failed: when obsidianRegister throws, shows banner on dry-run screen', async () => {
    (window as unknown as { api: { obsidianRegister: ReturnType<typeof vi.fn> } }).api.obsidianRegister =
      vi.fn().mockRejectedValue(new Error('Disk error'));
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-import'));
    fireEvent.click(screen.getByTestId('import-drop-zone-btn'));
    await waitFor(() => expect(screen.getByTestId('screen-import-dryrun')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('confirm-import'));
    await waitFor(() => expect(screen.getByTestId('screen-import-dryrun')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('dry-run-banner')).toBeInTheDocument());
    expect(screen.getByTestId('dry-run-banner').textContent).toMatch(/failed/i);
    // Drain any pending React state updates so they don't fire after JSDOM teardown.
    await act(async () => {});
  });

  it('E-disk-full: ENOSPC during import shows disk-full specific copy in banner', async () => {
    (window as unknown as { api: { obsidianRegister: ReturnType<typeof vi.fn> } }).api.obsidianRegister =
      vi.fn().mockRejectedValue(new Error('ENOSPC: no space left on device'));
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-import'));
    fireEvent.click(screen.getByTestId('import-drop-zone-btn'));
    await waitFor(() => expect(screen.getByTestId('screen-import-dryrun')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('confirm-import'));
    await waitFor(() => expect(screen.getByTestId('dry-run-banner')).toBeInTheDocument());
    expect(screen.getByTestId('dry-run-banner').textContent).toMatch(/disk space/);
    // Drain any pending React state updates so they don't fire after JSDOM teardown.
    await act(async () => {});
  });
});

// ─── SKY-152: Project wizard screens ─────────────────────────────────────────

describe('OnboardingWizard — SKY-152 Project wizard', () => {
  beforeEach(() => {
    (window as unknown as { api: unknown }).api = {
      pickFolder: vi.fn().mockResolvedValue({ vaultRoot: '/home/user/my-vault', cancelled: false, registrationToken: 'token-abc' }),
      obsidianDryRun: vi.fn(),
      obsidianRegister: vi.fn(),
      vaultSetPaths: vi.fn().mockResolvedValue({ ok: true }),
      loadSampleTwoVault: vi.fn(),
      validatePath: vi.fn().mockResolvedValue({ exists: false, isEmpty: true, writable: true }),
      obsidianPickFolderByPath: vi.fn(),
      onboardingComplete: vi.fn().mockResolvedValue({ ok: true }),
      writeVault: vi.fn().mockResolvedValue({ path: 'p', bytes: 1 }),
      writeNotesVault: vi.fn().mockResolvedValue({ path: 'p', bytes: 1 }),
    };
  });

  it('shows "Create your first project" CTA on welcome screen', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('cta-create-project')).toBeInTheDocument();
  });

  it('clicking CTA navigates to project-name screen', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('cta-create-project'));
    expect(screen.getByTestId('screen-project-name')).toBeInTheDocument();
  });

  it('shows Step 1 of 3 on project-name screen', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('cta-create-project'));
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
  });

  it('skip on project-name advances to genre', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('cta-create-project'));
    fireEvent.click(screen.getByTestId('skip-project-name'));
    expect(screen.getByTestId('screen-genre')).toBeInTheDocument();
  });

  it('next on project-name advances to genre', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('cta-create-project'));
    fireEvent.click(screen.getByTestId('next-to-genre'));
    expect(screen.getByTestId('screen-genre')).toBeInTheDocument();
  });

  it('shows Step 2 of 3 on genre screen', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('cta-create-project'));
    fireEvent.click(screen.getByTestId('next-to-genre'));
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
  });

  it('skip genre advances to writing-goal', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('cta-create-project'));
    fireEvent.click(screen.getByTestId('skip-project-name'));
    fireEvent.click(screen.getByTestId('skip-genre'));
    expect(screen.getByTestId('screen-writing-goal')).toBeInTheDocument();
  });

  it('shows Step 3 of 3 on writing-goal screen', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('cta-create-project'));
    fireEvent.click(screen.getByTestId('skip-project-name'));
    fireEvent.click(screen.getByTestId('skip-genre'));
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
  });

  it('next-to-path navigates to default-path screen', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('cta-create-project'));
    fireEvent.click(screen.getByTestId('skip-project-name'));
    fireEvent.click(screen.getByTestId('skip-genre'));
    fireEvent.click(screen.getByTestId('next-to-path'));
    expect(screen.getByTestId('screen-default-path')).toBeInTheDocument();
  });

  it('skip-goal navigates to default-path', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('cta-create-project'));
    fireEvent.click(screen.getByTestId('skip-project-name'));
    fireEvent.click(screen.getByTestId('skip-genre'));
    fireEvent.click(screen.getByTestId('skip-goal'));
    expect(screen.getByTestId('screen-default-path')).toBeInTheDocument();
  });

  it('shows create-project-vault button in project flow', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('cta-create-project'));
    fireEvent.click(screen.getByTestId('skip-project-name'));
    fireEvent.click(screen.getByTestId('skip-genre'));
    fireEvent.click(screen.getByTestId('next-to-path'));
    await waitFor(() => expect(screen.getByTestId('create-project-vault')).toBeInTheDocument());
  });

  it('create-project-vault calls vaultSetPaths blank and writes starter files', async () => {
    const onComplete = vi.fn();
    const apiMock = (window as unknown as { api: { vaultSetPaths: ReturnType<typeof vi.fn>; validatePath: ReturnType<typeof vi.fn>; writeVault: ReturnType<typeof vi.fn>; writeNotesVault: ReturnType<typeof vi.fn> } }).api;
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('cta-create-project'));
    fireEvent.click(screen.getByTestId('skip-project-name'));
    fireEvent.click(screen.getByTestId('skip-genre'));
    fireEvent.click(screen.getByTestId('next-to-path'));
    await waitFor(() => expect(apiMock.validatePath).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('create-project-vault'));
    await waitFor(() => expect(apiMock.vaultSetPaths).toHaveBeenCalledWith(
      expect.stringMatching(/Story Vault$/),
      expect.stringMatching(/Notes Vault$/),
      { seedMode: 'blank' }
    ));
    await waitFor(() => expect(apiMock.writeVault).toHaveBeenCalled());
    await waitFor(() => expect(apiMock.writeNotesVault).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('screen-done')).toBeInTheDocument());
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ onboardingComplete: true }));
  });

  it('existing picker cards remain accessible via other-options', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('card-default')).toBeInTheDocument();
    expect(screen.getByTestId('card-blank')).toBeInTheDocument();
    expect(screen.getByTestId('card-import')).toBeInTheDocument();
    expect(screen.getByTestId('card-sample')).toBeInTheDocument();
  });
});
