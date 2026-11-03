/**
 * page-panels-defaults.spec.ts — W1 (PLAN-WIDGET-SYSTEM-v2): scope model + page shell defaults.
 *
 * Widget shell beta flag ON (seeded `widgetShell: true`; W1 has no toggle and writes no settings):
 *   - Story Editor opens with the Story Navigator inside the page and a page-only inspector
 *     (`edPanel`: Scenes + Notes & Analysis; no Findings / Suggestions / partner).
 *   - The right sidebar holds the global partner; its Add menu splits Global vs This page,
 *     lists Findings as a full global panel, and never lists the Beta list.
 *   - Brainstorm shows the Idea Board with no page-level partner chat face.
 *   - Keyboard collapse works and the editor is never remounted (remount count 0).
 *   - axe passes on the page chrome.
 * AI Off (flag on): the partner, Findings, AI activity and Inbox are hidden or inert.
 * Flag OFF: the old shell, unchanged.
 *
 * Later slices (W5–W7) add their own user path + flag-off check with `openShell()`.
 */

import fs from 'fs';
import path from 'path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  firstWindow,
  launchApp,
  makeScratch,
  openSeededScene,
  rmScratch,
  seedUserData,
  seedVault,
  type Scratch,
} from './helpers/launchApp';
import { closeElectronApp } from './helpers/electronTeardown';

const AXE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../node_modules/axe-core/axe.min.js'), 'utf8');

interface ShellOptions {
  widgetShell: boolean;
  aiEnabled: boolean;
}

interface ShellSession {
  app: ElectronApplication;
  page: Page;
  scratch: Scratch;
}

/** Seeds a one-scene vault, applies the flag + AI mode, launches, and opens the Story Editor by clicking. */
async function openShell({ widgetShell, aiEnabled }: ShellOptions): Promise<ShellSession> {
  const scratch = makeScratch('page-panels');
  seedVault(scratch.vaultDir);
  seedUserData(scratch.userData, scratch.vaultDir, scratch.notesVaultDir);
  const settingsPath = path.join(scratch.userData, 'app-settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown> & {
    agents: Record<string, Record<string, unknown>>;
  };
  settings.agents.brainstorm = { ...settings.agents.brainstorm, enabled: true };
  const patched = {
    ...settings,
    ai: { enabled: aiEnabled },
    gettingStartedDismissed: true,
    vaultUpgradePromptShown: true,
    ...(widgetShell ? { widgetShell: true } : {}),
  };
  fs.writeFileSync(settingsPath, JSON.stringify(patched, null, 2));

  const app = await launchApp(scratch.userData);
  const page = await firstWindow(app);
  const notNow = page.getByRole('button', { name: /not now/i });
  if (await notNow.count()) await notNow.first().click().catch(() => {});
  await openSeededScene(page);
  return { app, page, scratch };
}

async function closeShell(session: ShellSession | undefined): Promise<void> {
  if (!session) return;
  await closeElectronApp(session.app);
  rmScratch(session.scratch);
}

interface AxeViolation {
  id: string;
  impact: string | null;
  nodes: { target: string[] }[];
}

/** Runs axe (WCAG 2 A/AA) on one element through CDP evaluate — the renderer CSP blocks script tags. */
async function axeViolations(page: Page, selector: string): Promise<AxeViolation[]> {
  await page.evaluate(AXE_SOURCE);
  return page.evaluate(async (sel) => {
    const target = document.querySelector(sel);
    if (!target) throw new Error(`axe target not found: ${sel}`);
    const axe = (window as unknown as {
      axe: { run: (root: Element, options: object) => Promise<{ violations: AxeViolation[] }> };
    }).axe;
    const result = await axe.run(target, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
    return result.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => ({ target: n.target })) }));
  }, selector);
}

const sidebar = (page: Page) => page.getByTestId('global-right-sidebar');
const editorInspector = (page: Page) => page.locator('#app-tabpanel-story').getByTestId('page-panel-edPanel');

