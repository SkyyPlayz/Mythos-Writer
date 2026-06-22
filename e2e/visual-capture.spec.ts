/**
 * visual-capture.spec.ts — MYT-726
 *
 * Captures render artifacts for the MYT-531 Liquid Neon visual gate:
 *
 *   §9.2  9 surfaces × 2 viewports (1440×900 desktop, 390×844 mobile) = 18 shots
 *   §9.3  Style slider (lg-softness) at 0 / 0.5 / 1 × 2 viewports       = 6 shots
 *
 * Screenshots land in e2e-visual-artifacts/visual-capture/ for manual inspection
 * and attachment to MYT-531.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/visual-capture.spec.ts --reporter=list
 *
 * Best results with a real display (DISPLAY env var set or xvfb-run).
 * backdrop-filter compositing requires GPU; headless Electron may render
 * glass surfaces as solid fills.
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

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const ARTIFACT_DIR = path.resolve(__dirname, '../e2e-visual-artifacts/visual-capture');

const DESKTOP_VP = { width: 1440, height: 900 };
const MOBILE_VP  = { width: 390, height: 844 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedUserData(userData: string, vaultDir: string): void {
  const storyId = 'e2e-story-001';
  const chapterId = 'e2e-chapter-001';
  const sceneId = 'e2e-scene-001';
  const now = new Date().toISOString();

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
        enabled: false, model: 'claude-sonnet-4-6',
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
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

  const vaultSettings = { vaultRoot: vaultDir };

  const manifest = {
    version: '1',
    vaultRoot: vaultDir,
    stories: [
      {
        id: storyId,
        title: 'The Liquid Neon Chronicles',
        path: `stories/${storyId}`,
        chapters: [
          {
            id: chapterId,
            title: 'Chapter One: The Glass Horizon',
            path: `stories/${storyId}/chapters/${chapterId}`,
            order: 0,
            scenes: [
              {
                id: sceneId,
                title: 'Scene One: Refraction',
                path: `stories/${storyId}/chapters/${chapterId}/scenes/${sceneId}.md`,
                order: 0,
                chapterId,
                storyId,
                draftState: 'in-progress',
                blocks: [
                  {
                    id: 'b1',
                    type: 'prose',
                    content: 'The glass panes caught the neon light, each surface a window into another story.',
                    order: 0,
                    updatedAt: now,
                  },
                  {
                    id: 'b2',
                    type: 'dialogue',
                    content: '"Is this the place?" she asked, her breath fogging the translucent wall.',
                    order: 1,
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
        createdAt: now,
        updatedAt: now,
      },
    ],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
  };

  const sceneContent = [
    '---',
    `id: ${sceneId}`,
    'title: "Scene One: Refraction"',
    'draftState: in-progress',
    `updatedAt: ${now}`,
    '---',
    '',
    'The glass panes caught the neon light, each surface a window into another story.',
    '',
    '> "Is this the place?" she asked, her breath fogging the translucent wall.',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Write the scene markdown to its expected path
  const sceneDir = path.join(vaultDir, 'stories', storyId, 'chapters', chapterId, 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(path.join(sceneDir, `${sceneId}.md`), sceneContent);
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  page.on('dialog', (d) => { void d.accept().catch(() => undefined); });
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function shot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const filePath = path.join(ARTIFACT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vcap-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vcap-vault-'));
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  seedUserData(userData, vaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);

  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
});

test.afterAll(async () => {
  const proc = app?.process();
  await Promise.race([
    app?.close().catch(() => undefined),
    new Promise<void>((r) => setTimeout(r, 5_000)),
  ]);
  try { if (proc && !proc.killed) proc.kill('SIGKILL'); } catch { /* exited */ }
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});

// ─── §9.2 — 18 surface shots (9 surfaces × 2 viewports) ──────────────────────

