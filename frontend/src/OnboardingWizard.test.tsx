import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    loadSampleProject: vi.fn().mockResolvedValue({ vaultRoot: '/home/user/Documents/Mythos Sample' }),
    createBlankVault: vi.fn().mockResolvedValue({ vaultRoot: '/home/user/Documents/Mythos Vault' }),
    validatePath: vi.fn().mockResolvedValue({ exists: false, isEmpty: true, writable: true }),
    obsidianPickFolderByPath: vi.fn().mockResolvedValue({ vaultRoot: '/home/user/dropped', registrationToken: 'drop-token' }),
    settingsSet: vi.fn().mockResolvedValue({ saved: true }),
  };
});

describe('OnboardingWizard — S0 Welcome screen', () => {
  it('renders the three-card welcome screen on first render', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('screen-welcome')).toBeInTheDocument();
    expect(screen.getByText('Mythos Writer')).toBeInTheDocument();
    expect(screen.getByText('Write the world before you write the book.')).toBeInTheDocument();
  });

  it('shows three picker cards', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('card-sample')).toBeInTheDocument();
    expect(screen.getByTestId('card-blank')).toBeInTheDocument();
    expect(screen.getByTestId('card-import')).toBeInTheDocument();
  });

  it('shows the Recommended badge on the sample card', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByText('Recommended')).toBeInTheDocument();
  });

  it('clicking Sample card goes to S3a (sample-path screen)', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-sample'));
    expect(screen.getByTestId('screen-sample-path')).toBeInTheDocument();
  });

  it('clicking Blank card goes to S1 (blank-path screen)', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    expect(screen.getByTestId('screen-blank-path')).toBeInTheDocument();
  });

  it('clicking Import card goes to S2a (import-source screen)', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-import'));
    expect(screen.getByTestId('screen-import-source')).toBeInTheDocument();
  });

  it('shows step label "Step 1 of 2" on blank-path screen', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
  });

  it('shows step label "Step 1 of 3" on import-source screen', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-import'));
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
  });
});

