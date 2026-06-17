import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    vaultGetPaths: () => Promise.resolve({
      storyVaultPath: '/tmp/mythos-story-vault',
      notesVaultPath: '/tmp/mythos-notes-vault',
    }),
    validatePath: () => Promise.resolve({ exists: true, isEmpty: false, writable: true }),
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
      templateList: vi.fn().mockResolvedValue({ templates: [] }),
      writeVault: vi.fn(),
      writeNotesVault: vi.fn(),
    });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('gs-overlay')).toBeInTheDocument());
  });

  it('shows Getting Started cards on first launch', async () => {
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
      templateList: vi.fn().mockResolvedValue({ templates: [] }),
      writeVault: vi.fn(),
      writeNotesVault: vi.fn(),
    });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('screen-step1')).toBeInTheDocument());
  });

  it('bypasses wizard when onboardingComplete is true (existing vault)', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText(/loading your vault/i)).toBeInTheDocument());
  });

  it('routes back through onboarding when neither vault binding is valid', async () => {
    (window as any).api = makeMockApi({
      vaultGetPaths: vi.fn().mockResolvedValue({
        storyVaultPath: '/Volumes/Cloud/Mythos/Story Vault',
        notesVaultPath: '/Volumes/Cloud/Mythos/Notes Vault',
      }),
      validatePath: vi.fn().mockResolvedValue({ exists: false, isEmpty: true, writable: false }),
      pickFolder: vi.fn().mockResolvedValue({ vaultRoot: null, cancelled: true, registrationToken: null }),
      obsidianDryRun: vi.fn(),
      obsidianRegister: vi.fn(),
      vaultSetPaths: vi.fn(),
      loadSampleTwoVault: vi.fn(),
      obsidianPickFolderByPath: vi.fn(),
      onboardingComplete: vi.fn().mockResolvedValue({ ok: true }),
      templateList: vi.fn().mockResolvedValue({ templates: [] }),
      writeVault: vi.fn(),
      writeNotesVault: vi.fn(),
    });

    render(<App />);

    await waitFor(() => expect(screen.getByTestId('gs-overlay')).toBeInTheDocument());
  });

  it('opens the shell when only the Notes vault is valid and shows the Story empty state', async () => {
    (window as any).api = makeMockApi({
      vaultGetPaths: vi.fn().mockResolvedValue({
        storyVaultPath: '/Volumes/Cloud/Mythos/Story Vault',
        notesVaultPath: '/Volumes/Cloud/Mythos/Notes Vault',
      }),
      validatePath: vi.fn(async (path: string) => (
        path.includes('Notes Vault')
          ? { exists: true, isEmpty: false, writable: true }
          : { exists: false, isEmpty: true, writable: false }
      )),
      readManifest: vi.fn().mockRejectedValue(new Error('story vault missing')),
      settingsSet: vi.fn().mockResolvedValue({}),
    });

    render(<App />);

    await waitFor(() => expect(screen.getByText(/start your first story to begin writing/i)).toBeInTheDocument());
    expect(screen.getAllByText(/no story vault/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /create a new story/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue onboarding/i })).toBeInTheDocument();
  });

  it('opens the shell when only the Story vault is valid and shows the Notes empty state after switching tabs', async () => {
    (window as any).api = makeMockApi({
      vaultGetPaths: vi.fn().mockResolvedValue({
        storyVaultPath: '/Volumes/Cloud/Mythos/Story Vault',
        notesVaultPath: '/Volumes/Cloud/Mythos/Notes Vault',
      }),
      validatePath: vi.fn(async (path: string) => (
        path.includes('Story Vault')
          ? { exists: true, isEmpty: false, writable: true }
          : { exists: false, isEmpty: true, writable: false }
      )),
      settingsSet: vi.fn().mockResolvedValue({}),
    });

    render(<App />);

    const notesTab = await screen.findByTestId('app-tab-notes');
    fireEvent.click(notesTab);

    await waitFor(() => expect(screen.getByRole('heading', { name: /no notes vault/i })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /create a notes vault/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect existing folder/i })).toBeInTheDocument();
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
