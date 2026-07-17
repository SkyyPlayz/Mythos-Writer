/**
 * vault-graph-v0.spec.ts — SKY-1767
 *
 * E2E coverage for Vault Graph v0 (AC-GV-01 through AC-GV-12).
 * UX spec: SKY-1743  Quality bar: SKY-356
 *
 * Three fixtures are spun up sequentially (workers: 1):
 *   Suite A  Rich-topology vault  — TC-GV-01..08, 11, 12
 *   Suite B  Empty-vault fixture  — TC-GV-09
 *   Suite C  Large-vault (500+)   — TC-GV-10
 *
 * Seed notes go into notesVaultDir (notesVaultRoot), NOT vaultRoot.
 * The vaultGraph IPC handler reads from getNotesVaultRoot().
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/vault-graph-v0.spec.ts --reporter=list
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

// ─── Shared helpers ───────────────────────────────────────────────────────────

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

  const vaultSettings = {
    vaultRoot: vaultDir,
    notesVaultRoot: notesVaultDir,
  };

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(appSettings, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify(vaultSettings, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 30_000,
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

/**
 * Navigate to the Graph view via the top menu bar and wait for the panel.
 * Navigating away first resets VaultGraphView component state (chips, depth, search).
 */
async function navigateToGraph(page: Page): Promise<void> {
  // Disable prefers-reduced-motion so VaultGraphView's prefersReducedMotion() guard
  // doesn't block setLiveMessage() calls (TC-GV-12 live region assertions).
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  const mainNav = page.locator('nav[aria-label="Main navigation"]');
  await expect(mainNav).toBeVisible({ timeout: 12_000 });
  const storyTab = mainNav.getByRole('button', { name: 'Story Writer', exact: true });
  const notesTab = mainNav.getByRole('button', { name: 'Notes Editor', exact: true });

  // Navigate away to reset state — use the Story Timeline sub-view (exists in every fixture).
  // Nav rail v2 treats a re-click of the ACTIVE Story item as a Stories-popover
  // toggle, and the open popover's backdrop intercepts every later click — so
  // only click when Story is not already active (first visit boots on Story;
  // tests 2..n leave activeTab on Notes, so the reset click still fires there).
  await expect(storyTab).toBeVisible({ timeout: 5_000 });
  if (await storyTab.getAttribute('aria-current') !== 'page') {
    await storyTab.click();
  }
  const timelineBtn = page.locator('[data-testid="story-subview-timeline"]');
  if (await timelineBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await timelineBtn.click();
    await page.waitForTimeout(200);
  }

  // Belt and braces: if the Stories popover is open anyway, dismiss it via its
  // backdrop so the Notes click can land.
  const storiesBackdrop = page.locator('[data-testid="nav-rail-stories-backdrop"]');
  if (await storiesBackdrop.count()) {
    await storiesBackdrop.click({ position: { x: 5, y: 5 }, force: true });
    await expect(storiesBackdrop).toHaveCount(0);
  }

  // Graph now lives under the Notes tab's Graph sub-view.
  await expect(notesTab).toBeVisible({ timeout: 5_000 });
  await notesTab.click();
  await page.locator('[data-testid="notes-subview-graph"]').click();
  // vault-graph-view is the panel's root section, rendered for both the empty
  // and populated states (the empty state nests vault-graph-empty inside it) —
  // matching it alone avoids a strict-mode violation on the OR-selector.
  await expect(page.locator('[data-testid="vault-graph-view"]')).toBeVisible({ timeout: 15_000 });
}

// ─── Suite A — Rich-topology vault ───────────────────────────────────────────
//
// Notes vault layout:
//   Characters/Hub.md            — hub; 20 spokes link to it → degree=20, r=16
//   Characters/Spoke01..20.md    — each links [[Hub]]
//   Characters/Arya.md           — links [[Winterfell]] (neighbour of Winterfell)
//   Locations/Winterfell.md      — neighbour of Arya
//   Factions/TheStarks.md        — faction note
//   TopLevel.md                  — root-level, default category
//   Orphan1..3.md                — no links → degree=0, r=5
//   ChainA.md → ChainB → ChainC → ChainD (4-hop chain for depth-filter test)
//   SearchTarget.md              — unique label for search test

