// Beta 3 M24 — unit tests for the settings remainder pages + import flows.
// A11y contract (SKY-814): every slider carries an aria-label; the settings
// e2e grabs the FIRST range input in each tabpanel, so that label must exist.
import { render, screen, fireEvent, act } from '@testing-library/react';
import AccountProfileSection from './AccountProfileSection';
import EditorSettingsSection, { EDITOR_PREFS_DEFAULTS } from './EditorSettingsSection';
import ImportVaultSection from './ImportVaultSection';
import ImportStorySection from './ImportStorySection';
import SyncBackupSection from './SyncBackupSection';
import ShortcutsSection from './ShortcutsSection';
import AboutSection from './AboutSection';
import { buildShortcutGroups, MOD } from '../../../shortcuts';

const baseSettings: AppSettings = {
  apiKey: '',
  agents: {
    writingAssistant: { enabled: true, model: 'm', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.8, maxTokensPerHour: 1, maxSuggestionsPerHour: 1, heartbeatIntervalMinutes: 5, maxTokensPerDay: 1 },
    brainstorm: { enabled: true, model: 'm', autoApply: false, confidenceThreshold: 0.8, maxTokensPerHour: 1, maxSuggestionsPerHour: 1, heartbeatIntervalMinutes: 5, maxTokensPerDay: 1 },
    archive: { enabled: true, model: 'm', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.8, maxTokensPerHour: 1, maxSuggestionsPerHour: 1, heartbeatIntervalMinutes: 5, maxTokensPerDay: 1 },
  },
  theme: 'dark',
  authorName: 'Skyy',
};

const mockGetAppInfo = vi.fn();
const mockChooseVaultFolder = vi.fn();
const mockVaultImportScan = vi.fn();
const mockVaultImportRun = vi.fn();
const mockStoryImportPickFile = vi.fn();
const mockStoryImportRun = vi.fn();
const mockBackupAppData = vi.fn();
const mockRestoreAppData = vi.fn();
const mockAppCheckForUpdate = vi.fn();
const mockOnboardingReset = vi.fn();

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGetAppInfo.mockResolvedValue({ platform: 'linux', electronVersion: '42.0.0', appVersion: '0.3.0-beta.2' });
  mockChooseVaultFolder.mockResolvedValue({ path: '/tmp/source-vault', cancelled: false });
  mockVaultImportScan.mockResolvedValue({ ok: true, noteCount: 87, attachmentCount: 3, totalFiles: 90, sampleFiles: ['World/The Gate.md'], warnings: [] });
  mockVaultImportRun.mockResolvedValue({ ok: true, targetPath: '/notes/Imported/source-vault', imported: 90, skipped: 0, errors: [] });
  mockStoryImportPickFile.mockResolvedValue({ filePath: '/tmp/The Last City.docx', cancelled: false });
  mockStoryImportRun.mockResolvedValue({ ok: true, storyTitle: 'The Last City', chapterCount: 12, sceneCount: 34, partCount: 2, planNotePath: 'Plans/Plan — The Last City.md', warnings: [] });
  mockBackupAppData.mockResolvedValue({ path: '/tmp/backup.zip', bytes: 2048, cancelled: false });
  mockRestoreAppData.mockResolvedValue({ restored: false, details: [], requiresConfirmation: true });
  mockAppCheckForUpdate.mockResolvedValue({ available: true, version: '0.4.0', releaseNotes: null });
  mockOnboardingReset.mockResolvedValue({ ok: true });
  (window as unknown as { api: unknown }).api = {
    getAppInfo: mockGetAppInfo,
    chooseVaultFolder: mockChooseVaultFolder,
    vaultImportScan: mockVaultImportScan,
    vaultImportRun: mockVaultImportRun,
    storyImportPickFile: mockStoryImportPickFile,
    storyImportRun: mockStoryImportRun,
    backupAppData: mockBackupAppData,
    restoreAppData: mockRestoreAppData,
    appCheckForUpdate: mockAppCheckForUpdate,
    onboardingReset: mockOnboardingReset,
  };
});

// ── Account & profile ─────────────────────────────────────────────────────────

