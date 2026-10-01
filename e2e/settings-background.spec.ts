/**
 * settings-background.spec.ts — SKY-3219 / SKY-3291
 *
 * Regression E2E for bug #612: Save must not reset the background-image setting.
 *
 * Root cause: SettingsPanel.handleSave called applyLiquidNeonTokens(lg, null)
 * when bgPreviewUrl was not yet loaded, which caused the function to fall through
 * to the `else` branch and reset --bg-app-image to the default gradient.
 *
 * The fix (theme.ts): when bgMode='image' but no bgDataUrl is supplied, the
 * applyLiquidNeonTokens function now skips the background branch entirely so
 * the existing CSS variable value is preserved.
 *
 * This test verifies the full IPC path:
 *   - stored value in app-settings.json survives a Settings open → Save round-trip
 *   - --bg-app-image CSS variable is not reset to the default gradient after Save
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

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

// Minimal valid 1×1 white PNG — sufficient for loadBgImage to read and return a data URL.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// The default gradient sentinel from theme.ts — if --bg-app-image contains this,
// the image was reset.
const DEFAULT_GRADIENT_MARKER = 'radial-gradient';

function seedUserData(
  userData: string,
  vaultDir: string,
  notesVaultDir: string,
  bgImagePath: string,
): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    liquidNeon: {
      background: bgImagePath,
      bgMode: 'image',
      glass: 0.5,
      blur: 0.5,
      neonIntensity: 0.5,
      neonAccent: 'cyan',
      textHeader: '#edecf6',
      textBody: '#bfd6e8',
      textMuted: '#8a9bb0',
    },
    agents: {
      writingAssistant: {
        enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: false, model: 'claude-sonnet-4-6', autoApply: false,
        confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: notesVaultDir };
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(appSettings, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify(vaultSettings, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
  const proc = app.process();
  proc.stdout?.on('data', (d: Buffer) => console.log('[main:out]', d.toString().trimEnd()));
  proc.stderr?.on('data', (d: Buffer) => console.log('[main:err]', d.toString().trimEnd()));
  return app;
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  pg.on('console', (m) => console.log('[renderer:' + m.type() + ']', m.text()));
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let bgImagePath: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-bg-settings-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-bg-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-bg-notes-'));

  // Create a real image file that loadBgImage can read.
  bgImagePath = path.join(userData, 'test-background.png');
  fs.writeFileSync(bgImagePath, PNG_1X1);

  seedUserData(userData, vaultDir, notesVaultDir, bgImagePath);

  app = await launchApp(userData);
  page = await firstWindow(app);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── TC-SKY-3219-01: stored path survives Settings open → Save ────────────────
test('TC-SKY-3219-01: Save preserves background image path in stored settings', async () => {
  // Open Settings. SKY-3177: AppNavRail adds a second "Open settings" button; target the menu bar one.
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('[role="dialog"][aria-label="Settings"]')).toBeVisible({ timeout: 5_000 });
  // SKY-10668: the panel now opens on Appearance (no Save footer) — the
  // explicit-save flow under test lives on the AI Agents page.
  await page.locator('[data-testid="settings-cat-agents"]').click();

  // F2#15: close auto-saves (no Save button).
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.locator('[role="dialog"][aria-label="Settings"]')).not.toBeVisible({ timeout: 2_000 });

  // Verify app-settings.json still has the correct background path.
  const stored = JSON.parse(fs.readFileSync(path.join(userData, 'app-settings.json'), 'utf-8')) as {
    liquidNeon?: { background?: string; bgMode?: string };
  };
  expect(stored.liquidNeon?.background).toBe(bgImagePath);
  expect(stored.liquidNeon?.bgMode).toBe('image');
});

// ─── TC-SKY-3219-02: --bg-app-image is not reset to gradient after Save ───────
test('TC-SKY-3219-02: Save does not reset --bg-app-image CSS variable to default gradient', async () => {
  // Allow loadBgImage to finish setting up --bg-app-image on initial load.
  await page.waitForTimeout(500);

  const bgBefore = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--bg-app-image'),
  );
  // Initial load should have set the image (data URL), not the default gradient.
  expect(bgBefore).not.toContain(DEFAULT_GRADIENT_MARKER);
  expect(bgBefore).toContain('data:');

  // Open Settings and Save. SKY-3177: AppNavRail adds a second "Open settings" button; target the menu bar one.
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('[role="dialog"][aria-label="Settings"]')).toBeVisible({ timeout: 5_000 });
  // SKY-10668: the panel now opens on Appearance (no Save footer) — the
  // explicit-save flow under test lives on the AI Agents page.
  await page.locator('[data-testid="settings-cat-agents"]').click();
  // F2#15: close auto-saves (no Save button).
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.locator('[role="dialog"][aria-label="Settings"]')).not.toBeVisible({ timeout: 2_000 });

  // Allow async onSaved → loadBgImage → applyLiquidNeonTokens to complete.
  await page.waitForTimeout(500);

  const bgAfter = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--bg-app-image'),
  );
  // After save, the background must still be a data URL — not the default gradient.
  expect(bgAfter, 'background image was reset to gradient after Save (SKY-3219 regression)').not.toContain(DEFAULT_GRADIENT_MARKER);
  expect(bgAfter).toContain('data:');
});

// ── F2 Probe N1 fold — #13/#15 into settings-background (e2e-shard-1) ─────────

function seedF2ChromeUserData(userDataDir: string, storyDir: string, notesDir: string): void {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(storyDir, { recursive: true });
  fs.mkdirSync(notesDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, 'app-settings.json'),
    JSON.stringify({
      onboardingComplete: true,
      onboardingStartMode: 'skip',
      theme: 'dark',
      agents: {
        writingAssistant: { enabled: false },
        brainstorm: { enabled: false },
        archive: { enabled: false },
        lineEditor: { enabled: false },
      },
      snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(userDataDir, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyDir, notesVaultRoot: notesDir }, null, 2),
  );
}

async function enableLineEditorAndClose(
  pg: Page,
  userDataDir: string,
  close: 'escape' | 'rail',
): Promise<void> {
  await pg.locator('.app-menu-gear-btn').click();
  const dialog = pg.locator('[role="dialog"][aria-label="Settings"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await dialog.locator('[data-testid="settings-cat-agents"]').click();
  const card = dialog.locator('[data-testid="line-editor-agent-card"]');
  await expect(card).toBeVisible({ timeout: 5_000 });
  const toggle = dialog.getByLabel('Enable Line Editor');
  await expect(toggle).toBeAttached();
  await expect(toggle).not.toBeChecked();
  await card.locator('.settings-toggle-track').click();
  await expect(toggle).toBeChecked();
  if (close === 'escape') {
    await pg.keyboard.press('Escape');
  } else {
    await pg.locator('nav[aria-label="Main navigation"] button[aria-label="Vault Graph"]').click();
  }
  await expect(dialog).toHaveCount(0, { timeout: 5_000 });
  await expect.poll(() => {
    const s = JSON.parse(fs.readFileSync(path.join(userDataDir, 'app-settings.json'), 'utf-8')) as {
      agents?: { lineEditor?: { enabled?: boolean } };
    };
    return s.agents?.lineEditor?.enabled;
  }, { timeout: 8_000 }).toBe(true);
}

test.describe('F2 Probe fold (#13 · #15) — e2e-shard-1', () => {
  test.setTimeout(90_000);

  let root: string;
  let ud: string;
  let f2App: ElectronApplication;
  let f2Page: Page;

  test.beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-f2-sbg-'));
    ud = path.join(root, 'user-data');
    const story = path.join(root, 'story');
    const notes = path.join(root, 'notes');
    seedF2ChromeUserData(ud, story, notes);
    f2App = await launchApp(ud);
    f2Page = await firstWindow(f2App);
    await expect(f2Page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
  });

  test.afterEach(async () => {
    await f2App?.close().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('F2#13 Settings overlay leaves WindowChrome visible', async () => {
    await f2Page.locator('.app-menu-gear-btn').click();
    const dialog = f2Page.locator('[role="dialog"][aria-label="Settings"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    const overlay = f2Page.locator('.settings-overlay');
    await expect(overlay).toBeVisible();
    const top = await overlay.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { top: cs.top, rectTop: el.getBoundingClientRect().top };
    });
    expect(parseFloat(top.top)).toBeGreaterThanOrEqual(44);
    expect(top.rectTop).toBeGreaterThanOrEqual(44);
    await expect(f2Page.locator('.wc-drag-region, .app-menu-bar').first()).toBeVisible();
  });

  test('F2#15 Escape-close writes Line Editor enable to app-settings.json', async () => {
    await enableLineEditorAndClose(f2Page, ud, 'escape');
  });

  test('F2#15 rail-nav close also flushes Line Editor to disk', async () => {
    await enableLineEditorAndClose(f2Page, ud, 'rail');
  });
});
