/**
 * pkg-e2e-linux — packaged-app smoke.
 *
 * Reuses e2e/smoke.spec.ts TC-01–03 against the packaged binary. Skips when
 * MYTHOS_PACKAGED_EXE is unset, so the ordinary CI shards stay unchanged.
 *
 *   MYTHOS_PACKAGED_EXE="$PWD/dist-electron/linux-unpacked/mythos-writer" \
 *     npm run test:e2e:packaged
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createStoryFromNavAdd } from './helpers/newStoryModal';

const packagedExe = process.env.MYTHOS_PACKAGED_EXE;

function seedUserData(userData: string, vaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: false,
        model: 'claude-sonnet-4-6',
        scanIntervalSeconds: 30,
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: false,
        model: 'claude-sonnet-4-6',
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: false,
        model: 'claude-sonnet-4-6',
        continuityCheckIntervalSeconds: 60,
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir }, null, 2),
  );
}

test.describe('pkg-e2e-linux', () => {
  test.skip(!packagedExe, 'MYTHOS_PACKAGED_EXE is unset');

  let userData: string;
  let vaultDir: string;
  let electronApp: ElectronApplication | undefined;
  let page: Page;
  let clientCertListeners = -1;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pkg-e2e-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pkg-vault-'));
    seedUserData(userData, vaultDir);
    const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
      ? ['--headless']
      : [];
    electronApp = await electron.launch({
      executablePath: packagedExe,
      args: [`--user-data-dir=${userData}`, ...extraArgs],
      timeout: 60_000,
    });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    clientCertListeners = await electronApp.evaluate(({ app }) => app.listenerCount('select-client-certificate'));
  });

  test.afterAll(async () => {
    await electronApp?.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  test('select-client-certificate listener is registered exactly once', () => {
    // A bare Electron 44.9.0 (and 42.11.2) App already has one internal relay
    // for this event before user code runs: `(t,r,...o)=>{r&&r.emit(e,t,...o)}`.
    // installClientCertPolicy adds exactly one listener, so the packaged total is 2.
    // Removing that call leaves the internal relay only (1) and this assertion fails.
    expect(clientCertListeners).toBe(2);
  });

  test('TC-01: app boots past onboarding into DesktopShell', async () => {
    await expect(page.getByRole('dialog', { name: 'Onboarding wizard' })).not.toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.wc-title')).toHaveText('Mythos Writer');
  });

  test('TC-02: create story → chapter → scene and type text', async () => {
    const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
    if (await storiesTab.isVisible()) await storiesTab.click();

    await createStoryFromNavAdd(page);

    const storyRow = page.locator('.nav-story-row').first();
    await expect(storyRow).toBeVisible({ timeout: 8_000 });
    await expect(storyRow).toContainText('Untitled Story');

    const chapterRow = page.locator('.nav-chapter-row').first();
    await expect(chapterRow).toBeVisible({ timeout: 6_000 });
    await expect(chapterRow).toContainText('Chapter 1');

    const sceneItem = page.locator('.nav-scene-row').first();
    await expect(sceneItem).toBeVisible({ timeout: 6_000 });
    await expect(sceneItem).toContainText('Untitled Scene');

    await sceneItem.click();
    await expect(page.locator('.block-editor')).toBeVisible({ timeout: 8_000 });
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible({ timeout: 5_000 });
    await expect(editor).toBeFocused({ timeout: 5_000 });

    const sceneText = 'The dragon soared over the Foundry as dawn broke.';
    await page.keyboard.type(sceneText);
    await expect(editor).toContainText(sceneText);
  });

  test('TC-03: save snapshot and verify in history panel', async () => {
    const menuBtn = page.locator('.msv-title-menu-btn');
    await expect(menuBtn).toBeVisible({ timeout: 5_000 });
    await menuBtn.click();
    const menuPopover = page.locator('[data-testid="msv-title-menu-popover"]');
    await expect(menuPopover).toBeVisible({ timeout: 3_000 });
    await menuPopover.locator('[data-testid="msv-title-menu-snapshot"]').click();

    await menuBtn.click();
    await expect(menuPopover).toBeVisible({ timeout: 3_000 });
    await expect(menuPopover.locator('.msv-title-menu-note')).toContainText('Snapshot saved', { timeout: 10_000 });

    await menuPopover.locator('[data-testid="msv-title-menu-history"]').click();
    const historyPanel = page.getByRole('dialog', { name: /Draft history|Draft History|Scene History/ });
    await expect(historyPanel).toBeVisible({ timeout: 5_000 });
    await expect(historyPanel.locator('.history-item').first()).toBeVisible({ timeout: 5_000 });

    const closeBtn = historyPanel.getByRole('button', { name: /Close draft history|Close history/ });
    if (await closeBtn.isVisible()) await closeBtn.click();
    await expect(historyPanel).not.toBeVisible({ timeout: 3_000 });
  });
});
