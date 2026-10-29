/**
 * prism-prose-checks.spec.ts — #1764 Prism (rule-only prose checks).
 *
 * Drives the real UI -> IPC -> disk path against the built Electron app with
 * AI switched OFF and no API key, proving the rule-only checks need neither:
 *
 *   TC-PR-01  Detection runs with display off (Flags default off, no marks,
 *             the Analytics checklist still counts findings). Clicking the
 *             Flags master switch draws underlines on the seeded prose;
 *             turning one check off hides only its marks and drops it from
 *             the list; "Go to" selects the flagged words in the editor;
 *             Prose colors tints dialogue. The choices land in the book's
 *             `prism.json` and survive a relaunch.
 *
 * Only the prose is seeded. Every Prism setting is reached by clicking from
 * a fresh profile (no prism.json exists before the test clicks).
 *
 * Run:
 *   npx playwright test e2e/prism-prose-checks.spec.ts --reporter=list
 */
import path from 'path';
import fs from 'fs';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import { MAIN_JS, makeScratch, firstWindow, type Scratch } from './helpers/launchApp';
import { clickStoryNav } from './helpers/navGuard';
import { closeElectronApp, removeTempDirs } from './helpers/electronTeardown';

const STORY_ID = 'prism-e2e-story';
const CHAPTER_ID = 'prism-e2e-chapter';
const SCENE_ID = 'prism-e2e-scene';
const SCENE_TITLE = 'Prism Seeded Scene';

// Each sentence trips one rule so the assertions below can name it:
// "just" → crutch-words, "quickly" → adverbs, "was taken" → passive-voice,
// "felt" → filter-words, the quoted line → dialogue tint.
const SCENE_BODY = [
  'Mara just stood at the rail as the storm rolled in.',
  'She quickly climbed the ladder to the lamp room.',
  'The last reading was taken by the night keeper.',
  'She felt the tower sway under her boots.',
  '“Hold the light steady,” Mara said.',
].join(' ');

