/**
 * sky9876-brainstorm-ai-off.spec.ts — SKY-9876 (M10-S1)
 *
 * PLAN.md §M11b surface contract, Brainstorm row:
 *   "AI on: Agent chat + Board. AI off: Board and idea collections remain
 *    manual; chat gone."
 *
 * Real end-to-end path: renderer boots against a real `app-settings.json`
 * with `ai.enabled` set on disk, reads it via the real `settingsGet` IPC
 * round trip (no `window.api` seam stubbed) through `useAiEnabled`, and the
 * Brainstorm surface reacts to it. No LLM call is made or mocked in either
 * test — these are pure chrome-visibility + manual-path assertions.
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

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');

interface Fixture {
  userData: string;
  vaultDir: string;
  notesVaultDir: string;
}

function agentCfg(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85,
    maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5,
    maxTokensPerDay: 500_000, ...extra,
  };
}

function createFixture(aiEnabled: boolean): Fixture {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-9876-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-9876-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-9876-notes-'));

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true,
    ai: { enabled: aiEnabled },
    agents: { writingAssistant: agentCfg(), brainstorm: agentCfg({ enabled: true }), archive: agentCfg() },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: vaultDir, notesVaultRoot: notesVaultDir,
  }, null, 2));

  const now = new Date().toISOString();
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
    version: '1', vaultRoot: vaultDir,
    stories: [{ id: 'sky9876-story', title: 'AI-off Fixture', path: 'stories/sky9876-story', createdAt: now, updatedAt: now, chapters: [] }],
    entities: [], suggestions: [], scenes: [], chapters: [],
  }, null, 2));

  return { userData, vaultDir, notesVaultDir };
}

function cleanupFixture(fixture: Fixture): void {
  fs.rmSync(fixture.userData, { recursive: true, force: true });
  fs.rmSync(fixture.vaultDir, { recursive: true, force: true });
  fs.rmSync(fixture.notesVaultDir, { recursive: true, force: true });
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function openApp(fixture: Fixture): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await launchApp(fixture.userData);
  const page = await app.firstWindow();
  page.on('dialog', (d) => void d.accept().catch(() => undefined));
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
  return { app, page };
}

async function closeApp(app: ElectronApplication | undefined): Promise<void> {
  const proc = app?.process();
  await Promise.race([
    app?.close().catch(() => undefined) ?? Promise.resolve(),
    new Promise<void>((r) => setTimeout(r, 5_000)),
  ]);
  try {
    if (proc && !proc.killed) proc.kill('SIGKILL');
  } catch { /* already exited */ }
}

async function goToBrainstorm(page: Page): Promise<void> {
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Brainstorm"]').click();
  await expect(page.locator('[data-testid="bs-collections"]')).toBeVisible({ timeout: 10_000 });
}

test('SKY-9876: AI off — Agent Chat gone, Board + Idea Collections stay manual', async () => {
  const fixture = createFixture(false);
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;

    await goToBrainstorm(page);

    // Board renders as the only page — no dead single-option segmented control.
    await expect(page.locator('[data-testid="bsc-mode-chat"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="bsc-mode-board"]')).toHaveCount(0);
    await expect(page.locator('.pc-header-title', { hasText: 'Brainstorm Center' })).toBeVisible();

    // Every AI-bearing affordance is gone, cleanly (no dead band).
    await expect(page.locator('.brainstorm-input')).toHaveCount(0);
    await expect(page.locator('[data-testid="bs-board-side"]')).toHaveCount(0);
    await expect(page.locator('.preset-selector-chip')).toHaveCount(0);

    // Idea Collections + canvas remain fully manual: seven collections with
    // live counts, and placing a starter idea onto the board still works by
    // hand (M11c manual-path requirement).
    const collections = page.locator('[data-testid="bs-collections"]');
    const groupCount = await collections.locator('.bs-coll-head').count();
    expect(groupCount).toBe(7); // All Ideas + 6 categories

    await page.locator('[data-testid="bs-coll-toggle-beats"]').click();
    const starterRow = page.getByRole('button', { name: 'Add Midpoint Reversal to the board' });
    await expect(starterRow).toBeVisible();
    await starterRow.click();

    const card = page.locator('.bsb-card', { hasText: 'Midpoint Reversal' });
    await expect(card).toBeVisible();

    // Footer copy no longer promises a chat-driven capture flow that isn't reachable.
    await expect(page.locator('.bs-collections-foot')).not.toContainText('chat');
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});

test('SKY-9876: AI on (control) — Agent Chat tab and Board-page agent panel present', async () => {
  const fixture = createFixture(true);
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;

    await goToBrainstorm(page);

    await expect(page.locator('[data-testid="bsc-mode-chat"]')).toBeVisible();
    await expect(page.locator('[data-testid="bsc-mode-board"]')).toBeVisible();
    await expect(page.locator('.brainstorm-input')).toBeVisible();
    await expect(page.locator('.preset-selector-chip')).toBeVisible();

    await page.locator('[data-testid="bsc-mode-board"]').click();
    await expect(page.locator('[data-testid="bs-board-side"]')).toBeVisible();
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});
