/**
 * capture-archive-chat-cards-sky8886.spec.ts — SKY-8886 (not part of CI)
 *
 * One-off Playwright script to capture PR #1157 evidence screenshots showing
 * the Timeline right-panel Archive Agent chat + card feeds built against the
 * refreshed Liquid Neon prototype (PR #1153):
 *   1. Archive tab — "Talk to the Archive Agent…" input, gold card messages
 *      (title/text/footer), full history in a growable feed.
 *   2. Brainstorm tab — purple card message in the same shared MiniAgentChat.
 * Seed helpers are copied from e2e/capture-timeline-right-panel-resize-sky7956
 * .spec.ts (which copied them from e2e/timeline.spec.ts) so the store shapes
 * match what the app actually reads. Session files are written in the exact
 * serializeSessionFile format (electron-main/src/mythosFormat/agentSessions.ts)
 * including the SKY-8886 `<!-- mythos:card-meta {...} -->` card marker.
 * Not registered in package.json/CI — run manually under xvfb:
 *   xvfb-run --auto-servernum npx playwright test \
 *     e2e/capture-archive-chat-cards-sky8886.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/archive-chat-cards-sky8886');

const STORY_ID = 'story-sky8886';
const CHAPTER_ID = 'chapter-sky8886';
const STORY_TITLE = 'SKY-8886 Chat Story';
const CHAPTER_TITLE = 'Chapter One';
const ANCHOR_SCENE = {
  id: 'sc-sky8886-anchor', title: 'Anchor Scene', date: '2340-06-14',
  arcs: [] as string[], pov: 'Eira', mood: 'tense',
};
const EV_1 = { id: 'ev-sky8886-1', name: 'Departure', when: 100, chapter: 1 };
const EV_2 = { id: 'ev-sky8886-2', name: 'Dawn Summons', when: 130, chapter: 1 };

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    // Keep the evidence shots clean: no Getting Started aside, no upgrade toast.
    gettingStartedProgress: { completedItems: [], dismissed: true },
    notesTabUpgradeToastShown: true,
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));
}

/** Copied from e2e/timeline.spec.ts's seedVault — manifest shape must mirror
 *  defaultManifest() in electron-main/src/vault.ts. */
function seedVault(vaultDir: string): void {
  const now = new Date().toISOString();
  fs.mkdirSync(vaultDir, { recursive: true });

  const sceneEntries = [{
    id: ANCHOR_SCENE.id,
    title: ANCHOR_SCENE.title,
    path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${ANCHOR_SCENE.id}.md`,
    order: 0,
    chapterId: CHAPTER_ID,
    storyId: STORY_ID,
    blocks: [],
    createdAt: now,
    updatedAt: now,
  }];
  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [{
      id: STORY_ID,
      title: STORY_TITLE,
      path: `stories/${STORY_ID}`,
      chapters: [{
        id: CHAPTER_ID,
        title: CHAPTER_TITLE,
        path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`,
        order: 0,
        scenes: sceneEntries,
        createdAt: now,
        updatedAt: now,
      }],
      createdAt: now,
      updatedAt: now,
    }],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
    provenance: {},
    boardReferences: [],
    smartFolders: [],
  };
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const scenePath = path.join(vaultDir, 'stories', STORY_ID, 'chapters', CHAPTER_ID, 'scenes', `${ANCHOR_SCENE.id}.md`);
  fs.mkdirSync(path.dirname(scenePath), { recursive: true });
  const fm = [
    '---',
    `id: ${ANCHOR_SCENE.id}`,
    `title: ${ANCHOR_SCENE.title}`,
    `chapterId: ${CHAPTER_ID}`,
    `storyId: ${STORY_ID}`,
    `chronologicalDate: ${ANCHOR_SCENE.date}`,
    `chronologicalIsEstimated: false`,
    `chronologicalConfidence: 1`,
    `chronologicalSource: explicit_marker`,
    `entityArcs: [${ANCHOR_SCENE.arcs.join(', ')}]`,
    `metaPov: ${ANCHOR_SCENE.pov}`,
    `metaMood: ${ANCHOR_SCENE.mood}`,
    `updatedAt: ${now}`,
    '---',
    '',
  ].join('\n');
  fs.writeFileSync(scenePath, fm + ANCHOR_SCENE.title + ' prose body.\n');
}

