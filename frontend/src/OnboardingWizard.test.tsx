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
    openVaultFolder: vi.fn().mockResolvedValue({ vaultRoot: '/home/user/my-vault', cancelled: false }),
    settingsSet: vi.fn().mockResolvedValue({ saved: true }),
  };
});

async function advanceToAgents() {
  render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /get started/i }));
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
  // skip API key
  fireEvent.click(screen.getByTestId('skip-api-key'));
  await waitFor(() => expect(screen.getByTestId('step-agents')).toBeInTheDocument());
}

describe('OnboardingWizard', () => {
  it('renders the welcome step on first render', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('step-welcome')).toBeInTheDocument();
    expect(screen.getByText('Welcome to Mythos Writer')).toBeInTheDocument();
  });

  it('navigates forward through all steps', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);

    // Step 1 → 2
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    expect(screen.getByTestId('step-vault')).toBeInTheDocument();

    // Step 2 → 3 (new vault, no dialog needed)
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByTestId('step-apikey')).toBeInTheDocument();

    // Step 3 → 4 (skip api key)
    fireEvent.click(screen.getByTestId('skip-api-key'));
    expect(screen.getByTestId('step-agents')).toBeInTheDocument();
  });

  it('navigates back from step 2 to step 1', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByTestId('step-welcome')).toBeInTheDocument();
  });

  it('navigates back from step 3 to step 2', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByTestId('step-vault')).toBeInTheDocument();
  });

  it('navigates back from step 4 to step 3', async () => {
    await advanceToAgents();
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByTestId('step-apikey')).toBeInTheDocument();
  });

  describe('vault selection — existing vault', () => {
    it('opens folder dialog when existing vault is chosen and advances to step 3', async () => {
      render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));

      fireEvent.click(screen.getByLabelText(/use existing obsidian vault/i));
      fireEvent.click(screen.getByRole('button', { name: /browse/i }));

      await waitFor(() => {
        expect((window as unknown as { api: { openVaultFolder: ReturnType<typeof vi.fn> } }).api.openVaultFolder).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(screen.getByTestId('step-apikey')).toBeInTheDocument();
      });
    });

    it('stays on step 2 if the folder dialog is cancelled', async () => {
      (window as unknown as { api: { openVaultFolder: ReturnType<typeof vi.fn>; settingsSet: ReturnType<typeof vi.fn> } }).api.openVaultFolder =
        vi.fn().mockResolvedValue({ vaultRoot: null, cancelled: true });

      render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));
      fireEvent.click(screen.getByLabelText(/use existing obsidian vault/i));
      fireEvent.click(screen.getByRole('button', { name: /browse/i }));

      await waitFor(() => {
        expect(screen.getByTestId('step-vault')).toBeInTheDocument();
      });
    });
  });

  describe('API key step', () => {
    async function goToApiKeyStep() {
      render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    }

    it('next button is disabled when API key input is empty', async () => {
      await goToApiKeyStep();
      expect(screen.getByTestId('save-api-key')).toBeDisabled();
    });

    it('next button enables when API key is entered', async () => {
      await goToApiKeyStep();
      fireEvent.change(screen.getByTestId('api-key-input'), {
        target: { value: 'sk-ant-test1234' },
      });
      expect(screen.getByTestId('save-api-key')).not.toBeDisabled();
    });

    it('advances to agents step after entering key and clicking next', async () => {
      await goToApiKeyStep();
      fireEvent.change(screen.getByTestId('api-key-input'), {
        target: { value: 'sk-ant-test1234' },
      });
      fireEvent.click(screen.getByTestId('save-api-key'));
      expect(screen.getByTestId('step-agents')).toBeInTheDocument();
    });

    it('skip path — advances to agents step without requiring a key', async () => {
      await goToApiKeyStep();
      fireEvent.click(screen.getByTestId('skip-api-key'));
      expect(screen.getByTestId('step-agents')).toBeInTheDocument();
    });
  });

  describe('agents step', () => {
    it('shows all three agent toggles with initial enabled state', async () => {
      await advanceToAgents();
      expect(screen.getByTestId('agent-toggle-writingAssistant')).toBeChecked();
      expect(screen.getByTestId('agent-toggle-brainstorm')).toBeChecked();
      expect(screen.getByTestId('agent-toggle-archive')).toBeChecked();
    });

    it('persists agent enabled flags and calls onComplete on finish', async () => {
      const onComplete = vi.fn();
      render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      fireEvent.click(screen.getByTestId('skip-api-key'));

      await waitFor(() => expect(screen.getByTestId('step-agents')).toBeInTheDocument());

      // disable brainstorm
      fireEvent.click(screen.getByTestId('agent-toggle-brainstorm'));
      fireEvent.click(screen.getByTestId('finish-onboarding'));

      await waitFor(() => {
        const api = (window as unknown as { api: { settingsSet: ReturnType<typeof vi.fn> } }).api;
        expect(api.settingsSet).toHaveBeenCalledWith(
          expect.objectContaining({
            onboardingComplete: true,
            agents: expect.objectContaining({
              brainstorm: expect.objectContaining({ enabled: false }),
              writingAssistant: expect.objectContaining({ enabled: true }),
            }),
          }),
        );
      });
      await waitFor(() => {
        expect(onComplete).toHaveBeenCalledWith(
          expect.objectContaining({ onboardingComplete: true }),
        );
      });
      expect(screen.getByTestId('step-done')).toBeInTheDocument();
    });

    it('with API key entered — key is included in saved settings', async () => {
      const onComplete = vi.fn();
      render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));
      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      fireEvent.change(screen.getByTestId('api-key-input'), { target: { value: 'sk-ant-test1234' } });
      fireEvent.click(screen.getByTestId('save-api-key'));

      await waitFor(() => expect(screen.getByTestId('step-agents')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('finish-onboarding'));

      await waitFor(() => {
        const api = (window as unknown as { api: { settingsSet: ReturnType<typeof vi.fn> } }).api;
        expect(api.settingsSet).toHaveBeenCalledWith(
          expect.objectContaining({ apiKey: 'sk-ant-test1234', onboardingComplete: true }),
        );
      });
    });
  });

  describe('done step', () => {
    it('shows done screen after completing the wizard', async () => {
      render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      fireEvent.click(screen.getByTestId('skip-api-key'));

      await waitFor(() => expect(screen.getByTestId('step-agents')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('finish-onboarding'));

      await waitFor(() => {
        expect(screen.getByTestId('step-done')).toBeInTheDocument();
      });
      expect(screen.getByText(/you're all set/i)).toBeInTheDocument();
    });
  });
});