test.describe('widget shell ON — page panels open inside their page', () => {
  test.describe.configure({ mode: 'serial' });
  let session: ShellSession | undefined;
  test.beforeAll(async () => { session = await openShell({ widgetShell: true, aiEnabled: true }); });
  test.afterAll(async () => { await closeShell(session); });

  test('Story Editor shows the Story Navigator in the page and a page-only inspector', async () => {
    const { page } = session!;
    const nav = page.locator('#app-tabpanel-story [data-panel-id="navEditor"]');
    await expect(nav).toBeVisible();
    await expect(nav).toHaveAttribute('data-scope', 'page:editor');
    await expect(nav.locator('.story-navigator')).toBeVisible();

    const inspector = editorInspector(page);
    await expect(inspector).toBeVisible();
    await expect(inspector).toHaveAttribute('data-scope', 'page:editor');
    await expect(inspector.getByRole('tab')).toHaveText(['Scenes', 'Notes & Analysis']);
    await expect(inspector.getByRole('tab', { name: /findings|suggestions/i })).toHaveCount(0);
    await expect(inspector.getByTestId('agent-hub-panel')).toHaveCount(0);

    // Global sidebar: the partner only, and no page panel inside it.
    await expect(sidebar(page).getByTestId('agent-hub-panel')).toBeVisible();
    await expect(sidebar(page).locator('[data-scope^="page:"]')).toHaveCount(0);
    await expect(sidebar(page).locator('[data-panel-id="navEditor"]')).toHaveCount(0);

    // Notes & Analysis is a page tab, and switching to it keeps the inspector page-only.
    await inspector.getByRole('tab', { name: 'Notes & Analysis' }).click();
    await expect(inspector.getByRole('tab', { name: 'Notes & Analysis' })).toHaveAttribute('aria-selected', 'true');
    await expect(inspector.getByTestId('agent-hub-panel')).toHaveCount(0);
  });

  test('Add menu: Global vs This page sections, Findings as a full global panel, no Beta list', async () => {
    const { page } = session!;
    await sidebar(page).getByTestId('grs-add-panel-btn').click();
    const globalSection = page.getByTestId('grs-add-panel-section-global');
    const pageSection = page.getByTestId('grs-add-panel-section-page');
    await expect(globalSection).toBeVisible();
    await expect(pageSection).toBeVisible();

    const findings = globalSection.getByTestId('grs-add-panel-item-findings');
    await expect(findings).toBeEnabled();
    await expect(findings).toHaveAttribute('data-scope', 'global');
    await expect(findings).toHaveAttribute('data-kind', 'full');
    await expect(page.getByTestId('grs-add-panel-item-navBeta')).toHaveCount(0);
    await expect(page.getByTestId('grs-add-panel-item-betaPanel')).toHaveCount(0);
    await expect(globalSection.locator('[data-scope^="page:"]')).toHaveCount(0);
    await expect(pageSection.locator('[data-scope="global"]')).toHaveCount(0);

    expect(await axeViolations(page, '[data-testid="grs-add-panel-popover"]')).toEqual([]);

    await findings.click();
    const findingsPanel = sidebar(page).getByTestId('global-panel-findings');
    await expect(findingsPanel).toBeVisible();
    await expect(findingsPanel).toHaveAttribute('data-scope', 'global');
    await expect(editorInspector(page).getByTestId('global-panel-findings')).toHaveCount(0);
  });

  test('keyboard collapse works and never remounts the editor', async () => {
    const { page } = session!;
    await page.evaluate(() => {
      const editor = document.querySelector('#app-tabpanel-story .ProseMirror');
      if (!editor) throw new Error('editor not mounted');
      (window as unknown as { __w1Editor?: Element }).__w1Editor = editor;
    });
    const editorRemounts = () => page.evaluate(() => {
      const before = (window as unknown as { __w1Editor?: Element }).__w1Editor;
      const now = document.querySelector('#app-tabpanel-story .ProseMirror');
      return before && before.isConnected && now === before ? 0 : 1;
    });

    const collapse = editorInspector(page).getByRole('button', { name: 'Collapse Editor inspector' });
    await collapse.focus();
    await page.keyboard.press('Enter');
    const expand = editorInspector(page).getByRole('button', { name: 'Expand Editor inspector' });
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expect(expand).toBeFocused();
    await expect(editorInspector(page).getByRole('tablist')).toBeHidden();
    expect(await editorRemounts()).toBe(0);

    await page.keyboard.press('Space');
    await expect(editorInspector(page).getByRole('button', { name: 'Collapse Editor inspector' })).toHaveAttribute('aria-expanded', 'true');
    await expect(editorInspector(page).getByRole('tablist')).toBeVisible();
    expect(await editorRemounts()).toBe(0);

    // Docking the global sidebar away and back is a layout change too.
    await sidebar(page).getByRole('button', { name: 'Hide right sidebar' }).click();
    await page.getByRole('button', { name: 'Show right sidebar' }).click();
    await expect(sidebar(page)).toBeVisible();
    expect(await editorRemounts()).toBe(0);

    // Hot path: a collapse toggle must paint within 2x the idle frame time (p95).
    const timing = await page.evaluate(async () => {
      const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
      const p95 = (values: number[]) => {
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
      };
      const idle: number[] = [];
      let last = await frame();
      for (let i = 0; i < 30; i += 1) { const now = await frame(); idle.push(now - last); last = now; }
      const toggles: number[] = [];
      for (let i = 0; i < 10; i += 1) {
        const button = document.querySelector<HTMLButtonElement>('[data-testid="page-panel-edPanel-collapse"]');
        if (!button) throw new Error('collapse button missing');
        await frame();
        const start = performance.now();
        button.click();
        await frame();
        toggles.push(performance.now() - start);
      }
      return { idleP95: p95(idle), toggleP95: p95(toggles) };
    });
    console.log(`[W1 hot path] collapse toggle p95 ${timing.toggleP95.toFixed(1)} ms vs idle frame p95 ${timing.idleP95.toFixed(1)} ms`);
    expect(timing.toggleP95).toBeLessThanOrEqual(2 * timing.idleP95);
    expect(await editorRemounts()).toBe(0);
  });

  test('axe passes on the page chrome', async () => {
    const { page } = session!;
    expect(await axeViolations(page, '[data-testid="page-panel-edPanel"]')).toEqual([]);
  });

  test('Brainstorm shows the Idea Board and no page-level partner chat', async () => {
    const { page } = session!;
    await page.locator('[data-testid="nav-rail-brainstorm"]').click();
    const brainstorm = page.locator('#app-tabpanel-brainstorm');
    await expect(brainstorm).toBeVisible({ timeout: 10_000 });

    await expect(brainstorm.getByTestId('bs-collections')).toBeVisible();
    await expect(brainstorm.getByTestId('bsc-board')).toBeVisible();
    await expect(page.getByTestId('bsc-mode-chat')).toHaveCount(0);
    await expect(page.getByTestId('bs-board-side')).toHaveCount(0);
    await expect(brainstorm.locator('.brainstorm-input')).toHaveCount(0);

    // The partner stays global: the sidebar keeps it, and Brainstorm never claims the sidebar.
    await expect(sidebar(page).getByTestId('agent-hub-panel')).toBeVisible();
    await expect(sidebar(page).locator('.brainstorm-facts-col')).toHaveCount(0);
  });
});