/** Copied from e2e/timeline.spec.ts's seedTimelinesStore. */
function seedTimelinesStore(vaultDir: string): void {
  const now = new Date().toISOString();
  const store = {
    schemaVersion: 1,
    activeTimelineId: 'tl-story',
    timelines: [{
      id: 'tl-story', name: STORY_TITLE, kind: 'story', axis: 'calendar',
      calendar: { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 },
      createdAt: now, updatedAt: now,
    }],
    eras: [], spans: [], rows: [],
    events: [
      { id: EV_1.id, timelineId: 'tl-story', name: EV_1.name, when: EV_1.when, chapter: EV_1.chapter },
      { id: EV_2.id, timelineId: 'tl-story', name: EV_2.name, when: EV_2.when, chapter: EV_2.chapter },
    ],
  };
  fs.writeFileSync(path.join(vaultDir, 'timelines.json'), JSON.stringify(store, null, 2));
}

interface SeedTurn { role: 'user' | 'agent'; text: string; cardTitle?: string; cardFoot?: string }

/** Writes a session file in the exact serializeSessionFile format so
 *  parseSessionFile (incl. the SKY-8886 card-meta line) restores every turn. */
function writeSessionFile(notesVaultDir: string, agent: string, id: string, title: string, turns: SeedTurn[]): void {
  const sessionsDir = path.join(notesVaultDir, 'Sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  const startedAt = '2026-07-29T18:00:00.000Z';
  const body: string[] = [
    '---',
    'mythosSession: 1',
    `id: ${id}`,
    `agent: ${agent}`,
    `title: ${title}`,
    `startedAt: ${startedAt}`,
    `updatedAt: 2026-07-29T18:30:00.000Z`,
    `turns: ${turns.length}`,
    '---',
    '',
    `# ${title}`,
    '',
  ];
  turns.forEach((turn, i) => {
    const at = new Date(Date.parse(startedAt) + i * 60_000).toISOString();
    body.push(`<!-- mythos:turn ${turn.role} ${at} -->`);
    if (turn.cardTitle) {
      const meta: Record<string, string> = { cardTitle: turn.cardTitle };
      if (turn.cardFoot) meta.cardFoot = turn.cardFoot;
      body.push(`<!-- mythos:card-meta ${JSON.stringify(meta)} -->`);
    }
    body.push(turn.role === 'user' ? '**You:**' : '**Agent:**', '');
    body.push(turn.text);
    body.push('<!-- /mythos:turn -->', '');
  });
  fs.writeFileSync(path.join(sessionsDir, `2026-07-29 ${agent} ${id.slice(0, 8)}.md`), body.join('\n'));
}

function seedSessions(notesVaultDir: string): void {
  writeSessionFile(notesVaultDir, 'archive', 'sky8886archive', 'Timeline questions', [
    { role: 'user', text: 'When does the Departure happen relative to Chapter 1?' },
    { role: 'agent', text: 'The Departure is dated 2340-06-14 — it opens Chapter 1, right before the anchor scene at dawn.' },
    { role: 'user', text: 'Add the dawn summons to the timeline.' },
    {
      role: 'agent',
      text: "Dated to 2340-06-15 and placed on the story timeline. Linked to the scene 'Anchor Scene'.",
      cardTitle: 'Dawn Summons', cardFoot: 'From Ch. 1',
    },
    { role: 'user', text: 'Anything undated left in this chapter?' },
    { role: 'agent', text: 'One scene still has no chronological marker — want me to suggest a date range from its context?' },
    { role: 'user', text: 'Yes, suggest one.' },
    {
      role: 'agent',
      text: 'The dawn summons likely falls on 2340-06-15, the morning after the Departure. Suggestion only — nothing has been written to your manuscript.',
      cardTitle: 'Suggested date', cardFoot: 'Confidence: high',
    },
  ]);
  writeSessionFile(notesVaultDir, 'brainstorm', 'sky8886brains', 'Late summons what-if', [
    { role: 'user', text: 'What if the summons arrives a day late?' },
    { role: 'agent', text: 'Then the Departure happens without the protagonist — the convoy leaves at dawn and she has to chase it.' },
    { role: 'user', text: 'I like that. Capture it.' },
    {
      role: 'agent',
      text: 'The summons arrives a day late: the convoy departs without her, forcing a pursuit thread through Chapters 1–2.',
      cardTitle: 'What-if', cardFoot: 'Saved to Brainstorm notes',
    },
    { role: 'user', text: 'Does that break the timeline?' },
    { role: 'agent', text: 'No — the Departure stays on 2340-06-14; only her arrival shifts.' },
  ]);
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  // Run this spec under `xvfb-run` (matches how CI's e2e suite launches
  // Electron) rather than passing a bare `--headless` Chromium flag — that
  // flag alone produces zero BrowserWindows for this app.
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', '--force-prefers-reduced-motion'],
    timeout: 60_000,
  });
}

