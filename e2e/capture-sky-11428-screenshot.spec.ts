/**
 * capture-sky-11428-screenshot.spec.ts — SKY-11428 (not part of CI)
 *
 * One-off Playwright script to capture real PR evidence for PR #1448
 * (SKY-11412 / SKY-11411 M12.B6 production-team roles), which had shipped
 * with `screenshot-exempt` self-applied on the "headless CI, cannot launch
 * Electron" justification Ivy's 07-29 overrule does not accept. Run here
 * against a real, non-headless display (WSLg X11 :0, not Xvfb) so the
 * capture shows the actual rendered UI, not a stand-in.
 *
 *   1. production-team-tab-alpha-reader     — Beta Reader -> Production Team
 *      tab, Alpha Reader selected (default).
 *   2. production-team-tab-storyline-consultant — same panel, Storyline
 *      Consultant selected — proves the Role select carries all three roles.
 *   3. production-team-tab-line-editor      — same panel, Line Editor
 *      selected.
 *   4. settings-ai-agents-toggles-off       — Settings > AI Agents, all
 *      three new toggles (Alpha Reader / Storyline Consultant / Line
 *      Editor) visible and unchecked (default OFF, AC1).
 *
 * Output: pr-screenshots/sky-11428-production-team-evidence/*.png
 *
 * Run (after `npm run build:electron`, with a real DISPLAY set):
 *   npx playwright test e2e/capture-sky-11428-screenshot.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-11428-production-team-evidence');

const STORY_ID = 'sky11428-story-0001';
const CHAPTER_ID = 'sky11428-chapter-0001';
const SCENE_ID = 'sky11428-scene-0001';
const SCENE_TITLE = 'Harbor Scene';
const SCENE_BODY = [
  'The harbor smelled of salt and diesel. Gulls wheeled over the moored trawlers as',
  'the tide crept up the stone steps, patient as it had been for a thousand years.',
].join('\n');

function ensureDir(d: string) {
  fs.mkdirSync(d, { recursive: true });
}

async function shot(page: Page, name: string) {
  ensureDir(OUT_DIR);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
  console.log(`  wrote ${name}.png`);
}

async function applyTheme(page: Page) {
  await page.evaluate(() => {
    const bgApp = getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim() || '#0e1116';
    const textBody = getComputedStyle(document.documentElement).getPropertyValue('--text-body').trim() || '#bfd6e8';
    document.documentElement.style.backgroundColor = bgApp;
    document.body.style.backgroundColor = bgApp;
    document.body.style.color = textBody;
  }).catch(() => undefined);
  await page.waitForTimeout(300);
}

function seedUserData(userData: string, vaultDir: string): void {
  const now = new Date().toISOString();
  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [
      {
        id: STORY_ID,
        title: 'SKY-11428 Evidence Story',
        path: `stories/${STORY_ID}`,
        chapters: [
          {
            id: CHAPTER_ID,
            title: 'Chapter One',
            path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`,
            order: 0,
            scenes: [
              {
                id: SCENE_ID,
                title: SCENE_TITLE,
                path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`,
                order: 0,
                chapterId: CHAPTER_ID,
                storyId: STORY_ID,
                updatedAt: now,
              },
            ],
            createdAt: now,
            updatedAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
  };

  const sceneDir = path.join(vaultDir, `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes`);
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(
    path.join(sceneDir, `${SCENE_ID}.md`),
    ['---', `id: ${SCENE_ID}`, `title: "${SCENE_TITLE}"`, `updatedAt: ${now}`, '---', '', SCENE_BODY, ''].join('\n'),
  );
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    onboardingComplete: true,
    theme: 'dark',
    rightSidebarVisible: true,
    notesTabUpgradeToastShown: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-haiku-4-5-20251001', scanIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000, waScanInterval: 'manual' },
      brainstorm: { enabled: false, model: 'claude-haiku-4-5-20251001', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      betaReader: { enabled: true, model: 'claude-haiku-4-5-20251001', maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, maxTokensPerDay: 500_000 },
      // SKY-11412 AC1: all three default OFF — this is what the Settings
      // screenshot must show, unmodified from a fresh install.
      alphaReader: { enabled: false, model: 'claude-haiku-4-5-20251001', maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, maxTokensPerDay: 500_000 },
      storylineConsultant: { enabled: false, model: 'claude-haiku-4-5-20251001', maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, maxTokensPerDay: 500_000 },
      lineEditor: { enabled: false, model: 'claude-haiku-4-5-20251001', maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, maxTokensPerDay: 500_000 },
    },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir }, null, 2));
}

async function clickStoryNav(page: Page): Promise<void> {
  const nav = page.locator('nav[aria-label="Main navigation"]');
  await expect(nav).toBeVisible({ timeout: 10_000 });
  const storyBtn = nav.locator('button[aria-label="Story Writer"]');
  if ((await storyBtn.getAttribute('aria-current')) !== 'page') {
    await storyBtn.click();
  }
  const backdrop = page.locator('[data-testid="nav-rail-stories-backdrop"]');
  if (await backdrop.count()) {
    await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    await expect(backdrop).toHaveCount(0);
  }
}

async function openScene(page: Page, sceneTitle: string): Promise<void> {
  await clickStoryNav(page);
  await page.locator('[data-testid="story-subview-editor"]').click();
  await expect(page.locator('.nav-story-row').first()).toBeVisible({ timeout: 20_000 });
  const sceneRow = page.locator('.nav-scene-row', { hasText: sceneTitle });
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();
}

async function openProductionTeamTab(page: Page) {
  const hubPanel = page.locator('[data-testid="agent-hub-panel"]');
  await expect(hubPanel).toBeVisible({ timeout: 8_000 });

  const betaRow = page.locator('[data-testid="ahp-agent-row-beta-reader"]');
  await expect(betaRow).toBeVisible({ timeout: 8_000 });
  await betaRow.click();

  const overlay = page.locator('.beta-reader-overlay');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  await overlay.getByRole('tab', { name: 'Production Team' }).click();
  await expect(page.locator('[data-testid="production-review-panel"]')).toBeVisible({ timeout: 5_000 });
  return overlay;
}

test('capture SKY-11428 production team + settings toggles evidence', async () => {
  test.setTimeout(120_000);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11428-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11428-vault-'));
  seedUserData(userData, vaultDir);

  // No --headless: this must run against a real display per Ivy's 07-29
  // overrule ("I could not capture one" does not qualify for screenshot-exempt).
  expect(process.env.DISPLAY, 'DISPLAY must be set to a real X server for this capture').toBeTruthy();
  const app: ElectronApplication = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'],
    timeout: 60_000,
  });

  try {
    const page: Page = await app.firstWindow();
    page.on('dialog', (dialog) => void dialog.accept().catch(() => undefined));
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
    await applyTheme(page);

    await openScene(page, SCENE_TITLE);

    // ── Production Team tab — cycle all three roles so each is proven live
    // in the Role select, not just the default. ───────────────────────────
    const overlay = await openProductionTeamTab(page);
    const roleSelect = overlay.getByLabel('Production role');
    await overlay.getByLabel('Review scope').selectOption('chapter').catch(() => undefined);

    await expect(roleSelect).toHaveValue('alphaReader');
    await page.waitForTimeout(200);
    await shot(page, '1-production-team-tab-alpha-reader');

    await roleSelect.selectOption('storylineConsultant');
    await page.waitForTimeout(200);
    await shot(page, '2-production-team-tab-storyline-consultant');

    await roleSelect.selectOption('lineEditor');
    await page.waitForTimeout(200);
    await shot(page, '3-production-team-tab-line-editor');

    await overlay.locator('.beta-reader-close').click();
    await expect(overlay).toBeHidden({ timeout: 5_000 });

    // ── Settings > AI Agents — all three new toggles, default OFF. ────────
    await page.locator('.app-menu-gear-btn').click();
    await expect(page.locator('.settings-title')).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="settings-cat-agents"]').click();

    const alphaToggle = page.getByLabel('Enable Alpha Reader');
    const storylineToggle = page.getByLabel('Enable Storyline Consultant');
    const lineEditorToggle = page.getByLabel('Enable Line Editor');
    // The checkbox itself is visually hidden (zero-size, styled via the
    // sibling track span) — same pattern as every other settings toggle in
    // this repo (e.g. sky-11412 TC-SKY11412-01). Assert on the card instead.
    await expect(page.locator('[data-testid="alpha-reader-agent-card"]')).toBeVisible({ timeout: 5_000 });
    await expect(alphaToggle).not.toBeChecked();
    await expect(storylineToggle).not.toBeChecked();
    await expect(lineEditorToggle).not.toBeChecked();

    await page.locator('[data-testid="line-editor-agent-card"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await shot(page, '4-settings-ai-agents-toggles-off');

    await page.click('.settings-close');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  }
});
