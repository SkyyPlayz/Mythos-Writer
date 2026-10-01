import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useCreateMythosVaultFlow } from './useCreateMythosVaultFlow';

function TestHarness({ onCreated }: { onCreated: (r: { vaultRoot: string; notesVaultRoot: string }) => void }) {
  const { createVault, createVaultModal } = useCreateMythosVaultFlow(onCreated);
  return (
    <div>
      <button onClick={() => createVault()}>Open</button>
      <button onClick={() => createVault('openin')}>Open openin</button>
      {createVaultModal}
    </div>
  );
}

const DRY_PREVIEW = {
  markdownCount: 2,
  attachmentCount: 0,
  totalFiles: 2,
  topLevelFolders: ['Characters'],
  sampleFiles: ['Characters/A.md'],
};

function setApi(overrides: Partial<Record<string, unknown>> = {}) {
  (window as unknown as { api: unknown }).api = {
    vaultGetPaths: vi.fn().mockResolvedValue({ vaultsParentPath: '/current/vaults', defaultVaultsParentPath: '/default/vaults' }),
    chooseVaultFolder: vi.fn().mockResolvedValue({ path: '/picked/location', cancelled: false }),
    dryRunObsidianImport: vi.fn().mockResolvedValue({ preview: DRY_PREVIEW }),
    settingsGet: vi.fn().mockResolvedValue({ onboardingComplete: false }),
    settingsSet: vi.fn().mockResolvedValue(undefined),
    createVaultFromOptions: vi.fn().mockResolvedValue({
      ok: true,
      mode: 'template',
      mythosRoot: '/current/vaults/New',
      storyVaultPath: '/current/vaults/New/Stories/Story Vault',
      notesVaultPath: '/current/vaults/New/Notes/Notes Vault',
      vaultName: 'New',
    }),
    ...overrides,
  };
}

describe('useCreateMythosVaultFlow (Slice D five-path)', () => {
  beforeEach(() => setApi());

  it('defaults the destination to the current vaults parent path', async () => {
    render(<TestHarness onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByText('/current/vaults')).toBeInTheDocument());
  });

  it('creates via createVaultFromOptions with template mode by default', async () => {
    const onCreated = vi.fn();
    render(<TestHarness onCreated={onCreated} />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByText('/current/vaults')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Browse…'));
    await waitFor(() => expect(screen.getByText('/picked/location')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/name for the new mythos vault/i), { target: { value: 'My Vault' } });
    fireEvent.click(screen.getByTestId('create-vault-submit'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({
      vaultRoot: '/current/vaults/New/Stories/Story Vault',
      notesVaultRoot: '/current/vaults/New/Notes/Notes Vault',
    }));
    expect(window.api.createVaultFromOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'template',
        name: 'My Vault',
        destinationParent: '/picked/location',
        activate: true,
      }),
    );
  });

  it('exposes all five Mythos create modes including Open Obsidian', async () => {
    render(<TestHarness onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument());
    expect(screen.getByTestId('rail-vault-mode-template')).toBeInTheDocument();
    expect(screen.getByTestId('rail-vault-mode-blank')).toBeInTheDocument();
    expect(screen.getByTestId('rail-vault-mode-import')).toBeInTheDocument();
    expect(screen.getByTestId('rail-vault-mode-restore')).toBeInTheDocument();
    expect(screen.getByTestId('rail-vault-mode-openin')).toBeInTheDocument();
  });

  it('openin preset skips destination and requires Obsidian path', async () => {
    render(<TestHarness onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText('Open openin'));
    await waitFor(() => expect(screen.getByTestId('rail-vault-mode-openin')).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(screen.getByTestId('create-vault-submit'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Obsidian vault/i));
  });

  it('Default folder resets the destination to defaultVaultsParentPath', async () => {
    render(<TestHarness onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByText('/current/vaults')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Browse…'));
    await waitFor(() => expect(screen.getByText('/picked/location')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('create-vault-default-folder'));
    await waitFor(() => expect(screen.getByText('/default/vaults')).toBeInTheDocument());
  });

  it('C4/C3: import dry-runs Notes+Story slots before create; nothing written until confirm', async () => {
    const onCreated = vi.fn();
    render(<TestHarness onCreated={onCreated} />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('rail-vault-mode-import'));
    expect(screen.getByTestId('step2-story-row')).toBeInTheDocument();
    // Browse Notes source → dry-run, no create yet.
    const browseBtns = screen.getAllByRole('button', { name: /Browse/i });
    // Destination browse is first; Notes import browse is next.
    fireEvent.click(browseBtns[1]);
    await waitFor(() => expect(window.api.dryRunObsidianImport).toHaveBeenCalledWith('/picked/location', 'notes'));
    await waitFor(() => expect(screen.getByTestId('create-vault-dryrun-notes')).toBeInTheDocument());
    expect(window.api.createVaultFromOptions).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('create-vault-submit'));
    await waitFor(() => expect(window.api.createVaultFromOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'import',
        importSources: [{ kind: 'notes', srcPath: '/picked/location' }],
      }),
    ));
    await waitFor(() => expect(window.api.settingsSet).toHaveBeenCalledWith(
      expect.objectContaining({ onboardingComplete: true, onboardingStartMode: 'import' }),
    ));
  });

  it('C7: template create persists onboardingStartMode=template', async () => {
    render(<TestHarness onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByText('/current/vaults')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('create-vault-submit'));
    await waitFor(() => expect(window.api.settingsSet).toHaveBeenCalledWith(
      expect.objectContaining({ onboardingStartMode: 'template', onboardingComplete: true }),
    ));
  });

  it('C7: blank create persists onboardingStartMode=blank (RED if wrong mode mutant)', async () => {
    render(<TestHarness onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('rail-vault-mode-blank'));
    fireEvent.click(screen.getByTestId('create-vault-submit'));
    await waitFor(() => expect(window.api.settingsSet).toHaveBeenCalledWith(
      expect.objectContaining({ onboardingStartMode: 'blank', onboardingComplete: true }),
    ));
    // Must not write template (or any other mode) for the blank path.
    expect(window.api.settingsSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ onboardingStartMode: 'template' }),
    );
  });

  it('C7: import create persists onboardingStartMode=import', async () => {
    render(<TestHarness onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('rail-vault-mode-import'));
    const browseBtns = screen.getAllByRole('button', { name: /Browse/i });
    fireEvent.click(browseBtns[1]);
    await waitFor(() => expect(screen.getByTestId('create-vault-dryrun-notes')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('create-vault-submit'));
    await waitFor(() => expect(window.api.settingsSet).toHaveBeenCalledWith(
      expect.objectContaining({ onboardingStartMode: 'import', onboardingComplete: true }),
    ));
  });

  it('C7: Cancel mid-flow with dirty state shows confirm; discard writes nothing', async () => {
    render(<TestHarness onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/name for the new mythos vault/i), { target: { value: 'Drafty' } });
    fireEvent.click(screen.getByTestId('create-vault-cancel'));
    await waitFor(() => expect(screen.getByTestId('gs-cancel-confirm')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('create-vault-cancel-discard'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Create a Mythos vault' })).not.toBeInTheDocument());
    expect(window.api.createVaultFromOptions).not.toHaveBeenCalled();
  });
});
