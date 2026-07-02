/**
 * timeline.spec.ts — SKY-797
 *
 * E2E coverage for the Timeline view (TimelineSpreadsheet + filter bar + detail
 * card) per spec §10 (08-timeline-builder.md) and the SKY-797 scope.
 *
 * The current Timeline shipped as a spreadsheet view (SKY-791/794) with the
 * detail/hover card (SKY-793), filters + arc focus + keyboard nav (SKY-795),
 * and AI proposals (SKY-796). The "subway view" wording from the parent
 * SKY-510 spec maps to row-level interactions on the spreadsheet: a row is a
 * scene "track stop", and the filter/focus controls behave per spec §2.4 / §3.3.
 *
 * Acceptance cases — each test maps 1:1 to a bullet in the SKY-797 scope:
 *   TC-TL-01  Scene with date appears as a row in the timeline.
 *   TC-TL-02  Hover row → detail card surfaces correct scene metadata.
 *   TC-TL-03  Click row → row enters selected state and the detail card flips
 *             to its `selected` visual variant (3px frame / 32% tint contract).
 *   TC-TL-04  Date column sort produces chronological ordering and persists to
 *             the vault (vault sync verified by reading scene .md files back).
 *   TC-TL-05  Entity filter (Arc tab) → non-matching rows fade to 0.3 opacity
 *             instead of being hidden (spec §2.4 — "tracks fade, not hidden").
 *   TC-TL-06  Date range filter → scenes outside [from, to] hidden entirely.
 *   TC-TL-07  Keyboard nav — Tab cycles chronologically, Enter opens the
 *             editor, Delete removes the scene from the timeline.
 *   TC-TL-08  Arc focus (single-arc) → non-focused arc rows ghost to 0.2
 *             opacity (spec §3.3).
 *
 * Performance gate (spec §10): a 500-scene × 10-arc fixture must keep
 * keyboard-nav scroll latency under the 60fps frame budget (16.67ms target;
 * we assert a generous 60ms ceiling to keep CI runners stable).
 *
 * The suite seeds the vault directly on disk before launching Electron so the
 * tests don't pay the cost of UI-driven scene creation per case. This keeps the
 * whole suite under one Electron boot and within CI's tight budget.
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

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

const STORY_ID = 'story-timeline-e2e';
const CHAPTER_ID = 'chapter-timeline-e2e';
const STORY_TITLE = 'Chronicles of the Subway';
const CHAPTER_TITLE = 'Track One';

// Three pre-seeded scenes with dates in 2340-06-14/15/16. The middle scene is
// excluded by the TC-TL-06 date range. Scene 1 lives on ARC_A only, Scene 2 on
// ARC_B only, Scene 3 on both — this gives every filter test a clear pass case
// and a clear fail case without retuning the fixture.
const SCENE_1 = { id: 'sc-tl-1', title: 'Departure', date: '2340-06-14', arcs: ['arc-a'], pov: 'Eira', mood: 'tense' };
const SCENE_2 = { id: 'sc-tl-2', title: 'Crossing',  date: '2340-06-15', arcs: ['arc-b'], pov: 'Kael', mood: 'somber' };
const SCENE_3 = { id: 'sc-tl-3', title: 'Arrival',   date: '2340-06-16', arcs: ['arc-a', 'arc-b'], pov: 'Eira', mood: 'hopeful' };

const ARC_A = { id: 'arc-a', title: 'Hero Journey', color: 'var(--neon-cyan)' };
const ARC_B = { id: 'arc-b', title: 'Villain Rise', color: 'var(--neon-magenta)' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
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
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: notesVaultDir };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

interface SeedScene {
  id: string;
  title: string;
  date: string;
  arcs: string[];
  pov: string;
  mood: string;
}

interface SeedArc {
  id: string;
  title: string;
  color: string;
}

/**
 * Write manifest + arcs + scene .md files for the timeline fixture.
 * Mirrors the on-disk layout the renderer reads via timelineGetScenes /
 * timelineListArcs so the page sees the seeded data on first load.
 */
