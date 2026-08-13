/**
 * create-story-instant.spec.ts — SKY-9021 (EPIC M3: Create story → instantly writable)
 *
 * Fidelity-rebuild M3 (plans/fidelity-rebuild/PLAN.md): the create-story action
 * — from ANY entry point — creates, in one transaction, story + Part 1
 * (title: "") + "Chapter 1" + one untitled scene, opens the Story Writer at
 * Full Book depth, and places the caret in the empty scene's first paragraph
 * (placeholder "Start writing…"). No dialog, modal, toast, or wizard may
 * interpose between the click and the caret.
 *
 * Coverage:
 *   AC1        Navigator "+" → keyboard.type('hello') with zero interposed
 *              clicks → prose on disk in the new scene's .md; manifest holds
 *              the exact v3 scaffold (Part "" → Chapter 1 → Untitled Scene).
 *   AC2        Post-create state: Full Book depth active, caret in the
 *              paragraph contenteditable, placeholder "Start writing…",
 *              row-3 scope title shows "Untitled Story" and is editable.
 *   Row-3      Inline story rename commits to manifest.json on Enter.
 *   AC3        Parity: empty-state CTA, File-menu "New story", and nav-rail
 *              "New Story" all produce the identical instant scaffold at
 *              Full Book depth (the nav-rail path must NOT open the old
 *              NewStoryWizard).
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/create-story-instant.spec.ts --reporter=list
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
import { closeElectronApp, removeTempDirs } from './helpers/electronTeardown';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
// U+2026 HORIZONTAL ELLIPSIS — the placeholder must use the real character.
const PLACEHOLDER = 'Start writing…';

// ─── Seeding ──────────────────────────────────────────────────────────────────

/**
 * Seed userData so the app boots straight into DesktopShell with a valid but
 * EMPTY Story Vault (`layoutMode: 'blank'` skips the "My First Story"
 * scaffold), so both the navigator "+" and the editor empty-state CTA render.
 */