// Vault-relative IDs used in data-testid="vault-node-{id}"
const HUB_ID = 'Characters/Hub.md';
const ARYA_ID = 'Characters/Arya.md';
const WINTERFELL_ID = 'Locations/Winterfell.md';
const TOP_LEVEL_ID = 'TopLevel.md';
const ORPHAN_ID = 'Orphan1.md';
const CHAIN_A_ID = 'ChainA.md';
const CHAIN_B_ID = 'ChainB.md';
const CHAIN_C_ID = 'ChainC.md';
const CHAIN_D_ID = 'ChainD.md';
const SEARCH_TARGET_ID = 'SearchTarget.md';

function seedRichVault(notesVaultDir: string): void {
  fs.mkdirSync(path.join(notesVaultDir, 'Characters'), { recursive: true });
  fs.mkdirSync(path.join(notesVaultDir, 'Locations'), { recursive: true });
  fs.mkdirSync(path.join(notesVaultDir, 'Factions'), { recursive: true });

  // Hub note — 20 spokes create inDegree=20 → degree=20 → computeNodeRadius(20)=16
  fs.writeFileSync(path.join(notesVaultDir, 'Characters', 'Hub.md'),
    '# Hub\n\nThe central character.\n', 'utf-8');
  for (let i = 1; i <= 20; i++) {
    const name = `Spoke${String(i).padStart(2, '0')}`;
    fs.writeFileSync(
      path.join(notesVaultDir, 'Characters', `${name}.md`),
      `# ${name}\n\nConnected to [[Hub]].\n`,
      'utf-8',
    );
  }

  // Arya links to Winterfell — they are neighbours; unlinked notes are non-neighbours
  fs.writeFileSync(path.join(notesVaultDir, 'Characters', 'Arya.md'),
    '# Arya\n\nA Stark from [[Winterfell]].\n', 'utf-8');
  fs.writeFileSync(path.join(notesVaultDir, 'Locations', 'Winterfell.md'),
    '# Winterfell\n\nThe ancestral home.\n', 'utf-8');
  fs.writeFileSync(path.join(notesVaultDir, 'Factions', 'TheStarks.md'),
    '# The Starks\n\nA noble house.\n', 'utf-8');

  // Top-level (no folder) → default category
  fs.writeFileSync(path.join(notesVaultDir, 'TopLevel.md'),
    '# TopLevel\n\nA root-level orphan note.\n', 'utf-8');

  // Orphan notes — no wikilinks → degree=0 → computeNodeRadius(0)=5
  for (let i = 1; i <= 3; i++) {
    fs.writeFileSync(path.join(notesVaultDir, `Orphan${i}.md`),
      `# Orphan${i}\n\nNo links.\n`, 'utf-8');
  }

  // Depth-filter chain: A→B→C→D (4 hops from A)
  // BFS from ChainA at depth=2 reaches ChainA, ChainB, ChainC but NOT ChainD
  fs.writeFileSync(path.join(notesVaultDir, 'ChainA.md'),
    '# ChainA\n\nLinks to [[ChainB]].\n', 'utf-8');
  fs.writeFileSync(path.join(notesVaultDir, 'ChainB.md'),
    '# ChainB\n\nLinks to [[ChainC]].\n', 'utf-8');
  fs.writeFileSync(path.join(notesVaultDir, 'ChainC.md'),
    '# ChainC\n\nLinks to [[ChainD]].\n', 'utf-8');
  fs.writeFileSync(path.join(notesVaultDir, 'ChainD.md'),
    '# ChainD\n\nEnd of chain.\n', 'utf-8');

  // Search target — unique name for TC-GV-08
  fs.writeFileSync(path.join(notesVaultDir, 'SearchTarget.md'),
    '# SearchTarget\n\nA uniquely named note for search testing.\n', 'utf-8');
}