test('§9.2 — 18 surface screenshots', async () => {
  for (const [vpLabel, vp] of [['desktop', DESKTOP_VP], ['mobile', MOBILE_VP]] as const) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(300);

    // ── Surface 1: App shell (editor view, empty welcome state — no scene open)
    // Navigate to editor view; deselect any scene
    const editorBtn = page.locator('.app-menu-view-btn', { hasText: 'Editor' });
    if (await editorBtn.isVisible()) await editorBtn.click();
    await page.waitForTimeout(300);
    await shot(page, `s1-app-shell-${vpLabel}`);

    // ── Surface 2: Editor — open the seeded scene
    const storyRow = page.locator('.nav-story-row').first();
    if (await storyRow.isVisible({ timeout: 3_000 }).catch(() => false)) {
      // Expand story → chapter → click scene
      const expandStory = storyRow.locator('.nav-expand-btn, button').first();
      if (await expandStory.isVisible()) await expandStory.click();
      await page.waitForTimeout(200);
      const chapterRow = page.locator('.nav-chapter-row').first();
      if (await chapterRow.isVisible({ timeout: 2_000 }).catch(() => false)) {
        const expandChapter = chapterRow.locator('.nav-expand-btn, button').first();
        if (await expandChapter.isVisible()) await expandChapter.click();
        await page.waitForTimeout(200);
      }
      const sceneRow = page.locator('.nav-scene-row').first();
      if (await sceneRow.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await sceneRow.click();
        await page.waitForTimeout(500);
      }
    }
    await shot(page, `s2-editor-${vpLabel}`);

    // ── Surface 3: Navigator — left rail with story tree
    const leftRail = page.locator('.shell-left, .left-rail');
    if (await leftRail.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await leftRail.screenshot({ path: path.join(ARTIFACT_DIR, `s3-navigator-${vpLabel}.png`) });
    } else {
      await shot(page, `s3-navigator-${vpLabel}`);
    }

    // ── Surface 4: Notes tab (right sidebar)
    const notesTab = page.locator('.sidebar-tab', { hasText: 'Notes' });
    if (await notesTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await notesTab.click();
      await page.waitForTimeout(200);
    }
    await shot(page, `s4-notes-tab-${vpLabel}`);

    // ── Surface 5: Agent chat / Writing Assistant tab
    const assistantTab = page.locator('.sidebar-tab', { hasText: 'Assistant' });
    if (await assistantTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await assistantTab.click();
      await page.waitForTimeout(200);
    }
    await shot(page, `s5-agent-chat-${vpLabel}`);

    // ── Surface 6: Graph view
    const graphBtn = page.locator('.app-menu-view-btn', { hasText: 'Graph' });
    if (await graphBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await graphBtn.click();
      await page.waitForTimeout(600);
    }
    await shot(page, `s6-graph-${vpLabel}`);

    // ── Surface 7: Brainstorm / Scene Crafter view
    const brainstormBtn = page.locator('.app-menu-view-btn', { hasText: 'Brainstorm' });
    if (await brainstormBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await brainstormBtn.click();
      await page.waitForTimeout(400);
    }
    await shot(page, `s7-scene-crafter-brainstorm-${vpLabel}`);

    // ── Surface 8: Settings dialog
    if (await editorBtn.isVisible({ timeout: 2_000 }).catch(() => false)) await editorBtn.click();
    await page.waitForTimeout(200);
    const gearBtn = page.locator('.app-menu-gear-btn');
    if (await gearBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await gearBtn.click();
      await page.waitForTimeout(600);
    }
    await shot(page, `s8-settings-dialog-${vpLabel}`);

    // Close settings before next surface
    const closeSettingsBtn = page.locator('.settings-close');
    if (await closeSettingsBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await closeSettingsBtn.click();
      await page.waitForTimeout(200);
    }

    // ── Surface 9: Board/Kanban view
    const boardBtn = page.locator('.app-menu-view-btn', { hasText: 'Board' });
    if (await boardBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await boardBtn.click();
      await page.waitForTimeout(400);
    }
    await shot(page, `s9-board-kanban-${vpLabel}`);

    // Return to editor for next iteration
    if (await editorBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await editorBtn.click();
      await page.waitForTimeout(200);
    }
  }

  // Verify at least some artifacts were written
  const files = fs.readdirSync(ARTIFACT_DIR).filter((f) => f.endsWith('.png'));
  expect(files.length).toBeGreaterThanOrEqual(18);
  console.log(`\n§9.2: wrote ${files.filter((f) => f.startsWith('s')).length} surface shots to ${ARTIFACT_DIR}`);
});

// ─── §9.3 — 6 slider sweep shots ─────────────────────────────────────────────

