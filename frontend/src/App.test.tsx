import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';

const mockManifest = {
  version: '1',
  vaultRoot: '/tmp',
  stories: [],
  entities: [],
  suggestions: [],
  scenes: [],
  chapters: [],
};

function makeMockApi(overrides: Record<string, unknown> = {}) {
  return {
    settingsGet: () => Promise.resolve({ onboardingComplete: true }),
    readManifest: () => Promise.resolve(mockManifest),
    writeManifest: () => Promise.resolve({}),
    onVaultFileChanged: () => () => {},
    ...overrides,
  };
}

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).api = makeMockApi();
});

describe('App — onboarding gate (SKY-152)', () => {
  it('shows wizard when onboardingComplete is false', async () => {
    (window as any).api = makeMockApi({
      settingsGet: () => Promise.resolve({ onboardingComplete: false }),
      pickFolder: vi.fn().mockResolvedValue({ vaultRoot: null, cancelled: true, registrationToken: null }),
      obsidianDryRun: vi.fn(),
      obsidianRegister: vi.fn(),
      vaultSetPaths: vi.fn(),
      loadSampleTwoVault: vi.fn(),
      validatePath: vi.fn().mockResolvedValue({ exists: false, isEmpty: true, writable: true }),
      obsidianPickFolderByPath: vi.fn(),
      onboardingComplete: vi.fn().mockResolvedValue({ ok: true }),
      writeVault: vi.fn(),
      writeNotesVault: vi.fn(),
    });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('screen-welcome')).toBeInTheDocument());
  });

  it('shows "Create your first project" CTA on first launch', async () => {
    (window as any).api = makeMockApi({
      settingsGet: () => Promise.resolve({ onboardingComplete: false }),
      pickFolder: vi.fn().mockResolvedValue({ vaultRoot: null, cancelled: true, registrationToken: null }),
      obsidianDryRun: vi.fn(),
      obsidianRegister: vi.fn(),
      vaultSetPaths: vi.fn(),
      loadSampleTwoVault: vi.fn(),
      validatePath: vi.fn().mockResolvedValue({ exists: false, isEmpty: true, writable: true }),
      obsidianPickFolderByPath: vi.fn(),
      onboardingComplete: vi.fn().mockResolvedValue({ ok: true }),
      writeVault: vi.fn(),
      writeNotesVault: vi.fn(),
    });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('cta-create-project')).toBeInTheDocument());
  });

  it('bypasses wizard when onboardingComplete is true (existing vault)', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText(/loading your vault/i)).toBeInTheDocument());
  });
});

describe('App', () => {
  it('renders the app shell loading state', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/loading your vault/i)).toBeInTheDocument();
    });
  });
});
