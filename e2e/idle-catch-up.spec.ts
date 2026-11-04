/**
 * idle-catch-up.spec.ts — PLAN-IDLE-CATCH-UP r2
 *
 * Purpose: real-Electron proof that background manuscript scans started from
 * the Continuity panel wait for a typing pause, and that typing stops FURTHER
 * submissions (a scan that already started may finish). This is the
 * hold -> recheck -> enqueue proof for the idle gate's flush order:
 *
 *   TC-IC-01  Two scans (Scene + Chapter scope) stage while the writer types.
 *             The e2e hold parks the flush right before the SECOND submit; by
 *             then the first job is in the real job queue. A real keystroke in
 *             the editor while held must stop the second submit on release
 *             (the recheck), and it only goes out after a fresh idle window.
 *   TC-IC-02  Settings → Editor → Idle catch-up persists across a relaunch
 *             (UI + app-settings.json on disk).
 *   TC-IC-03  A staged scan is dropped on a real vault switch (nav-rail tile)
 *             and is never submitted to the new vault, even after a full idle
 *             window. The new vault carries a scene with the SAME id, so a
 *             wrongly-submitted scan would land as a real job row there.
 *
 * No IPC mocks. The only renderer seam is the hold-only controller the gate
 * exposes while `window.__E2E_IDLE_CATCHUP__` is set (production never sets
 * it). Seeded: app settings (idleCatchUp { enabled: true, minutes: 1 } — 1 is
 * the test-only floor — for TC-IC-01 / TC-IC-03 only; TC-IC-02 tests that
 * setting, so it starts from a fresh-profile file without the key),
 * MythosVault v2 bundles and the vault registry. Nothing the feature produces
 * (staged items, job rows, the saved setting) is seeded.
 *
 * TC-IC-01 waits two real 1-minute idle windows and TC-IC-03 one, so those
 * new tests carry their own budgets (the suite default stays untouched).
 *
 * Run:
 *   rm -rf out/ && npm run build:electron
 *   xvfb-run --auto-servernum npx playwright test e2e/idle-catch-up.spec.ts --reporter=list --workers=1
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import { openSettingsDialog } from './helpers/aiOffSuite';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const NOW = '2026-11-01T00:00:00.000Z';
/** Shared by both vaults on purpose — see TC-IC-03's negative control. */
const SCENE_ID = 'scene-idle-catch-up';
const SCENE_TITLE = 'Idle Scene';
const CHAPTER_TITLE = 'Chapter One';
const SEED_PROSE = 'The lantern flickered once.';
const MAY_FINISH = 'If a background scan already started, it may finish after you start typing again.';
/** The gate coalesces by type + scope; these are its staged keys for the two scopes used. */
const KEY_SCENE = `manuscript-scan|scene|${SCENE_ID}`;
const KEY_CHAPTER = `manuscript-scan|chapter|${SCENE_ID}`;
/** Seeded idle window (minutes: 1). */
const IDLE_MS = 60_000;

interface VaultSettings {
  vaultRoot?: string;
  notesVaultRoot?: string;
}

/** Hold-only controller exposed by the idle gate while the e2e flag is set. */
interface IdleGateE2E {
  armHoldBeforeSubmit: (n: number) => void;
  isHeld: () => boolean;
  release: () => void;
  stagedKeys: () => string[];
}

type IdleE2EWindow = Window & {
  __E2E_IDLE_CATCHUP__?: boolean;
  __E2E_IDLE_CATCHUP_GATE__?: IdleGateE2E;
  __idleCatchUpPageMarker__?: string;
};

type JobsListWindow = Window & {
  api: {
    jobs: {
      list: (opts?: { type?: string; limit?: number }) => Promise<{ jobs?: Array<{ jobId: string }>; error?: string }>;
    };
  };
};

// ─── Fixture ────────────────────────────────────────────────────────────────

