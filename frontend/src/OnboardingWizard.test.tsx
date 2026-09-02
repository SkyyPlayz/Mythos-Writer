// SKY-11152 (parent spec SKY-11141 §3b) — unit coverage for the rewritten
// 3-screen first-run wizard (Welcome → Import [import mode only] → Name your
// vault). Replaces the pre-SKY-11152 OnboardingWizard.test.tsx /
// OnboardingWizardV2.test.tsx, both of which covered the OLD 4-card /
// title-author-form / genre-theme-picker / AI-provider-step flow that this
// ticket removed wholesale (screen-step1/step1b/step1c/step2/step3,
// custom-location/custom-template/custom-genre/custom-theme, wiz-provider —
// none of those screens exist anymore; frontend/src/OnboardingWizard.tsx no
// longer has a WizardStep matching any of their testids). There is no
// meaningful adaptation for that coverage — it tested UI that was deleted, so
// the files were deleted rather than patched. E2E coverage for the new flow
// (including the AC-OB3-02/04 pinned SKY-11132 "import never adopts the
// source" regression) lives in e2e/onboarding-four-paths.spec.ts and
// e2e/tests/sky-11152-onboarding-add-vault-dialog.spec.ts.
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

const mockChooseVaultFolder = vi.fn();
const mockVaultGetPaths = vi.fn();
const mockCreateVaultFromOptions = vi.fn();
const mockDryRunObsidianImport = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockVaultGetPaths.mockResolvedValue({ defaultVaultsParentPath: '/home/writer/Mythos Vaults', pathSeparator: '/' });
  mockCreateVaultFromOptions.mockResolvedValue({
    ok: true,
    mode: 'template',
    mythosRoot: '/home/writer/Mythos Vaults/My Vault',
    storyVaultPath: '/home/writer/Mythos Vaults/My Vault/Story Vault',
    notesVaultPath: '/home/writer/Mythos Vaults/My Vault/Notes Vault',
    vaultName: 'My Vault',
  });
  Object.defineProperty(window, 'api', {
    value: {
      chooseVaultFolder: mockChooseVaultFolder,
      vaultGetPaths: mockVaultGetPaths,
      createVaultFromOptions: mockCreateVaultFromOptions,
      dryRunObsidianImport: mockDryRunObsidianImport,
    },
    writable: true,
    configurable: true,
  });
});

function renderWizard(onComplete = vi.fn(), onCancel = vi.fn()) {
  render(
    <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} onCancel={onCancel} />,
  );
  return { onComplete, onCancel };
}

describe('OnboardingWizard — Welcome screen (3 path cards)', () => {
  it('renders exactly the 3 supported cards, template flagged RECOMMENDED', async () => {
    renderWizard();
    await waitFor(() => expect(screen.getByTestId('screen-welcome')).toBeTruthy());

    expect(screen.getByTestId('card-template')).toBeTruthy();
    expect(screen.getByTestId('card-start-blank')).toBeTruthy();
    expect(screen.getByTestId('card-import-obsidian')).toBeTruthy();
    expect(screen.getByTestId('card-template').textContent).toContain('RECOMMENDED');
    expect(screen.getByTestId('card-start-blank').textContent).not.toContain('RECOMMENDED');
    expect(screen.getByTestId('card-import-obsidian').textContent).not.toContain('RECOMMENDED');
  });

  it('does NOT render the removed sample/open-existing/restore cards', async () => {
    renderWizard();
    await waitFor(() => expect(screen.getByTestId('screen-welcome')).toBeTruthy());
    expect(screen.queryByTestId('card-sample')).toBeNull();
    expect(screen.queryByTestId('card-open-existing')).toBeNull();
    expect(screen.queryByTestId('card-restore')).toBeNull();
  });

  it('Escape shows the cancel-setup confirmation; Keep Going dismisses it', async () => {
    renderWizard();
    await waitFor(() => expect(screen.getByTestId('screen-welcome')).toBeTruthy());
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    expect(screen.getByTestId('gs-cancel-confirm')).toBeTruthy();
    fireEvent.click(screen.getByTestId('gs-keep-going'));
    expect(screen.queryByTestId('gs-cancel-confirm')).toBeNull();
  });

  it('Escape → Cancel Setup calls onCancel without touching the creation IPC', async () => {
    const { onCancel } = renderWizard();
    await waitFor(() => expect(screen.getByTestId('screen-welcome')).toBeTruthy());
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('gs-cancel-setup'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mockCreateVaultFromOptions).not.toHaveBeenCalled();
  });
});

