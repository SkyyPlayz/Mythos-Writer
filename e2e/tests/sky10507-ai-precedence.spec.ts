/**
 * sky10507-ai-precedence.spec.ts — SKY-10507 (M11c close-out, inherited from
 * Ivy's M11a PASS on SKY-9332).
 *
 * M11a (SKY-9160) proved the master AI gate blocks network egress, but its
 * fixture set `ai.enabled` and every `agents.*.enabled` to the SAME value —
 * the specced disagreement (master vs. per-agent) was never exercised. This
 * spec drives the real app against a fixture where the two settings DISAGREE
 * and asserts BOTH directions:
 *
 *   1. Master OFF + every per-agent ON  → master wins. Every AI surface
 *      (Assistant tab / Coach / agent panels / Brainstorm chat / continuity
 *      flags / AI suggestions) is gone, even though each agent says "on".
 *   2. Master ON + per-agents DISAGREE  → defers to per-agent `enabled`.
 *      Disabled agents (Coach, Archive) show "Disabled" and their surfaces
 *      go manual; enabled agents (Brainstorm, Beta Reader) stay live.
 *
 * Real end-to-end path: renderer boots against a real `app-settings.json`,
 * reads it via the real `settingsGet` IPC round trip (no `window.api` seam
 * stubbed) through `useAiEnabled` / `agentEnablement`. No LLM call is made
 * or mocked in either direction.
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
const STORY_TITLE = 'AI Precedence Fixture';

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

/**
 * `aiEnabled` is the master switch. `agentsEnabled` is the disagreeing
 * per-agent fixture — each key defaults to `true` so a caller only has to
 * name the agents it wants OFF.
 */
function createFixture(
  aiEnabled: boolean,
  agentsEnabled: { writingAssistant?: boolean; brainstorm?: boolean; archive?: boolean; betaReader?: boolean } = {},
): Fixture {
  const { writingAssistant = true, brainstorm = true, archive = true, betaReader = true } = agentsEnabled;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-10507-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-10507-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-10507-notes-'));

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, rightSidebarVisible: true,
    ai: { enabled: aiEnabled },
    agents: {
      writingAssistant: agentCfg({ enabled: writingAssistant }),
      brainstorm: agentCfg({ enabled: brainstorm }),
      archive: agentCfg({ enabled: archive }),
      betaReader: { enabled: betaReader, model: 'claude-sonnet-4-6' },
    },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: vaultDir, notesVaultRoot: notesVaultDir,
  }, null, 2));

  const now = new Date().toISOString();
  const storyId = '10507-story';
  const chapterId = '10507-chapter';
  const sceneId = '10507-scene';
  const sceneDir = path.join(vaultDir, 'stories', storyId, 'chapters', chapterId, 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(
    path.join(sceneDir, `${sceneId}.md`),
    '---\ntitle: "Fixture Scene"\n---\n\nShe checked the settings twice.\n',
    'utf8',
  );
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
    version: '1', vaultRoot: vaultDir,
    stories: [{
      id: storyId, title: STORY_TITLE, path: `stories/${storyId}`, createdAt: now, updatedAt: now,
      chapters: [{
        id: chapterId, title: 'Chapter One', storyId, order: 0, createdAt: now, updatedAt: now,
        scenes: [{
          id: sceneId, title: 'Fixture Scene', path: `stories/${storyId}/chapters/${chapterId}/scenes/${sceneId}.md`,
          chapterId, storyId, order: 0, draftState: 'in-progress', createdAt: now, updatedAt: now, blocks: [],
        }],
      }],
    }],
    entities: [], suggestions: [], scenes: [], chapters: [],
  }, null, 2));

  fs.mkdirSync(path.join(notesVaultDir, 'Characters'), { recursive: true });
  fs.writeFileSync(path.join(notesVaultDir, 'Characters', 'Rell Anders.md'), 'POV. Careful, methodical.');

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

async function selectStoryAndOpenScene(page: Page): Promise<void> {
  await clickStoryNav(page);
  await page.locator('.nav-story-title', { hasText: STORY_TITLE }).click();
  await expect(page.locator('[data-testid="lr-story-card"]')).toBeVisible({ timeout: 8_000 });
}

async function goToBrainstorm(page: Page): Promise<void> {
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Brainstorm"]').click();
  await expect(page.locator('[data-testid="bs-collections"]')).toBeVisible({ timeout: 10_000 });
}