test.describe('widget shell ON + AI Off — AI global panels are hidden or inert', () => {
  test.describe.configure({ mode: 'serial' });
  let session: ShellSession | undefined;
  test.beforeAll(async () => { session = await openShell({ widgetShell: true, aiEnabled: false }); });
  test.afterAll(async () => { await closeShell(session); });

  test('agent, findings, activity and inbox follow the AI Off rule', async () => {
    const { page } = session!;
    // agent: the partner tab is gone from the global sidebar.
    await expect(sidebar(page).getByTestId('ahp-tab-partner')).toHaveCount(0);
    await expect(sidebar(page).getByTestId('ahp-tab-suggestions')).toHaveCount(0);

    await sidebar(page).getByTestId('grs-add-panel-btn').click();
    // findings: listed but inert, with the reason, and cannot be added.
    const findings = page.getByTestId('grs-add-panel-item-findings');
    await expect(findings).toBeDisabled();
    await expect(page.getByTestId('grs-add-panel-popover')).toContainText('Turn AI on in Settings to add this panel.');
    // agent / activity / inbox: not offered at all.
    await expect(page.getByTestId('grs-add-panel-item-agent')).toHaveCount(0);
    await expect(page.getByTestId('grs-add-panel-item-activity')).toHaveCount(0);
    await expect(page.getByTestId('grs-add-panel-item-inbox')).toHaveCount(0);
    await findings.click({ force: true }).catch(() => {});
    await expect(page.getByTestId('global-panel-findings')).toHaveCount(0);

    // The page-only inspector still works with AI off.
    await page.keyboard.press('Escape');
    await expect(editorInspector(page).getByRole('tab')).toHaveText(['Scenes', 'Notes & Analysis']);
  });
});

test.describe('widget shell OFF — the old shell, unchanged', () => {
  test.describe.configure({ mode: 'serial' });
  let session: ShellSession | undefined;
  test.beforeAll(async () => { session = await openShell({ widgetShell: false, aiEnabled: true }); });
  test.afterAll(async () => { await closeShell(session); });

  test('no page dock, no scoped Add menu, and the four-tab right panel', async () => {
    const { page } = session!;
    await expect(page.locator('.story-navigator')).toBeVisible();
    await expect(page.getByTestId('page-panel-edPanel')).toHaveCount(0);
    await expect(page.locator('[data-panel-id]')).toHaveCount(0);
    await expect(page.getByTestId('grs-add-panel-btn')).toHaveCount(0);
    await expect(page.getByTestId('grs-extra-panels')).toHaveCount(0);
    for (const tab of ['partner', 'suggestions', 'scenes', 'notes-analysis']) {
      await expect(sidebar(page).getByTestId(`ahp-tab-${tab}`)).toBeVisible();
    }
  });

  test('Brainstorm keeps its chat face and claims the sidebar as before', async () => {
    const { page } = session!;
    await page.locator('[data-testid="nav-rail-brainstorm"]').click();
    await expect(page.locator('#app-tabpanel-brainstorm')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('bsc-mode-chat').first()).toBeAttached();
    await expect(sidebar(page).locator('.brainstorm-facts-col')).toHaveCount(1);
  });
});