describe('OnboardingWizard — Name your vault (every non-import path)', () => {
  it('"Start blank" lands directly on the name step (no import screen in between)', async () => {
    renderWizard();
    await waitFor(() => expect(screen.getByTestId('screen-welcome')).toBeTruthy());
    fireEvent.click(screen.getByTestId('card-start-blank'));
    await waitFor(() => expect(screen.getByTestId('screen-name')).toBeTruthy());
    expect(screen.queryByTestId('screen-import')).toBeNull();
  });

  it('shows a live "WILL BE CREATED AT" full-path preview that updates as the user types', async () => {
    renderWizard();
    fireEvent.click(await screen.findByTestId('card-template'));
    await waitFor(() => expect(screen.getByTestId('screen-name')).toBeTruthy());
    await waitFor(() => expect(mockVaultGetPaths).toHaveBeenCalled());

    fireEvent.change(screen.getByTestId('step3-vault-name'), { target: { value: 'Aetherfall' } });
    await waitFor(() =>
      expect(screen.getByTestId('step3-full-path').textContent).toBe('/home/writer/Mythos Vaults/Aetherfall'),
    );
  });

  it('template mode createNote copy describes the template folder shape', async () => {
    renderWizard();
    fireEvent.click(await screen.findByTestId('card-template'));
    await waitFor(() =>
      expect(screen.getByTestId('step3-create-note').textContent).toMatch(/Characters, Locations, Stories, Plot, Worldbuilding, Research/),
    );
  });

  it('blank mode createNote copy says the vault starts empty', async () => {
    renderWizard();
    fireEvent.click(await screen.findByTestId('card-start-blank'));
    await waitFor(() =>
      expect(screen.getByTestId('step3-create-note').textContent).toMatch(/Starts empty/),
    );
  });

  it('submitting calls createVaultFromOptions with mode/name/activate:true and finishes onboarding', async () => {
    const { onComplete } = renderWizard();
    fireEvent.click(await screen.findByTestId('card-template'));
    await waitFor(() => expect(screen.getByTestId('screen-name')).toBeTruthy());

    fireEvent.change(screen.getByTestId('step3-vault-name'), { target: { value: 'Aetherfall' } });
    fireEvent.click(screen.getByTestId('step3-open-vault'));

    await waitFor(() => expect(mockCreateVaultFromOptions).toHaveBeenCalledTimes(1));
    expect(mockCreateVaultFromOptions).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'template', name: 'Aetherfall', activate: true }),
    );
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    const updated = onComplete.mock.calls[0][0] as AppSettings;
    expect(updated.onboardingComplete).toBe(true);
  });

  it('surfaces a scaffold error inline and does not call onComplete when creation fails', async () => {
    mockCreateVaultFromOptions.mockResolvedValueOnce({ ok: false, error: 'Destination is not writable.' });
    const { onComplete } = renderWizard();
    fireEvent.click(await screen.findByTestId('card-start-blank'));
    await waitFor(() => expect(screen.getByTestId('screen-name')).toBeTruthy());

    fireEvent.click(screen.getByTestId('step3-open-vault'));
    await waitFor(() => expect(screen.getByTestId('gs-scaffold-error').textContent).toContain('Destination is not writable.'));
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('"Default folder" chip resets the path to the default vaults parent', async () => {
    renderWizard();
    fireEvent.click(await screen.findByTestId('card-start-blank'));
    await waitFor(() => expect(mockVaultGetPaths).toHaveBeenCalled());

    fireEvent.change(screen.getByTestId('step3-path-path'), { target: { value: '/custom/spot' } });
    fireEvent.click(screen.getByTestId('step3-path-reset'));
    await waitFor(() =>
      expect(screen.getByTestId('step3-full-path').textContent).toContain('/home/writer/Mythos Vaults'),
    );
  });
});

