/**
 * visual-regression.spec.ts — MYT-771
 *
 * Pixelmatch-based visual regression for Liquid Glass surfaces and writing modes:
 *   - Editor: Normal (shell, no scene), Scene-open (Edit), Focus-mode attempt
 *   - Brainstorm chat view
 *   - Settings panel
 *   - Vault browser sidebar
 *
 * Baselines live in e2e/visual-baselines/{platform}/{viewport}/.
 * Diffs land in e2e-visual-artifacts/visual-regression/ on failure.
 *
 * First run (no baselines): screenshots are saved as baselines; all tests pass.
 * Subsequent runs: screenshots are diffed against baselines via pixelmatch.
 *   Fail if pixel-diff ratio > VR_THRESHOLD (default 0.012 = 1.2%). Raised
 *   from 0.5% (SKY-6531) — sub-1% AA/font-rendering noise was flaking
 *   borderline diffs (0.63-0.69%) on every beta4 chrome/panel PR.
 *
 * To regenerate all baselines:
 *   VR_UPDATE_BASELINES=1 xvfb-run --auto-servernum npm run test:e2e:visual-regression
 *
 * Run (after `npm run build:electron`):
 *   xvfb-run --auto-servernum npm run test:e2e:visual-regression
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

// ─── Config ───────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');
const PLATFORM = os.platform(); // 'linux' | 'darwin' | 'win32'
const VIEWPORT = { width: 1440, height: 900 };
const VP_LABEL = `${VIEWPORT.width}x${VIEWPORT.height}`;

const THRESHOLD = parseFloat(process.env['VR_THRESHOLD'] ?? '0.012');
const UPDATE_BASELINES = process.env['VR_UPDATE_BASELINES'] === '1';

const BASELINE_DIR = path.resolve(
  __dirname, '../../e2e/visual-baselines', PLATFORM, VP_LABEL,
);
const DIFF_DIR = path.resolve(
  __dirname, '../../e2e-visual-artifacts/visual-regression',
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedUserData(userData: string, vaultDir: string): void {
  const storyId = 'vr-story-001';
  const chapterId = 'vr-chapter-001';
  const sceneId = 'vr-scene-001';
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
        title: 'Visual Regression Story',
        path: `stories/${storyId}`,
        chapters: [
          {
            id: chapterId,
            title: 'Chapter One',
            path: `stories/${storyId}/chapters/${chapterId}`,
            order: 0,
            scenes: [
              {
                id: sceneId,
                title: 'Opening Scene',
                path: `stories/${storyId}/chapters/${chapterId}/scenes/${sceneId}.md`,
                order: 0,
                chapterId,
                storyId,
                draftState: 'in-progress',
                blocks: [
                  {
                    id: 'b1', type: 'prose',
                    content: 'The cursor blinks, patient as a heartbeat, waiting.',
                    order: 0, updatedAt: now,
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
    'title: "Opening Scene"',
    'draftState: in-progress',
    `updatedAt: ${now}`,
    '---',
    '',
    'The cursor blinks, patient as a heartbeat, waiting.',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const sceneDir = path.join(vaultDir, 'stories', storyId, 'chapters', chapterId, 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(path.join(sceneDir, `${sceneId}.md`), sceneContent);
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env['DISPLAY'])
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

/**
 * Capture page screenshot and run pixelmatch against the stored baseline.
 * Returns the diff ratio (0–1). Creates the baseline if it doesn't exist or
 * if VR_UPDATE_BASELINES=1.
 */