/** Minimal hand-written MythosVault v2 bundle: one story, one chapter, one scene. */
function seedV2Vault(bundle: string, opts: { id: string; name: string; storyTitle: string }): void {
  const storyDir = path.join(bundle, 'Story Vault', opts.storyTitle);
  const chapterDir = path.join(storyDir, 'Part 1', 'Chapter 01');
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.mkdirSync(path.join(bundle, 'Notes Vault'), { recursive: true });

  const storyId = `story-${opts.id}`;
  fs.writeFileSync(
    path.join(bundle, 'mythos.json'),
    JSON.stringify({
      formatVersion: 2,
      id: `vault-${opts.id}`,
      name: opts.name,
      createdAt: NOW,
      stories: [{ id: storyId, title: opts.storyTitle, folder: opts.storyTitle, createdAt: NOW, updatedAt: NOW }],
      // Seed marker present → the demo-content seeder must never run here.
      seed: { layout: 'veynn-v2', mode: 'blank', seededAt: NOW },
    }, null, 2),
  );

  const spine = [{ dir: 'Part 1', chapters: [{ dir: 'Chapter 01', id: `ch-${opts.id}`, title: CHAPTER_TITLE }] }];
  fs.writeFileSync(
    path.join(storyDir, 'book.md'),
    [
      '---', `id: ${storyId}`, `title: ${opts.storyTitle}`, `createdAt: ${NOW}`, `updatedAt: ${NOW}`, '---',
      `# ${opts.storyTitle}`, '', '## Part 1', '', `- [[Part 1/Chapter 01|${CHAPTER_TITLE}]]`, '',
      '<!-- mythos:spine', JSON.stringify(spine), '-->', '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(chapterDir, 'Scene 01.md'),
    `---\nid: ${SCENE_ID}\ntitle: ${SCENE_TITLE}\nstatus: draft\nupdatedAt: ${NOW}\n---\n${SEED_PROSE}\n`,
  );
}

const AGENT = {
  model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85,
  maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
};

function seedUserData(
  userData: string,
  active: { story: string; notes: string },
  recents: Array<{ name: string; story: string; notes: string }>,
): void {
  fs.mkdirSync(userData, { recursive: true });
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: { ...AGENT, enabled: false, scanIntervalSeconds: 30 },
      brainstorm: { ...AGENT, enabled: false },
      // Archive on so the Continuity panel renders (same as continuity-panel.spec.ts).
      archive: { ...AGENT, enabled: true, continuityCheckIntervalSeconds: 60 },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    rightSidebarVisible: true,
    rightSidebarWidth: 360,
    rightSidebarPanels: [{ id: 'archive-continuity', collapsed: false }],
    archiveStoryEditConsentGiven: true,
    // Configuration, not feature output: the 1-minute test floor.
    idleCatchUp: { enabled: true, minutes: 1 },
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({
      vaultRoot: active.story,
      notesVaultRoot: active.notes,
      recentProjects: recents.map((r) => ({ name: r.name, vaultRoot: r.story, notesVaultRoot: r.notes, openedAt: NOW })),
    }, null, 2),
  );
}

function readAppSettings(userData: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(userData, 'app-settings.json'), 'utf-8')) as Record<string, unknown>;
}

/** Drop the seeded `idleCatchUp` key so the run starts from fresh-profile defaults. */
function unseedIdleCatchUp(userData: string): void {
  const settings = readAppSettings(userData);
  delete settings.idleCatchUp;
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(settings, null, 2));
}

function readVaultSettings(userData: string): VaultSettings {
  const file = path.join(userData, 'vault-settings.json');
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as VaultSettings;
}

// ─── App lifecycle ──────────────────────────────────────────────────────────

async function launchApp(userData: string, homeOverride: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  const launched = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
    env: { ...process.env, HOME: homeOverride, USERPROFILE: homeOverride },
  });
  const proc = launched.process();
  proc.stdout?.on('data', (d: Buffer) => console.log('[main:out]', d.toString().trimEnd()));
  proc.stderr?.on('data', (d: Buffer) => console.log('[main:err]', d.toString().trimEnd()));
  return launched;
}

async function firstWindow(electronApp: ElectronApplication): Promise<Page> {
  const page = await electronApp.firstWindow();
  page.on('console', (m) => console.log(`[renderer:${m.type()}]`, m.text()));
  page.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
  return page;
}