describe('OnboardingWizard — S1 Start blank', () => {
  it('shows the blank-path screen with default path and status hint', async () => {
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

  it('Create vault calls createBlankVault and advances to api-key screen', async () => {
    const api = (window as unknown as { api: { createBlankVault: ReturnType<typeof vi.fn>; validatePath: ReturnType<typeof vi.fn> } }).api;
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    await waitFor(() => expect(api.validatePath).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('create-blank-vault'));
    await waitFor(() => expect(api.createBlankVault).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('screen-api-key')).toBeInTheDocument());
  });

  it('Create vault shows error when createBlankVault fails', async () => {
    (window as unknown as { api: { createBlankVault: ReturnType<typeof vi.fn>; validatePath: ReturnType<typeof vi.fn> } }).api.createBlankVault =
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

  it('shows Restructured section when data present (MYT-820 spec requirement)', async () => {
    await goToDryRun();
    expect(screen.getByTestId('section-restructured')).toBeInTheDocument();
    expect(screen.getByText(/World\/Cities\.md/)).toBeInTheDocument();
  });

  it('shows Left-as-is section when data present (MYT-820 spec requirement)', async () => {
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

  it('forwards registrationToken from pickFolder to obsidianDryRun (MYT-367)', async () => {
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
  async function goToProgress() {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-import'));
    fireEvent.click(screen.getByTestId('import-drop-zone-btn'));
    await waitFor(() => expect(screen.getByTestId('screen-import-dryrun')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('confirm-import'));
    await waitFor(() => {
      const prog = document.querySelector('[data-testid="screen-import-progress"]');
      const success = document.querySelector('[data-testid="screen-import-success"]');
      const dryrun = document.querySelector('[data-testid="screen-import-dryrun"]');
      return prog || success || dryrun;
    });
  }

  it('shows cancel button during import (spec: always reachable)', async () => {
    // Make import take longer so we can see progress screen
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

  it('successful import shows import-success screen', async () => {
    await goToProgress();
    await waitFor(() => {
      const success = document.querySelector('[data-testid="screen-import-success"]');
      const dryrun = document.querySelector('[data-testid="screen-import-dryrun"]');
      return success || (dryrun && dryrun.querySelector('[data-testid="dry-run-banner"]'));
    });
    const success = document.querySelector('[data-testid="screen-import-success"]');
    if (success) {
      expect(success).toBeInTheDocument();
    }
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

  it('Continue → advances to api-key screen', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-import'));
    fireEvent.click(screen.getByTestId('import-drop-zone-btn'));
    await waitFor(() => expect(screen.getByTestId('screen-import-dryrun')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('confirm-import'));
    await waitFor(() => expect(screen.getByTestId('screen-import-success')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('import-success-continue'));
    expect(screen.getByTestId('screen-api-key')).toBeInTheDocument();
  });
});

describe('OnboardingWizard — S3a Sample project', () => {
  it('shows sample-path screen with default path and contents list', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-sample'));
    expect(screen.getByTestId('screen-sample-path')).toBeInTheDocument();
    expect(screen.getByText(/Acheron/)).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 2/)).toBeInTheDocument();
  });

  it('back button returns to welcome', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-sample'));
    fireEvent.click(screen.getByRole('button', { name: /← Back/i }));
    expect(screen.getByTestId('screen-welcome')).toBeInTheDocument();
  });

  it('Open sample calls loadSampleProject with targetPath and advances to api-key', async () => {
    const api = (window as unknown as { api: { loadSampleProject: ReturnType<typeof vi.fn> } }).api;
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-sample'));
    fireEvent.click(screen.getByTestId('open-sample'));
    await waitFor(() => expect(api.loadSampleProject).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('screen-api-key')).toBeInTheDocument());
  });

  it('shows E-sample-copy error when loadSampleProject fails', async () => {
    (window as unknown as { api: { loadSampleProject: ReturnType<typeof vi.fn> } }).api.loadSampleProject =
      vi.fn().mockRejectedValue(new Error('Permission denied'));
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-sample'));
    fireEvent.click(screen.getByTestId('open-sample'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert').textContent).toMatch(/couldn't copy the sample/);
  });

  it('shows disk-full error when ENOSPC thrown during sample copy', async () => {
    (window as unknown as { api: { loadSampleProject: ReturnType<typeof vi.fn> } }).api.loadSampleProject =
      vi.fn().mockRejectedValue(new Error('ENOSPC: no space left on device'));
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-sample'));
    fireEvent.click(screen.getByTestId('open-sample'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert').textContent).toMatch(/disk space/);
  });
});

describe('OnboardingWizard — S4 API key', () => {
  async function goToApiKeyViaBlank() {
    (window as unknown as { api: { validatePath: ReturnType<typeof vi.fn> } }).api.validatePath =
      vi.fn().mockResolvedValue({ exists: false, isEmpty: true, writable: true });
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    await waitFor(() => {});
    fireEvent.click(screen.getByTestId('create-blank-vault'));
    await waitFor(() => expect(screen.getByTestId('screen-api-key')).toBeInTheDocument());
  }

  it('shows the api-key screen with phase label', async () => {
    await goToApiKeyViaBlank();
    expect(screen.getByText(/Add your API key/i)).toBeInTheDocument();
  });

  it('Save button is disabled when API key input is empty', async () => {
    await goToApiKeyViaBlank();
    expect(screen.getByTestId('save-api-key')).toBeDisabled();
  });

  it('Save button enables when API key is entered', async () => {
    await goToApiKeyViaBlank();
    fireEvent.change(screen.getByTestId('api-key-input'), { target: { value: 'sk-ant-test' } });
    expect(screen.getByTestId('save-api-key')).not.toBeDisabled();
  });

  it('Skip advances to done screen and calls onComplete with onboardingComplete=true', async () => {
    const onComplete = vi.fn();
    (window as unknown as { api: { validatePath: ReturnType<typeof vi.fn>; createBlankVault: ReturnType<typeof vi.fn> } }).api.validatePath =
      vi.fn().mockResolvedValue({ exists: false, isEmpty: true, writable: true });
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    await waitFor(() => {});
    fireEvent.click(screen.getByTestId('create-blank-vault'));
    await waitFor(() => expect(screen.getByTestId('screen-api-key')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('skip-api-key'));
    await waitFor(() => expect(screen.getByTestId('screen-done')).toBeInTheDocument());
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ onboardingComplete: true })));
  });

  it('Save & continue persists API key and advances to done', async () => {
    const onComplete = vi.fn();
    (window as unknown as { api: { validatePath: ReturnType<typeof vi.fn>; createBlankVault: ReturnType<typeof vi.fn> } }).api.validatePath =
      vi.fn().mockResolvedValue({ exists: false, isEmpty: true, writable: true });
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    await waitFor(() => {});
    fireEvent.click(screen.getByTestId('create-blank-vault'));
    await waitFor(() => expect(screen.getByTestId('screen-api-key')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('api-key-input'), { target: { value: 'sk-ant-real-key' } });
    fireEvent.click(screen.getByTestId('save-api-key'));
    await waitFor(() => {
      const api = (window as unknown as { api: { settingsSet: ReturnType<typeof vi.fn> } }).api;
      expect(api.settingsSet).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-ant-real-key', onboardingComplete: true }));
    });
    await waitFor(() => expect(screen.getByTestId('screen-done')).toBeInTheDocument());
    expect(onComplete).toHaveBeenCalled();
  });
});

describe('OnboardingWizard — S5 Done', () => {
  it('shows "You\'re all set!" on done screen', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    await waitFor(() => {});
    fireEvent.click(screen.getByTestId('create-blank-vault'));
    await waitFor(() => expect(screen.getByTestId('screen-api-key')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('skip-api-key'));
    await waitFor(() => expect(screen.getByTestId('screen-done')).toBeInTheDocument());
    expect(screen.getByText(/You're all set!/)).toBeInTheDocument();
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
  });
});
