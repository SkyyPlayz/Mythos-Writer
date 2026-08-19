/**
 * sky10620-story-assist-ai-gate.spec.ts — SKY-10620 (M11c completeness audit).
 *
 * Same root-cause pattern as SKY-10576 (Scene Crafter Generate button): the
 * manuscript editor toolbar's "Story Assist" button
 * (aria-label "Open Brainstorm with current scene context (Story Assist)",
 * data-testid story-assist-btn) rendered whenever `agents.brainstorm.enabled`
 * was true, without checking the AI master toggle — a real, reproducible
 * violation of the R11 contract ("master off beats everything... every AI
 * surface disappears"), even though clicking it never calls the network
 * (it just seeds a Brainstorm prompt).
 *
 * Real end-to-end path: renderer boots against a real `app-settings.json`,
 * reads it via the real `settingsGet` IPC round trip through `useAiEnabled`.
 * No LLM call is made or mocked in either direction.
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
const SCENE_TITLE = 'Fixture Scene';

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

/** Mirrors the repro: master off, `agents.brainstorm.enabled` explicitly true. */
function createFixture(aiEnabled: boolean): Fixture {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-10620-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-10620-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-10620-notes-'));

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
  const storyId = '10620-story';
  const chapterId = '10620-chapter';
  const sceneId = '10620-scene';
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
      id: storyId, title: 'Story Assist Fixture', path: `stories/${storyId}`, createdAt: now, updatedAt: now,
      chapters: [{
        id: chapterId, title: 'Chapter One', storyId, order: 0, createdAt: now, updatedAt: now,
        scenes: [{
          id: sceneId, title: SCENE_TITLE, path: `stories/${storyId}/chapters/${chapterId}/scenes/${sceneId}.md`,
          chapterId, storyId, order: 0, draftState: 'in-progress', createdAt: now, updatedAt: now, blocks: [],
        }],
      }],
    }],
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

/** Opens the fixture-seeded scene in the manuscript editor. */
async function openScene(page: Page): Promise<void> {
  await clickStoryNav(page);
  await page.locator('.nav-scene-row', { hasText: SCENE_TITLE }).click();
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 10_000 });
}

test('SKY-10620: AI off — Story Assist button is gone from the manuscript toolbar', async () => {
  const fixture = createFixture(false);
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;

    await openScene(page);

    // agents.brainstorm.enabled is true on disk — proves the master toggle,
    // not the per-agent flag, gates the button.
    await expect(page.locator('[data-testid="story-assist-btn"]')).toHaveCount(0);
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});

test('SKY-10620: AI on (control) — Story Assist button renders and opens Brainstorm', async () => {
  const fixture = createFixture(true);
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;

    await openScene(page);

    const btn = page.locator('[data-testid="story-assist-btn"]');
    await expect(btn).toBeVisible();
    await btn.click();

    // Lands on Brainstorm with the scene-seeded prompt pre-filled.
    const input = page.locator('.brainstorm-input');
    await expect(input).toBeVisible({ timeout: 10_000 });
    await expect(input).toHaveValue(new RegExp(`Story Assist: help me develop the scene "${SCENE_TITLE}"`));
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});
