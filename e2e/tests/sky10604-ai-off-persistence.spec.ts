/**
 * sky10604-ai-off-persistence.spec.ts — SKY-10604 (M11c), items 3 + 4.
 *
 *   TC-PS-01  SETTINGS PERSISTENCE ACROSS RESTART: flipping the master "AI
 *             features" switch OFF through the real Settings UI persists to
 *             app-settings.json, survives a full app restart (surfaces stay
 *             gone, switch stays unchecked), and the same holds for the
 *             flip back ON after a second restart.
 *
 *   TC-RT-01  AGENT-COMMENT HIDE/RESTORE ROUND-TRIP: with agent comments
 *             (Archive + Writing Coach) and one user comment seeded in the
 *             v2 sidecar, toggling the master switch OFF live-hides every
 *             agent surface — gutter cards, anchor underlines, the count
 *             chip, the Assistant tab — while the WRITER'S OWN comment
 *             stays. The sidecar file on disk is byte-identical throughout,
 *             and toggling back ON restores every agent comment intact.
 *
 * Run: npx playwright test e2e/tests/sky10604-ai-off-persistence.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { closeElectronApp, removeTempDirs } from '../helpers/electronTeardown';
import {
  createSuiteFixture,
  cleanupSuiteFixture,
  launchSuiteApp,
  firstSuiteWindow,
  goStoryWriter,
  openSettingsDialog,
  closeSettingsDialog,
  flipMasterToggle,
} from '../helpers/aiOffSuite';

function readAiEnabled(userData: string): boolean | undefined {
  const parsed = JSON.parse(
    fs.readFileSync(path.join(userData, 'app-settings.json'), 'utf8'),
  ) as { ai?: { enabled?: boolean } };
  return parsed.ai?.enabled;
}

test('TC-PS-01: master toggle state persists across an app restart, both directions', async () => {
  const fixture = createSuiteFixture(true);
  let app: ElectronApplication | undefined;
  try {
    app = await launchSuiteApp(fixture.userData);
    let page = await firstSuiteWindow(app);
    await goStoryWriter(page);

    const grs = () => page.locator('[data-testid="global-right-sidebar"]');
    await expect(grs().getByRole('tab', { name: 'Assistant' })).toBeVisible({ timeout: 10_000 });

    // Flip OFF through the real Settings UI (immediate-persist toggle).
    await openSettingsDialog(page);
    await flipMasterToggle(page, false);
    await closeSettingsDialog(page);

    // Live effect before any restart…
    await expect(grs().getByRole('tab', { name: 'Assistant' })).toHaveCount(0);
    // …and the write reached disk.
    await expect.poll(() => readAiEnabled(fixture.userData), { timeout: 10_000 }).toBe(false);

    // RESTART 1: off state survives.
    await closeElectronApp(app);
    app = await launchSuiteApp(fixture.userData);
    page = await firstSuiteWindow(app);
    await goStoryWriter(page);
    await expect(grs().getByRole('tab', { name: 'Scenes' })).toBeVisible({ timeout: 10_000 });
    await expect(grs().getByRole('tab', { name: 'Assistant' })).toHaveCount(0);
    await openSettingsDialog(page);
    const toggle = page.locator('[role="dialog"][aria-label="Settings"] input[role="switch"][aria-label="AI features"]');
    await page.locator('[data-testid="settings-cat-agents"]').click();
    await expect(toggle).toHaveJSProperty('checked', false);

    // Flip back ON and restart again — the on state survives too.
    await flipMasterToggle(page, true);
    await closeSettingsDialog(page);
    await expect.poll(() => readAiEnabled(fixture.userData), { timeout: 10_000 }).toBe(true);
    await closeElectronApp(app);
    app = await launchSuiteApp(fixture.userData);
    page = await firstSuiteWindow(app);
    await goStoryWriter(page);
    await expect(grs().getByRole('tab', { name: 'Assistant' })).toBeVisible({ timeout: 10_000 });
  } finally {
    await closeElectronApp(app);
    cleanupSuiteFixture(fixture);
  }
});

// ─── TC-RT-01 fixture: v2 vault with agent + user comments (comments-v2 shape) ─

const NOW = '2026-08-01T00:00:00.000Z';
const RT_STORY_ID = 'story-rt-1';
const RT_STORY_TITLE = 'Round Trip';
const RT_PROSE = 'The lantern cast a trembling circle of light across the drowned stone.';
const ARCHIVE_TEXT = 'Continuity: this lantern is oil-lit in Ch. 1 but crystal-lit later.';
const COACH_TEXT = 'Strong image — consider landing it even harder.';
const USER_TEXT = 'Keep the lantern line exactly as it is.';

function seedRoundTripVault(bundle: string): void {
  const storyDir = path.join(bundle, 'Story Vault', RT_STORY_TITLE);
  const chapterDir = path.join(storyDir, 'Part 1', 'Chapter 01');
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.mkdirSync(path.join(bundle, 'Notes Vault'), { recursive: true });

  fs.writeFileSync(path.join(bundle, 'mythos.json'), JSON.stringify({
    formatVersion: 2, id: 'vault-rt-1', name: 'Round Trip Vault', createdAt: NOW,
    stories: [{ id: RT_STORY_ID, title: RT_STORY_TITLE, folder: RT_STORY_TITLE, createdAt: NOW, updatedAt: NOW }],
    seed: { layout: 'veynn-v2', mode: 'blank', seededAt: NOW },
  }, null, 2));

  const spine = [{ dir: 'Part 1', chapters: [{ dir: 'Chapter 01', id: 'ch-rt-1', title: 'Chapter One' }] }];
  fs.writeFileSync(
    path.join(storyDir, 'book.md'),
    [
      '---', `id: ${RT_STORY_ID}`, `title: ${RT_STORY_TITLE}`, `createdAt: ${NOW}`, `updatedAt: ${NOW}`, '---',
      `# ${RT_STORY_TITLE}`, '', '## Part 1', '', '- [[Part 1/Chapter 01|Chapter One]]', '',
      '<!-- mythos:spine', JSON.stringify(spine), '-->', '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(chapterDir, 'Scene 01.md'),
    `---\nid: scene-rt-1\ntitle: The Gate\nstatus: draft\nupdatedAt: ${NOW}\n---\n${RT_PROSE}`,
  );

  fs.writeFileSync(path.join(storyDir, 'comments.json'), `${JSON.stringify({
    version: 1,
    comments: [
      {
        id: 'c-rt-archive', storyId: RT_STORY_ID, sceneId: 'scene-rt-1',
        anchor: 'trembling circle of light', author: 'Archive Agent', kind: 'archive',
        text: ARCHIVE_TEXT, createdAt: NOW,
      },
      {
        id: 'c-rt-coach', storyId: RT_STORY_ID, sceneId: 'scene-rt-1',
        anchor: 'across the drowned stone', author: 'Writing Coach', kind: 'writing',
        text: COACH_TEXT, createdAt: NOW,
      },
      {
        id: 'c-rt-user', storyId: RT_STORY_ID, sceneId: 'scene-rt-1',
        anchor: 'The lantern cast', author: 'You', kind: 'user',
        text: USER_TEXT, createdAt: NOW,
      },
    ],
  }, null, 2)}\n`);
}

async function openManuscript(page: Page): Promise<void> {
  const nav = page.locator('nav[aria-label="Main navigation"]');
  await expect(nav).toBeVisible({ timeout: 15_000 });
  const storyBtn = nav.getByRole('button', { name: /^story( writer)?$/i }).first();
  if ((await storyBtn.getAttribute('aria-current')) !== 'page') {
    await storyBtn.click();
  }
  const backdrop = page.locator('[data-testid="nav-rail-stories-backdrop"]');
  if (await backdrop.count()) {
    await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    await expect(backdrop).toHaveCount(0);
  }
  const storyRow = page.getByRole('button', { name: new RegExp(RT_STORY_TITLE) }).first();
  await expect(storyRow).toBeVisible({ timeout: 20_000 });
  const chapterRow = page.getByRole('button', { name: /Chapter One/ }).first();
  if (!(await chapterRow.isVisible().catch(() => false))) {
    await storyRow.click();
  }
  await expect(chapterRow).toBeVisible({ timeout: 10_000 });
  // Boot-time reindex can re-collapse the chapter — retry (comments-v2 pattern).
  const sceneRow = page.getByRole('button', { name: /The Gate/ }).first();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await chapterRow.click();
    try {
      await sceneRow.waitFor({ state: 'visible', timeout: 3_000 });
      break;
    } catch { /* collapsed again — retry */ }
  }
  await sceneRow.click();
  await expect(page.locator('.ProseMirror').first()).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('msv-zoom-chapter').click();
  await expect(page.locator('.chapter-continuous-view')).toBeVisible({ timeout: 10_000 });
}

