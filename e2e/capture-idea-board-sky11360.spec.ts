/**
 * capture-idea-board-sky11360.spec.ts — SKY-11399 screenshot evidence for PR #1434
 *
 * SKY-11360 moves the brainstorm / Idea Board file out of the user's Notes Vault
 * and into the Agent Vault (agent state, not user writing). The visible surface
 * touched by the PR is the Brainstorm → Board page (`frontend/src/BrainstormPage.tsx`),
 * so `screenshot-check` requires a real screenshot of it.
 *
 * This spec boots the real Electron app (no mocked renderer), opens the Idea
 * Board, places a few starter-library ideas onto the one free-form canvas, and
 * writes a full-window PNG to docs/screenshots/sky-11360/idea-board.png.
 *
 * Run (after `npm run build:electron`):
 *   xvfb-run -a npx playwright test e2e/capture-idea-board-sky11360.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { closeElectronApp, removeTempDirs } from './helpers/electronTeardown';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/sky-11360');

function seedUserData(userData: string, vaultDir: string): void {
  const agentDefaults = {
    enabled: true,
    model: 'claude-haiku-4-5-20251001',
    autoApply: false,
    confidenceThreshold: 0.85,
    maxTokensPerHour: 100_000,
    maxSuggestionsPerHour: 50,
    heartbeatIntervalMinutes: 5,
    maxTokensPerDay: 500_000,
  };
  const appSettings = {
    apiKey: 'sk-ant-test-key-for-e2e',
    onboardingComplete: true,
    agents: {
      writingAssistant: { ...agentDefaults, enabled: false },
      brainstorm: { ...agentDefaults, enabled: true },
      archive: { ...agentDefaults, enabled: false },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: vaultDir };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

let userData: string;
let vaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-shot-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-shot-vault-'));
  seedUserData(userData, vaultDir);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  app = await launchApp(userData);
  page = await app.firstWindow();
  page.on('dialog', (dialog) => void dialog.accept().catch(() => undefined));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
});

test.afterAll(async () => {
  if (app) await closeElectronApp(app);
  removeTempDirs(userData, vaultDir);
});

test('capture: Idea Board with placed starter ideas', async () => {
  // Open the Brainstorm panel (supported Ctrl+3 shortcut).
  await page.keyboard.press('Control+3');
  const panel = page.locator('#app-tabpanel-brainstorm');
  await expect(panel).toBeVisible({ timeout: 8_000 });

  // Left IDEA COLLECTIONS starter library is present.
  await expect(page.locator('[data-testid="bs-collections"]')).toBeVisible();

  // Place a known starter beat — this jumps to the Board page with the card.
  await page.locator('[data-testid="bs-coll-toggle-beats"]').click();
  const beat = page.getByRole('button', { name: 'Add Midpoint Reversal to the board' });
  await expect(beat).toBeVisible({ timeout: 5_000 });
  await beat.click();
  await expect(page.locator('[data-testid="bsc-mode-board"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="bsc-board"]')).toBeVisible();

  // Place a couple more ideas from other starter collections so the canvas
  // reads as a populated board. Best-effort — a missing collection must not
  // fail the capture.
  for (const coll of ['trope', 'theme']) {
    try {
      await page.locator(`[data-testid="bs-coll-toggle-${coll}"]`).click({ timeout: 2_000 });
      const add = page.getByRole('button', { name: /Add .+ to the board/ }).first();
      if (await add.isVisible().catch(() => false)) await add.click({ timeout: 2_000 });
    } catch {
      /* collection absent or already collapsed — skip */
    }
  }

  // Land firmly on the Board page and let cards settle.
  await page.locator('[data-testid="bsc-mode-board"]').click();
  await expect(page.locator('[data-testid="bsc-board"]')).toBeVisible();
  await expect(page.locator('.bsb-card').first()).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(400);

  const cardCount = await page.locator('.bsb-card').count();
  expect(cardCount).toBeGreaterThanOrEqual(1);

  await page.screenshot({ path: path.join(OUT_DIR, 'idea-board.png') });
});
