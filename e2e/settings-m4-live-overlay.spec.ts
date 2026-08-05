/**
 * settings-m4-live-overlay.spec.ts — SKY-9018 (Fidelity Rebuild M4, §2-B)
 *
 * M4 acceptance criteria (plans/fidelity-rebuild/PLAN.md §M4):
 *   1. Open Settings over the editor: the animated background is visibly moving
 *      behind the glass — two frames 2 s apart inside Settings differ in the
 *      background region.
 *   2. Appearance changes reflect live and persist with no Save click.
 *   3. Esc closes; focus trap holds; high-contrast mode still renders opaque.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/settings-m4-live-overlay.spec.ts --reporter=list
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

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
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
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
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

async function openSettings(page: Page): Promise<void> {
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('[role="dialog"][aria-label="Settings"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.settings-cat-nav__tab').first()).toBeVisible({ timeout: 10_000 });
}

async function closeSettings(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="dialog"][aria-label="Settings"]')).not.toBeVisible({ timeout: 2_000 });
}

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m4-settings-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m4-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m4-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── M4-AC1: overlay is transparent glass with the ambient stack visible ─────
test('M4: settings overlay is transparent and the panel is blurred glass', async () => {
  await openSettings(page);

  const overlayBg = await page.locator('.settings-overlay:not(.settings-overlay--scrim)').evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  expect(overlayBg).toBe('rgba(0, 0, 0, 0)');

  const panelBackdrop = await page.locator('.settings-panel').evaluate(
    (el) => getComputedStyle(el).backdropFilter || (getComputedStyle(el) as unknown as Record<string, string>)['webkitBackdropFilter'],
  );
  expect(panelBackdrop).toContain('blur');

  // The shell's BackgroundStack must still be mounted (not unmounted/covered
  // by an opaque sheet) while Settings is open.
  await expect(page.locator('.ln-bg-stack, [data-testid="background-stack"]').first()).toBeAttached();

  await closeSettings(page);
});

// ─── M4-AC1: video frame-diff — background visibly moving behind the glass ───
test('M4: two frames 2s apart inside Settings differ in the background region', async () => {
  await openSettings(page);

  // Reset the SKY-8566 idle freeze clock (ambient loops pause after 5 s of no
  // input) so both frames land inside the animated window.
  await page.mouse.move(200, 200);

  // A region of the settings body away from any focus ring/caret: static UI
  // renders deterministically, so any pixel diff comes from the ambient drift
  // reading through the glass.
  const clip = { x: 320, y: 220, width: 320, height: 320 };
  const frame1 = await page.screenshot({ clip });
  await page.waitForTimeout(2_000);
  const frame2 = await page.screenshot({ clip });

  expect(Buffer.compare(frame1, frame2)).not.toBe(0);

  await closeSettings(page);
});

// ─── M4-AC2: appearance changes apply live and persist with no Save click ────
test('M4: appearance slider applies live and persists without Save', async () => {
  await openSettings(page);
  await page.getByRole('tab', { name: 'Appearance' }).click();

  // The Appearance tab has no Cancel/Save footer (M4 §2-B).
  await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(0);

  const slider = page.getByTestId('lnas-intensity');
  await slider.waitFor({ state: 'visible', timeout: 5_000 });
  const before = Number(await slider.inputValue());
  const target = before >= 50 ? before - 20 : before + 20;
  await slider.fill(String(target));

  // Live persist is debounced (400 ms) — the new value must reach disk with
  // no Save click.
  await expect
    .poll(() => {
      try {
        const onDisk = JSON.parse(fs.readFileSync(path.join(userData, 'app-settings.json'), 'utf8'));
        return onDisk.liquidNeonV2?.intensity;
      } catch {
        return undefined;
      }
    }, { timeout: 5_000 })
    .toBe(target);

  await closeSettings(page);
});

// ─── M4-AC3: Esc closes; focus trap holds; high-contrast renders opaque ──────
test('M4: focus trap holds inside the dialog and Esc closes it', async () => {
  await openSettings(page);

  // Tab a bounded number of times — focus must stay inside the dialog.
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="Settings"]');
      return dialog ? dialog.contains(document.activeElement) : false;
    });
    expect(inside).toBe(true);
  }

  await closeSettings(page);
});

test('M4: high-contrast mode keeps the settings backdrop opaque (K8)', async () => {
  await openSettings(page);
  await page.getByRole('tab', { name: 'Appearance' }).click();

  await page.getByRole('radio', { name: 'High contrast' }).check();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-contrast')))
    .toBe('high');

  const overlayBg = await page.locator('.settings-overlay:not(.settings-overlay--scrim)').evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  // Opaque override: any fully-opaque color (alpha 1 renders as rgb(...)).
  expect(overlayBg).toMatch(/^rgb\(/);

  // Restore the default theme for any spec running after this one (the
  // appearance tab live-persists, so this write reaches disk too).
  await page.getByRole('radio', { name: 'Liquid Neon' }).check();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-contrast')))
    .toBe(null);

  await closeSettings(page);
});