test('§9.3 — slider sweep at 0 / 0.5 / 1 (2 viewports)', async () => {
  // Return to editor view so glass surfaces are visible
  const editorBtn = page.locator('.app-menu-view-btn', { hasText: 'Editor' });
  if (await editorBtn.isVisible()) await editorBtn.click();
  await page.waitForTimeout(200);

  for (const [vpLabel, vp] of [['desktop', DESKTOP_VP], ['mobile', MOBILE_VP]] as const) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(200);

    // Open settings to access the main Style (softness↔contrast) slider
    const gearBtn = page.locator('.app-menu-gear-btn');
    if (await gearBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await gearBtn.click();
      await page.waitForTimeout(600);
      // Navigate to Appearance category (SKY-3215: settings has category sub-nav; slider lives here)
      const appearanceNavBtn = page.locator('[data-testid="settings-cat-appearance"]');
      if (await appearanceNavBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await appearanceNavBtn.click();
        await page.waitForTimeout(200);
      }
    }

    // MYT-716: ThemeContrastSlider replaced by #lg-softness (range 0–1)
    const slider = page.locator('#lg-softness');
    if (!(await slider.isVisible({ timeout: 3_000 }).catch(() => false))) {
      // Settings panel loaded but slider not visible — screenshot as-is
      await shot(page, `slider-no-slider-${vpLabel}`);
      const closeBtn = page.locator('.settings-close');
      if (await closeBtn.isVisible()) await closeBtn.click();
      continue;
    }

    for (const pos of [0, 0.5, 1] as const) {
      await slider.fill(String(pos));
      await slider.dispatchEvent('input');
      await slider.dispatchEvent('change');
      await page.waitForTimeout(400);
      await shot(page, `slider-pos${pos}-${vpLabel}`);
    }

    // Reset to default (0.5 = midpoint) before closing
    await slider.fill('0.5');
    await slider.dispatchEvent('input');
    await slider.dispatchEvent('change');

    const closeBtn = page.locator('.settings-close');
    if (await closeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(200);
    }
  }

  const sliderFiles = fs.readdirSync(ARTIFACT_DIR).filter((f) => f.startsWith('slider-pos'));
  console.log(`\n§9.3: wrote ${sliderFiles.length} slider sweep shots to ${ARTIFACT_DIR}`);
  expect(sliderFiles.length).toBeGreaterThanOrEqual(6);
});

// ─── §9.5 — Reference image inventory ────────────────────────────────────────
//
// The reference images are already in-repo at:
//   plans/ProjectGoalOverView/Liquid-Neon-theme-examples/
//
// This test logs their paths so the UX reviewer knows where to find them for
// the side-by-side comparison with the §9.2 captures above.

test('§9.5 — log reference image paths for side-by-side review', async () => {
  const refDir = path.resolve(
    __dirname,
    '../plans/ProjectGoalOverView/Liquid-Neon-theme-examples',
  );

  const refs = fs.existsSync(refDir)
    ? fs.readdirSync(refDir).filter((f) => /\.(png|jpg|jpeg)$/i.test(f))
    : [];

  // Map reference images to comparable §9.2 surfaces
  const pairs: { ref: string; capture: string }[] = [
    { ref: 'Liquid Neon writing app example 1.png', capture: 's2-editor-desktop.png' },
    { ref: 'Liquid Neon writing app example 2.png', capture: 's2-editor-mobile.png' },
    { ref: 'Liquid Neon Agent chat box example1.png', capture: 's5-agent-chat-desktop.png' },
    { ref: 'Notes navigator example .png', capture: 's4-notes-tab-desktop.png' },
    { ref: 'Mythos writer Liquid Neon example 1.png', capture: 's1-app-shell-desktop.png' },
    { ref: 'Mythos writer Liquid Neon example 2.png', capture: 's1-app-shell-mobile.png' },
    { ref: 'Cosmic neon grapgh view example.png', capture: 's6-graph-desktop.png' },
    { ref: 'Mythos writer notes example 1.png', capture: 's4-notes-tab-mobile.png' },
  ];

  console.log('\n§9.5 Reference ↔ Capture pairs for UX side-by-side review:');
  for (const { ref, capture } of pairs) {
    const refPath = path.join(refDir, ref);
    const capPath = path.join(ARTIFACT_DIR, capture);
    const refExists = refs.includes(ref);
    const capExists = fs.existsSync(capPath);
    console.log(`  REF  ${refExists ? '✓' : '✗'} ${ref}`);
    console.log(`  CAP  ${capExists ? '✓' : '✗'} ${capture}`);
    console.log();
  }

  console.log(`Reference dir: ${refDir}`);
  console.log(`Captures dir:  ${ARTIFACT_DIR}`);

  // Non-blocking: refs exist in-repo; captures depend on §9.2 having run first
  expect(refs.length).toBeGreaterThan(0);
});