test('TC-RT-01: toggle OFF hides agent comments/flags, ON restores them intact; sidecar never changes', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-10604-rt-'));
  const userData = path.join(tmpRoot, 'user-data');
  const bundle = path.join(tmpRoot, 'Round Trip Vault');
  const sidecarPath = path.join(bundle, 'Story Vault', RT_STORY_TITLE, 'comments.json');
  fs.mkdirSync(userData, { recursive: true });
  seedRoundTripVault(bundle);
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, rightSidebarVisible: true,
    ai: { enabled: true },
    theme: 'dark',
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: path.join(bundle, 'Story Vault'),
    notesVaultRoot: path.join(bundle, 'Notes Vault'),
  }, null, 2));
  const sidecarBefore = fs.readFileSync(sidecarPath, 'utf8');

  let app: ElectronApplication | undefined;
  try {
    app = await launchSuiteApp(userData);
    const page = await firstSuiteWindow(app);
    await openManuscript(page);

    // AI ON: all three comments render — two agent cards + the user's.
    await expect(page.getByTestId('msv-gutter')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('msv-cmt-c-rt-archive')).toContainText(ARCHIVE_TEXT);
    await expect(page.getByTestId('msv-cmt-c-rt-coach')).toContainText(COACH_TEXT);
    await expect(page.getByTestId('msv-cmt-c-rt-user')).toContainText(USER_TEXT);
    await expect(page.getByTestId('msv-anchor-c-rt-archive')).toBeVisible();
    await expect(page.getByTestId('msv-comments-chip')).toContainText('3');
    const grs = page.locator('[data-testid="global-right-sidebar"]');
    await expect(grs.getByRole('tab', { name: 'Assistant' })).toBeVisible();

    // Toggle OFF (live — no restart).
    await openSettingsDialog(page);
    await flipMasterToggle(page, false);
    await closeSettingsDialog(page);

    // Agent content hides: cards, anchor underlines, Assistant tab. The
    // writer's own comment STAYS — it is manual content, not AI content.
    await expect(page.getByTestId('msv-cmt-c-rt-archive')).toHaveCount(0);
    await expect(page.getByTestId('msv-cmt-c-rt-coach')).toHaveCount(0);
    await expect(page.getByTestId('msv-anchor-c-rt-archive')).toHaveCount(0);
    await expect(page.getByTestId('msv-anchor-c-rt-coach')).toHaveCount(0);
    await expect(page.getByTestId('msv-cmt-c-rt-user')).toContainText(USER_TEXT);
    await expect(page.getByTestId('msv-comments-chip')).toContainText('1');
    await expect(grs.getByRole('tab', { name: 'Assistant' })).toHaveCount(0);

    // Hiding is presentation-only: the sidecar is byte-identical.
    expect(fs.readFileSync(sidecarPath, 'utf8')).toBe(sidecarBefore);

    // Toggle back ON — everything reappears intact, same text, same count.
    await openSettingsDialog(page);
    await flipMasterToggle(page, true);
    await closeSettingsDialog(page);
    await expect(page.getByTestId('msv-cmt-c-rt-archive')).toContainText(ARCHIVE_TEXT);
    await expect(page.getByTestId('msv-cmt-c-rt-coach')).toContainText(COACH_TEXT);
    await expect(page.getByTestId('msv-cmt-c-rt-user')).toContainText(USER_TEXT);
    await expect(page.getByTestId('msv-anchor-c-rt-archive')).toBeVisible();
    await expect(page.getByTestId('msv-comments-chip')).toContainText('3');
    await expect(grs.getByRole('tab', { name: 'Assistant' })).toBeVisible();
    expect(fs.readFileSync(sidecarPath, 'utf8')).toBe(sidecarBefore);
  } finally {
    await closeElectronApp(app);
    removeTempDirs(tmpRoot);
  }
});