async function closeApp(electronApp: ElectronApplication | undefined): Promise<void> {
  const proc = electronApp?.process();
  await Promise.race([
    electronApp?.close().catch(() => undefined) ?? Promise.resolve(),
    new Promise<void>((r) => setTimeout(r, 5_000)),
  ]);
  try {
    if (proc && !proc.killed) proc.kill('SIGKILL');
  } catch {
    // already exited
  }
}

// ─── UI helpers ─────────────────────────────────────────────────────────────

/** Activate the Story section without tripping the nav rail Stories popover. */
async function clickStorySection(page: Page): Promise<void> {
  const nav = page.locator('nav[aria-label="Main navigation"]');
  await expect(nav).toBeVisible({ timeout: 15_000 });
  const storyBtn = nav.getByRole('button', { name: /^story( writer)?$/i }).first();
  await expect(storyBtn).toBeVisible({ timeout: 10_000 });
  if ((await storyBtn.getAttribute('aria-current')) !== 'page') {
    await storyBtn.click();
  }
  const backdrop = page.locator('[data-testid="nav-rail-stories-backdrop"]');
  if (await backdrop.count()) {
    await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    await expect(backdrop).toHaveCount(0);
  }
}

/** Open the seeded scene and return its ProseMirror surface. */
async function openScene(page: Page, storyTitle: string): Promise<Locator> {
  await clickStorySection(page);
  const storyRow = page.getByRole('button', { name: new RegExp(storyTitle) }).first();
  await expect(storyRow).toBeVisible({ timeout: 20_000 });
  const chapterRow = page.getByRole('button', { name: new RegExp(CHAPTER_TITLE) }).first();
  if (!(await chapterRow.isVisible().catch(() => false))) {
    await storyRow.click();
  }
  await expect(chapterRow).toBeVisible({ timeout: 10_000 });
  // Boot-time reindex re-renders the navigator and can collapse a freshly
  // expanded chapter — retry the expand until the scene row stays visible.
  const sceneRow = page.getByRole('button', { name: new RegExp(SCENE_TITLE) }).first();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await chapterRow.click();
    try {
      await sceneRow.waitFor({ state: 'visible', timeout: 3_000 });
      break;
    } catch {
      /* collapsed again — retry */
    }
  }
  await sceneRow.click();
  const surface = page.locator('.ProseMirror').first();
  await expect(surface).toBeVisible({ timeout: 15_000 });
  await expect(surface).toContainText(SEED_PROSE, { timeout: 15_000 });
  return surface;
}

/** A real editable keystroke in the scene editor (keydown/beforeinput/input on the contenteditable). */
async function typeInEditor(page: Page, surface: Locator, key: string): Promise<number> {
  await surface.click();
  await page.keyboard.press('End');
  const at = Date.now();
  await page.keyboard.press(key);
  return at;
}

/** Open Notes & Analysis in the right sidebar, where the Continuity panel lives. */
async function openContinuity(page: Page): Promise<Locator> {
  const sidebar = page.getByTestId('global-right-sidebar');
  await expect(sidebar).toBeVisible({ timeout: 12_000 });
  await sidebar.getByTestId('ahp-tab-notes-analysis').click();
  await expect(sidebar.getByTestId('ahp-notes-analysis')).toBeVisible({ timeout: 8_000 });
  await expect(sidebar.getByRole('combobox', { name: /scan scope/i })).toBeVisible({ timeout: 12_000 });
  return sidebar;
}

async function pickScope(page: Page, sidebar: Locator, label: 'Scene' | 'Chapter'): Promise<void> {
  const picker = sidebar.getByRole('combobox', { name: /scan scope/i });
  await expect(picker).toBeEnabled({ timeout: 30_000 });
  await picker.click();
  await page.getByRole('listbox', { name: /scan scope/i }).getByRole('option', { name: label, exact: true }).click();
  await expect(picker).toContainText(label);
}

/** Settings → Editor, scoped to the category rail so a section sub-nav can't match. */
function editorCategoryTab(dialog: Locator): Locator {
  return dialog.getByRole('tablist', { name: 'Settings categories' }).getByRole('tab', { name: 'Editor', exact: true });
}