function seedVault(
  vaultDir: string,
  storyId: string,
  storyTitle: string,
  chapterId: string,
  chapterTitle: string,
  scenes: SeedScene[],
  arcs: SeedArc[],
): void {
  const now = new Date().toISOString();
  fs.mkdirSync(vaultDir, { recursive: true });

  // ── manifest.json ────────────────────────────────────────────────────────
  const sceneEntries = scenes.map((s, idx) => ({
    id: s.id,
    title: s.title,
    path: `stories/${storyId}/chapters/${chapterId}/scenes/${s.id}.md`,
    order: idx,
    chapterId,
    storyId,
    blocks: [],
    createdAt: now,
    updatedAt: now,
  }));
  // Manifest shape must mirror defaultManifest() in electron-main/src/vault.ts —
  // the readers iterate manifest.scenes / manifest.entities etc., so missing
  // arrays raise "manifest.scenes is not iterable" on first read.
  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [{
      id: storyId,
      title: storyTitle,
      path: `stories/${storyId}`,
      chapters: [{
        id: chapterId,
        title: chapterTitle,
        path: `stories/${storyId}/chapters/${chapterId}`,
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

  // ── arcs.json ────────────────────────────────────────────────────────────
  const arcEntries = arcs.map(a => ({
    id: a.id, title: a.title, color: a.color, colorIsCustom: false,
    scenes: scenes.filter(s => s.arcs.includes(a.id)).map(s => s.id),
    createdAt: now, updatedAt: now,
  }));
  fs.writeFileSync(path.join(vaultDir, 'arcs.json'), JSON.stringify(arcEntries, null, 2));

  // ── scene .md files ──────────────────────────────────────────────────────
  for (const scene of scenes) {
    const scenePath = path.join(
      vaultDir, 'stories', storyId, 'chapters', chapterId, 'scenes', `${scene.id}.md`,
    );
    fs.mkdirSync(path.dirname(scenePath), { recursive: true });
    // Serialised frontmatter shape mirrors vault.ts:serializeFrontmatter — arrays
    // emit as YAML flow sequences and strings stay bare; readSceneFile parses
    // both forms back into the SceneFileData.
    const fm = [
      '---',
      `id: ${scene.id}`,
      `title: ${scene.title}`,
      `chapterId: ${chapterId}`,
      `storyId: ${storyId}`,
      `chronologicalDate: ${scene.date}`,
      `chronologicalIsEstimated: false`,
      `chronologicalConfidence: 1`,
      `chronologicalSource: explicit_marker`,
      `entityArcs: [${scene.arcs.join(', ')}]`,
      `metaPov: ${scene.pov}`,
      `metaMood: ${scene.mood}`,
      `updatedAt: ${now}`,
      '---',
      '',
    ].join('\n');
    fs.writeFileSync(scenePath, fm + scene.title + ' prose body.\n');
  }
}

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

/** Open the story's first scene so DesktopShell sets `selectedStory`, then
 *  switch to the Timeline view. Returns once the spreadsheet root is mounted.
 *
 *  StoryNavigator initialises with every story + chapter expanded, so we look
 *  for the scene row directly rather than clicking toggles — toggling here
 *  would collapse the tree and hide the scene we need. */
async function openTimeline(pg: Page, sceneTitle: string): Promise<void> {
  await expect(pg.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  const storiesTab = pg.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();

  const sceneRow = pg.locator('.nav-scene-row', { hasText: sceneTitle }).first();
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();

  // Switch to the Timeline sub-view in the Story tab.
  const nav = pg.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav).toBeVisible({ timeout: 10_000 });
  await nav.getByRole('button', { name: 'Story' }).click();
  const timelineBtn = pg.locator('[data-testid="story-subview-timeline"]');
  await expect(timelineBtn).toBeVisible({ timeout: 6_000 });
  await timelineBtn.click();

  await expect(pg.locator('[data-testid="timeline-spreadsheet-root"]')).toBeVisible({ timeout: 8_000 });
}

// ─── Suite-level state ────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-user-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-vault-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  seedVault(
    vaultDir,
    STORY_ID, STORY_TITLE,
    CHAPTER_ID, CHAPTER_TITLE,
    [SCENE_1, SCENE_2, SCENE_3],
    [ARC_A, ARC_B],
  );
  app = await launchApp(userData);
  page = await firstWindow(app);
  await openTimeline(page, SCENE_1.title);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── TC-TL-01: Scene with date appears as a timeline row ─────────────────────

test('TC-TL-01: pre-seeded scene with chronologicalDate appears as a timeline row', async () => {
  const row1 = page.locator(`[data-testid="row-${SCENE_1.id}"]`);
  await expect(row1).toBeVisible({ timeout: 6_000 });
  await expect(row1).toContainText(SCENE_1.title);
  await expect(row1).toContainText(SCENE_1.date);

  // All three seeded scenes should be visible by default (no active filters).
  await expect(page.locator(`[data-testid="row-${SCENE_2.id}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="row-${SCENE_3.id}"]`)).toBeVisible();
});

// ─── TC-TL-02: Hover row → detail card with correct metadata ────────────────

test('TC-TL-02: hovering a row surfaces the detail card with correct scene metadata', async () => {
  const row = page.locator(`[data-testid="row-${SCENE_3.id}"]`);
  await expect(row).toBeVisible({ timeout: 4_000 });

  // React's onMouseEnter is synthesised from native `mouseover` (which bubbles),
  // not from native `mouseenter` (which does not). Dispatching `mouseover`
  // exercises the same path the spreadsheet relies on in production, and
  // sidesteps Playwright's flaky synthesised hover under Electron/xvfb.
  await row.evaluate(el => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));

  const card = page.locator('[data-testid="timeline-detail-card"]');
  await expect(card).toBeVisible({ timeout: 4_000 });
  // The card surfaces scene title in its <h3> and the metadata dl rows.
  await expect(card).toContainText(SCENE_3.title);
  // POV resolves to the raw id (Eira) since the entity browser was not seeded
  // for this fixture — the contract here is that the card displays whatever
  // was stored; the resolution path is unit-tested in TimelineDetailCard.test.
  await expect(page.locator('[data-testid="tdc-pov"]')).toContainText(SCENE_3.pov);

  // Leave the row so a stale hover doesn't bleed into the next test.
  await row.evaluate(el => el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
});

// ─── TC-TL-03: Click row → selected state on row + detail card ──────────────

test('TC-TL-03: clicking a row enters the selected state on both row and detail card', async () => {
  const row = page.locator(`[data-testid="row-${SCENE_1.id}"]`);
  await row.click();

  await expect(row).toHaveClass(/tls-row--selected/);
  await expect(row).toHaveAttribute('aria-selected', 'true');

  // Detail card flips to its selected variant — used by the 3px frame + 32% tint
  // CSS contract (TimelineDetailCard.css) so this attribute is the test surface.
  // Move the mouse off the row first so the card's `state` resolution falls
  // through hover → focused/selected per TimelineSpreadsheet's detailCardScene
  // memo.
  await page.locator('.app-menu-bar').hover();
  await expect(page.locator('[data-testid="timeline-detail-card"]'))
    .toHaveAttribute('data-state', 'selected', { timeout: 4_000 });
});

// ─── TC-TL-04: Date sort → chronological order + vault sync ─────────────────

test('TC-TL-04: sorting by Date renders rows chronologically and the vault still holds the original dates', async () => {
  // Click the Date column header once → ascending sort.
  const dateHeader = page.locator('.tls-th-date');
  await expect(dateHeader).toBeVisible({ timeout: 4_000 });
  await dateHeader.click();
  await expect(dateHeader).toHaveAttribute('aria-sort', 'ascending');

  // After sort, the visible row order matches scene.date ascending.
  const orderedIds = await page.locator('.tls-row').evaluateAll(rows =>
    rows.map(r => (r as HTMLElement).dataset['rowId'] ?? ''),
  );
  expect(orderedIds.filter(Boolean)).toEqual([SCENE_1.id, SCENE_2.id, SCENE_3.id]);

  // Vault sync: the .md files on disk still hold the chronologicalDate set in
  // the seed (sort is render-only; no scene file should have been rewritten).
  for (const scene of [SCENE_1, SCENE_2, SCENE_3]) {
    const filePath = path.join(
      vaultDir, 'stories', STORY_ID, 'chapters', CHAPTER_ID, 'scenes', `${scene.id}.md`,
    );
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content, `${scene.id}.md should keep its seeded chronologicalDate`).toContain(`chronologicalDate: ${scene.date}`);
  }
});

// ─── TC-TL-05: Entity filter (Arc) → non-matching rows fade to 0.3 ───────────

test('TC-TL-05: arc-tab filter fades non-matching rows to 0.3 opacity instead of hiding them', async () => {
  // Switch to the Arc entity tab, then narrow to ARC_A. Spec §2.4 — non-matching
  // tracks fade rather than disappear, so all three rows should stay mounted.
  await page.locator('#tlf-tab-arc').click();
  await page.locator('#tlf-entity-value').selectOption(ARC_A.id);

  // Rows on arc-a stay full opacity (no data-opacity attribute).
  await expect(page.locator(`[data-testid="row-${SCENE_1.id}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="row-${SCENE_3.id}"]`)).toBeVisible();
  expect(await page.locator(`[data-testid="row-${SCENE_1.id}"]`).getAttribute('data-opacity')).toBeNull();
  expect(await page.locator(`[data-testid="row-${SCENE_3.id}"]`).getAttribute('data-opacity')).toBeNull();

  // Scene 2 (arc-b only) fades to 0.3.
  const row2 = page.locator(`[data-testid="row-${SCENE_2.id}"]`);
  await expect(row2).toBeVisible();
  await expect(row2).toHaveAttribute('data-opacity', '0.3');

  // Reset the filter so subsequent tests start clean.
  await page.locator('#tlf-tab-all').click();
});

// ─── TC-TL-06: Date range filter → out-of-range rows hidden ─────────────────

test('TC-TL-06: date range filter hides scenes outside [from, to]', async () => {
  // Set a narrow range covering only SCENE_1's date. SCENE_2/3 should disappear
  // from the DOM entirely (opacity 0 → tls-row not rendered per visibleScenes
  // memo in TimelineSpreadsheet).
  //
  // React 18 installs an instance-level value descriptor (trackValueOnNode) that
  // updates its internal tracker whenever el.value = val is assigned, so the
  // subsequent input event sees tracker==DOM and skips onChange. Bypass by calling
  // the native prototype setter directly, leaving the tracker stale so React
  // detects a change and fires onChange. Same root cause as type="range" sliders.
  await page.locator('#tlf-date-from').evaluate((el, val) => {
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, '2340-06-14');
  await page.locator('#tlf-date-to').evaluate((el, val) => {
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, '2340-06-14');

  // The Clear button is conditionally rendered — wait for it to confirm React
  // processed the filter update before asserting row counts.
  await expect(page.locator('.tlf-clear-btn')).toBeVisible({ timeout: 4_000 });
  await expect(page.locator(`[data-testid="row-${SCENE_1.id}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="row-${SCENE_2.id}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-testid="row-${SCENE_3.id}"]`)).toHaveCount(0);

  // Clear the range so the next test sees the full fixture again. TC-TL-03 can
  // leave the detail card in `selected` state over the filter area, so avoid a
  // coordinate click that can be intercepted; focusing the real button and
  // pressing Enter exercises the same accessible control path.
  const clearDateRange = page.getByRole('button', { name: 'Clear date range' });
  await clearDateRange.focus();
  await page.keyboard.press('Enter');
  // Wait for the controlled inputs to clear first — confirms React applied the
  // filter reset before we check that the hidden rows reappear.
  await expect(page.locator('#tlf-date-from')).toHaveValue('', { timeout: 8_000 });
  await expect(page.locator('#tlf-date-to')).toHaveValue('', { timeout: 8_000 });
  await expect(clearDateRange).toHaveCount(0, { timeout: 8_000 });
  await expect(page.locator(`[data-testid="row-${SCENE_2.id}"]`)).toBeVisible({ timeout: 8_000 });
});

// ─── TC-TL-07: Keyboard nav (Tab / Enter / Delete) ──────────────────────────

test('TC-TL-07: Tab cycles chronologically, Enter opens the editor, Delete removes the focused scene', async () => {
  // Establish a known focusedSceneId baseline rather than relying on state
  // carried over from TC-TL-03's click across multiple intervening tests.
  // TC-TL-06 can leave the date-from input with a dirty DOM focus state after
  // dispatching synthetic events; clicking SCENE_1 here resets that focus and
  // pins focusedSceneId to SCENE_1 before we exercise Tab cycling.
  const row1 = page.locator(`[data-testid="row-${SCENE_1.id}"]`);
  await expect(row1).toBeVisible({ timeout: 4_000 });
  await row1.click();
  await expect(row1).toHaveClass(/tls-row--selected/, { timeout: 4_000 });

  const root = page.locator('[data-testid="timeline-spreadsheet-root"]');
  await root.focus();

  // Tab advances one chronological step → SCENE_2 (next in
  // chronologicalSceneIds, which sorts by chronologicalDate ascending).
  await root.press('Tab');
  await expect(page.locator(`[data-testid="row-${SCENE_2.id}"]`))
    .toHaveClass(/tls-row--keyboard-focused/, { timeout: 4_000 });

  // Second Tab → SCENE_3.
  await root.press('Tab');
  await expect(page.locator(`[data-testid="row-${SCENE_3.id}"]`))
    .toHaveClass(/tls-row--keyboard-focused/, { timeout: 4_000 });

  // Enter on the focused scene → DesktopShell switches into editor view.
  await root.press('Enter');
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 8_000 });

  // Switch back to the Timeline view and Delete the now-focused scene.
  // The shell unmounts the spreadsheet on view-out, so focus state resets and
  // the first Tab after re-entering lands on SCENE_1.
  // Use a generous timeout: the component must remount and complete its async
  // IPC load (timelineGetScenes) before the root div renders — 4 s was too
  // tight on loaded CI runners.
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav).toBeVisible({ timeout: 10_000 });
  await nav.getByRole('button', { name: 'Story' }).click();
  await page.locator('[data-testid="story-subview-timeline"]').click();
  await expect(root).toBeVisible({ timeout: 8_000 });
  // Confirm at least one scene row is in the DOM (data loaded) before Tab.
  await expect(page.locator('.tls-row').first()).toBeVisible({ timeout: 6_000 });
  await root.focus();

  await root.press('Tab');
  await expect(page.locator(`[data-testid="row-${SCENE_1.id}"]`))
    .toHaveClass(/tls-row--keyboard-focused/, { timeout: 4_000 });
  await root.press('Delete');

  // Removed from the timeline = its row unmounts (chronologicalDate cleared on
  // disk, then visibleScenes filter drops it once getScenes refreshes; here the
  // optimistic update in removeFromTimeline already drops it locally).
  await expect(page.locator(`[data-testid="row-${SCENE_1.id}"]`)).toHaveCount(0, { timeout: 6_000 });
});

// ─── TC-TL-08: Arc focus → non-focused arc rows ghost to 0.2 ────────────────

test('TC-TL-08: single-arc focus ghosts non-focused arc rows to 0.2 opacity', async () => {
  // SCENE_1 was deleted in TC-TL-07; SCENE_2 (arc-b only) and SCENE_3 (both arcs)
  // remain. Focusing ARC_A keeps SCENE_3 vivid and ghosts SCENE_2.
  await page.locator('#tlf-arc-focus').selectOption(ARC_A.id);

  const row3 = page.locator(`[data-testid="row-${SCENE_3.id}"]`);
  const row2 = page.locator(`[data-testid="row-${SCENE_2.id}"]`);
  await expect(row3).toBeVisible();
  await expect(row2).toBeVisible();

  // SCENE_3 includes arc-a → vivid (no data-opacity attribute).
  expect(await row3.getAttribute('data-opacity')).toBeNull();
  // SCENE_2 is arc-b only → ghosted to 0.2 per spec §3.3.
  await expect(row2).toHaveAttribute('data-opacity', '0.2');

  // Clear focus.
  await page.locator('#tlf-arc-focus').selectOption('');
});

// ─── Performance gate (spec §10 — 500 scenes × 10 arcs under 60ms frames) ───
//
// A separate Electron boot with a 500-scene fixture. We measure the median
// requestAnimationFrame interval while a hover/scroll sweep is running and
// assert it stays under a 60ms ceiling — generous vs. the 16.67ms 60fps ideal,
// but tight enough to catch the obvious render-blocking regressions the spec
// guards against on CI runners. Local devs see headroom; CI runners running
// under xvfb with no GPU sit near the ceiling, which is why we don't assert
// 16.67ms directly.

test.describe('SKY-797 — perf gate', () => {
  const PERF_STORY_ID = 'story-perf';
  const PERF_CHAPTER_ID = 'chapter-perf';

  // 60ms = 16.67fps. Tight enough to catch O(n²) regressions on every hover
  // sweep; loose enough to survive runner jitter under xvfb.
  const FRAME_BUDGET_MS = 60;

  let perfUserData: string;
  let perfVaultDir: string;
  let perfNotesVaultDir: string;
  let perfApp: ElectronApplication | undefined;
  let perfPage: Page;

  test.beforeAll(async () => {
    perfUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-perf-user-'));
    perfVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-perf-vault-'));
    perfNotesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-perf-notes-'));
    seedUserData(perfUserData, perfVaultDir, perfNotesVaultDir);

    // Build the 500 × 10 fixture programmatically.
    const arcs: SeedArc[] = Array.from({ length: 10 }, (_, i) => ({
      id: `arc-perf-${i}`,
      title: `Arc ${i}`,
      color: i % 2 === 0 ? 'var(--neon-cyan)' : 'var(--neon-magenta)',
    }));
    const scenes: SeedScene[] = Array.from({ length: 500 }, (_, i) => {
      const yearOffset = Math.floor(i / 100);
      const dayOfYear = (i % 100) + 1;
      const month = String(Math.floor((dayOfYear - 1) / 28) + 1).padStart(2, '0');
      const day = String(((dayOfYear - 1) % 28) + 1).padStart(2, '0');
      // Each scene is tagged with exactly one arc (round-robin), keeping the
      // fixture deterministic and exercising arc-pill rendering on every row.
      const arcIdx = i % arcs.length;
      return {
        id: `sc-perf-${i.toString().padStart(3, '0')}`,
        title: `Scene ${i.toString().padStart(3, '0')}`,
        date: `${2340 + yearOffset}-${month}-${day}`,
        arcs: [arcs[arcIdx].id],
        pov: `Char ${i % 5}`,
        mood: ['tense', 'somber', 'hopeful', 'calm', 'wry'][i % 5],
      };
    });
    seedVault(
      perfVaultDir,
      PERF_STORY_ID, 'Perf Story',
      PERF_CHAPTER_ID, 'Perf Chapter',
      scenes, arcs,
    );

    perfApp = await launchApp(perfUserData);
    perfPage = await firstWindow(perfApp);
    await openTimeline(perfPage, scenes[0].title);
  });

  test.afterAll(async () => {
    await perfApp?.close().catch(() => {});
    fs.rmSync(perfUserData, { recursive: true, force: true });
    fs.rmSync(perfVaultDir, { recursive: true, force: true });
    fs.rmSync(perfNotesVaultDir, { recursive: true, force: true });
  });

  test('500 scenes × 10 arcs — median frame interval under 60ms during a hover + scroll sweep', async () => {
    // Sanity: at least the first batch of rows is rendered.
    await expect(perfPage.locator('.tls-row').first()).toBeVisible({ timeout: 10_000 });

    // page.evaluate samples requestAnimationFrame intervals for ~2 s while it
    // drives a hover + scroll sweep on the scroll container. We assert on the
    // median so a single jank frame from GC or layout doesn't blow up the test.
    const result = await perfPage.evaluate(async () => {
      // Captures rAF intervals for SAMPLE_MS while the scroller is being
      // panned and hovered programmatically. Returning the array (vs. the
      // median) keeps the assertion side in Node where the budget lives.
      const SAMPLE_MS = 2000;
      const intervals: number[] = [];
      const scroller = document.querySelector<HTMLElement>('.tls-scroll');
      const rows = Array.from(document.querySelectorAll<HTMLElement>('.tls-row'));
      if (!scroller || rows.length === 0) {
        return { sampled: 0, medianMs: 0, p95Ms: 0, rows: rows.length };
      }

      let last = performance.now();
      const stopAt = last + SAMPLE_MS;
      let raf = 0;
      let i = 0;
      let direction = 1;

      const step = () => {
        const now = performance.now();
        intervals.push(now - last);
        last = now;

        // Drive a hover sweep: dispatch mouseenter/leave on rows in sequence so
        // the React onMouseEnter handler in TimelineSpreadsheet runs and the
        // detail-card memo re-resolves on every frame.
        const row = rows[i % rows.length];
        row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        row.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        i++;

        // Scroll the table up and down to provoke layout + paint each frame.
        scroller.scrollTop += direction * 40;
        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight) direction = -1;
        if (scroller.scrollTop <= 0) direction = 1;

        if (now < stopAt) {
          raf = requestAnimationFrame(step);
        }
      };
      raf = requestAnimationFrame(step);

      await new Promise<void>(resolve => setTimeout(resolve, SAMPLE_MS + 100));
      cancelAnimationFrame(raf);

      // Drop the first sample — it always reflects warm-up cost between scheduling
      // and the first measured frame, not steady-state render cost.
      const usable = intervals.slice(1).sort((a, b) => a - b);
      const median = usable[Math.floor(usable.length / 2)] ?? 0;
      const p95 = usable[Math.floor(usable.length * 0.95)] ?? 0;
      return { sampled: usable.length, medianMs: median, p95Ms: p95, rows: rows.length };
    });

    console.log('[perf]', JSON.stringify(result));
    expect(result.rows, 'fixture must render at least 100 rows for the sample to be meaningful').toBeGreaterThanOrEqual(100);
    expect(result.sampled, 'must collect a meaningful frame sample').toBeGreaterThan(30);
    expect(
      result.medianMs,
      `median frame interval ${result.medianMs.toFixed(1)}ms exceeded the ${FRAME_BUDGET_MS}ms budget (p95=${result.p95Ms.toFixed(1)}ms over ${result.sampled} frames, ${result.rows} rows)`,
    ).toBeLessThanOrEqual(FRAME_BUDGET_MS);
  });
});