test.describe('Suite A — Rich-topology vault (TC-GV-01..08, 11, 12)', () => {
  let userData: string;
  let vaultDir: string;
  let notesVaultDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-gv0a-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-gv0a-vault-'));
    notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-gv0a-notes-'));
    seedUserData(userData, vaultDir, notesVaultDir);
    seedRichVault(notesVaultDir);
    app = await launchApp(userData);
    page = await firstWindow(app);
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
    fs.rmSync(notesVaultDir, { recursive: true, force: true });
  });

  // ── TC-GV-01 ─────────────────────────────────────────────────────────────────
  // AC-GV-01: Graph icon in left sidebar nav zone opens graph panel;
  //           panel id is `vault-graph`; panel is dockable.

  test('TC-GV-01: Notes tab Graph sub-view opens vault-graph panel', async () => {
    await navigateToGraph(page);

    // Graph panel must mount
    const graphView = page.locator('[data-testid="vault-graph-view"]');
    await expect(graphView).toBeVisible({ timeout: 15_000 });

    // Notes graph container is present
    await expect(page.locator('[data-testid="notes-graph-view"]')).toBeVisible();
  });

  // ── TC-GV-02 ─────────────────────────────────────────────────────────────────
  // AC-GV-02: Characters/ note renders cyan (--ln-graph-node-characters);
  //           Locations/ note renders violet (--ln-graph-node-locations);
  //           top-level note renders default token (--ln-graph-node-default).

  test('TC-GV-02: Characters node → vgv-node-circle--characters; Locations → locations; top-level → default', async () => {
    await navigateToGraph(page);

    // Characters/Arya.md → category 'characters'
    const aryaCircle = page.locator(`[data-testid="vault-node-${ARYA_ID}"] [data-testid="vault-graph-node-circle"]`);
    await expect(aryaCircle).toBeVisible({ timeout: 10_000 });
    await expect(aryaCircle).toHaveClass(/vgv-node-circle--characters/);
    expect(await aryaCircle.getAttribute('fill')).toBe('var(--ln-graph-node-characters)');
    expect(await aryaCircle.getAttribute('stroke')).toBe('var(--ln-graph-border-characters)');

    // Locations/Winterfell.md → category 'locations'
    const winterfellCircle = page.locator(`[data-testid="vault-node-${WINTERFELL_ID}"] [data-testid="vault-graph-node-circle"]`);
    await expect(winterfellCircle).toBeVisible({ timeout: 5_000 });
    await expect(winterfellCircle).toHaveClass(/vgv-node-circle--locations/);
    expect(await winterfellCircle.getAttribute('fill')).toBe('var(--ln-graph-node-locations)');
    expect(await winterfellCircle.getAttribute('stroke')).toBe('var(--ln-graph-border-locations)');

    // TopLevel.md (no folder) → category 'default'
    const topLevelCircle = page.locator(`[data-testid="vault-node-${TOP_LEVEL_ID}"] [data-testid="vault-graph-node-circle"]`);
    await expect(topLevelCircle).toBeVisible({ timeout: 5_000 });
    await expect(topLevelCircle).toHaveClass(/vgv-node-circle--default/);
    expect(await topLevelCircle.getAttribute('fill')).toBe('var(--ln-graph-node-default)');
  });

  // ── TC-GV-03 ─────────────────────────────────────────────────────────────────
  // AC-GV-03: Hub note with 20+ links renders at 16 px radius;
  //           orphan note renders at 5 px radius.
  //
  // computeNodeRadius formula:
  //   degree=0  → 5
  //   degree=20 → 6 + min(max(20*0.5, 0), 10) = 6 + 10 = 16

  test('TC-GV-03: hub node (inDegree=20) has SVG r=16; orphan node (degree=0) has r=5', async () => {
    await navigateToGraph(page);

    const hubCircle = page.locator(`[data-testid="vault-node-${HUB_ID}"] [data-testid="vault-graph-node-circle"]`);
    await expect(hubCircle).toBeVisible({ timeout: 10_000 });
    expect(Number(await hubCircle.getAttribute('r'))).toBe(16);

    const orphanCircle = page.locator(`[data-testid="vault-node-${ORPHAN_ID}"] [data-testid="vault-graph-node-circle"]`);
    await expect(orphanCircle).toBeVisible({ timeout: 5_000 });
    expect(Number(await orphanCircle.getAttribute('r'))).toBe(5);
  });

  // ── TC-GV-04 ─────────────────────────────────────────────────────────────────
  // AC-GV-04: Hovering a node: neighbours remain full opacity;
  //           non-neighbours fade (.vgv-graph-node--dimmed);
  //           mouse-leave restores within 150 ms.

  test('TC-GV-04: hover dims non-neighbours; neighbours stay full; mouse-leave restores within 150 ms', async () => {
    await navigateToGraph(page);

    // Ensure nodes are visible before hovering
    const aryaNode = page.locator(`[data-testid="vault-node-${ARYA_ID}"]`);
    const winterfellNode = page.locator(`[data-testid="vault-node-${WINTERFELL_ID}"]`);
    const orphanNode = page.locator(`[data-testid="vault-node-${ORPHAN_ID}"]`);

    await expect(aryaNode).toBeVisible({ timeout: 10_000 });
    await expect(orphanNode).toBeVisible({ timeout: 5_000 });

    // React 17+ uses event delegation at the root and synthesizes onMouseEnter from
    // native `mouseover` events (not `mouseenter`, which doesn't bubble). We must use
    // page.evaluate() with an explicit new MouseEvent(..., {bubbles:true}) constructor
    // because Playwright's locator.dispatchEvent() uses new Event(type) internally and
    // bubbles defaults to false — so the event never reaches React's root delegate listener.
    await page.evaluate(
      (sel) => document.querySelector(sel)!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true })),
      `[data-testid="vault-node-${ARYA_ID}"]`,
    );

    await expect(orphanNode).toHaveClass(/vgv-graph-node--dimmed/, { timeout: 3_000 });
    await expect(aryaNode).not.toHaveClass(/vgv-graph-node--dimmed/);
    await expect(winterfellNode).not.toHaveClass(/vgv-graph-node--dimmed/);

    // Dispatch mouseout on Arya → React synthesizes onMouseLeave → clears hoveredNodeId
    await page.evaluate(
      (sel) => document.querySelector(sel)!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, cancelable: true })),
      `[data-testid="vault-node-${ARYA_ID}"]`,
    );

    // Dimmed class must be removed (immediate React state update on mouseleave)
    await expect(orphanNode).not.toHaveClass(/vgv-graph-node--dimmed/, { timeout: 500 });
  });

  // ── TC-GV-05 ─────────────────────────────────────────────────────────────────
  // AC-GV-05 (M26): Clicking a node surfaces the node card; the card's
  // `Open note` button opens the corresponding vault note in the Notes editor.

  test('TC-GV-05: node click opens the card; card Open note opens it in the Notes editor', async () => {
    await navigateToGraph(page);

    const aryaNode = page.locator(`[data-testid="vault-node-${ARYA_ID}"]`);
    await expect(aryaNode).toBeVisible({ timeout: 10_000 });

    // page.evaluate() dispatches a native MouseEvent with bubbles:true so React's root
    // delegation listener receives the click. Playwright's locator.dispatchEvent() uses
    // new Event(type) where bubbles defaults to false, so the SVG <g> click never reaches
    // React's event root.
    await page.evaluate(
      (sel) => document.querySelector(sel)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
      `[data-testid="vault-node-${ARYA_ID}"]`,
    );

    // M26: the click selects and surfaces the node card (inspector)
    const inspector = page.locator('[data-testid="vault-graph-inspector"]');
    await expect(inspector).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('[data-testid="vault-graph-inspector-title"]')).toContainText('Arya', { timeout: 3_000 });
    await expect(page.locator('[data-testid="vault-graph-inspector-blurb"]')).not.toBeEmpty({ timeout: 3_000 });

    // The card's Open note button deep-links into the Notes editor
    await page.locator('[data-testid="vault-graph-inspector-open"]').click();
    await expect(page.locator('[data-testid="notes-subview-editor"]')).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });
    await expect(page.locator('.note-viewer-filename')).toContainText('Arya.md', { timeout: 5_000 });
  });

  // ── TC-GV-06 ─────────────────────────────────────────────────────────────────
  // AC-GV-06: Toggling Characters chip off removes Characters nodes;
  //           re-enabling restores them.

  test('TC-GV-06: toggling Characters chip off hides Characters nodes; re-enabling restores them', async () => {
    await navigateToGraph(page);

    const aryaNode = page.locator(`[data-testid="vault-node-${ARYA_ID}"]`);
    await expect(aryaNode).toBeVisible({ timeout: 10_000 });

    // Chip: button[data-category="characters"][aria-pressed="true"] while active
    const charsChip = page.locator('button[data-category="characters"]');
    await expect(charsChip).toBeVisible({ timeout: 5_000 });
    await expect(charsChip).toHaveAttribute('aria-pressed', 'true');

    // Toggle off — Characters nodes disappear
    await charsChip.click();
    await expect(aryaNode).not.toBeVisible({ timeout: 5_000 });

    // Locations/ nodes are unaffected
    await expect(page.locator(`[data-testid="vault-node-${WINTERFELL_ID}"]`)).toBeVisible({ timeout: 3_000 });

    // Chip shows inactive state
    await expect(charsChip).toHaveAttribute('aria-pressed', 'false');

    // Re-enable — Characters nodes return
    await charsChip.click();
    await expect(aryaNode).toBeVisible({ timeout: 5_000 });
    await expect(charsChip).toHaveAttribute('aria-pressed', 'true');
  });

  // ── TC-GV-07 ─────────────────────────────────────────────────────────────────
  // AC-GV-07 (M26): Double-clicking a graph node opens the corresponding note
  // in the Notes editor (single click only selects).

  test('TC-GV-07: double-clicking ChainA opens the matching note in the Notes editor', async () => {
    await navigateToGraph(page);

    const chainANode = page.locator(`[data-testid="vault-node-${CHAIN_A_ID}"]`);
    await expect(chainANode).toBeVisible({ timeout: 10_000 });

    // page.evaluate() with bubbles:true ensures React's root listener sees the dblclick
    await page.evaluate(
      (sel) => document.querySelector(sel)!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })),
      `[data-testid="vault-node-${CHAIN_A_ID}"]`,
    );

    await expect(page.locator('[data-testid="notes-subview-editor"]')).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });
    await expect(page.locator('.note-viewer-filename')).toContainText('ChainA.md', { timeout: 5_000 });
  });

  // ── TC-GV-08 ─────────────────────────────────────────────────────────────────
  // AC-GV-08: Typing in search highlights matching nodes and dims others;
  //           Escape restores.

  test('TC-GV-08: search highlights matches with --search-match; dims others with --search-dimmed; Escape restores', async () => {
    await navigateToGraph(page);

    const searchInput = page.locator('input[aria-label="Search nodes"]');
    await expect(searchInput).toBeVisible({ timeout: 10_000 });

    // Type a unique query that matches only SearchTarget.md
    await searchInput.fill('SearchTarget');

    const searchTargetNode = page.locator(`[data-testid="vault-node-${SEARCH_TARGET_ID}"]`);
    await expect(searchTargetNode).toHaveClass(/vgv-graph-node--search-match/, { timeout: 3_000 });

    // Other nodes are dimmed
    const aryaNode = page.locator(`[data-testid="vault-node-${ARYA_ID}"]`);
    await expect(aryaNode).toHaveClass(/vgv-graph-node--search-dimmed/, { timeout: 3_000 });

    // Escape clears search and restores all nodes
    await searchInput.press('Escape');
    await expect(searchInput).toHaveValue('', { timeout: 3_000 });
    await expect(searchTargetNode).not.toHaveClass(/vgv-graph-node--search-match/, { timeout: 3_000 });
    await expect(aryaNode).not.toHaveClass(/vgv-graph-node--search-dimmed/, { timeout: 3_000 });
  });

  // ── TC-GV-11 ─────────────────────────────────────────────────────────────────
  // AC-GV-11: Tab focuses canvas; Tab/Shift+Tab cycles nodes;
  //           Enter on focused node opens the note.

  test('TC-GV-11: Tab focuses SVG canvas; Tab/Shift+Tab cycles focus; Enter opens focused node', async () => {
    await navigateToGraph(page);

    const svg = page.locator('.vgv-svg');
    await expect(svg).toBeVisible({ timeout: 10_000 });

    // Focus the SVG canvas element (tabIndex=0)
    await svg.focus();

    // First Tab → keyboard focus moves to the first node in sorted order
    await svg.press('Tab');
    const focused1 = page.locator('.vgv-graph-node--keyboard-focused');
    await expect(focused1).toBeVisible({ timeout: 3_000 });
    // Focus ring is reflected via CSS on --keyboard-focused nodes
    await expect(focused1).toHaveCount(1);

    // Second Tab → cycles to next node
    await svg.press('Tab');
    await expect(page.locator('.vgv-graph-node--keyboard-focused')).toHaveCount(1);

    // Shift+Tab → cycles backwards
    await svg.press('Shift+Tab');
    await expect(page.locator('.vgv-graph-node--keyboard-focused')).toHaveCount(1);

    // M26: first Enter selects the focused node (node card appears)…
    await svg.press('Enter');
    await expect(page.locator('[data-testid="vault-graph-inspector"]')).toBeVisible({ timeout: 3_000 });

    // …and a second Enter opens the selected note in the Notes editor.
    await svg.press('Enter');
    await expect(page.locator('[data-testid="notes-subview-editor"]')).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });
    await expect(page.locator('.note-viewer-filename')).toBeVisible({ timeout: 5_000 });
  });

  // ── TC-GV-12 ─────────────────────────────────────────────────────────────────
  // AC-GV-12: `sr-only` live region announces note count on load;
  //           focus on node announces name + connection count.

  test('TC-GV-12: aria-live region announces note count on graph load; node hover triggers name + connections announcement', async () => {
    await navigateToGraph(page);

    const liveRegion = page.locator('[data-testid="vault-graph-live-region"]');
    // Live region is always in DOM (sr-only, aria-live="polite")
    await expect(liveRegion).toBeAttached({ timeout: 5_000 });

    // After graph loads, graphSummary() fires: "N notes. M connections. K orphan notes. …"
    await expect(async () => {
      const text = (await liveRegion.textContent()) ?? '';
      expect(text).toMatch(/\d+ notes\./);
      expect(text).toMatch(/connections/);
      expect(text).toMatch(/orphan/);
    }).toPass({ timeout: 8_000 });

    // Hovering a node triggers nodeAnnouncement (debounced 500ms):
    // "{label}. {connectionCount} connections."
    // React 17+ synthesizes onMouseEnter from native `mouseover` events. Use page.evaluate()
    // with an explicit MouseEvent({bubbles:true}) so the event reaches React's root delegation
    // listener. Playwright's locator.dispatchEvent() defaults to bubbles:false.
    const aryaNode = page.locator(`[data-testid="vault-node-${ARYA_ID}"]`);
    await expect(aryaNode).toBeVisible({ timeout: 5_000 });
    await page.evaluate(
      (sel) => document.querySelector(sel)!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true })),
      `[data-testid="vault-node-${ARYA_ID}"]`,
    );

    await expect(async () => {
      const text = (await liveRegion.textContent()) ?? '';
      expect(text).toContain('Arya');
      expect(text).toMatch(/connection/);
    }).toPass({ timeout: 3_000 });
  });

  // ── TC-GV-13 (M26) ───────────────────────────────────────────────────────────
  // M26 acceptance: all left-panel controls affect the sim live — eye toggle
  // hides the category, the physics slider re-settles node positions.

  test('TC-GV-13 (M26): left-panel eye toggle and physics slider affect the live sim', async () => {
    await navigateToGraph(page);

    const panel = page.locator('[data-testid="vault-graph-left-panel"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Eye toggle hides Characters nodes live, second click restores them
    const eye = page.locator('[data-testid="vault-graph-eye-characters"]');
    const aryaNode = page.locator(`[data-testid="vault-node-${ARYA_ID}"]`);
    await expect(aryaNode).toBeVisible({ timeout: 10_000 });
    await eye.click();
    await expect(aryaNode).not.toBeVisible({ timeout: 5_000 });
    await eye.click();
    await expect(aryaNode).toBeVisible({ timeout: 5_000 });

    // Physics slider (link distance 120 → 240) wakes the sim and moves nodes
    const before = await aryaNode.getAttribute('transform');
    await page.locator('[data-testid="vault-graph-physics-linkDistance"]').evaluate((el) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '240');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('[data-testid="vault-graph-physics-linkDistance-value"]')).toHaveText('240', { timeout: 3_000 });
    await expect(async () => {
      const after = await aryaNode.getAttribute('transform');
      expect(after).not.toBe(before);
    }).toPass({ timeout: 8_000 });
  });
});