/** The panel's scan trigger — "Scan now" (not yet scanned) or the compact "Scan". */
async function clickScan(sidebar: Locator): Promise<void> {
  const scan = sidebar.getByRole('button', { name: /^scan( now)? for continuity issues$/i });
  await expect(scan).toBeEnabled({ timeout: 30_000 });
  await scan.click();
}

// ─── Renderer reads (real IPC + the gate's e2e controller) ──────────────────

async function setIdleE2EFlag(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as IdleE2EWindow).__E2E_IDLE_CATCHUP__ = true;
  });
}

/** null until the gate has exposed its controller (first enqueue after the flag). */
async function stagedKeys(page: Page): Promise<string[] | null> {
  return page.evaluate(() => {
    const ctl = (window as IdleE2EWindow).__E2E_IDLE_CATCHUP_GATE__;
    return ctl ? ctl.stagedKeys() : null;
  });
}

async function gateCall(page: Page, op: 'arm2' | 'release'): Promise<void> {
  await page.evaluate((which) => {
    const ctl = (window as IdleE2EWindow).__E2E_IDLE_CATCHUP_GATE__;
    if (!ctl) throw new Error('idle gate e2e controller is not exposed');
    if (which === 'arm2') ctl.armHoldBeforeSubmit(2);
    else ctl.release();
  }, op);
}

async function isHeld(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as IdleE2EWindow).__E2E_IDLE_CATCHUP_GATE__?.isHeld() ?? false);
}

/** Every manuscript-scan job row in the open vault's real job queue. */
async function manuscriptScanJobIds(page: Page): Promise<string[]> {
  const res = await page.evaluate(() =>
    (window as unknown as JobsListWindow).api.jobs.list({ type: 'manuscript-scan', limit: 100 }),
  );
  if (res.error) throw new Error(`jobs.list failed: ${res.error}`);
  return (res.jobs ?? []).map((j) => j.jobId);
}

// ─── Per-test state ─────────────────────────────────────────────────────────

let tmpRoot: string;
let homeOverride: string;
let userData: string;
let storyA: string;
let notesA: string;
let storyB: string;
let notesB: string;
let app: ElectronApplication | undefined;

const STORY_A = 'Alpha Idle Story';
const STORY_B = 'Beta Idle Story';

test.beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-idle-catch-up-'));
  homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-idle-catch-up-home-'));
  userData = path.join(tmpRoot, 'user-data');
  const bundleA = path.join(tmpRoot, 'Alpha');
  const bundleB = path.join(tmpRoot, 'Beta');
  seedV2Vault(bundleA, { id: 'idle-a', name: 'Alpha', storyTitle: STORY_A });
  seedV2Vault(bundleB, { id: 'idle-b', name: 'Beta', storyTitle: STORY_B });
  storyA = path.join(bundleA, 'Story Vault');
  notesA = path.join(bundleA, 'Notes Vault');
  storyB = path.join(bundleB, 'Story Vault');
  notesB = path.join(bundleB, 'Notes Vault');
  // Alpha active; both vaults registered so both nav-rail tiles render.
  seedUserData(userData, { story: storyA, notes: notesA }, [
    { name: 'Alpha', story: storyA, notes: notesA },
    { name: 'Beta', story: storyB, notes: notesB },
  ]);
  app = undefined;
});

test.afterEach(async () => {
  await closeApp(app);
  app = undefined;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(homeOverride, { recursive: true, force: true });
});

// ─── Tests ──────────────────────────────────────────────────────────────────