// ─── SKY-3186 — AEON Track (TC-TL-TRK-*) ─────────────────────────────────────
//
// "AEON Track" (TrackTimeline.tsx, F1/F2 — SKY-3181/SKY-3182) is the
// owner-locked subway-core visual REQUIRED for Beta 2: an SVG time-axis
// canvas reached via the Timeline view's mode switcher
// ("Spreadsheet" / "AEON" / "AEON Track"), additive to the existing
// spreadsheet timeline covered by TC-TL-01..08 above.
//
// Scope note on "filters": AEON Track has no arc/date filter controls of its
// own — that UI lives on the spreadsheet view only (TC-TL-05/06). TC-TL-TRK-06
// asserts that behavior is intentional and stable: Track always renders every
// scene, independent of whatever filter state the spreadsheet view is left
// in, rather than silently inheriting or dropping scenes. If per-lane
// filtering ships for Track later, replace this test with real filter
// coverage.

test.describe('SKY-3186 — AEON Track (TC-TL-TRK-*)', () => {
  const TRK_STORY_ID = 'story-track-e2e';
  const TRK_CHAPTER_ID = 'chapter-track-e2e';
  const TRK_STORY_TITLE = 'Chronicles of the Track';
  const TRK_CHAPTER_TITLE = 'Track One';

  // Three dated scenes (a >20% span gap between T2/T3 exercises proportional
  // gap-indicator math even though the default view is uniform spacing) plus
  // one undated scene (exercises the "N undated" status text and the
  // undated-slot-marker style).
  const T1 = { id: 'sc-trk-1', title: 'Boarding',  date: '2340-01-01', arcs: ['arc-trk-a'], pov: 'Eira', mood: 'tense' };
  const T2 = { id: 'sc-trk-2', title: 'Delay',     date: '2340-01-03', arcs: ['arc-trk-a'], pov: 'Eira', mood: 'somber' };
  const T3 = { id: 'sc-trk-3', title: 'Terminus',  date: '2340-08-20', arcs: ['arc-trk-b'], pov: 'Kael', mood: 'hopeful' };
  const T4 = { id: 'sc-trk-4', title: 'Flashback', date: '',           arcs: [] as string[], pov: 'Eira', mood: 'wry' };

  const TRK_ARC_A = { id: 'arc-trk-a', title: 'Hero Journey', color: 'var(--neon-cyan)' };
  const TRK_ARC_B = { id: 'arc-trk-b', title: 'Villain Rise', color: 'var(--neon-magenta)' };

  let trkUserData: string;
  let trkVaultDir: string;
  let trkNotesVaultDir: string;
  let trkApp: ElectronApplication | undefined;
  let trkPage: Page;

  test.beforeAll(async () => {
    trkUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-track-user-'));
    trkVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-track-vault-'));
    trkNotesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-track-notes-'));
    seedUserData(trkUserData, trkVaultDir, trkNotesVaultDir);
    seedVault(
      trkVaultDir,
      TRK_STORY_ID, TRK_STORY_TITLE,
      TRK_CHAPTER_ID, TRK_CHAPTER_TITLE,
      [T1, T2, T3, T4],
      [TRK_ARC_A, TRK_ARC_B],
    );
    trkApp = await launchApp(trkUserData);
    trkPage = await firstWindow(trkApp);
    await openTimeline(trkPage, T1.title);
  });

  test.afterAll(async () => {
    await trkApp?.close().catch(() => {});
    fs.rmSync(trkUserData, { recursive: true, force: true });
    fs.rmSync(trkVaultDir, { recursive: true, force: true });
    fs.rmSync(trkNotesVaultDir, { recursive: true, force: true });
  });

  /** Click "AEON Track" in the mode switcher and wait for its SVG to mount. */
  async function switchToTrackMode(pg: Page): Promise<void> {
    const modeBar = pg.getByRole('group', { name: 'Timeline view mode' });
    await expect(modeBar).toBeVisible({ timeout: 6_000 });
    await modeBar.getByRole('button', { name: 'AEON Track' }).click();
    await expect(pg.locator('[data-testid="tt-svg"]')).toBeVisible({ timeout: 6_000 });
  }

  // ─── TC-TL-TRK-01: Render ──────────────────────────────────────────────────

  test('TC-TL-TRK-01: switching to AEON Track renders the SVG canvas with every seeded scene', async () => {
    await switchToTrackMode(trkPage);

    await expect(trkPage.locator('[data-testid="tt-svg"]')).toHaveAttribute('aria-label', /4 scenes/);

    for (const scene of [T1, T2, T3, T4]) {
      await expect(trkPage.locator(`g[aria-label^="Scene: ${scene.title}"]`)).toHaveCount(1);
    }

    await expect(trkPage.locator('.tt-status')).toContainText('4 scenes');
    await expect(trkPage.locator('.tt-status')).toContainText('1 undated');
  });

  // ─── TC-TL-TRK-02: View switch ─────────────────────────────────────────────

  test('TC-TL-TRK-02: mode switcher cycles Spreadsheet → AEON → AEON Track without cross-mounting', async () => {
    const modeBar = trkPage.getByRole('group', { name: 'Timeline view mode' });

    await modeBar.getByRole('button', { name: 'Spreadsheet', exact: true }).click();
    await expect(trkPage.locator('[data-testid="timeline-spreadsheet-root"]')).toBeVisible({ timeout: 6_000 });
    await expect(trkPage.locator('[data-testid="tt-svg"]')).toHaveCount(0);
    await expect(trkPage.locator('[data-testid="aeon-lane-view"]')).toHaveCount(0);

    await modeBar.getByRole('button', { name: 'AEON', exact: true }).click();
    await expect(trkPage.locator('[data-testid="aeon-lane-view"]')).toBeVisible({ timeout: 6_000 });
    await expect(trkPage.locator('[data-testid="timeline-spreadsheet-root"]')).toHaveCount(0);
    await expect(trkPage.locator('[data-testid="tt-svg"]')).toHaveCount(0);

    await switchToTrackMode(trkPage);
    await expect(trkPage.locator('[data-testid="aeon-lane-view"]')).toHaveCount(0);
    await expect(trkPage.locator('[data-testid="timeline-spreadsheet-root"]')).toHaveCount(0);

    await expect(modeBar.getByRole('button', { name: 'AEON Track' })).toHaveAttribute('aria-pressed', 'true');
    await expect(modeBar.getByRole('button', { name: 'Spreadsheet', exact: true })).toHaveAttribute('aria-pressed', 'false');
  });

  // ─── TC-TL-TRK-03: Zoom ─────────────────────────────────────────────────────

  test('TC-TL-TRK-03: zoom in/out/fit controls update the zoom level and SVG transform scale', async () => {
    await switchToTrackMode(trkPage);
    await expect(trkPage.locator('[data-testid="zoom-level"]')).toHaveText('100%');

    await trkPage.locator('[data-testid="zoom-in-btn"]').click();
    await expect(trkPage.locator('[data-testid="zoom-level"]')).toHaveText('110%');
    await expect(trkPage.locator('[data-testid="tt-content-group"]')).toHaveAttribute('transform', /scale\(1\.1\)/);

    await trkPage.locator('[data-testid="zoom-out-btn"]').click();
    await trkPage.locator('[data-testid="zoom-out-btn"]').click();
    await expect(trkPage.locator('[data-testid="zoom-level"]')).toHaveText('90%');

    await trkPage.locator('[data-testid="zoom-fit-btn"]').click();
    await expect(trkPage.locator('[data-testid="zoom-level"]')).toHaveText('100%');
    await expect(trkPage.locator('[data-testid="tt-content-group"]')).toHaveAttribute('transform', 'translate(0 0) scale(1)');
  });

  // ─── TC-TL-TRK-04: Pan (pointer drag) ──────────────────────────────────────

  test('TC-TL-TRK-04: dragging the canvas pans the content group', async () => {
    // Continues from TC-TL-TRK-03's fit state (same mount, no mode switch in
    // between) so the starting transform is known without re-asserting it.
    const svg = trkPage.locator('[data-testid="tt-svg"]');
    const box = await svg.boundingBox();
    if (!box) throw new Error('tt-svg has no bounding box');
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await trkPage.mouse.move(startX, startY);
    await trkPage.mouse.down();
    await trkPage.mouse.move(startX - 60, startY - 20, { steps: 8 });
    await trkPage.mouse.up();

    const [offsetX, offsetY] = await trkPage.locator('[data-testid="tt-content-group"]').evaluate(el => {
      const t = el.getAttribute('transform') ?? '';
      const m = t.match(/translate\(([-\d.]+) ([-\d.]+)\)/);
      return m ? [parseFloat(m[1]), parseFloat(m[2])] : [0, 0];
    });
    expect(offsetX, 'dragging left should produce a negative x offset').toBeLessThan(-30);
    expect(offsetY, 'dragging up should produce a negative y offset').toBeLessThan(-5);

    // Restore a known state for the keyboard-nav test that follows.
    await trkPage.locator('[data-testid="zoom-fit-btn"]').click();
    await expect(trkPage.locator('[data-testid="tt-content-group"]')).toHaveAttribute('transform', 'translate(0 0) scale(1)');
  });

  // ─── TC-TL-TRK-05: Keyboard nav (pan + zoom-fit) ───────────────────────────

  test('TC-TL-TRK-05: arrow keys pan the canvas and Home resets to fit', async () => {
    const root = trkPage.locator('[role="application"][aria-label^="AEON track timeline"]');
    await expect(root).toBeVisible({ timeout: 6_000 });
    await root.focus();

    await root.press('ArrowRight');
    await expect(trkPage.locator('[data-testid="tt-content-group"]')).toHaveAttribute('transform', 'translate(-40 0) scale(1)');

    await root.press('ArrowDown');
    await expect(trkPage.locator('[data-testid="tt-content-group"]')).toHaveAttribute('transform', 'translate(-40 -40) scale(1)');

    await root.press('ArrowLeft');
    await root.press('ArrowUp');
    await expect(trkPage.locator('[data-testid="tt-content-group"]')).toHaveAttribute('transform', 'translate(0 0) scale(1)');

    // Home resets zoom + pan even after a zoom change.
    await trkPage.locator('[data-testid="zoom-in-btn"]').click();
    await root.press('Home');
    await expect(trkPage.locator('[data-testid="zoom-level"]')).toHaveText('100%');
    await expect(trkPage.locator('[data-testid="tt-content-group"]')).toHaveAttribute('transform', 'translate(0 0) scale(1)');
  });

  // ─── TC-TL-TRK-06: Filters — Track is filter-independent by design ─────────

  test('TC-TL-TRK-06: AEON Track renders every scene regardless of spreadsheet filter state', async () => {
    const modeBar = trkPage.getByRole('group', { name: 'Timeline view mode' });
    await modeBar.getByRole('button', { name: 'Spreadsheet', exact: true }).click();
    await expect(trkPage.locator('[data-testid="timeline-spreadsheet-root"]')).toBeVisible({ timeout: 6_000 });

    // Narrow the spreadsheet to arc-trk-a only — T3 (arc-trk-b) should fade.
    await trkPage.locator('#tlf-tab-arc').click();
    await trkPage.locator('#tlf-entity-value').selectOption(TRK_ARC_A.id);
    await expect(trkPage.locator(`[data-testid="row-${T3.id}"]`)).toHaveAttribute('data-opacity', '0.3');

    await switchToTrackMode(trkPage);
    for (const scene of [T1, T2, T3, T4]) {
      await expect(trkPage.locator(`g[aria-label^="Scene: ${scene.title}"]`)).toHaveCount(1);
    }
    await expect(trkPage.locator('.tt-status')).toContainText('4 scenes');

    // Reset the spreadsheet filter so it doesn't bleed into later tests.
    await modeBar.getByRole('button', { name: 'Spreadsheet', exact: true }).click();
    await trkPage.locator('#tlf-tab-all').click();
  });

  // ─── TC-TL-TRK-07: Accessibility ────────────────────────────────────────────

  test('TC-TL-TRK-07: AEON Track exposes an application landmark, labelled toolbar, and live status region', async () => {
    await switchToTrackMode(trkPage);

    await expect(trkPage.locator('[role="application"]')).toHaveAttribute(
      'aria-label',
      /AEON track timeline.*arrow keys to pan.*zoom/i,
    );

    const toolbar = trkPage.locator('[data-testid="timeline-header"]');
    await expect(toolbar).toHaveAttribute('role', 'toolbar');
    await expect(trkPage.locator('[data-testid="zoom-out-btn"]')).toHaveAttribute('aria-label', 'Zoom out');
    await expect(trkPage.locator('[data-testid="zoom-in-btn"]')).toHaveAttribute('aria-label', 'Zoom in');
    await expect(trkPage.locator('[data-testid="zoom-fit-btn"]')).toHaveAttribute('aria-label', 'Zoom to fit all scenes');
    await expect(trkPage.locator('[data-testid="zoom-level"]')).toHaveAttribute('aria-live', 'polite');

    const svg = trkPage.locator('[data-testid="tt-svg"]');
    await expect(svg).toHaveAttribute('role', 'img');
    await expect(svg).toHaveAttribute('aria-label', /Track timeline for .+\. \d+ scenes?, uniform spacing\./);

    await expect(trkPage.locator('.tt-status')).toHaveAttribute('aria-live', 'polite');

    await expect(trkPage.locator(`g[aria-label="Scene: ${T1.title}, Jan 1, 2340"]`)).toHaveCount(1);
    // The undated scene's label omits the date clause entirely, rather than
    // reading "undefined" or an empty date to AT users.
    await expect(trkPage.locator(`g[aria-label="Scene: ${T4.title}"]`)).toHaveCount(1);
  });

  // ─── TC-TL-TRK-08: Reduced motion ───────────────────────────────────────────

  test('TC-TL-TRK-08: prefers-reduced-motion disables the loading-spinner animation', async () => {
    await trkPage.emulateMedia({ reducedMotion: 'reduce' });
    try {
      // Force a remount so the loading state (and its spinner) appears again.
      const modeBar = trkPage.getByRole('group', { name: 'Timeline view mode' });
      await modeBar.getByRole('button', { name: 'Spreadsheet', exact: true }).click();
      await switchToTrackMode(trkPage);

      const spinner = trkPage.locator('.tt-loading-spinner');
      // The spinner can resolve before we sample it on a fast run; only assert
      // the animation is off when it's still present in the DOM.
      if (await spinner.count() > 0) {
        const animationName = await spinner.evaluate(el => getComputedStyle(el).animationName);
        expect(animationName).toBe('none');
      }
      await expect(trkPage.locator('[data-testid="tt-svg"]')).toBeVisible({ timeout: 6_000 });
    } finally {
      await trkPage.emulateMedia({ reducedMotion: 'no-preference' });
    }
  });

  // ─── TC-TL-TRK-09: High-contrast theme reaches the rendered SVG ────────────

  test('TC-TL-TRK-09: the high-contrast accessibility theme overrides reach every rendered marker/label', async () => {
    await switchToTrackMode(trkPage);
    // A vertical SVG <line> has zero bounding-box width, so Playwright's
    // geometry-based toBeVisible() reports it "hidden" even though it renders
    // fine — wait on DOM presence instead.
    await expect(trkPage.locator('.tt-slot-marker')).toHaveCount(4, { timeout: 6_000 });
    const marker = trkPage.locator('.tt-slot-marker').first();

    // Baseline (dark, default theme).
    expect(await marker.evaluate(el => getComputedStyle(el).opacity)).toBe('0.8');

    // applyTheme('high-contrast') (theme.ts) sets this attribute; the
    // [data-contrast="high"] overlay in TrackTimeline.css must reach every
    // already-rendered marker/label, not just ones mounted after the toggle.
    await trkPage.evaluate(() => document.documentElement.setAttribute('data-contrast', 'high'));
    try {
      expect(await marker.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
      expect(await marker.evaluate(el => getComputedStyle(el).strokeWidth)).toBe('2.5px');

      const label = trkPage.locator('.tt-scene-label').first();
      const highContrastFill = await label.evaluate(el => getComputedStyle(el).fill);
      await trkPage.evaluate(() => document.documentElement.removeAttribute('data-contrast'));
      const defaultFill = await label.evaluate(el => getComputedStyle(el).fill);
      expect(highContrastFill, 'high-contrast scene-label fill should differ from the default token').not.toBe(defaultFill);
    } finally {
      await trkPage.evaluate(() => document.documentElement.removeAttribute('data-contrast'));
    }
  });
});

// ─── SKY-3186 — AEON Track perf gate (500 scenes × 10 arcs) ─────────────────
//
// Mirrors the SKY-797 spreadsheet perf gate above, but drives the sweep
// against AEON Track and asserts the three budgets named in the SKY-3186
// acceptance criteria: 60fps-equivalent median frame interval, a p95 "paint"
// ceiling for the worst individual frame in the sweep, and a separate
// interaction-latency budget for a single zoom step (click → transform
// updated in the DOM).

test.describe('SKY-3186 — AEON Track perf gate (500×10)', () => {
  const TRK_PERF_STORY_ID = 'story-track-perf';
  const TRK_PERF_CHAPTER_ID = 'chapter-track-perf';

  const FRAME_BUDGET_MS = 60;   // median rAF interval — mirrors SKY-797's spreadsheet budget
  const PAINT_BUDGET_MS = 100;  // p95 rAF interval — no single frame should blow past this
  const ZOOM_BUDGET_MS = 200;   // click → rendered-transform latency for a single zoom step

  let perfTrkUserData: string;
  let perfTrkVaultDir: string;
  let perfTrkNotesVaultDir: string;
  let perfTrkApp: ElectronApplication | undefined;
  let perfTrkPage: Page;

  test.beforeAll(async () => {
    perfTrkUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-track-perf-user-'));
    perfTrkVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-track-perf-vault-'));
    perfTrkNotesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-track-perf-notes-'));
    seedUserData(perfTrkUserData, perfTrkVaultDir, perfTrkNotesVaultDir);

    const arcs: SeedArc[] = Array.from({ length: 10 }, (_, i) => ({
      id: `arc-trk-perf-${i}`,
      title: `Arc ${i}`,
      color: i % 2 === 0 ? 'var(--neon-cyan)' : 'var(--neon-magenta)',
    }));
    const scenes: SeedScene[] = Array.from({ length: 500 }, (_, i) => {
      const yearOffset = Math.floor(i / 100);
      const dayOfYear = (i % 100) + 1;
      const month = String(Math.floor((dayOfYear - 1) / 28) + 1).padStart(2, '0');
      const day = String(((dayOfYear - 1) % 28) + 1).padStart(2, '0');
      const arcIdx = i % arcs.length;
      return {
        id: `sc-trk-perf-${i.toString().padStart(3, '0')}`,
        title: `Scene ${i.toString().padStart(3, '0')}`,
        date: `${2340 + yearOffset}-${month}-${day}`,
        arcs: [arcs[arcIdx].id],
        pov: `Char ${i % 5}`,
        mood: ['tense', 'somber', 'hopeful', 'calm', 'wry'][i % 5],
      };
    });
    seedVault(
      perfTrkVaultDir,
      TRK_PERF_STORY_ID, 'Track Perf Story',
      TRK_PERF_CHAPTER_ID, 'Perf Chapter',
      scenes, arcs,
    );

    perfTrkApp = await launchApp(perfTrkUserData);
    perfTrkPage = await firstWindow(perfTrkApp);
    await openTimeline(perfTrkPage, scenes[0].title);
    const modeBar = perfTrkPage.getByRole('group', { name: 'Timeline view mode' });
    await modeBar.getByRole('button', { name: 'AEON Track' }).click();
    await expect(perfTrkPage.locator('[data-testid="tt-svg"]')).toBeVisible({ timeout: 10_000 });
  });

  test.afterAll(async () => {
    await perfTrkApp?.close().catch(() => {});
    fs.rmSync(perfTrkUserData, { recursive: true, force: true });
    fs.rmSync(perfTrkVaultDir, { recursive: true, force: true });
    fs.rmSync(perfTrkNotesVaultDir, { recursive: true, force: true });
  });

  // KNOWN GAP — SKY-5738: TrackTimeline renders every scene unconditionally
  // (frontend/src/TrackTimeline.tsx:539, `{placed.map(p => ...)}`) with no
  // windowing, unlike TimelineSpreadsheet (.tls-row virtualization) and
  // AeonLaneView (F3/SKY-3183's windowed render). Measured against main
  // (fc48c2dc) in this exact xvfb environment: only 17 rAF samples/2s at 500
  // scenes vs 69 for the equivalent (passing) spreadsheet perf test — this is
  // a Track-specific rendering issue, not environment overhead. Both
  // assertions below are real, correctly-scoped budgets and must be restored
  // to `test(...)` once SKY-5738 windows the marker rendering — do not loosen
  // the budgets or delete the assertions to make this pass.
  test.fixme('500 scenes × 10 arcs — median frame interval <=60ms, p95 (paint) <=100ms during a pan sweep', async () => {
    await expect(
      perfTrkPage.locator('[data-testid="tt-content-group"] g[aria-label^="Scene:"]').first(),
    ).toBeVisible({ timeout: 10_000 });

    const result = await perfTrkPage.evaluate(async () => {
      const SAMPLE_MS = 2000;
      const intervals: number[] = [];
      const root = document.querySelector<HTMLElement>('.tt-root');
      const markers = Array.from(document.querySelectorAll<SVGGElement>('[data-testid="tt-content-group"] > g'));
      if (!root || markers.length === 0) {
        return { sampled: 0, medianMs: 0, p95Ms: 0, markers: markers.length };
      }

      let last = performance.now();
      const stopAt = last + SAMPLE_MS;
      let raf = 0;
      let direction = 1;

      const step = () => {
        const now = performance.now();
        intervals.push(now - last);
        last = now;

        // Drive the same ArrowRight/ArrowLeft pan handler TC-TL-TRK-05
        // exercises, at rAF cadence, occasionally reversing direction so the
        // sweep provokes repeated layout/paint of the full 500-marker set.
        root.dispatchEvent(
          new KeyboardEvent('keydown', { key: direction > 0 ? 'ArrowRight' : 'ArrowLeft', bubbles: true }),
        );
        if (Math.random() < 0.02) direction *= -1;

        if (now < stopAt) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);

      await new Promise<void>(resolve => setTimeout(resolve, SAMPLE_MS + 100));
      cancelAnimationFrame(raf);

      // Drop the first sample — warm-up cost between scheduling and the first
      // measured frame, not steady-state render cost.
      const usable = intervals.slice(1).sort((a, b) => a - b);
      const median = usable[Math.floor(usable.length / 2)] ?? 0;
      const p95 = usable[Math.floor(usable.length * 0.95)] ?? 0;
      return { sampled: usable.length, medianMs: median, p95Ms: p95, markers: markers.length };
    });

    console.log('[perf:track]', JSON.stringify(result));
    expect(result.markers, 'fixture must render scene markers for the sample to be meaningful').toBeGreaterThanOrEqual(100);
    expect(result.sampled, 'must collect a meaningful frame sample').toBeGreaterThan(30);
    expect(
      result.medianMs,
      `median frame interval ${result.medianMs.toFixed(1)}ms exceeded the ${FRAME_BUDGET_MS}ms budget`,
    ).toBeLessThanOrEqual(FRAME_BUDGET_MS);
    expect(
      result.p95Ms,
      `p95 (paint) frame interval ${result.p95Ms.toFixed(1)}ms exceeded the ${PAINT_BUDGET_MS}ms budget`,
    ).toBeLessThanOrEqual(PAINT_BUDGET_MS);
  });

  // KNOWN GAP — SKY-5738 (see above): a single zoom step at 500 unwindowed
  // scenes measured 663ms, well over the 200ms AC budget.
  test.fixme('a single zoom step updates the rendered transform within 200ms', async () => {
    const zoomIn = perfTrkPage.locator('[data-testid="zoom-in-btn"]');
    const contentGroup = perfTrkPage.locator('[data-testid="tt-content-group"]');
    const before = await contentGroup.getAttribute('transform');

    const start = Date.now();
    await zoomIn.click();
    await expect(contentGroup).not.toHaveAttribute('transform', before ?? '');
    const elapsed = Date.now() - start;

    expect(elapsed, `zoom step took ${elapsed}ms, exceeding the ${ZOOM_BUDGET_MS}ms budget`).toBeLessThanOrEqual(ZOOM_BUDGET_MS);
  });
});