describe('OnboardingWizard — Import screen (import mode only)', () => {
  it('Continue is disabled until at least one of the two rows has a path', async () => {
    renderWizard();
    fireEvent.click(await screen.findByTestId('card-import-obsidian'));
    await waitFor(() => expect(screen.getByTestId('screen-import')).toBeTruthy());
    expect(screen.getByTestId('step2-continue')).toBeDisabled();

    fireEvent.change(screen.getByTestId('step2-notes-path'), { target: { value: '/obsidian/notes' } });
    expect(screen.getByTestId('step2-continue')).toBeEnabled();
  });

  it('shows the "one is enough" copy', async () => {
    renderWizard();
    fireEvent.click(await screen.findByTestId('card-import-obsidian'));
    await waitFor(() =>
      expect(screen.getByTestId('screen-import').textContent).toMatch(/One is enough/),
    );
  });

  it('Continue triggers a real dry-run scan and shows the report before anything is created', async () => {
    mockDryRunObsidianImport.mockResolvedValue({
      preview: { markdownCount: 12, attachmentCount: 2, totalFiles: 14, topLevelFolders: ['Characters'], sampleFiles: [] },
    });
    renderWizard();
    fireEvent.click(await screen.findByTestId('card-import-obsidian'));
    fireEvent.change(screen.getByTestId('step2-notes-path'), { target: { value: '/obsidian/notes' } });
    fireEvent.click(screen.getByTestId('step2-continue'));

    await waitFor(() => expect(mockDryRunObsidianImport).toHaveBeenCalledWith('/obsidian/notes', 'notes'));
    await waitFor(() => expect(screen.getByTestId('screen-import-report')).toBeTruthy());
    expect(screen.getByTestId('step2-report-notes').textContent).toContain('12');
    expect(mockCreateVaultFromOptions).not.toHaveBeenCalled();
  });

  it('a dry-run error stays inline and Continue stays enabled for retry (no report shown)', async () => {
    mockDryRunObsidianImport.mockResolvedValue({ error: "This doesn't look like an Obsidian vault." });
    renderWizard();
    fireEvent.click(await screen.findByTestId('card-import-obsidian'));
    fireEvent.change(screen.getByTestId('step2-notes-path'), { target: { value: '/not/obsidian' } });
    fireEvent.click(screen.getByTestId('step2-continue'));

    await waitFor(() => expect(screen.getByTestId('step2-dryrun-error').textContent).toContain("doesn't look like an Obsidian vault"));
    expect(screen.queryByTestId('screen-import-report')).toBeNull();
    expect(screen.getByTestId('step2-continue')).toBeEnabled();
  });

  it('confirming the dry-run report lands on the shared Name-your-vault step, not a separate finish path', async () => {
    mockDryRunObsidianImport.mockResolvedValue({
      preview: { markdownCount: 1, attachmentCount: 0, totalFiles: 1, topLevelFolders: [], sampleFiles: [] },
    });
    renderWizard();
    fireEvent.click(await screen.findByTestId('card-import-obsidian'));
    fireEvent.change(screen.getByTestId('step2-notes-path'), { target: { value: '/obsidian/notes' } });
    fireEvent.click(screen.getByTestId('step2-continue'));
    fireEvent.click(await screen.findByTestId('step2-report-confirm'));

    await waitFor(() => expect(screen.getByTestId('screen-name')).toBeTruthy());
    expect(mockCreateVaultFromOptions).not.toHaveBeenCalled();
  });

  it('submitting the name step after import confirm calls createVaultFromOptions with mode:import + importSources (SKY-11132: never the source path itself as destination)', async () => {
    mockDryRunObsidianImport.mockResolvedValue({
      preview: { markdownCount: 1, attachmentCount: 0, totalFiles: 1, topLevelFolders: [], sampleFiles: [] },
    });
    renderWizard();
    fireEvent.click(await screen.findByTestId('card-import-obsidian'));
    fireEvent.change(screen.getByTestId('step2-notes-path'), { target: { value: '/obsidian/notes' } });
    fireEvent.click(screen.getByTestId('step2-continue'));
    fireEvent.click(await screen.findByTestId('step2-report-confirm'));
    await waitFor(() => expect(screen.getByTestId('screen-name')).toBeTruthy());

    fireEvent.click(screen.getByTestId('step3-open-vault'));
    await waitFor(() => expect(mockCreateVaultFromOptions).toHaveBeenCalledTimes(1));
    const payload = mockCreateVaultFromOptions.mock.calls[0][0];
    expect(payload.mode).toBe('import');
    expect(payload.importSources).toEqual([{ kind: 'notes', srcPath: '/obsidian/notes' }]);
    expect(payload.destinationParent).not.toBe('/obsidian/notes');
  });
});
