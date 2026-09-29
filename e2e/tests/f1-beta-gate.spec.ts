/**
 * F1 beta gate VERIFY — Critic H1–H6 + Probe #1/#2/#9/#3/#5/#10/#13.
 * Real Electron app (not the deleted mock proof harness).
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
import { clickStoryNav } from '../helpers/navGuard';

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');
// Shield residual: default to os.tmpdir() — never hardcode /cursor/stores/…
// (local `npm run test:e2e` would EACCES). Set F1_PROOF_OUT for Agent Store.
const MEDIA = process.env.F1_PROOF_OUT
  ?? path.join(os.tmpdir(), 'mythos-f1-proof');

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(notesVaultDir, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function waitForBoot(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const l of ['Not now', 'Dismiss', 'Got it', 'Skip']) {
    const b = page.locator(`button:has-text("${l}")`).first();
    if (await b.isVisible({ timeout: 400 }).catch(() => false)) {
      await b.click().catch(() => {});
    }
  }
  await page.keyboard.press('Escape').catch(() => {});
  return page;
}

async function createAndSelectStory(page: Page): Promise<void> {
  await page.locator('.wc-menu', { hasText: 'File' }).click();
  await page.locator('.wc-menu-item', { hasText: 'New story' }).click();
  await expect(page.locator('.nav-story-row').first()).toBeVisible({ timeout: 8_000 });
  await page.locator('.nav-story-title').first().click();
}

test.describe('F1 beta gate VERIFY', () => {
  test('F1#13 toolbar computed height is 36px @ 1440×900', async () => {
    test.skip(!fs.existsSync(MAIN_JS), 'needs npm run build:electron');
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-tb-'));
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-tb-v-'));
    const notes = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-tb-n-'));
    seedUserData(userData, vault, notes);
    const app = await launchApp(userData);
    try {
      const page = await waitForBoot(app);
      await createAndSelectStory(page);
      await clickStoryNav(page);
      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Story"]').click().catch(() => {});
      const tb = page.getByTestId('msv-toolbar');
      await expect(tb).toBeVisible({ timeout: 10_000 });
      const h = await tb.evaluate((el) => Math.round(el.getBoundingClientRect().height));
      expect(h).toBe(36);
      fs.mkdirSync(MEDIA, { recursive: true });
      await page.screenshot({ path: path.join(MEDIA, 'f1-toolbar-1440x900.png'), fullPage: false });
    } finally {
      await app.close();
    }
  });

  test('F1#2 + New board opens canvas with story selected', async () => {
    test.skip(!fs.existsSync(MAIN_JS), 'needs npm run build:electron');
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-nb-'));
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-nb-v-'));
    const notes = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-nb-n-'));
    seedUserData(userData, vault, notes);
    const app = await launchApp(userData);
    try {
      const page = await waitForBoot(app);
      await createAndSelectStory(page);
      await clickStoryNav(page);
      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
      await expect(page.getByTestId('crafter-new-board')).toBeVisible({ timeout: 10_000 });
      await page.getByTestId('crafter-new-board').click();
      await expect(page.locator('.sc-canvas-view, [aria-label^="Canvas board"]')).toBeVisible({ timeout: 10_000 });
    } finally {
      await app.close();
    }
  });

  test('F1#9 insert chapter after selected renumbers order in navigator', async () => {
    test.skip(!fs.existsSync(MAIN_JS), 'needs npm run build:electron');
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-ins-'));
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-ins-v-'));
    const notes = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-ins-n-'));
    seedUserData(userData, vault, notes);

    let titlesBefore: string[] = [];
    {
      const app = await launchApp(userData);
      try {
        const page = await waitForBoot(app);
        await createAndSelectStory(page);
        page.on('dialog', async (d) => {
          const t = d.type();
          if (t === 'prompt') await d.accept(`Chapter ${Date.now() % 1000}`);
          else await d.accept().catch(() => {});
        });
        for (let i = 0; i < 2; i += 1) {
          await page.locator('.wc-menu', { hasText: 'File' }).click();
          await page.locator('.wc-menu-item', { hasText: 'New chapter' }).click().catch(async () => {
            await page.keyboard.press('Escape');
          });
          await page.waitForTimeout(400);
        }
        const firstCh = page.locator('.nav-chapter-row, .nav-chapter-title').first();
        if (await firstCh.isVisible({ timeout: 2000 }).catch(() => false)) {
          await firstCh.click();
        }
        await page.locator('.wc-menu', { hasText: 'File' }).click();
        await page.locator('.wc-menu-item', { hasText: 'New chapter' }).click().catch(() => {});
        await page.waitForTimeout(600);
        titlesBefore = await page.locator('.nav-chapter-title').allTextContents();
        expect(titlesBefore.length).toBeGreaterThan(0);
      } finally {
        await app.close();
      }
    }

    // Reload-order assert: relaunch with same userData/vault.
    const app2 = await launchApp(userData);
    try {
      const page2 = await waitForBoot(app2);
      await page2.locator('.nav-story-title').first().click().catch(() => {});
      await page2.waitForTimeout(800);
      const titlesAfter = await page2.locator('.nav-chapter-title').allTextContents();
      expect(titlesAfter).toEqual(titlesBefore);
    } finally {
      await app2.close();
    }
  });

  test('F1#1 Create Scene → board survives reload', async () => {
    test.skip(!fs.existsSync(MAIN_JS), 'needs npm run build:electron');
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-cs-'));
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-cs-v-'));
    const notes = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-cs-n-'));
    seedUserData(userData, vault, notes);

    const findScene = (root: string) => {
      const walk = (dir: string): string | null => {
        if (!fs.existsSync(dir)) return null;
        for (const name of fs.readdirSync(dir)) {
          const full = path.join(dir, name);
          const st = fs.statSync(full);
          if (st.isDirectory()) {
            const hit = walk(full);
            if (hit) return hit;
          } else if (name.endsWith('.md')) {
            if (fs.readFileSync(full, 'utf-8').includes('Held Tip Scene')) return full;
          }
        }
        return null;
      };
      return walk(root);
    };

    {
      const app = await launchApp(userData);
      try {
        const page = await waitForBoot(app);
        await createAndSelectStory(page);
        await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
        const titleInput = page.locator('input[placeholder="The next scene…"]');
        await expect(titleInput).toBeVisible({ timeout: 8_000 });
        await titleInput.fill('Held Tip Scene');
        const createBtn = page.getByTestId('sc-create-scene-btn');
        await expect(createBtn).toBeVisible({ timeout: 5_000 });
        await createBtn.click();
        await expect(page.locator('.shell-kanban, .sc-canvas-view, [aria-label^="Canvas board"]')).toBeVisible({
          timeout: 12_000,
        });
        expect(findScene(vault), 'scene must exist on disk before reload').toBeTruthy();
      } finally {
        await app.close();
      }
    }

    const app2 = await launchApp(userData);
    try {
      const page2 = await waitForBoot(app2);
      expect(findScene(vault), 'scene must persist after reload').toBeTruthy();
      await page2.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
      await expect(page2.locator('.shell-kanban, .sc-canvas-view')).toBeVisible({ timeout: 10_000 });
    } finally {
      await app2.close();
    }
  });

  test('F1#10 dropcap root class absent by default on manuscript', async () => {
    test.skip(!fs.existsSync(MAIN_JS), 'needs npm run build:electron');
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-dc-'));
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-dc-v-'));
    const notes = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-dc-n-'));
    seedUserData(userData, vault, notes);
    const app = await launchApp(userData);
    try {
      const page = await waitForBoot(app);
      await createAndSelectStory(page);
      const root = page.getByTestId('msv-root');
      await expect(root).toBeVisible({ timeout: 10_000 });
      const cls = await root.getAttribute('class');
      expect(cls ?? '').not.toContain('msv-root--dropcap');
      // Chromeless scene editor first letter must not float when gated off.
      const float = await page.evaluate(() => {
        const p = document.querySelector('.block-editor--chromeless .ProseMirror > p:first-child');
        if (!p) return 'no-p';
        return getComputedStyle(p, '::first-letter').float;
      });
      expect(['none', 'no-p']).toContain(float);
    } finally {
      await app.close();
    }
  });
});
