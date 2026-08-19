/**
 * aiOffSuite.ts — shared fixture + workspace walk for the SKY-10604 (M11c)
 * AI-off automated suite. Three specs share this file:
 *
 *   sky10604-network-silence.spec.ts   — zero-egress assert (item 1)
 *   sky10604-ai-walkthrough.spec.ts    — both-state walkthrough (item 2)
 *   sky10604-ai-off-persistence.spec.ts — restart persistence (item 3)
 *
 * The fixture is deliberately ADVERSARIAL for the off-state: the master
 * toggle is the only thing turned off — every per-agent enable stays true,
 * so anything that leaks past the master gate has an agent eager to run.
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { clickStoryNav } from './navGuard';

export const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');
export const STORY_TITLE = 'AI Off Suite Fixture';

export interface SuiteFixture {
  userData: string;
  vaultDir: string;
  notesVaultDir: string;
}

function agentCfg(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85,
    maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5,
    maxTokensPerDay: 500_000, ...extra,
  };
}

/**
 * Seed a profile + story/notes vault. `aiEnabled` drives ONLY the master
 * toggle; all per-agent enables stay true (see the header). The story vault
 * uses the manifest-v1 layout (same as sky10507-ai-precedence.spec.ts).
 */
export function createSuiteFixture(aiEnabled: boolean): SuiteFixture {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-10604-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-10604-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-10604-notes-'));

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, rightSidebarVisible: true,
    ai: { enabled: aiEnabled },
    agents: {
      writingAssistant: agentCfg(),
      brainstorm: agentCfg(),
      archive: agentCfg(),
      betaReader: { enabled: true, model: 'claude-sonnet-4-6' },
    },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: vaultDir, notesVaultRoot: notesVaultDir,
  }, null, 2));

  const now = new Date().toISOString();
  const storyId = '10604-story';
  const chapterId = '10604-chapter';
  const sceneId = '10604-scene';
  const sceneDir = path.join(vaultDir, 'stories', storyId, 'chapters', chapterId, 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(
    path.join(sceneDir, `${sceneId}.md`),
    '---\ntitle: "Fixture Scene"\n---\n\nThe harness watched the wire and heard nothing at all.\n',
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

export function cleanupSuiteFixture(fixture: SuiteFixture): void {
  fs.rmSync(fixture.userData, { recursive: true, force: true });
  fs.rmSync(fixture.vaultDir, { recursive: true, force: true });
  fs.rmSync(fixture.notesVaultDir, { recursive: true, force: true });
}

export async function launchSuiteApp(
  userData: string,
  extraLaunchArgs: string[] = [],
): Promise<ElectronApplication> {
  const headlessArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...headlessArgs, ...extraLaunchArgs],
    timeout: 60_000,
  });
}

export async function firstSuiteWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  page.on('dialog', (d) => void d.accept().catch(() => undefined));
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
  return page;
}

// ─── Workspace walk ──────────────────────────────────────────────────────────

const NAV = 'nav[aria-label="Main navigation"]';

async function clickRail(page: Page, label: string): Promise<void> {
  await page.locator(`${NAV} button[aria-label="${label}"]`).click();
}

/**
 * Story Writer: select the fixture story, then open its scene in the editor.
 * The scene click also sets the app-wide `selectedScene`, which NotesTabPanel
 * needs for its Agent-tab surfaces (m18 pattern).
 */
export async function goStoryWriter(page: Page): Promise<void> {
  await clickStoryNav(page);
  const title = page.locator('.nav-story-title', { hasText: STORY_TITLE });
  if (await title.isVisible().catch(() => false)) {
    await title.click();
  }
  await expect(page.locator('[data-testid="lr-story-card"]')).toBeVisible({ timeout: 10_000 });
  const sceneRow = page.locator('.nav-scene-row').first();
  if (await sceneRow.isVisible().catch(() => false)) {
    await sceneRow.click();
    await expect(page.locator('.ProseMirror').first()).toBeVisible({ timeout: 15_000 });
  }
}

export async function goNotesEditor(page: Page): Promise<void> {
  await clickRail(page, 'Notes Editor');
  await expect(page.locator('[data-testid="notes-tab-center"]')).toBeVisible({ timeout: 10_000 });
}

export async function goSceneCrafter(page: Page): Promise<void> {
  await clickRail(page, 'Scene Crafter');
  await expect(page.locator('.sc-suggest')).toBeVisible({ timeout: 10_000 });
}

export async function goBrainstorm(page: Page): Promise<void> {
  await clickRail(page, 'Brainstorm');
  await expect(page.locator('[data-testid="bs-collections"]')).toBeVisible({ timeout: 10_000 });
}

export async function goTimeline(page: Page): Promise<void> {
  await clickRail(page, 'Timeline');
  await expect(page.locator('[data-testid="timeline-root"]')).toBeVisible({ timeout: 10_000 });
}

export async function goVaultGraph(page: Page): Promise<void> {
  await clickRail(page, 'Vault Graph');
  await expect(page.locator('#app-tabpanel-vault-graph')).toBeVisible({ timeout: 10_000 });
  await expect(
    page.locator('[data-testid="vault-graph-view"], .vgv-state').first(),
  ).toBeVisible({ timeout: 10_000 });
}

export async function openSettingsDialog(page: Page): Promise<void> {
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('[role="dialog"][aria-label="Settings"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.settings-cat-nav__tab').first()).toBeVisible({ timeout: 10_000 });
}

export async function closeSettingsDialog(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="dialog"][aria-label="Settings"]')).not.toBeVisible({ timeout: 3_000 });
}

/**
 * Flip the master "AI features" switch inside the (already open) Settings
 * dialog and wait for the immediate-persist toast copy.
 */
export async function flipMasterToggle(page: Page, to: boolean): Promise<void> {
  const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
  await dialog.locator('[data-testid="settings-cat-agents"]').click();
  const card = dialog.locator('.ai-master-card');
  await expect(card).toBeVisible({ timeout: 5_000 });
  const toggle = card.locator('input[role="switch"][aria-label="AI features"]');
  if (await toggle.isChecked() !== to) {
    // Click the label — the checkbox input itself is visually hidden chrome.
    await card.locator('.settings-toggle').click();
    await expect(
      page.getByText(to ? 'AI features back on' : 'AI features off — every tool is now manual'),
    ).toBeVisible({ timeout: 5_000 });
  }
  await expect(toggle).toHaveJSProperty('checked', to);
}

/**
 * The full six-workspace walk in one pass (plus the Settings dialog). Used
 * by the network-silence spec, which cares that every workspace was really
 * exercised, not which elements rendered.
 */
export async function walkEveryWorkspace(page: Page): Promise<void> {
  await goStoryWriter(page);
  await goSceneCrafter(page);
  await goNotesEditor(page);
  await goBrainstorm(page);
  await goTimeline(page);
  await goVaultGraph(page);
  await openSettingsDialog(page);
  await closeSettingsDialog(page);
}
