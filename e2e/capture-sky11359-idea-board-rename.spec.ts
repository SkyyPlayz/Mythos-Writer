// SKY-11359 — PR evidence screenshots: the Brainstorm tab's board is renamed
// "Idea Board" everywhere user-visible (page-segment toggle, chat-page toggle
// switch label + tooltip). The Notes Board is a separate surface and is not
// touched by this change.
// Not part of CI: run manually to refresh the images.
//   xvfb-run --auto-servernum npx playwright test e2e/capture-sky11359-idea-board-rename.spec.ts
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/sky-11359-idea-board-rename');

function seedUserData(userData: string, vaultDir: string): void {
  const appSettings = {
    apiKey: 'sk-ant-test-key-for-e2e',
    onboardingComplete: true,
    agents: {
      brainstorm: {
        enabled: true,
        model: 'claude-haiku-4-5-20251001',
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
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: vaultDir }, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

test('capture SKY-11359 Idea Board rename — page-segment toggle + chat-page toggle', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-capture-sky11359-'));
  const userData = path.join(tempRoot, 'userData');
  const vaultDir = path.join(tempRoot, 'story-vault');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  seedUserData(userData, vaultDir);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const app = await launchApp(userData);
  try {
    const page: Page = await app.firstWindow();
    page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined); });
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.locator('.wc-menu', { hasText: 'File' }).click();
    await page.locator('.wc-menu-item', { hasText: 'New story' }).click();
    await expect(page.locator('.nav-story-row').first()).toBeVisible({ timeout: 8_000 });
    await page.locator('.nav-story-title').first().click();

    // Open Brainstorm (Ctrl+3 — same shortcut brainstorm.spec.ts uses).
    await page.keyboard.press('Control+3');
    const panel = page.locator('#app-tabpanel-brainstorm');
    await expect(panel).toBeVisible({ timeout: 6_000 });

    // 1) Agent Chat page — page-segment toggle reads "Agent Chat" / "Idea Board",
    //    and the chat-page "Idea Board" stack toggle is visible in the header.
    await expect(page.getByTestId('bsc-mode-board')).toHaveText('Idea Board');
    await expect(page.locator('.bs-board-toggle-wrap')).toContainText('Idea Board');
    await page.screenshot({ path: path.join(OUT_DIR, '01-agent-chat-page-segment-toggle.png') });

    // 2) Switch to the Idea Board page itself.
    await page.getByTestId('bsc-mode-board').click();
    await expect(page.getByTestId('bsc-mode-board')).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: path.join(OUT_DIR, '02-idea-board-page.png') });

    console.log(`Screenshots written to ${OUT_DIR}`);
  } finally {
    await app.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