function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    // 'skip' keeps post-onboarding surfaces (Getting Started panel, template
    // CTA) out of the shell — M3 asserts nothing interposes before the caret.
    onboardingStartMode: 'skip',
    agents: {
      writingAssistant: {
        enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: false, model: 'claude-sonnet-4-6', autoApply: false,
        confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
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
  const vaultSettings = {
    vaultRoot: vaultDir,
    notesVaultRoot: notesVaultDir,
    layoutMode: 'blank',
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

// ─── Launch helpers ───────────────────────────────────────────────────────────

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
  const proc = app.process();
  proc.stdout?.on('data', (d: Buffer) => console.log('[main:out]', d.toString().trimEnd()));
  proc.stderr?.on('data', (d: Buffer) => console.log('[main:err]', d.toString().trimEnd()));
  return app;
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  pg.on('console', (m) => console.log('[renderer:' + m.type() + ']', m.text()));
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

async function waitForShell(pg: Page): Promise<void> {
  await expect(pg.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
}

/** Expand the Story Navigator panel if it is collapsed (SKY-1694 panel zone). */
async function ensureStoriesPanel(pg: Page): Promise<void> {
  const storiesPanel = pg.locator('[data-panel-id="stories"]');
  if (await storiesPanel.isVisible().catch(() => false)) {
    const isCollapsed = await storiesPanel
      .evaluate((el) => el.classList.contains('lr-panel--collapsed'))
      .catch(() => false);
    if (isCollapsed) await storiesPanel.locator('.lr-panel-collapse-btn').click();
  }
}

// ─── Instant-create helpers ───────────────────────────────────────────────────

/**
 * Wait for the caret to land in the new scene's paragraph contenteditable.
 * This is a passive wait (no click, no keypress, no dismissal) — it exists
 * only because CI under xvfb needs time for the create transaction + render;
 * it is NOT an "interposed interaction" in the AC1 sense.
 */
async function waitForWriterCaret(pg: Page): Promise<void> {
  await pg.waitForFunction(
    () => (document.activeElement?.getAttribute('data-testid') ?? '').startsWith('msv-para-'),
    undefined,
    { timeout: 20_000 },
  );
}

/**
 * M3: nothing may interpose between click and caret — no useTextPrompt modal
 * (.prompt-modal-overlay), no NewStoryWizard (nsw-create), no toast (ln-toast).
 */
async function expectNoInterposedSurfaces(pg: Page): Promise<void> {
  await expect(pg.locator('.prompt-modal-overlay')).toHaveCount(0);
  await expect(pg.locator('[data-testid="nsw-create"]')).toHaveCount(0);
  await expect(pg.locator('[data-testid="ln-toast"]')).toHaveCount(0);
}

/** Commit the typed prose: ParagraphRow commits on BLUR (not on a click). */
async function blurActiveParagraph(pg: Page): Promise<void> {
  await pg.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

// ─── Disk-side helpers ────────────────────────────────────────────────────────

interface ManifestChapter {
  id: string;
  title: string;
  scenes: Array<{ id: string; title: string; path: string }>;
}
interface ManifestStory {
  id: string;
  title: string;
  chapters: ManifestChapter[];
  parts?: Array<{
    title: string;
    order: number;
    note?: unknown[];
    chapters: ManifestChapter[];
  }>;
}

function readManifest(vaultDir: string): { stories: ManifestStory[] } | null {
  const manifestPath = path.join(vaultDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { stories: ManifestStory[] };
  } catch {
    return null; // mid-write — caller polls
  }
}

/** All chapters of a story regardless of tier (v3: parts[0].chapters). */
function storyChapters(story: ManifestStory): ManifestChapter[] {
  return story.parts?.length ? story.parts.flatMap((p) => p.chapters) : story.chapters;
}

/** Absolute path of the story's first scene .md, from the manifest's own path. */
function firstScenePath(vaultDir: string, story: ManifestStory): string | null {
  const scene = storyChapters(story)[0]?.scenes[0];
  return scene?.path ? path.join(vaultDir, scene.path) : null;
}

/**
 * Poll the vault on disk until a story exists whose first scene's .md contains
 * `word` (scene .md is written on blur; manifest follows a ~900 ms debounce).
 */
async function findStoryWithProse(
  vaultDir: string,
  word: string,
  timeoutMs = 20_000,
): Promise<ManifestStory> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const manifest = readManifest(vaultDir);
    for (const story of manifest?.stories ?? []) {
      const scenePath = firstScenePath(vaultDir, story);
      if (scenePath && fs.existsSync(scenePath)) {
        try {
          if (fs.readFileSync(scenePath, 'utf-8').includes(word)) return story;
        } catch {
          /* mid-write — retry */
        }
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No story scene .md containing "${word}" appeared in ${vaultDir} within ${timeoutMs}ms`);
}

/**
 * M3 scaffold contract, asserted for EVERY entry point (AC3: identical shape):
 * parts = [{ title: '', order: 0, note: [], chapters: [Chapter 1] }], the one
 * chapter titled 'Chapter 1' with exactly one scene 'Untitled Scene', and
 * story.chapters mirroring parts[0].chapters (v3 migration shape).
 */
function assertScaffold(story: ManifestStory): void {
  expect(story.title, 'new story title').toMatch(/^Untitled Story/);
  expect(story.parts, 'story.parts must exist (schema v3)').toBeDefined();
  expect(story.parts).toHaveLength(1);
  const part = story.parts![0];
  expect(part.title, 'Part 1 is unnamed').toBe('');
  expect(part.order).toBe(0);
  expect(Array.isArray(part.note), 'part.note is an array').toBe(true);
  expect(part.chapters).toHaveLength(1);
  const chapter = part.chapters[0];
  expect(chapter.title).toBe('Chapter 1');
  expect(chapter.scenes).toHaveLength(1);
  const scene = chapter.scenes[0];
  expect(scene.title).toBe('Untitled Scene');
  expect(scene.path).toMatch(/^stories\/[^/]+\/chapters\/[^/]+\/scenes\/[^/]+\.md$/);
  // story.chapters mirrors parts[0].chapters — same single chapter.
  expect(story.chapters).toHaveLength(1);
  expect(story.chapters[0].id).toBe(chapter.id);
}

async function expectFullBookDepth(pg: Page): Promise<void> {
  await expect(pg.locator('[data-testid="msv-zoom-book"]')).toHaveClass(/msv-zoom-opt--active/, {
    timeout: 15_000,
  });
}

/**
 * Shared parity flow (AC3): the entry point was just clicked — wait for the
 * caret, verify nothing interposed, type a unique word, commit via blur, and
 * verify the scaffold + prose on disk and Full Book depth in the UI.
 */
async function verifyInstantCreate(pg: Page, vaultDir: string, word: string): Promise<void> {
  await waitForWriterCaret(pg);
  await expectNoInterposedSurfaces(pg);
  await pg.keyboard.type(word);
  await blurActiveParagraph(pg);
  const story = await findStoryWithProse(vaultDir, word);
  assertScaffold(story);
  await expectFullBookDepth(pg);
}

// ═══ Suite 1: AC1 + AC2 + row-3 rename (navigator "+") ════════════════════════

test.describe('M3: create story → instantly writable (navigator +)', () => {
  let userData: string;
  let vaultDir: string;
  let notesVaultDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m3-instant-ud-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m3-instant-story-'));
    notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m3-instant-notes-'));
    seedUserData(userData, vaultDir, notesVaultDir);
    app = await launchApp(userData);
    page = await firstWindow(app);
    await waitForShell(page);
  });

  test.afterAll(async () => {
    await closeElectronApp(app);
    removeTempDirs(userData, vaultDir, notesVaultDir);
  });

  test('AC1: navigator + → type "hello" with zero interposed clicks → prose + scaffold on disk', async () => {
    await ensureStoriesPanel(page);

    // M6/GAP-3: StoryNavigator's own header is hidden (hideHeader) — LeftRail's
    // .lr-nav-add is now the only "New story" entry point.
    const addBtn = page.locator('.lr-nav-add');
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await expectNoInterposedSurfaces(page);

    await addBtn.click();

    // Click → caret with NO other interaction: the only thing between the
    // click and keyboard.type below is a passive wait for the caret to land.
    await waitForWriterCaret(page);
    await expectNoInterposedSurfaces(page);

    await page.keyboard.type('hello');

    // Still nothing interposed after typing (a toast lingers ~2.5 s, so this
    // also catches one fired by the create action itself).
    await expectNoInterposedSurfaces(page);

    // Text commits on BLUR (ParagraphRow onBlur → onCommit) — not on a click.
    await blurActiveParagraph(page);

    // Scene .md is written immediately on commit; manifest follows a ~900 ms
    // debounce. Poll disk for both.
    const story = await findStoryWithProse(vaultDir, 'hello');
    expect(story.title).toBe('Untitled Story');
    assertScaffold(story);
  });

  test('AC2: new story lands at Full Book depth with caret in the placeholder paragraph', async () => {
    // Create a second story from the same entry point and inspect the
    // freshly-created state (AC1 above already blurred its story's caret).
    await ensureStoriesPanel(page);
    await page.locator('.lr-nav-add').click();
    await waitForWriterCaret(page);

    // Full Book depth every time.
    await expectFullBookDepth(page);

    // Caret: document.activeElement is the paragraph contenteditable.
    const activeTestId = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') ?? '',
    );
    expect(activeTestId).toMatch(/^msv-para-/);

    // Placeholder "Start writing…" (U+2026) on the active paragraph.
    const placeholder = await page.evaluate(
      () => document.activeElement?.getAttribute('data-placeholder') ?? '',
    );
    expect(placeholder).toBe(PLACEHOLDER);

    // The new story renders exactly one (empty) paragraph block.
    const paras = page.locator('[data-testid^="msv-para-"]');
    await expect(paras.first()).toBeVisible({ timeout: 10_000 });
    await expect(paras).toHaveCount(1);

    // Row 3: scope title shows the new story's title and is editable inline.
    const scopeTitle = page.locator('[data-testid="msv-scope-title"]');
    await expect(scopeTitle).toBeVisible({ timeout: 10_000 });
    await expect(scopeTitle).toContainText('Untitled Story');
    await expect(scopeTitle).toHaveAttribute('contenteditable', /^(true|plaintext-only)$/);
  });

  test('Row 3: inline story rename commits to manifest.json on Enter', async () => {
    const NEW_TITLE = 'Renamed Chronicle';

    const scopeTitle = page.locator('[data-testid="msv-scope-title"]');
    await expect(scopeTitle).toBeVisible({ timeout: 10_000 });
    await scopeTitle.click();
    // Replace the whole title (contenteditable keeps existing text on click).
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(NEW_TITLE);
    await page.keyboard.press('Enter');

    // Rename commits on Enter; manifest write is debounced ~900 ms — poll.
    const deadline = Date.now() + 10_000;
    let renamed: ManifestStory | undefined;
    while (Date.now() < deadline && !renamed) {
      renamed = readManifest(vaultDir)?.stories.find((s) => s.title === NEW_TITLE);
      if (!renamed) await new Promise((r) => setTimeout(r, 200));
    }
    expect(renamed, `manifest.json story renamed to "${NEW_TITLE}"`).toBeDefined();
    // The rename must not disturb the scaffold.
    expect(storyChapters(renamed!)[0]?.title).toBe('Chapter 1');
  });
});

// ═══ Suite 2: AC3 — every remaining entry point behaves identically ═══════════

test.describe('M3-AC3: create-story entry-point parity', () => {
  let userData: string;
  let vaultDir: string;
  let notesVaultDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m3-parity-ud-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m3-parity-story-'));
    notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m3-parity-notes-'));
    seedUserData(userData, vaultDir, notesVaultDir);
    app = await launchApp(userData);
    page = await firstWindow(app);
    await waitForShell(page);
  });

  test.afterAll(async () => {
    await closeElectronApp(app);
    removeTempDirs(userData, vaultDir, notesVaultDir);
  });

  test('editor empty-state CTA creates the identical instant scaffold', async () => {
    // Only rendered while the vault has zero stories — must run first.
    const cta = page.locator('[data-testid="shell-empty-new-story"]');
    await expect(cta).toBeVisible({ timeout: 10_000 });
    await cta.click();
    await verifyInstantCreate(page, vaultDir, 'ctaparityprose');
  });

  test('File menu → "New story" creates the identical instant scaffold', async () => {
    await page.locator('[data-testid="wc-menu-file"]').click();
    const item = page.getByRole('menuitem', { name: /^New story/ });
    await expect(item).toBeVisible({ timeout: 6_000 });
    await item.click();
    await verifyInstantCreate(page, vaultDir, 'filemenuparityprose');
  });

  test('nav rail "New Story" creates the identical instant scaffold (no wizard)', async () => {
    // The rail's New Story button lives in the Stories popover, which opens by
    // re-clicking the active Story Writer rail item (AppNavRail pick()); a
    // first click may only navigate to the module, so click again if needed.
    const rail = page.getByRole('navigation', { name: 'Main navigation' });
    const railStoryItem = rail.getByRole('button', { name: 'Story Writer' });
    const railNewStory = page.locator('[data-testid="nav-rail-new-story"]');

    await railStoryItem.click();
    try {
      await railNewStory.waitFor({ state: 'visible', timeout: 2_500 });
    } catch {
      await railStoryItem.click(); // first click navigated; this one opens the popover
    }
    await expect(railNewStory).toBeVisible({ timeout: 6_000 });
    await railNewStory.click();

    // This entry point used to open NewStoryWizard — it must not any more
    // (verifyInstantCreate also asserts nsw-create/prompt/toast count 0).
    await verifyInstantCreate(page, vaultDir, 'railparityprose');

    // AC3: all three stories in this vault share the identical scaffold shape.
    const manifest = readManifest(vaultDir);
    expect(manifest?.stories).toHaveLength(3);
    for (const story of manifest!.stories) assertScaffold(story);
  });
});