test.describe('PLAN-IDLE-CATCH-UP — background scans wait for a typing pause', () => {
  test('TC-IC-01: hold -> recheck -> enqueue — typing while held stops the next submit until a fresh idle window', async () => {
    // Two real 1-minute idle windows by design (see header).
    test.setTimeout(300_000);
    app = await launchApp(userData, homeOverride);
    const page = await firstWindow(app);
    await setIdleE2EFlag(page);

    const surface = await openScene(page, STORY_A);
    await typeInEditor(page, surface, 'x');

    const sidebar = await openContinuity(page);
    const before = new Set(await manuscriptScanJobIds(page));
    const newJobs = async () => (await manuscriptScanJobIds(page)).filter((id) => !before.has(id));

    // Scope A (Scene) then scope B (Chapter): two distinct type+scope keys.
    await pickScope(page, sidebar, 'Scene');
    await clickScan(sidebar);
    await expect.poll(() => stagedKeys(page), { timeout: 10_000 }).toEqual([KEY_SCENE]);
    await pickScope(page, sidebar, 'Chapter');
    await clickScan(sidebar);
    await expect.poll(() => stagedKeys(page), { timeout: 10_000 }).toEqual([KEY_SCENE, KEY_CHAPTER]);

    // Staged is not submitted: neither scope has a job row yet.
    expect(await newJobs()).toEqual([]);
    const queued = sidebar.getByTestId('cp-bg-scan-queued');
    await expect(queued).toContainText('1 minute');
    await expect(queued).toContainText(MAY_FINISH);

    // Restart the idle clock right before arming, so the first flush cannot
    // begin before the hold is armed.
    await typeInEditor(page, surface, 'y');
    await gateCall(page, 'arm2');

    // (1) hold: the flush parks right before the SECOND submit, after one
    // real idle window. The first (Scene) job is already in the queue.
    await expect.poll(() => isHeld(page), { timeout: 90_000, intervals: [1_000] }).toBe(true);
    const firstJobs = await newJobs();
    expect(firstJobs).toHaveLength(1);
    expect(await stagedKeys(page)).toEqual([KEY_CHAPTER]);

    // A real editable keydown in the scene editor while the flush is held.
    const typedAt = await typeInEditor(page, surface, 'z');
    // (2) recheck after release: the typing must stop the Chapter submit.
    await gateCall(page, 'release');
    await expect.poll(() => isHeld(page), { timeout: 5_000 }).toBe(false);
    await page.waitForTimeout(2_000);
    expect(await newJobs()).toEqual(firstJobs);
    expect(await stagedKeys(page)).toEqual([KEY_CHAPTER]);

    // Hard fail if the Chapter scan goes out before a fresh idle window.
    while (Date.now() - typedAt < IDLE_MS - 15_000) {
      expect(await newJobs(), 'Chapter scan submitted before a fresh idle window').toEqual(firstJobs);
      expect(await stagedKeys(page)).toEqual([KEY_CHAPTER]);
      await page.waitForTimeout(3_000);
    }

    // (3)+(4) after the fresh idle window: Chapter is submitted, nothing staged.
    await expect.poll(async () => (await newJobs()).length, { timeout: 90_000, intervals: [1_000] }).toBe(2);
    expect(Date.now() - typedAt).toBeGreaterThanOrEqual(IDLE_MS - 15_000);
    expect(await stagedKeys(page)).toEqual([]);
    expect((await newJobs()).filter((id) => !firstJobs.includes(id))).toHaveLength(1);
    await expect(queued).toHaveCount(0);
  });

  test('TC-IC-02: Settings → Editor → Idle catch-up persists across a relaunch', async () => {
    // Two cold Electron launches.
    test.setTimeout(150_000);
    // The setting under test is not seeded: a fresh profile has no key.
    unseedIdleCatchUp(userData);
    app = await launchApp(userData, homeOverride);
    let page = await firstWindow(app);
    expect(readAppSettings(userData)).not.toHaveProperty('idleCatchUp');

    await openSettingsDialog(page);
    let dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await editorCategoryTab(dialog).click();
    await expect(dialog.getByRole('heading', { name: 'Idle catch-up' })).toBeVisible({ timeout: 8_000 });

    let enabled = dialog.getByRole('checkbox', { name: 'Wait for a typing pause before background scans' });
    let minutes = dialog.getByRole('spinbutton', { name: 'Minutes without typing' });
    // Fresh-profile defaults: on, 2 minutes.
    await expect(enabled).toBeChecked();
    await expect(minutes).toHaveValue('2');

    // Off disables the minutes field and says scans start right away; back on.
    await enabled.uncheck();
    await expect(minutes).toBeDisabled();
    await expect(dialog.getByText(/Off: background scans start right away\./)).toBeVisible();
    await enabled.check();
    await expect(minutes).toBeEnabled();
    await expect(dialog.getByText(MAY_FINISH, { exact: false })).toBeVisible();

    await minutes.fill('5');
    await minutes.blur();
    await expect(minutes).toHaveValue('5');

    // Normal close path — it saves.
    await dialog.getByRole('button', { name: 'Close settings' }).click();
    await expect(dialog).toBeHidden({ timeout: 8_000 });
    await expect.poll(() => readAppSettings(userData).idleCatchUp, { timeout: 10_000 })
      .toEqual({ enabled: true, minutes: 5 });

    await closeApp(app);
    app = undefined;

    app = await launchApp(userData, homeOverride);
    page = await firstWindow(app);
    await openSettingsDialog(page);
    dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await editorCategoryTab(dialog).click();
    await expect(dialog.getByRole('heading', { name: 'Idle catch-up' })).toBeVisible({ timeout: 8_000 });
    enabled = dialog.getByRole('checkbox', { name: 'Wait for a typing pause before background scans' });
    minutes = dialog.getByRole('spinbutton', { name: 'Minutes without typing' });
    await expect(enabled).toBeChecked();
    await expect(minutes).toHaveValue('5');
    expect(readAppSettings(userData).idleCatchUp).toEqual({ enabled: true, minutes: 5 });
  });

  test('TC-IC-03: a staged scan is dropped on a real vault switch and never reaches the new vault', async () => {
    // One real 1-minute idle window after the switch.
    test.setTimeout(240_000);
    app = await launchApp(userData, homeOverride);
    const page = await firstWindow(app);
    await setIdleE2EFlag(page);
    // A full page reload would also empty the buffer; this marker proves the
    // clear happened in the same renderer.
    await page.evaluate(() => {
      (window as IdleE2EWindow).__idleCatchUpPageMarker__ = 'before-switch';
    });

    await page.locator('[data-testid="nav-rail-vaults"]').waitFor({ timeout: 30_000 });
    const tileA = page.locator(`[data-testid="nav-rail-vault-tile-${storyA}"]`);
    const tileB = page.locator(`[data-testid="nav-rail-vault-tile-${storyB}"]`);
    await expect(tileA).toHaveClass(/nav-rail__vault-tile--active/);

    const surface = await openScene(page, STORY_A);
    await typeInEditor(page, surface, 'x');

    const sidebar = await openContinuity(page);
    const beforeA = new Set(await manuscriptScanJobIds(page));
    await pickScope(page, sidebar, 'Scene');
    await clickScan(sidebar);
    await expect.poll(() => stagedKeys(page), { timeout: 10_000 }).toEqual([KEY_SCENE]);
    expect((await manuscriptScanJobIds(page)).filter((id) => !beforeA.has(id))).toEqual([]);
    await expect(sidebar.getByTestId('cp-bg-scan-queued')).toBeVisible();

    // Keep the idle clock fresh so the switch lands well inside the window.
    const typedAt = await typeInEditor(page, surface, 'y');

    // Real switch through the nav-rail tile (window.api.projectSwitch path).
    await tileB.click();
    await expect.poll(() => readVaultSettings(userData).vaultRoot, { timeout: 30_000 }).toBe(storyB);
    await expect(tileB).toHaveClass(/nav-rail__vault-tile--active/);
    expect(Date.now() - typedAt, 'switch must land before the idle window elapses').toBeLessThan(IDLE_MS);

    // Same renderer, staged work cleared by the switch — not by an idle flush.
    await expect.poll(() => page.evaluate(() => (window as IdleE2EWindow).__idleCatchUpPageMarker__))
      .toBe('before-switch');
    await expect.poll(() => stagedKeys(page), { timeout: 10_000 }).toEqual([]);
    await expect(page.getByTestId('cp-bg-scan-queued')).toHaveCount(0);

    // Past a full idle window: nothing was submitted to the new vault, whose
    // scene shares the staged scan's scene id (so a stray submit would have
    // resolved and produced a job row here).
    const waitMs = typedAt + IDLE_MS + 15_000 - Date.now();
    if (waitMs > 0) await page.waitForTimeout(waitMs);
    expect(await stagedKeys(page)).toEqual([]);
    expect(await manuscriptScanJobIds(page)).toEqual([]);
  });
});
