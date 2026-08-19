/**
 * sky9878-scene-crafter-ai-off.spec.ts — SKY-9878 (M10-S3)
 *
 * PLAN.md §M11c: an AI-adjacent manual-add flow must keep working, and say so,
 * with the master AI toggle off. The SUGGESTED CARDS rail's click-or-drag-
 * onto-the-board path never calls AI either way (pure vault reads) — this
 * test proves the real settings → IPC → `useAiEnabled` → copy path (no
 * `window.api` seam stubbed) swaps the "who stocks this list" hint, and that
 * the rail's manual paths keep working with AI off.
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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-9878-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-9878-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-9878-notes-'));

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
    stories: [{ id: 'sky9878-story', title: 'AI-off Fixture', path: 'stories/sky9878-story', createdAt: now, updatedAt: now, chapters: [] }],
    entities: [], suggestions: [], scenes: [], chapters: [],
  }, null, 2));

  fs.mkdirSync(path.join(notesVaultDir, 'Characters'), { recursive: true });
  fs.writeFileSync(path.join(notesVaultDir, 'Characters', 'Mira Veynn.md'), 'POV. Dread first, wonder second.');

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

/** Selects the fixture's manifest-seeded story, then opens Scene Crafter — the board is story-scoped. */
async function goToSceneCrafter(page: Page): Promise<void> {
  await clickStoryNav(page);
  await page.locator('.nav-story-title', { hasText: 'AI-off Fixture' }).click();
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
  await expect(page.locator('.sc-suggest')).toBeVisible({ timeout: 10_000 });
}

test('SKY-9878: AI off — rail credits the Notes Vault, not the Brainstorm Agent, and the manual add path still works', async () => {
  const fixture = createFixture(false);
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;

    await goToSceneCrafter(page);

    const hint = page.locator('.sc-suggest-hint');
    await expect(hint).toContainText('this list is drawn straight from your Notes Vault.');
    await expect(hint).not.toContainText('Brainstorm Agent');

    // Manual add path (M11c): the rail is pure vault reads either way — a
    // suggested card still selects as draft context with AI off.
    const card = page.locator('.sc-suggest').getByRole('button', { name: /Mira Veynn/i });
    await expect(card).toHaveAttribute('aria-pressed', 'false');
    await card.click();
    await expect(card).toHaveAttribute('aria-pressed', 'true');

    // SKY-10576: the AI first-pass Generate button is an AI affordance and
    // must not render with the master toggle off (server-side AiDisabledError
    // is a backstop, not a substitute for hiding the control).
    await expect(page.locator('.sc-draft-btn')).toHaveCount(0);
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});

test('SKY-9878: AI on (control) — rail credits the Brainstorm Agent', async () => {
  const fixture = createFixture(true);
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;

    await goToSceneCrafter(page);

    const hint = page.locator('.sc-suggest-hint');
    await expect(hint).toContainText('the Brainstorm Agent keeps this list stocked from your vault.');

    // SKY-10576 control: Generate renders normally with AI on.
    await expect(page.locator('.sc-draft-btn')).toBeVisible();
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});