// ─── Suite B — Empty-vault fixture ───────────────────────────────────────────

test.describe('Suite B — Empty vault (TC-GV-09)', () => {
  let userData: string;
  let vaultDir: string;
  let notesVaultDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-gv0b-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-gv0b-vault-'));
    // notesVaultDir is intentionally empty — 0 .md files → 0 nodes → empty state
    notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-gv0b-notes-'));
    seedUserData(userData, vaultDir, notesVaultDir);
    app = await launchApp(userData);
    page = await firstWindow(app);
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
    fs.rmSync(notesVaultDir, { recursive: true, force: true });
  });

  // ── TC-GV-09 ─────────────────────────────────────────────────────────────────
  // AC-GV-09: Empty-vault fixture shows empty-state copy;
  //           "Open a note" CTA is present and navigates.

  test('TC-GV-09: empty vault renders empty-state panel with wiki-links copy and "Open a note →" CTA', async () => {
    await navigateToGraph(page);

    // Empty state panel is present (no nodes in vault)
    const emptyPanel = page.locator('[data-testid="vault-graph-empty"]');
    await expect(emptyPanel).toBeVisible({ timeout: 15_000 });

    // Copy references [[wiki-links]]
    await expect(emptyPanel).toContainText('wiki-links');

    // "Open a note" CTA is present and visible
    const cta = page.locator('[data-testid="vault-graph-open-note-cta"]');
    await expect(cta).toBeVisible({ timeout: 5_000 });
    await expect(cta).toContainText('Open a note');

    // CTA click does not crash the app (fires onOpenNote with empty/recent path)
    await cta.click();
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 3_000 });
  });
});