function seed(s: Scratch): void {
  fs.writeFileSync(
    path.join(s.userData, 'app-settings.json'),
    JSON.stringify(
      {
        apiKey: '',
        onboardingComplete: true,
        ai: { enabled: false },
        theme: 'dark',
        notesTabUpgradeToastShown: true,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(s.userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: s.vaultDir, notesVaultRoot: s.notesVaultDir }, null, 2),
  );

  const now = new Date().toISOString();
  const sceneDir = path.join(s.vaultDir, `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes`);
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(
    path.join(sceneDir, `${SCENE_ID}.md`),
    ['---', `id: ${SCENE_ID}`, `title: "${SCENE_TITLE}"`, `updatedAt: ${now}`, '---', '', SCENE_BODY, ''].join('\n'),
  );
  const manifest = {
    schemaVersion: 1,
    stories: [
      {
        id: STORY_ID,
        title: 'Prism Story',
        path: `stories/${STORY_ID}`,
        chapters: [
          {
            id: CHAPTER_ID,
            title: 'Chapter One',
            path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`,
            order: 0,
            scenes: [
              {
                id: SCENE_ID,
                title: SCENE_TITLE,
                path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`,
                order: 0,
                chapterId: CHAPTER_ID,
                storyId: STORY_ID,
                blocks: [{ id: 'prism-block-0001', type: 'prose', content: SCENE_BODY, order: 0, updatedAt: now }],
                draftState: 'in-progress',
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
  fs.writeFileSync(path.join(s.vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

async function launch(s: Scratch): Promise<{ app: ElectronApplication; page: Page }> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${s.userData}`, '--no-sandbox', '--force-prefers-reduced-motion', ...extraArgs],
    timeout: 60_000,
  });
  const page = await firstWindow(app);
  return { app, page };
}

async function openScene(page: Page): Promise<void> {
  await clickStoryNav(page);
  await page.locator('[data-testid="story-subview-editor"]').click();
  const sceneRow = page.locator('.nav-scene-row', { hasText: SCENE_TITLE });
  await expect(sceneRow).toBeVisible({ timeout: 20_000 });
  await sceneRow.click();
  await expect(page.locator('.ProseMirror')).toContainText('Hold the light steady', { timeout: 10_000 });
}

function prismFile(s: Scratch): string {
  return path.join(s.vaultDir, 'stories', STORY_ID, 'prism.json');
}

function readPrismFile(s: Scratch): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(prismFile(s), 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

test.describe('Prism rule-only prose checks (#1764)', () => {
  let scratch: Scratch | undefined;
  let app: ElectronApplication | undefined;

  test.afterEach(async () => {
    await closeElectronApp(app);
    app = undefined;
    if (scratch) removeTempDirs(scratch.userData, scratch.vaultDir, scratch.notesVaultDir);
    scratch = undefined;
  });

  test('TC-PR-01 flags, per-check hide, go-to, prose colors and per-book persistence with AI off', async () => {
    test.setTimeout(150_000);
    scratch = makeScratch('prism');
    seed(scratch);
    expect(fs.existsSync(prismFile(scratch))).toBe(false);

    let page: Page;
    ({ app, page } = await launch(scratch));
    await openScene(page);
    const editor = page.locator('.ProseMirror');

    // Fresh profile: display is off, but detection runs and the checklist counts.
    const zone = page.locator('[data-testid="lr-analytics-zone"]');
    await expect(zone).toBeVisible();
    await expect(zone.locator('[data-testid="prism-checklist"]')).toBeVisible();
    await expect(page.locator('[data-testid="prism-count-crutch-words"]')).toHaveText(/[1-9]/, { timeout: 10_000 });
    await expect(editor.locator('.prism-flag')).toHaveCount(0);
    await expect(editor.locator('.prism-tint')).toHaveCount(0);

    // Flags on → underlines on the seeded prose.
    await page.locator('[data-testid="prism-master-flags"]').click();
    await expect(editor.locator('.prism-flag--crutch-words').first()).toHaveText(/just/i);
    await expect(editor.locator('.prism-flag--adverbs').first()).toHaveText(/quickly/i);
    await expect(editor.locator('.prism-flag--passive-voice').first()).toHaveText(/was taken/i);
    await expect(editor.locator('.prism-flag--filter-words').first()).toHaveText(/felt/i);

    // One check off → only its marks hide and it leaves the list.
    await page.locator('[data-testid="prism-check-toggle-crutch-words"]').click();
    await expect(editor.locator('.prism-flag--crutch-words')).toHaveCount(0);
    await expect(page.locator('[data-testid="prism-count-crutch-words"]')).toHaveText(/off/i);
    await expect(page.locator('[data-testid="prism-item-crutch-words"]')).toHaveCount(0);
    await expect(editor.locator('.prism-flag--adverbs').first()).toBeVisible();

    // "Go to" selects the flagged words in the manuscript; the writer edits.
    await page.locator('[data-testid="prism-expand-adverbs"]').click();
    const item = page.locator('[data-testid="prism-item-adverbs"]').first();
    await expect(item).toHaveAccessibleName(/^Go to: .*quickly/i);
    await item.click();
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
      .toMatch(/^quickly$/i);

    // Prose colors → dialogue tint.
    await page.locator('[data-testid="prism-master-prose-colors"]').click();
    await expect(editor.locator('.prism-tint--dialogue').first()).toContainText('Hold the light steady');

    // The choices are saved per book in the story folder.
    await expect
      .poll(() => readPrismFile(scratch!), { timeout: 10_000 })
      .toMatchObject({ flags: true, proseColors: true, checks: { 'crutch-words': false, adverbs: true } });

    // Relaunch: the book's saved config comes back without any clicks.
    await closeElectronApp(app);
    ({ app, page } = await launch(scratch));
    await openScene(page);
    const editor2 = page.locator('.ProseMirror');
    await expect(editor2.locator('.prism-flag--adverbs').first()).toHaveText(/quickly/i, { timeout: 10_000 });
    await expect(editor2.locator('.prism-flag--crutch-words')).toHaveCount(0);
    await expect(editor2.locator('.prism-tint--dialogue').first()).toBeVisible();
  });
});
