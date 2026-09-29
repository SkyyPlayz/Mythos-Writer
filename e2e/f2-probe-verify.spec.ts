/**
 * f2-probe-verify.spec.ts — Probe early VERIFY FAIL fold (F2 tip)
 *
 * Running Electron under xvfb/headless with a clean userData. Covers:
 *   #10 picker portaled + on top
 *   #12 panel top-bar computed height
 *   #13 Settings leaves window chrome visible
 *   #15 Escape-close persists to app-settings.json; rail close also flushes
 *   #4  explorer MIME drop into Story editor inserts [[Note]]
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/f2-probe-verify.spec.ts --reporter=list
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
const MIME = 'application/x-mythos-vault-note';
const NOW = '2026-07-01T00:00:00.000Z';

function seed(userData: string, storyVault: string, notesVault: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(path.join(storyVault, 'Probe Story', 'Manuscript', 'Chapter One'), { recursive: true });
  fs.mkdirSync(path.join(notesVault, 'Characters'), { recursive: true });
  fs.mkdirSync(path.join(notesVault, 'Locations'), { recursive: true });

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    onboardingComplete: true,
    onboardingStartMode: 'skip',
    theme: 'dark',
    agents: {
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: storyVault,
    notesVaultRoot: notesVault,
  }, null, 2));

  const scene = {
    id: 'scene-1',
    title: 'Probe Scene',
    path: 'Probe Story/Manuscript/Chapter One/Probe Scene.md',
    order: 1,
    draftState: 'in-progress',
    blocks: [{ id: 'b1', type: 'prose', content: 'Drop target prose.', order: 1, updatedAt: NOW }],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const chapter = {
    id: 'ch-1', title: 'Chapter One', path: 'Probe Story/Manuscript/Chapter One',
    order: 1, scenes: [scene], createdAt: NOW, updatedAt: NOW,
  };
  const story = {
    id: 'story-1', title: 'Probe Story', path: 'Probe Story',
    chapters: [chapter], createdAt: NOW, updatedAt: NOW,
  };
  const elara = {
    id: 'entity-elara', name: 'Elara', type: 'character',
    path: 'Characters/Elara.md', aliases: [], createdAt: NOW, updatedAt: NOW,
  };
  fs.writeFileSync(path.join(storyVault, 'manifest.json'), JSON.stringify({
    version: '1.0.0', vaultRoot: storyVault,
    stories: [story], chapters: [chapter], scenes: [scene], entities: [elara], suggestions: [],
  }, null, 2));
  fs.writeFileSync(path.join(storyVault, scene.path), [
    '---', 'id: scene-1', 'title: Probe Scene', '---', '',
    '<!-- BLOCKS_JSON', JSON.stringify(scene.blocks), 'END_BLOCKS_JSON -->', '',
    scene.blocks[0].content,
  ].join('\n'));
  fs.writeFileSync(path.join(notesVault, 'Characters', 'Elara.md'), '# Elara\n\nProfile.\n');
  fs.writeFileSync(path.join(notesVault, 'Locations', 'Harbor.md'), '# Harbor\n\nA place.\n');
}

async function launch(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

test.describe('F2 Probe VERIFY FAIL fold', () => {
  test.setTimeout(120_000);

  let tempRoot: string;
  let userData: string;
  let storyVault: string;
  let notesVault: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-f2-probe-'));
    userData = path.join(tempRoot, 'user-data');
    storyVault = path.join(tempRoot, 'story');
    notesVault = path.join(tempRoot, 'notes');
    seed(userData, storyVault, notesVault);
    app = await launch(userData);
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
  });

  test.afterEach(async () => {
    await app?.close().catch(() => {});
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('#13 Settings overlay leaves WindowChrome visible', async () => {
    await page.locator('.app-menu-gear-btn').click();
    const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    const overlay = page.locator('.settings-overlay');
    await expect(overlay).toBeVisible();
    const top = await overlay.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { top: cs.top, rectTop: el.getBoundingClientRect().top };
    });
    // WindowChrome is 45px (--shell-titlebar-height); overlay must start below it.
    expect(parseFloat(top.top)).toBeGreaterThanOrEqual(44);
    expect(top.rectTop).toBeGreaterThanOrEqual(44);
    // Titlebar/drag region still present above the overlay.
    await expect(page.locator('.wc-drag-region, .app-menu-bar').first()).toBeVisible();
  });

  test('#15 Escape-close writes theme change to app-settings.json', async () => {
    await page.locator('.app-menu-gear-btn').click();
    const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.locator('[data-testid="settings-cat-agents"]').click();
    const toggle = dialog.getByLabel('Enable Writing Coach');
    await expect(toggle).toBeVisible({ timeout: 5_000 });
    const before = await toggle.isChecked();
    await toggle.click();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0, { timeout: 5_000 });
    await expect.poll(() => {
      const s = JSON.parse(fs.readFileSync(path.join(userData, 'app-settings.json'), 'utf-8')) as {
        agents?: { writingAssistant?: { enabled?: boolean } };
      };
      return s.agents?.writingAssistant?.enabled;
    }, { timeout: 8_000 }).toBe(!before);
  });

  test('#15 rail-nav close also flushes settings:set', async () => {
    await page.locator('.app-menu-gear-btn').click();
    const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.locator('[data-testid="settings-cat-agents"]').click();
    const toggle = dialog.getByLabel('Enable Writing Coach');
    await expect(toggle).toBeVisible({ timeout: 5_000 });
    const before = await toggle.isChecked();
    await toggle.click();
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Vault Graph"]').click();
    await expect(dialog).toHaveCount(0, { timeout: 5_000 });
    await expect.poll(() => {
      const s = JSON.parse(fs.readFileSync(path.join(userData, 'app-settings.json'), 'utf-8')) as {
        agents?: { writingAssistant?: { enabled?: boolean } };
      };
      return s.agents?.writingAssistant?.enabled;
    }, { timeout: 8_000 }).toBe(!before);
  });

  test('#12 PanelChrome header computes to --panel-top-bar-height', async () => {
    // Brainstorm hosts PanelChrome headers that previously grew past 36px.
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Brainstorm"]').click();
    await expect(page.locator('.pc-header').first()).toBeVisible({ timeout: 10_000 });
    const metrics = await page.locator('.pc-header').first().evaluate((el) => {
      const root = getComputedStyle(document.documentElement);
      const token = root.getPropertyValue('--panel-top-bar-height').trim();
      const cs = getComputedStyle(el);
      return {
        token,
        height: cs.height,
        maxHeight: cs.maxHeight,
        flexWrap: cs.flexWrap,
        rectH: el.getBoundingClientRect().height,
      };
    });
    expect(metrics.token).toBe('36px');
    expect(metrics.height).toBe('36px');
    expect(metrics.maxHeight).toBe('36px');
    expect(metrics.flexWrap).toBe('nowrap');
    expect(Math.round(metrics.rectH)).toBe(36);
  });

  test('#10 @ mention picker is portaled, fixed, and above shell panels', async () => {
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"]').click();
    const sceneRow = page.locator('.nav-scene-row', { hasText: 'Probe Scene' }).first();
    await expect(sceneRow).toBeVisible({ timeout: 8_000 });
    await sceneRow.click();
    const editor = page.locator('[data-testid="msv-sheet"] .ProseMirror').first();
    await expect(editor).toBeVisible({ timeout: 8_000 });
    await editor.click();
    await editor.press('End');
    await editor.press('Enter');
    await editor.type('@Ela');
    const picker = page.locator('.entity-mention-picker');
    await expect(picker).toBeVisible({ timeout: 5_000 });
    const info = await picker.evaluate((el) => {
      const cs = getComputedStyle(el);
      const parentIsBody = el.parentElement === document.body;
      return {
        parentIsBody,
        position: cs.position,
        zIndex: cs.zIndex,
        visible: cs.visibility !== 'hidden' && cs.display !== 'none',
        rect: el.getBoundingClientRect().toJSON(),
      };
    });
    expect(info.parentIsBody).toBe(true);
    expect(info.position).toBe('fixed');
    expect(info.visible).toBe(true);
    expect(Number(info.zIndex)).toBeGreaterThanOrEqual(200);
    // Must not be clipped under a covering panel (non-zero size in viewport).
    expect(info.rect.width).toBeGreaterThan(40);
    expect(info.rect.height).toBeGreaterThan(20);
  });

  test('#4 explorer MIME drop into Story editor inserts [[Harbor]]', async () => {
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"]').click();
    const sceneRow = page.locator('.nav-scene-row', { hasText: 'Probe Scene' }).first();
    await expect(sceneRow).toBeVisible({ timeout: 8_000 });
    await sceneRow.click();
    const editor = page.locator('[data-testid="msv-sheet"] .ProseMirror').first();
    await expect(editor).toBeVisible({ timeout: 8_000 });
    await editor.click();

    await editor.evaluate((el, mime) => {
      const dt = new DataTransfer();
      dt.setData(mime, 'Locations/Harbor.md');
      dt.setData('text/plain', 'Locations/Harbor.md');
      const rect = el.getBoundingClientRect();
      const x = rect.left + Math.min(40, rect.width / 2);
      const y = rect.top + Math.min(20, rect.height / 2);
      el.dispatchEvent(new DragEvent('dragover', {
        bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y,
      }));
      el.dispatchEvent(new DragEvent('drop', {
        bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y,
      }));
    }, MIME);

    await expect(editor.locator('[data-wiki-link="Harbor"]')).toBeVisible({ timeout: 5_000 });
  });
});