async function goToSceneCrafter(page: Page): Promise<void> {
  await clickStoryNav(page);
  await page.locator('.nav-story-title', { hasText: STORY_TITLE }).click();
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
  await expect(page.locator('.sc-suggest')).toBeVisible({ timeout: 10_000 });
}

test('SKY-10507: master OFF + every per-agent ON — master wins, every AI surface is gone', async () => {
  // Disagreeing fixture, direction 1: master says no; every agent says yes.
  const fixture = createFixture(false, { writingAssistant: true, brainstorm: true, archive: true, betaReader: true });
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;

    await selectStoryAndOpenScene(page);

    // Assistant tab (Coach + AGENTS panels + Continuity flags all live
    // inside it) is entirely absent — not present-but-empty.
    const grs = page.locator('[data-testid="global-right-sidebar"]');
    await expect(grs.getByRole('tab', { name: 'Assistant' })).toHaveCount(0);
    await expect(grs.getByRole('tab', { name: 'Scenes' })).toBeVisible();
    await expect(page.locator('[data-testid="ahp-agent-row-writing-assistant"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="ahp-agent-row-archive"]')).toHaveCount(0);
    await expect(page.locator('.cp-flags-label', { hasText: 'CONTINUITY FLAGS' })).toHaveCount(0);

    // Brainstorm: chat mode gone, board is the only page (M11b contract) —
    // even though agents.brainstorm.enabled is true on disk.
    await goToBrainstorm(page);
    await expect(page.locator('[data-testid="bsc-mode-chat"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="bsc-mode-board"]')).toHaveCount(0);
    await expect(page.locator('.brainstorm-input')).toHaveCount(0);

    // Scene Crafter suggested-cards rail credits the vault, not the agent —
    // even though agents.brainstorm.enabled is true on disk.
    await goToSceneCrafter(page);
    const hint = page.locator('.sc-suggest-hint');
    await expect(hint).toContainText('this list is drawn straight from your Notes Vault.');
    await expect(hint).not.toContainText('Brainstorm Agent');
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});

test('SKY-10507: master ON + per-agents disagree — defers to each per-agent enable', async () => {
  // Disagreeing fixture, direction 2: master says yes; Coach + Archive say
  // no, Brainstorm + Beta Reader say yes.
  const fixture = createFixture(true, { writingAssistant: false, brainstorm: true, archive: false, betaReader: true });
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;

    await selectStoryAndOpenScene(page);

    const grs = page.locator('[data-testid="global-right-sidebar"]');
    await expect(grs.getByRole('tab', { name: 'Assistant' })).toBeVisible();

    // AGENTS card: disabled agents say "Disabled"; enabled agents don't.
    const agentsCard = page.locator('[data-testid="agent-hub-panel"] section[aria-label="Agents"]');
    await expect(agentsCard.locator('[data-testid="ahp-agent-row-writing-assistant"] .ahp-status-text')).toHaveText('Disabled');
    await expect(agentsCard.locator('[data-testid="ahp-agent-row-archive"] .ahp-status-text')).toHaveText('Disabled');
    await expect(agentsCard.locator('[data-testid="ahp-agent-row-brainstorm"] .ahp-status-text')).not.toHaveText('Disabled');
    await expect(agentsCard.locator('[data-testid="ahp-agent-row-beta-reader"] .ahp-status-text')).not.toHaveText('Disabled');

    // Continuity: master is ON, so the panel is present (not gone) — but it
    // reads Archive's OWN disable, going manual with the agent-specific copy.
    const continuityStatus = page.locator('[data-testid="agent-hub-panel"] .cp-status-msg');
    await expect(continuityStatus).toHaveText('Archive Agent is disabled. Enable it in Settings.');

    // Brainstorm chat is live — its own per-agent enable is true.
    await goToBrainstorm(page);
    await expect(page.locator('[data-testid="bsc-mode-chat"]')).toBeVisible();
    await expect(page.locator('.brainstorm-input')).toBeVisible();

    // Scene Crafter rail credits the Brainstorm Agent — its own enable is true.
    await goToSceneCrafter(page);
    const hint = page.locator('.sc-suggest-hint');
    await expect(hint).toContainText('the Brainstorm Agent keeps this list stocked from your vault.');
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});
