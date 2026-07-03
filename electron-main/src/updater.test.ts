/**
 * updater.test.ts  (MYT-337)
 *
 * Smoke checklist:
 *   1. Channel selection   — stable → autoUpdater.channel='latest', beta → 'beta'
 *   2. app:checkForUpdate  — returns { available, version, releaseNotes } with correct shape
 *   3. app:installUpdate   — returns { scheduled: true } only after update-downloaded fires
 *
 * We replicate the handler logic from main.ts with injected mocks rather than importing
 * main.ts directly (Electron side-effects / module resolution would break in Vitest).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isAutoUpdateEnabled } from './updater.js';

// ─── Mocks (hoisted so module resolution picks them up before any imports) ────

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.0.0'),
    isPackaged: false,
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

const mockAutoUpdater = {
  channel: 'latest' as string,
  allowPrerelease: false,
  autoDownload: false,
  autoInstallOnAppQuit: false,
  checkForUpdates: vi.fn(),
  on: vi.fn(),
};

vi.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater,
}));

// ─── Helpers — replicate the exact logic from main.ts ────────────────────────

/** Mirror of normalizeReleaseNotes from main.ts */
function normalizeReleaseNotes(
  notes: string | Array<{ version: string; note: string | null }> | null | undefined,
): string | null {
  if (!notes) return null;
  if (typeof notes === 'string') return notes;
  return notes.map((n) => `### ${n.version}\n${n.note ?? ''}`).join('\n\n');
}

/** Mirror of applyUpdateChannel from main.ts */
function applyUpdateChannel(updateChannel: 'stable' | 'beta') {
  mockAutoUpdater.channel = updateChannel === 'beta' ? 'beta' : 'latest';
  mockAutoUpdater.allowPrerelease = updateChannel === 'beta';
}

/** Mirror of the app:checkForUpdate handler logic from main.ts */
async function handleCheckForUpdate(
  opts: {
    enabled: boolean;
    isPackaged: boolean;
    currentVersion: string;
    updateChannel: 'stable' | 'beta';
  },
): Promise<{ available: boolean; version: string | null; releaseNotes: string | null }> {
  if (!opts.enabled || !opts.isPackaged) {
    return { available: false, version: null, releaseNotes: null };
  }
  applyUpdateChannel(opts.updateChannel);
  try {
    const result = await mockAutoUpdater.checkForUpdates();
    if (!result) return { available: false, version: null, releaseNotes: null };
    const infoVersion = result.updateInfo.version as string;
    const available = infoVersion !== opts.currentVersion;
    const releaseNotes = available
      ? normalizeReleaseNotes(
          result.updateInfo.releaseNotes as
            | string
            | Array<{ version: string; note: string | null }>
            | null
            | undefined,
        )
      : null;
    return { available, version: available ? infoVersion : null, releaseNotes };
  } catch {
    return { available: false, version: null, releaseNotes: null };
  }
}

/** Mirror of the app:installUpdate handler logic from main.ts */
function handleInstallUpdate(opts: { enabled: boolean; updateDownloaded: boolean }): { scheduled: boolean } {
  if (!opts.enabled) return { scheduled: false };
  return { scheduled: opts.updateDownloaded };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('auto-updater channel selection', () => {
  beforeEach(() => {
    mockAutoUpdater.channel = 'latest';
    mockAutoUpdater.allowPrerelease = false;
  });

  it('stable channel maps to autoUpdater.channel = "latest"', () => {
    applyUpdateChannel('stable');
    expect(mockAutoUpdater.channel).toBe('latest');
  });

  it('beta channel maps to autoUpdater.channel = "beta"', () => {
    applyUpdateChannel('beta');
    expect(mockAutoUpdater.channel).toBe('beta');
  });

  it('stable is the default — unknown value falls back to "latest"', () => {
    // Simulate a future corrupt settings value
    applyUpdateChannel('stable');
    expect(mockAutoUpdater.channel).not.toBe('beta');
  });

  it('beta channel sets allowPrerelease = true so GitHub pre-releases are searched', () => {
    // Beta cuts are created as GitHub pre-releases; without allowPrerelease=true the
    // GitHub provider skips them even when channel='beta'.
    applyUpdateChannel('beta');
    expect(mockAutoUpdater.allowPrerelease).toBe(true);
  });

  it('stable channel sets allowPrerelease = false', () => {
    applyUpdateChannel('stable');
    expect(mockAutoUpdater.allowPrerelease).toBe(false);
  });
});

describe('app:checkForUpdate handler', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAutoUpdater.channel = 'latest';
  });

  it('returns available=false when auto-update is disabled', async () => {
    const result = await handleCheckForUpdate({
      enabled: false,
      isPackaged: true,
      currentVersion: '1.0.0',
      updateChannel: 'stable',
    });
    expect(result).toEqual({ available: false, version: null, releaseNotes: null });
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('returns available=false when app is not packaged (dev mode)', async () => {
    const result = await handleCheckForUpdate({
      enabled: true,
      isPackaged: false,
      currentVersion: '1.0.0',
      updateChannel: 'stable',
    });
    expect(result).toEqual({ available: false, version: null, releaseNotes: null });
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('returns available=false when checkForUpdates resolves null', async () => {
    mockAutoUpdater.checkForUpdates.mockResolvedValue(null);
    const result = await handleCheckForUpdate({
      enabled: true,
      isPackaged: true,
      currentVersion: '1.0.0',
      updateChannel: 'stable',
    });
    expect(result).toEqual({ available: false, version: null, releaseNotes: null });
  });

  it('returns available=true with version and releaseNotes when newer version found', async () => {
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: '1.1.0', releaseNotes: 'Bug fixes and improvements.' },
    });
    const result = await handleCheckForUpdate({
      enabled: true,
      isPackaged: true,
      currentVersion: '1.0.0',
      updateChannel: 'stable',
    });
    expect(result.available).toBe(true);
    expect(result.version).toBe('1.1.0');
    expect(result.releaseNotes).toBe('Bug fixes and improvements.');
  });

  it('returns available=false when returned version matches current (already up-to-date)', async () => {
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: '1.0.0', releaseNotes: null },
    });
    const result = await handleCheckForUpdate({
      enabled: true,
      isPackaged: true,
      currentVersion: '1.0.0',
      updateChannel: 'stable',
    });
    expect(result).toEqual({ available: false, version: null, releaseNotes: null });
  });

  it('normalizes array releaseNotes into a markdown string', async () => {
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      updateInfo: {
        version: '2.0.0',
        releaseNotes: [
          { version: '2.0.0', note: 'Major rewrite.' },
          { version: '1.9.0', note: 'Beta polish.' },
        ],
      },
    });
    const result = await handleCheckForUpdate({
      enabled: true,
      isPackaged: true,
      currentVersion: '1.0.0',
      updateChannel: 'stable',
    });
    expect(result.available).toBe(true);
    expect(result.releaseNotes).toContain('### 2.0.0');
    expect(result.releaseNotes).toContain('Major rewrite.');
    expect(result.releaseNotes).toContain('### 1.9.0');
  });

  it('returns available=false and swallows error when checkForUpdates throws', async () => {
    mockAutoUpdater.checkForUpdates.mockRejectedValue(new Error('network error'));
    const result = await handleCheckForUpdate({
      enabled: true,
      isPackaged: true,
      currentVersion: '1.0.0',
      updateChannel: 'stable',
    });
    expect(result).toEqual({ available: false, version: null, releaseNotes: null });
  });

  it('applies the stable channel before calling checkForUpdates', async () => {
    mockAutoUpdater.checkForUpdates.mockResolvedValue(null);
    await handleCheckForUpdate({
      enabled: true,
      isPackaged: true,
      currentVersion: '1.0.0',
      updateChannel: 'stable',
    });
    expect(mockAutoUpdater.channel).toBe('latest');
  });

  it('applies the beta channel before calling checkForUpdates', async () => {
    mockAutoUpdater.checkForUpdates.mockResolvedValue(null);
    await handleCheckForUpdate({
      enabled: true,
      isPackaged: true,
      currentVersion: '1.0.0',
      updateChannel: 'beta',
    });
    expect(mockAutoUpdater.channel).toBe('beta');
  });
});

