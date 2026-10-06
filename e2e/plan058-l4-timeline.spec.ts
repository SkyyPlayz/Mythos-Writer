/**
 * PLAN-058 L4 — Timeline lane (double-render hint, partner tab, notes chip, axis chrome).
 *
 * Proof command:
 *   xvfb-run --auto-servernum npx playwright test e2e/plan058-l4-timeline.spec.ts --reporter=list --workers=1
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

function makeTemp(): { userData: string; notesDir: string; storyDir: string; tempRoot: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-l4-'));
  const userData = path.join(tempRoot, 'userData');
  const storyDir = path.join(tempRoot, 'story-vault');
  const notesDir = path.join(tempRoot, 'notes-vault');
  for (const d of [userData, storyDir, notesDir]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyDir, notesVaultRoot: notesDir }, null, 2),
  );
  fs.mkdirSync(path.join(notesDir, 'Plot'), { recursive: true });
  fs.writeFileSync(
    path.join(notesDir, 'Plot', 'beat.md'),
    '---\ntitle: Harbor Beat\n---\n\nA note to plot on the timeline.\n',
  );
  return { userData, notesDir, storyDir, tempRoot };
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function bootToTimeline(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Timeline"]').click();
  await expect(page.locator('[data-testid="timeline-root"]')).toBeVisible({ timeout: 12_000 });
  return page;
}

test.describe('PLAN-058 L4 — Timeline', () => {
  let app: ElectronApplication;
  let page: Page;
  let tempRoot: string;

  test.beforeAll(async () => {
    const t = makeTemp();
    tempRoot = t.tempRoot;
    app = await launchApp(t.userData);
    page = await bootToTimeline(app);
  });

  test.afterAll(async () => {
    await app?.close();
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('66:14 — Ctrl+T on Timeline shows dup-hint (no second StoryTimeline tree)', async () => {
    await page.keyboard.press('Control+t');
    await expect(page.getByTestId('sidebar-timeline-hint')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId('timeline-root')).toBeVisible();
    await expect(page.locator('.react-flow')).toHaveCount(0);
  });

  test('70:51 / 71:52 — lane zoom lives on axis toolbar (tl-vzoom), not duplicated in header', async () => {
    await expect(page.getByTestId('tl-vzoom')).toBeVisible();
    await expect(page.locator('.tlr-header [data-testid="tl-vzoom"]')).toHaveCount(0);
  });

  test('66:52 FD-3 — partner tab exposes Update Timeline action chips', async () => {
    await page.getByTestId('trp-tab-partner').click();
    await expect(page.getByTestId('trp-partner-action-update-timeline')).toBeVisible();
  });

  test('FD-2 warm — notes Timeline chip plots and opens Inspector', async () => {
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
    await expect(page.getByTestId('vb-notes-vault')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="vb-row-Plot/beat.md"]').click();
    const chip = page.locator('[data-testid="notes-tab-center"] [data-testid="notes-timeline-chip"]');
    await expect(chip).toBeVisible({ timeout: 12_000 });
    await chip.click();
    await expect(page.getByTestId('timeline-root')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('trp-tab-inspector')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('trp-event-linked-note-row')).toContainText('Plot/beat.md');
    if (process.env.CAPTURE_PR_SCREENSHOT) {
      await page.screenshot({ path: '/opt/cursor/artifacts/plan058-l4-timeline-fd2.png' });
    }
  });
});

test.describe('PLAN-058 L4 — Timeline FD-2 cold path', () => {
  test('FD-2 cold — Notes first (never Timeline), chip opens Inspector linked note', async () => {
    const t = makeTemp();
    const app = await launchApp(t.userData);
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
      await expect(page.getByTestId('vb-notes-vault')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('[data-testid="timeline-root"]')).toHaveCount(0);
      await page.locator('[data-testid="vb-row-Plot/beat.md"]').click();
      const chip = page.locator('[data-testid="notes-tab-center"] [data-testid="notes-timeline-chip"]');
      await expect(chip).toBeVisible({ timeout: 12_000 });
      await chip.click();
      await expect(page.getByTestId('timeline-root')).toBeVisible({ timeout: 12_000 });
      await expect(page.getByTestId('trp-tab-inspector')).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('trp-event-linked-note-row')).toContainText('Plot/beat.md');
    } finally {
      await app.close();
      fs.rmSync(t.tempRoot, { recursive: true, force: true });
    }
  });
});
