/**
 * PLAN-058 Fid r3 — Tip 3 (FD-9 #25).
 * The graph filter bar sits in the top-right corner of the graph card.
 *
 *   xvfb-run --auto-servernum npx playwright test e2e/plan058-fid-r3.spec.ts --reporter=list --workers=1
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
const WIDTHS = [900, 936, 962, 1024, 1280] as const;
const CHIP_LABELS = ['Characters', 'Locations', 'Factions', 'History', 'Systems', 'Items', 'Scenes', 'Misc'] as const;
const TAB_ANCHORS = [
  'Notes',
  'Story',
  'Both',
  'Filters',
  'Show story cluster',
  'Characters filter',
  'Locations filter',
  'Factions filter',
  'History filter',
  'Systems filter',
  'Items filter',
  'Scenes filter',
  'Misc filter',
  'Depth limit: All',
] as const;
const ARYA_ID = 'Characters/Arya.md';
const WINTERFELL_ID = 'Locations/Winterfell.md';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

function boxInside(inner: Box, outer: Box): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

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
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

function seedVault(notesVaultDir: string): void {
  fs.mkdirSync(path.join(notesVaultDir, 'Characters'), { recursive: true });
  fs.mkdirSync(path.join(notesVaultDir, 'Locations'), { recursive: true });
  fs.writeFileSync(
    path.join(notesVaultDir, 'Characters', 'Arya.md'),
    '# Arya\n\nA Stark from [[Winterfell]].\n',
    'utf-8',
  );
  fs.writeFileSync(
    path.join(notesVaultDir, 'Locations', 'Winterfell.md'),
    '# Winterfell\n\nThe ancestral home.\n',
    'utf-8',
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 30_000,
  });
}

async function setContentSize(app: ElectronApplication, w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('no BrowserWindow');
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(size.w, size.h);
  }, { w, h });
}

async function openGraph(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const mainNav = page.locator('nav[aria-label="Main navigation"]');
  await expect(mainNav).toBeVisible({ timeout: 12_000 });
  const graphTab = mainNav.getByRole('button', { name: 'Vault Graph', exact: true });
  await expect(graphTab).toBeVisible({ timeout: 5_000 });
  await graphTab.click();
  await expect(page.getByTestId('vault-graph-view')).toBeVisible({ timeout: 15_000 });
}

test.describe('PLAN-058 Fid r3 tip 3', () => {
  let userData: string;
  let vaultDir: string;
  let notesVaultDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-fid-r3-ud-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-fid-r3-vault-'));
    notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-fid-r3-notes-'));
    seedUserData(userData, vaultDir, notesVaultDir);
    seedVault(notesVaultDir);
    app = await launchApp(userData);
    page = await app.firstWindow();
    page.on('console', (m) => console.log('[renderer:' + m.type() + ']', m.text()));
    page.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
    fs.rmSync(notesVaultDir, { recursive: true, force: true });
  });

  test('graph filter bar sits top-right of the graph card', async () => {
    await openGraph(page);

    const arya = page.locator(`[data-testid="vault-node-${ARYA_ID}"]`);
    await expect(arya).toBeVisible({ timeout: 10_000 });

    // Same click the inspector uses in vault-graph-v0.spec.ts (TC-GV-05).
    await page.evaluate(
      (sel) => document.querySelector(sel)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
      `[data-testid="vault-node-${ARYA_ID}"]`,
    );
    const inspector = page.getByTestId('vault-graph-inspector');
    await expect(inspector).toBeVisible({ timeout: 3_000 });

    const card = page.getByTestId('vault-graph-view');
    const bar = card.getByRole('toolbar', { name: 'Graph filters', exact: true });
    const header = card.locator('.vgv-toolbar');
    const hint = card.locator('.vgv-canvas-hint');
    await expect(bar).toBeVisible();
    await expect(header).toBeVisible();
    await expect(hint).toBeVisible();

    for (const w of WIDTHS) {
      await setContentSize(app, w, 900);
      await expect.poll(async () => {
        const cardBox = await card.boundingBox();
        const barBox = await bar.boundingBox();
        if (!cardBox || !barBox) return 'missing-box';
        const rightGap = Math.abs((barBox.x + barBox.width) - (cardBox.x + cardBox.width));
        const topGap = Math.abs(barBox.y - cardBox.y);
        const leftGap = barBox.x - cardBox.x;
        const widthRatio = barBox.width / cardBox.width;
        if (rightGap > 16 || topGap > 16) return `w${w} right:${rightGap.toFixed(1)} top:${topGap.toFixed(1)}`;
        // Full-width stretch leaves leftGap ≈ 0 and widthRatio ≈ 1. A content-sized
        // top-right cluster stays well under the card with a real left gap.
        if (!(leftGap > 24)) return `w${w} left:${leftGap.toFixed(1)} ratio:${widthRatio.toFixed(3)}`;
        if (!(widthRatio < 0.9)) return `w${w} width-ratio:${widthRatio.toFixed(3)} left:${leftGap.toFixed(1)}`;
        if (!(barBox.width < cardBox.width - 24)) return `w${w} bar-wide:${barBox.width.toFixed(1)}/${cardBox.width.toFixed(1)}`;
        for (const label of CHIP_LABELS) {
          const chip = bar.getByRole('button', { name: `${label} filter`, exact: true });
          const chipBox = await chip.boundingBox();
          if (!chipBox) return `w${w} missing-chip:${label}`;
          if (!boxInside(chipBox, barBox)) return `w${w} chip-outside-bar:${label}`;
          if (!boxInside(chipBox, cardBox)) return `w${w} chip-outside-card:${label}`;
          const clip = await chip.evaluate((el) => {
            const labelEl = el.querySelector('.vgv-chip-label') ?? el;
            return {
              scrollWidth: labelEl.scrollWidth,
              clientWidth: labelEl.clientWidth,
              text: (labelEl.textContent ?? '').trim(),
            };
          });
          if (clip.text !== label) return `w${w} label-text:${clip.text}`;
          if (clip.scrollWidth > clip.clientWidth) {
            return `w${w} clipped:${label}:${clip.scrollWidth}>${clip.clientWidth}`;
          }
        }
        return 'within-16';
      }).toBe('within-16');

      await expect.poll(async () => {
        const barBox = await bar.boundingBox();
        const headerBox = await header.boundingBox();
        const hintBox = await hint.boundingBox();
        const inspectorBox = await inspector.boundingBox();
        if (!barBox || !headerBox || !hintBox || !inspectorBox) return 'missing-box';
        if (intersects(barBox, headerBox)) return 'intersects-toolbar';
        if (intersects(barBox, hintBox)) return 'intersects-hint';
        if (intersects(barBox, inspectorBox)) return 'intersects-inspector';
        return 'clear';
      }).toBe('clear');

      await card.screenshot({ path: test.info().outputPath(`plan058-fid-r3-${w}.png`) });
    }

    // Tab order follows DOM: header controls, then the eight chips, then Depth.
    // Focus the card (not a control) and walk with real Tab presses.
    await card.evaluate((el) => {
      el.setAttribute('tabindex', '-1');
      el.focus();
    });
    const tabNames: string[] = [];
    for (let step = 0; step < 24; step += 1) {
      await page.keyboard.press('Tab');
      const name = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return '';
        return el.getAttribute('aria-label') || (el.textContent || '').replace(/\s+/g, ' ').trim();
      });
      tabNames.push(name);
      if (name.startsWith('Depth limit')) break;
    }
    let from = 0;
    for (const anchor of TAB_ANCHORS) {
      const idx = tabNames.indexOf(anchor, from);
      expect(idx, `tab order missing "${anchor}" in ${tabNames.join(' > ')}`).toBeGreaterThanOrEqual(from);
      from = idx + 1;
    }

    const nodes = page.locator('[data-testid^="vault-node-"]');
    const before = await nodes.count();
    expect(before).toBeGreaterThan(0);
    const chip = page.getByRole('button', { name: 'Characters filter', exact: true });
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => nodes.count()).toBeLessThan(before);
    await expect(arya).toBeHidden();
    await expect(page.locator(`[data-testid="vault-node-${WINTERFELL_ID}"]`)).toBeVisible();
  });
});
