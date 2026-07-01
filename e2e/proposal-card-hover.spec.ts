/**
 * proposal-card-hover.spec.ts — SKY-1616 / SKY-1598
 *
 * Captures hover-state screenshots of ProposalCard at 1440×900:
 *   1. Confirm button hovered  → should show var(--accent-hover) = #00cfe0
 *   2. Reject button hovered   → should show color-mix(state-danger 20%, transparent)
 *
 * Run after `npm run build:electron`:
 *   npx playwright test e2e/proposal-card-hover.spec.ts --reporter=list
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
const ARTIFACT_DIR = path.resolve(__dirname, '../e2e-visual-artifacts/proposal-card-hover');

const DESKTOP_VP = { width: 1440, height: 900 };

const MOCK_PROPOSAL = {
  id: 'qa-proposal-001',
  kind: 'character',
  title: 'Aria Vex',
  body: 'A skilled hacker who navigates the neon-lit underworld of New Shanghai, trading secrets for survival. Her neural implants give her an edge, but also a vulnerability she keeps close.',
  destinationPath: 'notes/characters/Aria_Vex.md',
  frontmatter: { type: 'character', tags: ['brainstorm', 'protagonist'] },
  sourceConversationTurnId: 'qa-turn-001',
  extractionConfidence: 0.95,
};

// ─── Seed helpers ─────────────────────────────────────────────────────────────

function seedUserData(userData: string, vaultDir: string): void {
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
        enabled: true, model: 'claude-sonnet-4-6',
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

  const storyId = 'e2e-story-001';
  const manifest = {
    version: '1',
    vaultRoot: vaultDir,
    stories: [
      {
        id: storyId,
        title: 'The Liquid Neon Chronicles',
        path: `stories/${storyId}`,
        chapters: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
  };

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
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

// ─── Test lifecycle ───────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pc-hover-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pc-hover-vault-'));
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

// ─── Screenshot capture ───────────────────────────────────────────────────────

test('ProposalCard hover states at 1440×900 — SKY-1598', async () => {
  await page.setViewportSize(DESKTOP_VP);
  await page.waitForTimeout(300);

  // Navigate to Brainstorm view
  const brainstormBtn = page.locator('.app-menu-view-btn', { hasText: 'Brainstorm' });
  await expect(brainstormBtn).toBeVisible({ timeout: 5_000 });
  await brainstormBtn.click();
  await expect(page.locator('.brainstorm-title')).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(500);

  // Inject a test proposal via IPC push from the main process
  await app!.evaluate(({ BrowserWindow }) => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) throw new Error('No BrowserWindow found');
    win.webContents.send('brainstorm:proposalQueued', {
      proposals: [{
        id: 'qa-proposal-001',
        kind: 'character',
        title: 'Aria Vex',
        body: 'A skilled hacker who navigates the neon-lit underworld of New Shanghai, trading secrets for survival. Her neural implants give her an edge, but also a vulnerability she keeps close.',
        destinationPath: 'notes/characters/Aria_Vex.md',
        frontmatter: { type: 'character', tags: ['brainstorm', 'protagonist'] },
        sourceConversationTurnId: 'qa-turn-001',
        extractionConfidence: 0.95,
      }],
    });
  });

  // Wait for ProposalCard to render
  const confirmBtn = page.locator('.pc-btn-confirm').first();
  const rejectBtn = page.locator('.pc-btn-reject').first();
  await expect(confirmBtn).toBeVisible({ timeout: 8_000 });
  await expect(rejectBtn).toBeVisible({ timeout: 3_000 });
  await page.waitForTimeout(300);

  // ── Screenshot 1: Baseline (no hover)
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, '01-proposal-card-baseline.png'),
    fullPage: false,
  });

  // ── Screenshot 2: Confirm button hover
  await confirmBtn.hover({ force: true });
  await page.waitForTimeout(200);
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, '02-confirm-button-hover.png'),
    fullPage: false,
  });

  // Move off to reset hover
  await page.mouse.move(DESKTOP_VP.width / 2, DESKTOP_VP.height / 2);
  await page.waitForTimeout(200);

  // ── Screenshot 3: Reject button hover
  await rejectBtn.hover({ force: true });
  await page.waitForTimeout(200);
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, '03-reject-button-hover.png'),
    fullPage: false,
  });

  // ── Screenshot 4: ProposalCard close-up (cropped to the card)
  const card = page.locator('.pc-card, .proposal-card, [class*="proposal"]').first();
  const cardLocator = page.locator('.pc-btn-confirm').first();
  const cardBbox = await cardLocator.boundingBox();
  if (cardBbox) {
    // Widen bounding box to include full card
    const clip = {
      x: Math.max(0, cardBbox.x - 200),
      y: Math.max(0, cardBbox.y - 120),
      width: Math.min(500, DESKTOP_VP.width - cardBbox.x + 200),
      height: Math.min(400, DESKTOP_VP.height - cardBbox.y + 120),
    };

    // Confirm hover close-up
    await confirmBtn.hover({ force: true });
    await page.waitForTimeout(200);
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, '04-confirm-hover-closeup.png'),
      clip,
      fullPage: false,
    });

    await page.mouse.move(DESKTOP_VP.width / 2, DESKTOP_VP.height / 2);
    await page.waitForTimeout(200);

    // Reject hover close-up
    await rejectBtn.hover({ force: true });
    await page.waitForTimeout(200);
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, '05-reject-hover-closeup.png'),
      clip,
      fullPage: false,
    });
  }

  // Verify screenshots were written
  const files = fs.readdirSync(ARTIFACT_DIR).filter((f) => f.endsWith('.png'));
  expect(files.length).toBeGreaterThanOrEqual(3);
  console.log(`\nScreenshots written to: ${ARTIFACT_DIR}`);
  console.log('Files:', files.join(', '));
});