async function assertMatchesBaseline(page: Page, name: string): Promise<number> {
  const baselinePath = path.join(BASELINE_DIR, `${name}.png`);
  const diffPath = path.join(DIFF_DIR, `${name}-diff.png`);

  const buf = await page.screenshot({ fullPage: false });

  const baselineExists = fs.existsSync(baselinePath);

  if (!baselineExists || UPDATE_BASELINES) {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
    fs.writeFileSync(baselinePath, buf);
    const action = baselineExists ? 'Updated' : 'Created';
    console.log(`  [VR] ${action} baseline: ${path.relative(process.cwd(), baselinePath)}`);
    return 0;
  }

  // Compare against stored baseline
  const baseline = PNG.sync.read(fs.readFileSync(baselinePath));
  const current = PNG.sync.read(buf);

  if (baseline.width !== current.width || baseline.height !== current.height) {
    fs.mkdirSync(DIFF_DIR, { recursive: true });
    fs.writeFileSync(diffPath, buf);
    fs.writeFileSync(path.join(DIFF_DIR, `${name}-actual.png`), buf);
    const ratio = 1;
    console.warn(`  [VR] FAIL ${name}: viewport size changed (${current.width}x${current.height} vs ${baseline.width}x${baseline.height})`);
    return ratio;
  }

  const { width, height } = baseline;
  const diff = new PNG({ width, height });
  const mismatchedPixels = pixelmatch(
    baseline.data, current.data, diff.data,
    width, height,
    { threshold: 0.1 },
  );
  const ratio = mismatchedPixels / (width * height);

  if (ratio > THRESHOLD) {
    fs.mkdirSync(DIFF_DIR, { recursive: true });
    fs.writeFileSync(diffPath, PNG.sync.write(diff));
    // Also save the actual screenshot so CI artifacts can be promoted to baselines
    const actualPath = path.join(DIFF_DIR, `${name}-actual.png`);
    fs.writeFileSync(actualPath, buf);
    console.warn(
      `  [VR] FAIL ${name}: ${(ratio * 100).toFixed(3)}% diff (${mismatchedPixels} px) — threshold ${(THRESHOLD * 100).toFixed(2)}%`,
    );
    console.warn(`       diff → ${path.relative(process.cwd(), diffPath)}`);
  } else {
    console.log(
      `  [VR] PASS ${name}: ${(ratio * 100).toFixed(3)}% diff`,
    );
  }

  return ratio;
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vr-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vr-vault-'));
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  fs.mkdirSync(DIFF_DIR, { recursive: true });

  seedUserData(userData, vaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);

  await page.setViewportSize(VIEWPORT);
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
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

// ─── Writing mode: Normal (editor shell, no scene selected) ──────────────────

test('VR-01 editor — normal mode (shell, no scene)', async () => {
  const editorBtn = page.locator('.app-menu-view-btn', { hasText: 'Editor' });
  if (await editorBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await editorBtn.click();
  }
  await page.waitForTimeout(400);

  const ratio = await assertMatchesBaseline(page, 'editor-normal');
  expect(ratio, `editor-normal diff ratio ${(ratio * 100).toFixed(3)}% exceeds ${(THRESHOLD * 100).toFixed(2)}% threshold`).toBeLessThanOrEqual(THRESHOLD);
});

// ─── Writing mode: Edit (scene open, block editor active) ────────────────────

test('VR-02 editor — edit mode (scene open)', async () => {
  const storyRow = page.locator('.nav-story-row').first();
  if (await storyRow.isVisible({ timeout: 3_000 }).catch(() => false)) {
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

  const ratio = await assertMatchesBaseline(page, 'editor-scene-open');
  expect(ratio, `editor-scene-open diff ratio ${(ratio * 100).toFixed(3)}% exceeds ${(THRESHOLD * 100).toFixed(2)}% threshold`).toBeLessThanOrEqual(THRESHOLD);
});

// ─── Writing mode: Focus (F11 or focus button, best-effort) ──────────────────

test('VR-03 editor — focus mode', async () => {
  const focusBtn = page.locator('[data-testid="focus-mode"], .btn-focus, .focus-mode-btn');
  const focusBtnVisible = await focusBtn.isVisible({ timeout: 1_000 }).catch(() => false);

  if (focusBtnVisible) {
    await focusBtn.click();
    await page.waitForTimeout(500);
  } else {
    await page.keyboard.press('F11');
    await page.waitForTimeout(500);
  }

  const ratio = await assertMatchesBaseline(page, 'editor-focus-mode');
  expect(ratio, `editor-focus-mode diff ratio ${(ratio * 100).toFixed(3)}% exceeds ${(THRESHOLD * 100).toFixed(2)}% threshold`).toBeLessThanOrEqual(THRESHOLD);

  if (focusBtnVisible) {
    if (await focusBtn.isVisible({ timeout: 1_000 }).catch(() => false)) await focusBtn.click();
  } else {
    await page.keyboard.press('F11');
  }
  await page.waitForTimeout(300);
});

// ─── Brainstorm chat ──────────────────────────────────────────────────────────

test('VR-04 brainstorm chat view', async () => {
  // SKY-6496: '.app-menu-view-btn' is stale — the nav rail (Beta 4 M3) renders
  // items as buttons with aria-label={item.label}, not that class. The old
  // selector silently no-op'd here, so the screenshot captured the default
  // Editor welcome screen instead of Brainstorm, producing a flaky diff ratio.
  const brainstormBtn = page.getByRole('button', { name: 'Brainstorm', exact: true });
  await brainstormBtn.click();
  await page.waitForTimeout(500);

  const ratio = await assertMatchesBaseline(page, 'brainstorm-chat');
  expect(ratio, `brainstorm-chat diff ratio ${(ratio * 100).toFixed(3)}% exceeds ${(THRESHOLD * 100).toFixed(2)}% threshold`).toBeLessThanOrEqual(THRESHOLD);
});

// ─── Settings panel ───────────────────────────────────────────────────────────

test('VR-05 settings panel', async () => {
  // SKY-6522: use aria-label role selector (same fix as VR-04 / SKY-6496)
  const editorBtn = page.getByRole('button', { name: 'Editor', exact: true });
  if (await editorBtn.isVisible({ timeout: 2_000 }).catch(() => false)) await editorBtn.click();
  await page.waitForTimeout(200);

  const gearBtn = page.locator('.app-menu-gear-btn');
  if (await gearBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await gearBtn.click();
    await page.waitForTimeout(600);
  }

  const ratio = await assertMatchesBaseline(page, 'settings-panel');
  expect(ratio, `settings-panel diff ratio ${(ratio * 100).toFixed(3)}% exceeds ${(THRESHOLD * 100).toFixed(2)}% threshold`).toBeLessThanOrEqual(THRESHOLD);

  const closeBtn = page.locator('.settings-close');
  if (await closeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await closeBtn.click();
    await page.waitForTimeout(200);
  }
});

// ─── Vault browser sidebar ────────────────────────────────────────────────────

test('VR-06 vault browser sidebar', async () => {
  // SKY-6522: use aria-label role selector (same fix as VR-04 / SKY-6496)
  const editorBtn = page.getByRole('button', { name: 'Editor', exact: true });
  if (await editorBtn.isVisible({ timeout: 2_000 }).catch(() => false)) await editorBtn.click();
  await page.waitForTimeout(300);

  const sidebar = page.locator('.shell-left, .left-rail, .story-navigator, [class*="sidebar"]').first();
  const sidebarVisible = await sidebar.isVisible({ timeout: 2_000 }).catch(() => false);

  let buf: Buffer;
  if (sidebarVisible) {
    buf = await sidebar.screenshot();
  } else {
    buf = await page.screenshot({ fullPage: false });
  }

  const baselinePath = path.join(BASELINE_DIR, 'vault-sidebar.png');
  const diffPath = path.join(DIFF_DIR, 'vault-sidebar-diff.png');
  const baselineExists = fs.existsSync(baselinePath);

  if (!baselineExists || UPDATE_BASELINES) {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
    fs.writeFileSync(baselinePath, buf);
    const action = baselineExists ? 'Updated' : 'Created';
    console.log(`  [VR] ${action} baseline: ${path.relative(process.cwd(), baselinePath)}`);
    return;
  }

  const baseline = PNG.sync.read(fs.readFileSync(baselinePath));
  const current = PNG.sync.read(buf);

  if (baseline.width !== current.width || baseline.height !== current.height) {
    fs.mkdirSync(DIFF_DIR, { recursive: true });
    fs.writeFileSync(diffPath, buf);
    fs.writeFileSync(path.join(DIFF_DIR, 'vault-sidebar-actual.png'), buf);
    expect(false, `vault-sidebar: viewport size changed (${current.width}x${current.height} vs ${baseline.width}x${baseline.height})`).toBe(true);
    return;
  }

  const { width, height } = baseline;
  const diff = new PNG({ width, height });
  const mismatchedPixels = pixelmatch(
    baseline.data, current.data, diff.data,
    width, height,
    { threshold: 0.1 },
  );
  const ratio = mismatchedPixels / (width * height);

  if (ratio > THRESHOLD) {
    fs.mkdirSync(DIFF_DIR, { recursive: true });
    fs.writeFileSync(diffPath, PNG.sync.write(diff));
    fs.writeFileSync(path.join(DIFF_DIR, 'vault-sidebar-actual.png'), buf);
    console.warn(`  [VR] FAIL vault-sidebar: ${(ratio * 100).toFixed(3)}% — diff → ${path.relative(process.cwd(), diffPath)}`);
  } else {
    console.log(`  [VR] PASS vault-sidebar: ${(ratio * 100).toFixed(3)}% diff`);
  }

  expect(ratio, `vault-sidebar diff ratio ${(ratio * 100).toFixed(3)}% exceeds ${(THRESHOLD * 100).toFixed(2)}% threshold`).toBeLessThanOrEqual(THRESHOLD);
});

// ─── Summary ──────────────────────────────────────────────────────────────────

test('VR-07 summary report', () => {
  const baselines = fs.existsSync(BASELINE_DIR)
    ? fs.readdirSync(BASELINE_DIR).filter((f) => f.endsWith('.png'))
    : [];
  const diffs = fs.existsSync(DIFF_DIR)
    ? fs.readdirSync(DIFF_DIR).filter((f) => f.endsWith('-diff.png'))
    : [];
  console.log(`\n[VR] Baselines: ${BASELINE_DIR} (${baselines.length} files)`);
  console.log(`[VR] Diffs:     ${DIFF_DIR} (${diffs.length} failures)`);
  if (diffs.length > 0) {
    console.log('[VR] Failing screens:');
    for (const d of diffs) console.log(`  • ${d}`);
  }
});