describe('AccountProfileSection', () => {
  it('binds the pen name to settings.authorName', async () => {
    const setSettings = vi.fn();
    render(<AccountProfileSection settings={baseSettings} setSettings={setSettings} setSavedOk={vi.fn()} />);
    await flush();
    const input = screen.getByLabelText('Pen name') as HTMLInputElement;
    expect(input.value).toBe('Skyy');
    fireEvent.change(input, { target: { value: 'Skyy Veynn' } });
    expect(setSettings).toHaveBeenCalled();
    const updater = setSettings.mock.calls[0][0] as (p: AppSettings) => AppSettings;
    expect(updater(baseSettings).authorName).toBe('Skyy Veynn');
  });

  it('shows this device with the detected platform', async () => {
    render(<AccountProfileSection settings={baseSettings} setSettings={vi.fn()} setSavedOk={vi.fn()} />);
    await flush();
    expect(screen.getByTestId('account-this-device').textContent).toContain('Linux');
  });
});

// ── Editor ────────────────────────────────────────────────────────────────────

describe('EditorSettingsSection', () => {
  it('renders the autosave slider with an aria-label (SKY-814 contract)', () => {
    render(<EditorSettingsSection settings={baseSettings} setSettings={vi.fn()} setSavedOk={vi.fn()} />);
    const slider = screen.getByLabelText('Autosave snapshot every') as HTMLInputElement;
    expect(slider.type).toBe('range');
    expect(slider.value).toBe(String(EDITOR_PREFS_DEFAULTS.autosaveSeconds));
  });

  it('flips a behavior toggle into editorPrefs', () => {
    const setSettings = vi.fn();
    render(<EditorSettingsSection settings={baseSettings} setSettings={setSettings} setSavedOk={vi.fn()} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Spellcheck while typing' }));
    const updater = setSettings.mock.calls[0][0] as (p: AppSettings) => AppSettings;
    expect(updater(baseSettings).editorPrefs?.spellcheck).toBe(false);
  });
});

// ── Import another vault ──────────────────────────────────────────────────────

describe('ImportVaultSection', () => {
  it('runs the Beta-2 wizard shape: browse → dry-run report → confirm → import', async () => {
    render(<ImportVaultSection notesVaultPath="/notes" />);

    fireEvent.click(screen.getByTestId('import-vault-browse'));
    await flush();
    expect(screen.getByTestId('import-vault-src').textContent).toBe('/tmp/source-vault');

    fireEvent.click(screen.getByTestId('import-vault-dry-run'));
    await flush();
    expect(mockVaultImportScan).toHaveBeenCalledWith('obsidian', '/tmp/source-vault');
    expect(screen.getByTestId('import-vault-report').textContent).toContain('87 notes');

    fireEvent.click(screen.getByTestId('import-vault-confirm'));
    await flush();
    expect(mockVaultImportRun).toHaveBeenCalledWith({ kind: 'obsidian', srcPath: '/tmp/source-vault', into: 'second' });
    expect(screen.getByTestId('import-vault-done').textContent).toContain('90 files imported');
  });

  it('passes the picked kind and surfaces scan errors', async () => {
    mockVaultImportScan.mockResolvedValue({ ok: false, error: 'No .scrivx file found' });
    render(<ImportVaultSection notesVaultPath="/notes" />);
    fireEvent.click(screen.getByTestId('import-vault-kind-scriv'));
    fireEvent.click(screen.getByTestId('import-vault-browse'));
    await flush();
    fireEvent.click(screen.getByTestId('import-vault-dry-run'));
    await flush();
    expect(mockVaultImportScan).toHaveBeenCalledWith('scriv', '/tmp/source-vault');
    expect(screen.getByTestId('import-vault-error').textContent).toContain('No .scrivx file found');
  });

  it('requires a destination folder before dry-running into a new vault', async () => {
    mockChooseVaultFolder.mockResolvedValueOnce({ path: '/tmp/source-vault', cancelled: false });
    render(<ImportVaultSection notesVaultPath="/notes" />);
    fireEvent.click(screen.getByTestId('import-vault-browse'));
    await flush();
    fireEvent.click(screen.getByTestId('import-vault-into-new'));
    expect((screen.getByTestId('import-vault-dry-run') as HTMLButtonElement).disabled).toBe(true);
  });
});

// ── Import a story ────────────────────────────────────────────────────────────

describe('ImportStorySection', () => {
  it('picks a file, runs the import, and reports parts/chapters/scenes + plan note', async () => {
    render(<ImportStorySection />);
    fireEvent.click(screen.getByTestId('import-story-run'));
    await flush();
    expect(mockStoryImportPickFile).toHaveBeenCalledWith('docx');
    expect(mockStoryImportRun).toHaveBeenCalledWith('docx', '/tmp/The Last City.docx');
    const done = screen.getByTestId('import-story-done').textContent ?? '';
    expect(done).toContain('The Last City');
    expect(done).toContain('2 parts');
    expect(done).toContain('12 chapters');
    expect(done).toContain('34 scenes');
    expect(done).toContain('Plans/Plan — The Last City.md');
  });

  it('does nothing when the picker is cancelled', async () => {
    mockStoryImportPickFile.mockResolvedValue({ filePath: null, cancelled: true });
    render(<ImportStorySection />);
    fireEvent.click(screen.getByTestId('import-story-run'));
    await flush();
    expect(mockStoryImportRun).not.toHaveBeenCalled();
  });

  it('sends the selected format and surfaces errors', async () => {
    mockStoryImportRun.mockResolvedValue({ ok: false, error: 'ePub spine contained no readable documents' });
    render(<ImportStorySection />);
    fireEvent.click(screen.getByTestId('import-story-format-epub'));
    fireEvent.click(screen.getByTestId('import-story-run'));
    await flush();
    expect(mockStoryImportPickFile).toHaveBeenCalledWith('epub');
    expect(screen.getByTestId('import-story-error').textContent).toContain('spine');
  });
});

// ── Sync & Backup ─────────────────────────────────────────────────────────────

describe('SyncBackupSection', () => {
  const vaults = { storyVaultPath: '/story', notesVaultPath: '/notes' };

  it('backs up via the existing app-data IPC', async () => {
    render(<SyncBackupSection vaults={vaults} vaultProvider={null} onMoveVault={vi.fn()} />);
    fireEvent.click(screen.getByTestId('sync-backup-btn'));
    await flush();
    expect(mockBackupAppData).toHaveBeenCalled();
    expect(screen.getByTestId('sync-status').textContent).toContain('Backup saved');
  });

  it('keeps the two-step restore handshake', async () => {
    render(<SyncBackupSection vaults={vaults} vaultProvider={null} onMoveVault={vi.fn()} />);
    fireEvent.click(screen.getByTestId('sync-restore-btn'));
    await flush();
    expect(screen.getByTestId('sync-restore-confirm')).toBeTruthy();
    mockRestoreAppData.mockResolvedValue({ restored: true, details: ['a', 'b'] });
    fireEvent.click(screen.getByTestId('sync-restore-confirm-btn'));
    await flush();
    expect(mockRestoreAppData).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId('sync-status').textContent).toContain('Restored 2 files');
  });

  it('offers the Move vault wizard entry point', () => {
    const onMoveVault = vi.fn();
    render(<SyncBackupSection vaults={vaults} vaultProvider={null} onMoveVault={onMoveVault} />);
    fireEvent.click(screen.getByTestId('sync-move-vault'));
    expect(onMoveVault).toHaveBeenCalled();
  });
});

// ── Shortcuts ─────────────────────────────────────────────────────────────────

describe('ShortcutsSection', () => {
  it('renders every group and entry from the real shortcut registry', () => {
    render(<ShortcutsSection />);
    for (const group of buildShortcutGroups(MOD)) {
      expect(screen.getAllByText(group.label).length).toBeGreaterThan(0);
      for (const entry of group.entries) {
        // Some actions repeat across groups (e.g. Focus mode) — assert presence.
        expect(screen.getAllByText(entry.action).length).toBeGreaterThan(0);
      }
    }
  });
});

// ── About ─────────────────────────────────────────────────────────────────────

describe('AboutSection', () => {
  it('shows the real app version and runs the update check', async () => {
    render(<AboutSection />);
    await flush();
    expect(screen.getByTestId('about-version').textContent).toContain('v0.3.0-beta.2');
    fireEvent.click(screen.getByTestId('about-check-updates'));
    await flush();
    expect(mockAppCheckForUpdate).toHaveBeenCalled();
    expect(screen.getByTestId('about-update-status').textContent).toContain('0.4.0');
  });
});