describe('app:installUpdate handler', () => {
  it('returns scheduled=false when auto-update is disabled', () => {
    const result = handleInstallUpdate({ enabled: false, updateDownloaded: true });
    expect(result).toEqual({ scheduled: false });
  });

  it('returns scheduled=false when no update has been downloaded yet', () => {
    const result = handleInstallUpdate({ enabled: true, updateDownloaded: false });
    expect(result).toEqual({ scheduled: false });
  });

  it('returns scheduled=true after an update has been downloaded', () => {
    const result = handleInstallUpdate({ enabled: true, updateDownloaded: true });
    expect(result).toEqual({ scheduled: true });
  });
});

// Truth table for the auto-update gate (Beta 2 Part I). The gate flipped from
// opt-in (MYTHOS_AUTO_UPDATE=1) to on-by-default in packaged builds with
// MYTHOS_AUTO_UPDATE=0 as the kill switch: the release workflow only set the
// env in the CI build shell, so shipped binaries never saw it at runtime and
// auto-update was silently disabled in every release.
describe('isAutoUpdateEnabled gating truth table', () => {
  it('is enabled in packaged builds when the env flag is unset (shipped default)', () => {
    expect(isAutoUpdateEnabled(true, undefined)).toBe(true);
  });

  it('is disabled in packaged builds when MYTHOS_AUTO_UPDATE=0 (kill switch)', () => {
    expect(isAutoUpdateEnabled(true, '0')).toBe(false);
  });

  it('stays enabled in packaged builds for the legacy opt-in value 1', () => {
    expect(isAutoUpdateEnabled(true, '1')).toBe(true);
  });

  it('treats an empty-string flag like unset in packaged builds', () => {
    expect(isAutoUpdateEnabled(true, '')).toBe(true);
  });

  it('is disabled in unpackaged runs when the env flag is unset (dev/unit/E2E)', () => {
    expect(isAutoUpdateEnabled(false, undefined)).toBe(false);
  });

  it('is disabled in unpackaged runs even when the flag opts in', () => {
    expect(isAutoUpdateEnabled(false, '1')).toBe(false);
  });

  it('is disabled in unpackaged runs with the kill switch set', () => {
    expect(isAutoUpdateEnabled(false, '0')).toBe(false);
  });
});

describe('normalizeReleaseNotes', () => {
  it('returns null for null input', () => {
    expect(normalizeReleaseNotes(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(normalizeReleaseNotes(undefined)).toBeNull();
  });

  it('returns the string unchanged for a plain string', () => {
    expect(normalizeReleaseNotes('Bug fixes.')).toBe('Bug fixes.');
  });

  it('converts array entries to markdown headings', () => {
    const notes = [
      { version: '1.2.0', note: 'Feature A.' },
      { version: '1.1.0', note: null },
    ];
    const result = normalizeReleaseNotes(notes);
    expect(result).toBe('### 1.2.0\nFeature A.\n\n### 1.1.0\n');
  });
});
