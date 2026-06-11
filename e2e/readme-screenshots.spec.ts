/**
 * readme-screenshots.spec.ts — SKY-1223
 *
 * Captures four README hero screenshots:
 *   1. onboarding-wizard   — first-launch Welcome screen (step 1, path picker)
 *   2. getting-started     — post-onboarding shell with Getting Started panel visible
 *   3. settings-vault-local   — Settings dialog with VaultSyncBadge in (Local) state
 *   4. brainstorm-panel    — Brainstorm view with empty prompt state
 *
 * Output: docs/screenshots/*.png
 *
 * Run:
 *   xvfb-run -a npx playwright test e2e/readme-screenshots.spec.ts --reporter=list
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
const SCREENSHOT_DIR = path.resolve(__dirname, '../docs/screenshots');
const CSS_ASSET = path.resolve(__dirname, '../out/renderer/assets/index-DHjmkebl.css');
const DESKTOP_VP = { width: 1440, height: 900 };

function ensureDir(d: string) {
  fs.mkdirSync(d, { recursive: true });
}

async function applyTheme(page: Page) {
  // In headless Xvfb mode the `body { background }` CSS rule doesn't fire
  // even though the stylesheet loads and class-based rules DO apply.
  // Force the dark-theme base colours on html/body so screenshots look right.
  await page.evaluate(() => {
    const bgApp = getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim() || '#0e1116';
    const textBody = getComputedStyle(document.documentElement).getPropertyValue('--text-body').trim() || '#bfd6e8';
    document.documentElement.style.backgroundColor = bgApp;
    document.body.style.backgroundColor = bgApp;
    document.body.style.color = textBody;
  }).catch(() => undefined);
  await page.waitForTimeout(300);
}

async function shot(page: Page, name: string) {
  ensureDir(SCREENSHOT_DIR);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`) });
  console.log(`  wrote ${name}.png`);
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  page.on('dialog', (d) => { void d.accept().catch(() => undefined); });
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize(DESKTOP_VP);
  return page;
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

function seedPostOnboarding(userData: string, vaultDir: string) {
  const storyId = 'readme-story-001';
  const chapterId = 'readme-ch-001';
  const sceneId = 'readme-sc-001';
  const now = new Date().toISOString();

  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: true, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    gettingStarted: { completedItems: [], dismissed: false },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };

  const vaultSettings = { vaultRoot: vaultDir };

  const manifest = {
    version: '1',
    vaultRoot: vaultDir,
    stories: [{
      id: storyId,
      title: 'The Midnight Archives',
      path: `stories/${storyId}`,
      chapters: [{
        id: chapterId,
        title: 'Chapter One: First Light',
        path: `stories/${storyId}/chapters/${chapterId}`,
        order: 0,
        scenes: [{
          id: sceneId,
          title: 'Scene One: The Letter',
          path: `stories/${storyId}/chapters/${chapterId}/scenes/${sceneId}.md`,
          order: 0,
          chapterId,
          storyId,
          draftState: 'in-progress',
          blocks: [],
          createdAt: now,
          updatedAt: now,
        }],
        createdAt: now,
        updatedAt: now,
      }],
      createdAt: now,
      updatedAt: now,
    }],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
  };

  ensureDir(userData);
  ensureDir(vaultDir);
  const sceneDir = path.join(vaultDir, 'stories', storyId, 'chapters', chapterId, 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(path.join(sceneDir, `${sceneId}.md`), '---\nid: readme-sc-001\ntitle: "Scene One: The Letter"\ndraftState: in-progress\n---\n\n');
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

// ─── Test 1: Onboarding wizard ────────────────────────────────────────────────

test('screenshot: onboarding wizard (step 1 — path picker)', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-readme-onb-'));
  // No seed — app will show onboarding
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'],
    timeout: 45_000,
  });
  try {
    const page = await firstWindow(app);
    await page.setViewportSize(DESKTOP_VP);

    // Wait for onboarding screen to appear
    const step1 = page.locator('[data-testid="screen-step1"], .onboarding-wizard, .wizard-root, .onboarding-step');
    await expect(step1.first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(800);
    await applyTheme(page);
    await shot(page, 'onboarding-wizard');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

// ─── Test 2: Post-onboarding Getting Started panel ───────────────────────────

test('screenshot: post-onboarding shell with getting-started panel', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-readme-gs-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-readme-vault-'));
  seedPostOnboarding(userData, vaultDir);

  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'],
    timeout: 45_000,
  });
  try {
    const page = await firstWindow(app);
    await page.setViewportSize(DESKTOP_VP);

    // Wait for the main shell
    const shell = page.locator('.app-menu-bar, .shell-root, .desktop-shell');
    await expect(shell.first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1000);

    // The Getting Started panel should be visible in the right sidebar
    const gsPanel = page.locator('.gs-panel, [data-testid="getting-started-panel"]');
    if (await gsPanel.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await page.waitForTimeout(500);
    }

    await applyTheme(page);
    await shot(page, 'getting-started-panel');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  }
});

// ─── Test 3: Settings vault badge (local state) ───────────────────────────────

test('screenshot: settings vault badge (local / no sync)', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-readme-vb-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-readme-vb-vault-'));
  seedPostOnboarding(userData, vaultDir);

  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'],
    timeout: 45_000,
  });
  try {
    const page = await firstWindow(app);
    await page.setViewportSize(DESKTOP_VP);

    // Wait for app shell
    await expect(page.locator('.app-menu-bar, .shell-root, .desktop-shell').first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);

    // Open settings
    const gearBtn = page.locator('.app-menu-gear-btn, [aria-label*="Settings"], [data-testid="settings-btn"]');
    await gearBtn.first().click();
    await page.waitForTimeout(800);

    // Scroll to vault section if needed
    const vaultBadge = page.locator('.vault-sync-badge, [aria-label*="Vault sync"]');
    if (await vaultBadge.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await vaultBadge.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
    }

    await applyTheme(page);
    await shot(page, 'settings-vault-badge');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  }
});

// ─── Test 4: Brainstorm panel ─────────────────────────────────────────────────

test('screenshot: brainstorm panel', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-readme-bs-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-readme-bs-vault-'));
  seedPostOnboarding(userData, vaultDir);

  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'],
    timeout: 45_000,
  });
  try {
    const page = await firstWindow(app);
    await page.setViewportSize(DESKTOP_VP);

    // Wait for app shell
    await expect(page.locator('.app-menu-bar, .shell-root, .desktop-shell').first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);

    // Navigate to Brainstorm view
    const brainstormBtn = page.locator('.app-menu-view-btn, [data-view="brainstorm"]', { hasText: /Brainstorm/i });
    if (await brainstormBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await brainstormBtn.click();
      await page.waitForTimeout(800);
    }

    await applyTheme(page);
    await shot(page, 'brainstorm-panel');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  }
});
