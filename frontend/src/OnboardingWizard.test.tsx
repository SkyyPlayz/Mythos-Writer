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

beforeEach(() => {
  (window as unknown as { api: unknown }).api = {
    pickFolder: vi.fn().mockResolvedValue({ vaultRoot: '/home/user/my-vault', cancelled: false }),
    obsidianDryRun: vi.fn().mockResolvedValue({
      notesCount: 5,
      brokenLinks: [],
      nameCollisions: [],
      missingFrontmatter: [],
      fatalError: null,
    }),
    obsidianRegister: vi.fn().mockResolvedValue({ vaultRoot: '/home/user/my-vault', notesIndexed: 5 }),
    loadSampleProject: vi.fn().mockResolvedValue({ vaultRoot: '/home/user/Documents/Mythos Writer Sample' }),
    settingsSet: vi.fn().mockResolvedValue({ saved: true }),
  };
});

describe('OnboardingWizard', () => {
  it('renders the welcome step on first render', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('step-welcome')).toBeInTheDocument();
    expect(screen.getByText('Welcome to Mythos Writer')).toBeInTheDocument();
  });

  it('shows the Recommended chip on the sample project option', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    expect(screen.getByText('Recommended')).toBeInTheDocument();
  });

  it('navigates back from step 2 to step 1', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByTestId('step-welcome')).toBeInTheDocument();
  });

  describe('path 1 — blank vault', () => {
    it('advances from vault choice to API key step without IPC calls', async () => {
      render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));

      fireEvent.click(screen.getByLabelText(/start with a blank vault/i));
      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      expect(screen.getByTestId('step-apikey')).toBeInTheDocument();
      const api = (window as unknown as { api: { loadSampleProject: ReturnType<typeof vi.fn>; pickFolder: ReturnType<typeof vi.fn> } }).api;
      expect(api.loadSampleProject).not.toHaveBeenCalled();
      expect(api.pickFolder).not.toHaveBeenCalled();
    });

    it('completes the wizard via skip and shows done screen', async () => {
      const onComplete = vi.fn();
      render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));
      fireEvent.click(screen.getByLabelText(/start with a blank vault/i));
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      fireEvent.click(screen.getByTestId('skip-api-key'));

      await waitFor(() => expect(screen.getByTestId('step-done')).toBeInTheDocument());
      await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ onboardingComplete: true })));
    });
  });

  describe('path 2 — existing Obsidian vault', () => {
    it('opens folder picker, runs dry-run, and advances to dry-run report', async () => {
      render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));

      fireEvent.click(screen.getByLabelText(/use existing obsidian vault/i));
      fireEvent.click(screen.getByRole('button', { name: /browse/i }));

      await waitFor(() => {
        const api = (window as unknown as { api: { pickFolder: ReturnType<typeof vi.fn> } }).api;
        expect(api.pickFolder).toHaveBeenCalled();
      });
      await waitFor(() => expect(screen.getByTestId('step-dry-run')).toBeInTheDocument());
    });

    it('stays on step 2 if the folder dialog is cancelled', async () => {
      (window as unknown as { api: { pickFolder: ReturnType<typeof vi.fn>; settingsSet: ReturnType<typeof vi.fn> } }).api.pickFolder =
        vi.fn().mockResolvedValue({ vaultRoot: null, cancelled: true });

      render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));
      fireEvent.click(screen.getByLabelText(/use existing obsidian vault/i));
      fireEvent.click(screen.getByRole('button', { name: /browse/i }));

      await waitFor(() => expect(screen.getByTestId('step-vault')).toBeInTheDocument());
    });

    it('confirms import and advances to API key step', async () => {
      render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));
      fireEvent.click(screen.getByLabelText(/use existing obsidian vault/i));
      fireEvent.click(screen.getByRole('button', { name: /browse/i }));

      await waitFor(() => expect(screen.getByTestId('step-dry-run')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('confirm-import'));

      await waitFor(() => expect(screen.getByTestId('step-apikey')).toBeInTheDocument());
    });

    it('can navigate back from dry-run to vault choice', async () => {
      render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));
      fireEvent.click(screen.getByLabelText(/use existing obsidian vault/i));
      fireEvent.click(screen.getByRole('button', { name: /browse/i }));

      await waitFor(() => expect(screen.getByTestId('step-dry-run')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /back/i }));
      expect(screen.getByTestId('step-vault')).toBeInTheDocument();
    });
  });

  describe('path 3 — sample project (default)', () => {
    it('loads sample project and advances to API key step', async () => {
      render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));

      // sample is pre-selected
      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        const api = (window as unknown as { api: { loadSampleProject: ReturnType<typeof vi.fn> } }).api;
        expect(api.loadSampleProject).toHaveBeenCalled();
      });
      await waitFor(() => expect(screen.getByTestId('step-apikey')).toBeInTheDocument());
    });

    it('completes the wizard via skip and calls onComplete with onboardingComplete=true', async () => {
      const onComplete = vi.fn();
      render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));
      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => expect(screen.getByTestId('step-apikey')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('skip-api-key'));

      await waitFor(() => expect(screen.getByTestId('step-done')).toBeInTheDocument());
      expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ onboardingComplete: true }));
    });

    it('shows error when loadSampleProject fails', async () => {
      (window as unknown as { api: { loadSampleProject: ReturnType<typeof vi.fn> } }).api.loadSampleProject =
        vi.fn().mockRejectedValue(new Error('Disk full'));

      render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));
      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      expect(screen.getByRole('alert').textContent).toContain('Disk full');
    });
  });

  describe('API key step', () => {
    async function goToApiKeyStep() {
      render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));
      // Use blank path to avoid async loadSampleProject
      fireEvent.click(screen.getByLabelText(/start with a blank vault/i));
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    }

    it('save button is disabled when API key input is empty', async () => {
      await goToApiKeyStep();
      expect(screen.getByTestId('save-api-key')).toBeDisabled();
    });

    it('save button enables when API key is entered', async () => {
      await goToApiKeyStep();
      fireEvent.change(screen.getByTestId('api-key-input'), {
        target: { value: 'sk-ant-test1234' },
      });
      expect(screen.getByTestId('save-api-key')).not.toBeDisabled();
    });

    it('persists API key and calls onComplete on save', async () => {
      const onComplete = vi.fn();
      render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));
      fireEvent.click(screen.getByLabelText(/start with a blank vault/i));
      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      fireEvent.change(screen.getByTestId('api-key-input'), {
        target: { value: 'sk-ant-test1234' },
      });
      fireEvent.click(screen.getByTestId('save-api-key'));

      await waitFor(() => {
        const api = (window as unknown as { api: { settingsSet: ReturnType<typeof vi.fn> } }).api;
        expect(api.settingsSet).toHaveBeenCalledWith(
          expect.objectContaining({ apiKey: 'sk-ant-test1234', onboardingComplete: true }),
        );
      });
      await waitFor(() => expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ onboardingComplete: true }),
      ));
      expect(screen.getByTestId('step-done')).toBeInTheDocument();
    });

    it('skip path — skips API key and persists onboardingComplete=true', async () => {
      const onComplete = vi.fn();
      render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));
      fireEvent.click(screen.getByLabelText(/start with a blank vault/i));
      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      fireEvent.click(screen.getByTestId('skip-api-key'));

      await waitFor(() => {
        const api = (window as unknown as { api: { settingsSet: ReturnType<typeof vi.fn> } }).api;
        expect(api.settingsSet).toHaveBeenCalledWith(
          expect.objectContaining({ onboardingComplete: true }),
        );
      });
      await waitFor(() => expect(onComplete).toHaveBeenCalled());
      expect(screen.getByTestId('step-done')).toBeInTheDocument();
    });
  });

  describe('done step', () => {
    it('shows done screen after completing the wizard', async () => {
      render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));
      fireEvent.click(screen.getByLabelText(/start with a blank vault/i));
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      fireEvent.click(screen.getByTestId('skip-api-key'));

      await waitFor(() => expect(screen.getByTestId('step-done')).toBeInTheDocument());
      expect(screen.getByText(/you're all set/i)).toBeInTheDocument();
    });
  });

  describe('don\'t show again — returning users', () => {
    it('wizard does not render when onboardingComplete is true in settings', () => {
      // This behavior is enforced in App.tsx — the wizard is only rendered when
      // settings.onboardingComplete is falsy. We verify onComplete sets the flag.
      const onComplete = vi.fn();
      render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));
      fireEvent.click(screen.getByLabelText(/start with a blank vault/i));
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      fireEvent.click(screen.getByTestId('skip-api-key'));

      return waitFor(() => {
        expect(onComplete).toHaveBeenCalledWith(
          expect.objectContaining({ onboardingComplete: true }),
        );
      });
    });
  });
});