test('capture archive chat + card feed screenshots', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky8886-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky8886-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky8886-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  seedVault(vaultDir);
  seedTimelinesStore(vaultDir);
  seedSessions(notesVaultDir);

  const app = await launchApp(userData);
  const page: Page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setBounds({ x: 0, y: 0, width: 1500, height: 950 });
  });

  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  const sceneRow = page.locator('.nav-scene-row', { hasText: ANCHOR_SCENE.title }).first();
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav).toBeVisible({ timeout: 10_000 });
  const storyNavBtn = nav.getByRole('button', { name: 'Story Writer', exact: true });
  if (await storyNavBtn.getAttribute('aria-current') !== 'page') await storyNavBtn.click();

  const timelineBtn = page.locator('[data-testid="story-subview-timeline"]');
  await expect(timelineBtn).toBeVisible({ timeout: 6_000 });
  await timelineBtn.click();
  await expect(page.locator('[data-testid="timeline-root"]')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('[data-testid="timeline-right-panel"]')).toBeVisible({ timeout: 8_000 });

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ── 1+2. Archive tab: placeholder, gold cards, full history, growable feed.
  await page.locator('[data-testid="trp-tab-archive"]').click();
  await expect(page.locator('[data-testid="trp-tab-archive"]')).toHaveAttribute('aria-selected', 'true');
  const archiveInput = page.locator('[data-testid="trp-archive-chat-input"]');
  await expect(archiveInput).toBeVisible({ timeout: 6_000 });
  await expect(archiveInput).toHaveAttribute('placeholder', 'Talk to the Archive Agent…');

  const archiveFeed = page.locator('[data-testid="trp-archive-chat-feed"]');
  await expect(archiveFeed.locator('.trp-msg-card--archive')).toHaveCount(2, { timeout: 6_000 });
  await expect(archiveFeed.locator('.trp-msg-card-title').last()).toHaveText('Suggested date');
  // Full history: all 8 seeded turns render (no .slice(-6)).
  await expect(archiveFeed.locator('.trp-bubble, .trp-msg-card')).toHaveCount(8);
  // Auto-scroll: the feed rests at its bottom (equal heights when nothing overflows).
  const atBottom = await archiveFeed.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 4);
  expect(atBottom).toBe(true);

  await archiveInput.fill('Which chapter does the Departure land in?');
  await archiveInput.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT_DIR, '1-archive-chat-cards.png') });
  await page.locator('[data-testid="timeline-right-panel"]').screenshot({
    path: path.join(OUT_DIR, '2-archive-panel-closeup.png'),
  });

  // ── 3. Brainstorm tab: purple card in the shared MiniAgentChat feed.
  await page.locator('[data-testid="trp-tab-brainstorm"]').click();
  await expect(page.locator('[data-testid="trp-tab-brainstorm"]')).toHaveAttribute('aria-selected', 'true');
  const bsFeed = page.locator('[data-testid="trp-brainstorm-chat-feed"]');
  await expect(bsFeed.locator('.trp-msg-card--brainstorm')).toHaveCount(1, { timeout: 6_000 });
  await expect(bsFeed.locator('.trp-bubble, .trp-msg-card')).toHaveCount(6);
  await page.locator('[data-testid="trp-brainstorm-chat-input"]').scrollIntoViewIfNeeded();
  await page.locator('[data-testid="timeline-right-panel"]').screenshot({
    path: path.join(OUT_DIR, '3-brainstorm-panel-closeup.png'),
  });

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});
