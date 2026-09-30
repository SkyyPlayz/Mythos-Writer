/**
 * Probe H1 (PR #1644): vault switch while Settings is open must await
 * `__mythosSettingsFlush` before `loadVault` unmounts SettingsPanel.
 *
 * Settings stays under `.desktop-shell__main-col` (M28 — nav rail clickable).
 * Flush-before-switch is the Probe-approved alternative to keep-mounted.
 *
 * Red-on-revert: drop the flush gate → applyProjectSwitched runs immediately
 * and shell-loading appears before the deferred flush resolves.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import App from './App';

const VAULT_A = '/vault-a';
const VAULT_B = '/vault-b';

let mainRoot = VAULT_A;
let onProjectSwitchedCb: ((data: { vaultRoot: string }) => void) | null = null;

function makeManifest(root: string) {
  return {
    version: '1',
    vaultRoot: root,
    stories: [],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
  };
}

function makeMockApi() {
  return {
    settingsGet: () => Promise.resolve({
      onboardingComplete: true,
      rightSidebarVisible: true,
      theme: 'dark',
      agents: {
        writingAssistant: { enabled: true },
        brainstorm: { enabled: true },
        archive: { enabled: true },
        lineEditor: { enabled: false },
      },
    }),
    vaultGetPaths: () => Promise.resolve({
      storyVaultPath: '/story',
      notesVaultPath: '/notes',
    }),
    validatePath: () => Promise.resolve({ valid: true, exists: true, writable: true }),
    getVaultRoot: () => Promise.resolve({ vaultRoot: mainRoot }),
    readManifest: () => Promise.resolve(makeManifest(mainRoot)),
    settingsSet: vi.fn().mockResolvedValue({ saved: true }),
    projectList: () => Promise.resolve({
      projects: [
        { vaultRoot: VAULT_A, name: 'Alpha', openedAt: '' },
        { vaultRoot: VAULT_B, name: 'Bravo', openedAt: '' },
      ],
    }),
    projectSwitch: vi.fn().mockImplementation(async (vaultRoot: string) => {
      mainRoot = vaultRoot;
      onProjectSwitchedCb?.({ vaultRoot });
      return { switched: true };
    }),
    onProjectSwitched: (cb: (data: { vaultRoot: string }) => void) => {
      onProjectSwitchedCb = cb;
      return () => { onProjectSwitchedCb = null; };
    },
    entityList: vi.fn().mockResolvedValue({ entities: [] }),
    listNotesVault: () => Promise.resolve({ items: [] }),
    onVaultFileChanged: () => () => {},
    archiveListContinuity: () => Promise.resolve({ items: [] }),
    onArchiveContScanStart: () => () => {},
    onArchiveContScanResult: () => () => {},
    onArchiveContScanError: () => () => {},
  };
}

beforeEach(() => {
  mainRoot = VAULT_A;
  onProjectSwitchedCb = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).api = makeMockApi();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function openSettings() {
  const gear = document.querySelector('.app-menu-gear-btn') as HTMLElement | null;
  if (gear) {
    fireEvent.click(gear);
    return;
  }
  fireEvent.click(screen.getAllByRole('button', { name: 'Open settings' })[0]);
}

describe('DesktopShell Settings flush on real vault-switch (Probe H1)', () => {
  it('gates loadVault on __mythosSettingsFlush while Settings is open', async () => {
    render(<App />);
    await screen.findByTestId(`nav-rail-vault-tile-${VAULT_A}`);

    openSettings();
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

    // Install a deferred flush that SettingsPanel's effect will not overwrite
    // mid-assertion: re-install after each microtask until the switch fires.
    let resolveFlush: ((v: boolean) => void) | null = null;
    const flushSpy = vi.fn();
    const installDeferredFlush = () => {
      const w = window as Window & { __mythosSettingsFlush?: () => Promise<boolean> };
      w.__mythosSettingsFlush = () => {
        flushSpy();
        return new Promise<boolean>((resolve) => { resolveFlush = resolve; });
      };
    };
    installDeferredFlush();
    // Re-bind after Effects that SettingsPanel may schedule.
    await act(async () => {
      await Promise.resolve();
      installDeferredFlush();
    });

    await act(async () => {
      onProjectSwitchedCb!({ vaultRoot: VAULT_B });
      await Promise.resolve();
    });

    // Flush gate: applyProjectSwitched must NOT have run yet.
    expect(flushSpy, 'onProjectSwitched must call __mythosSettingsFlush').toHaveBeenCalled();
    expect(
      document.querySelector('.shell-loading'),
      'loadVault must wait for flush — shell-loading must not appear yet',
    ).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

    // Release flush — apply is allowed to proceed (vault race suites cover
    // post-switch highlight; this test only proves the flush gate).
    await act(async () => {
      resolveFlush?.(true);
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('DesktopShell source flushes before applyProjectSwitched', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.resolve(__dirname, 'DesktopShell.tsx'), 'utf8');
    expect(src).toMatch(/__mythosSettingsFlush/);
    expect(src).toMatch(/flushOpenSettings/);
    expect(src).toMatch(/void flush\(\)\.finally\(\(\) => \{ applyProjectSwitched/);
  });
});