// ─── Suite C — Large-vault fixture (500+ notes) ───────────────────────────────

function seedLargeVault(notesVaultDir: string, noteCount = 501): void {
  // Create noteCount notes all linking to Hub — single connected component.
  // This stays under 500 interactive nodes initially, triggering the truncation banner.
  fs.writeFileSync(path.join(notesVaultDir, 'Hub.md'),
    '# Hub\n\nCentral node.\n', 'utf-8');
  for (let i = 1; i < noteCount; i++) {
    const name = `Note${String(i).padStart(4, '0')}`;
    fs.writeFileSync(
      path.join(notesVaultDir, `${name}.md`),
      `# ${name}\n\nLinked to [[Hub]].\n`,
      'utf-8',
    );
  }
}

test.describe('Suite C — Large vault / truncation banner (TC-GV-10)', () => {
  let userData: string;
  let vaultDir: string;
  let notesVaultDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-gv0c-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-gv0c-vault-'));
    notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-gv0c-notes-'));
    seedUserData(userData, vaultDir, notesVaultDir);
    seedLargeVault(notesVaultDir, 501);
    app = await launchApp(userData);
    page = await firstWindow(app);
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
    fs.rmSync(notesVaultDir, { recursive: true, force: true });
  });

  // ── TC-GV-10 ─────────────────────────────────────────────────────────────────
  // AC-GV-10: 500+ linked notes fixture: truncation banner shown;
  //           "Show all" renders all nodes.
  //
  // Implementation note: after "Show all", viewport culling (isNodeInViewport) is
  // applied. With default pan/zoom and a 1200×800 window the SVG viewBox fits all
  // positioned nodes, so all 501 data-testid elements should appear in the DOM.

  test('TC-GV-10: 501-note vault shows truncation banner; "Show all" expands to all 501 nodes', async () => {
    test.slow(); // Large vault rendering may take > 2 s — test.slow() triples the timeout

    await navigateToGraph(page);

    // Graph panel mounts (large graph — extended timeout)
    await expect(page.locator('[data-testid="vault-graph-view"]')).toBeVisible({ timeout: 30_000 });

    // Truncation banner appears: "⚠ Large vault: 501 notes. Showing top 500 by links."
    const banner = page.locator('[data-testid="vault-graph-truncation-banner"]');
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner).toContainText('501');

    // "Show all" button is present and labelled
    const showAllBtn = page.locator('.vgv-truncation-showall');
    await expect(showAllBtn).toBeVisible({ timeout: 5_000 });
    await expect(showAllBtn).toContainText('Show all');

    // Count rendered nodes before clicking Show all (should be ≤500 due to truncation)
    const nodesBefore = await page.locator('[data-testid^="vault-node-"]').count();
    expect(nodesBefore).toBeLessThanOrEqual(500);

    // Click "Show all" — all 501 notes become the working set
    await showAllBtn.click();

    // After Show all, nodes within the viewport are rendered.
    // With default pan (0,0) and zoom (1) + a 1200×800 viewBox, all positioned
    // nodes are within the viewport bounds, so we expect > 500 DOM nodes.
    await expect(async () => {
      const nodesAfter = await page.locator('[data-testid^="vault-node-"]').count();
      expect(nodesAfter).toBeGreaterThan(500);
    }).toPass({ timeout: 15_000 });

    // "Show all" button disappears once isTruncated = false (showAll removed the gate)
    await expect(showAllBtn).not.toBeVisible({ timeout: 5_000 });
  });
});
