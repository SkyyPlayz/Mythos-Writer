// SKY-11480 — Liquid Neon fidelity sweep capture (READ-ONLY analysis).
//
// Produces the evidence for the per-surface gap list across the three surfaces
// SKY-11439 named: Scene Crafter, the Notes Board / Boards canvas, and the
// dialog/popover overlay tier.
//
// Two kinds of evidence, because they answer different questions:
//
//  1. In-situ screenshots — what the surface actually looks like in the real
//     app, reached by ordinary clicks (§4c: nothing under test is pre-seeded;
//     the vault notes only stock the reference columns).
//
//  2. A computed-style probe grid — for the overlay tier the question is
//     "does surface X render the glass chrome?" for ~30 dialogs and popovers.
//     Driving all thirty through real flows is neither cheap nor stable, so
//     instead each catalogued class is mounted inside the live app root and
//     `getComputedStyle` is read off it. That resolves against the running
//     theme engine, so the numbers are the real ones the user would see —
//     and the grid is screenshotted so every row has a picture too.
//
// Harness rules: see lib.mjs header.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('capture-sky11480-fidelity-sweep');
const VIEWPORT = { width: 1600, height: 1000 };

// Stocks the Scene Crafter reference columns + gives the Boards canvas folders
// to lay out. Only the vault content is seeded — never a board sidecar.
const NOTES = [
  ['Characters/Mira Veynn.md', 'Reluctant heir — resourceful, haunted.'],
  ['Characters/Kael Thorne.md', 'Smuggler — witty, guarded, survivor.'],
  ['Characters/The Broker.md', 'Antagonist — elusive, always watching.'],
  ['Locations/The Undercity.md', 'Drowned streets, stacked walkways.'],
  ['Locations/The Sunken Gate.md', 'Ancient floodgate. Opens at low tide.'],
  ['Items & Systems/Map Fragment.md', 'Redraws itself at low tide.'],
  ['Items & Systems/Drownlight.md', 'Burns underwater. Misbehaves near flame.'],
  ['Worldbuilding/Tide Mechanics.md', 'The rules by which the deep breathes.'],
];

// ── the overlay-tier catalogue ───────────────────────────────────────────────
// Every floating dialog / popover / menu surface in the app, with the ancestor
// chain its CSS needs to match. `ln-overlay-surface` entries are the ones
// PR #1467 migrated; the rest are what this sweep is here to measure.
const OVERLAY_CATALOGUE = [
  // — reference: the shared tier itself —
  ['REFERENCE .ln-overlay-surface', 'div.ln-overlay-surface', null],

  // — shared primitives (one gap each, many surfaces downstream) —
  ['ui/Menu .ln-menu', 'div.ln-menu', null],
  ['ui/DropdownSelect .ln-select-listbox', 'div.ln-select-listbox', null],
  ['ui/Dialog .ln-dialog', 'div.ln-dialog.ln-overlay-surface', null],

  // — frozen mockup literals (right colour, dead tokens) —
  ['ExportDialog .export-dialog', 'div.export-dialog', null],
  ['NoteSplitPane .nsp-pane-menu', 'div.nsp-pane-menu', null],
  ['SplitEditorPane .spe-pane-menu', 'div.spe-pane-menu', null],
  ['NoteViewer .note-gear-menu', 'div.note-gear-menu', null],
  ['TimelineRoot .tlr-tpl-menu', 'div.tlr-tpl-menu', null],
  ['WorkspaceTabBar .wtb-ctx-menu', 'div.wtb-ctx-menu', null],
  ['WorkspaceTabBar .wtb-new-tab-menu', 'div.wtb-new-tab-menu', null],
  ['WorkspaceTabBar .wtb-overflow-menu', 'div.wtb-overflow-menu', null],
  ['WindowChrome .wc-popover', 'div.wc-popover', null],
  ['DraftsPopover .ln-drafts-popover', 'div.ln-drafts-popover', null],
  ['VaultBrowser .vb-vault-picker-dropdown', 'div.vb-vault-picker-dropdown', null],

  // — undefined tokens: the literal fallback paints, theme never reaches them —
  ['LayoutPicker .layout-picker-dropdown', 'div.layout-picker-dropdown', null],
  ['TimelinePicker .tlpicker__dropdown', 'div.tlpicker__dropdown', null],
  ['TagInput .tag-dropdown', 'div.tag-dropdown', null],
  ['TagPane .tp-merge-dialog', 'div.tp-merge-dialog', null],
  ['NoteViewer .note-fidelity-dialog', 'div.note-fidelity-dialog', null],
  ['GlobalRightSidebar .grs-add-panel-picker', 'div.grs-add-panel-picker', null],
  ['SceneHistory .history-confirm-dialog', 'div.history-confirm-dialog', null],
  ['SplitEditorPane .spe-scene-popover', 'div.spe-scene-popover', null],
  ['GlobalSearchPanel .gsp-panel', 'div.gsp-panel', null],
  ['MigrationBanner .migration-modal-card', 'div.migration-modal-card', null],

  // — defined but flat: --bg-elevated / --bg-inset / --surface (opaque) —
  ['LeftRail .lr-panel-picker', 'div.lr-panel-picker', null],
  ['TemplatePicker .tp-modal', 'div.tp-modal', null],
  ['InconsistencyCard .ic-consent-modal', 'div.ic-consent-modal', null],
  ['SceneGrid .context-menu', 'div.context-menu', null],
  ['PresetSelector .preset-selector-dropdown', 'div.preset-selector-dropdown', null],
  ['EntityBrowser .entity-dialog', 'div.entity-dialog', null],
  ['EntityBrowser .entity-type-picker', 'div.entity-type-picker', null],
  ['WikiLinkPicker .wiki-link-picker', 'div.wiki-link-picker', null],
  ['EntityMention .entity-mention-picker', 'div.entity-mention-picker', null],
  ['IconPicker .icon-picker-modal', 'div.icon-picker-modal', null],
  ['KanbanBoard .kanban-entry-picker-panel', 'div.kanban-entry-picker-panel', null],
  ['ProjectSwitcher .project-switcher-dropdown', 'div.project-switcher-dropdown', null],
  ['BrainstormPage .bs-delete-confirm-dialog', 'div.bs-delete-confirm-dialog', null],
  ['IdeaContextMenu .idea-context-menu', 'div.idea-context-menu', null],
  ['IdeaDetailDrawer .idd-discard-dialog', 'div.idd-discard-dialog', null],
  ['IdeaDetailDrawer .idd-entity-picker', 'div.idd-entity-picker', null],
  ['DesktopShell .prompt-modal', 'div.prompt-modal', null],
  ['SettingsPanel .lg-popover', 'div.lg-popover', null],
  ['VaultGraphView .vgv-legend-popover', 'div.vgv-legend-popover', null],
  ['AgentSessionPicker .asp-dropdown', 'div.asp-dropdown', null],
  ['SceneCrafter .sc-pov-dropdown', 'div.sc-pov-dropdown', 'div.scene-crafter-page'],
  ['SceneCrafter .sc-ref-picker', 'div.sc-ref-picker', 'div.scene-crafter-page'],
  ['ManuscriptView .msv-title-menu-popover', 'div.msv-title-menu-popover', null],
  ['OutlinePlanningPanel .opl-link-picker', 'div.opl-link-picker', null],
  ['MythosMigration .mythos-migration-modal', 'div.mythos-migration-modal', null],

  // — half-migrated: opaque fallback fill, no blur, neutral rim —
  ['DesktopShell .app-menu-dropdown', 'div.app-menu-dropdown', null],
  ['DockedTabBar .dtb-picker', 'div.dtb-picker', null],
  ['DockedTabBar .dtb-close-popover', 'div.dtb-close-popover', null],
  ['AeonLaneView .aeon-popover', 'div.aeon-popover', null],
  ['AeonLaneView .aeon-context-menu', 'div.aeon-context-menu', null],
  ['VaultBrowser .vb-context-menu', 'div.vb-context-menu', null],
  ['DesktopShell .cross-tab-link-modal__card', 'div.cross-tab-link-modal__card', null],
];

function seedFixture() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11480-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11480-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11480-notes-'));
  const agentCfg = (extra = {}) => ({
    enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85,
    maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5,
    maxTokensPerDay: 500000, ...extra,
  });
  // Shipped Appearance defaults on purpose — a fresh profile is exactly what
  // the owner sees, and the default wallpaper is what the glass reads through.
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
    gettingStartedDismissed: true, vaultUpgradePromptShown: true,
    ai: { enabled: true },
    agents: { writingAssistant: agentCfg(), brainstorm: agentCfg({ enabled: true }), archive: agentCfg() },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));
  for (const [rel, body] of NOTES) {
    const p = path.join(notesVaultDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return { userData, vaultDir, notesVaultDir };
}

const cleanup = (f) => { for (const d of Object.values(f)) fs.rmSync(d, { recursive: true, force: true }); };

async function clipOf(page, selector, pad = 12) {
  const box = await page.locator(selector).first().boundingBox().catch(() => null);
  if (!box) return undefined;
  return {
    x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
    width: Math.min(box.width + pad * 2, VIEWPORT.width - Math.max(0, box.x - pad)),
    height: Math.min(box.height + pad * 2, VIEWPORT.height - Math.max(0, box.y - pad)),
  };
}

async function shot(page, name, selector, pad = 12) {
  const clip = selector ? await clipOf(page, selector, pad) : undefined;
  if (selector && !clip) { console.log(`  MISS ${name} (${selector} not on screen)`); return false; }
  await page.screenshot({ path: `${OUT}/${name}.png`, clip });
  console.log(`  shot ${name}`);
  return true;
}

/** Computed chrome of one selector, as numbers the gap list can quote. */
const CHROME_JS = `(sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { background: cs.backgroundColor, backdropFilter: cs.backdropFilter,
           borderTop: cs.borderTopWidth + ' ' + cs.borderTopColor,
           radius: cs.borderTopLeftRadius, boxShadow: cs.boxShadow };
}`;

async function main() {
  const fixture = seedFixture();
  const app = await electron.launch({
    args: [mainJs, `--user-data-dir=${fixture.userData}`, '--no-sandbox'],
    env: { ...process.env, MYTHOS_DISABLE_BOOT_MIGRATION: '1' },
    timeout: 90000,
  });
  const page = await app.firstWindow();
  page.on('dialog', (d) => void d.accept().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize(VIEWPORT);
  await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const report = { sceneCrafter: {}, boards: {}, overlay: [] };

  // ── 1. Boards canvas (reachable straight from the nav rail) ────────────────
  console.log('\n── Boards canvas ──');
  const boardsBtn = page.locator('nav[aria-label="Main navigation"] button[aria-label="Boards"]');
  if (await boardsBtn.count()) {
    await boardsBtn.click();
    await page.locator('.board-canvas__root').waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(900);
    await shot(page, 'boards-canvas-full', null);
    await shot(page, 'boards-canvas-crop', '.boards-tab-panel', 0);
    for (const sel of ['.board-canvas__root', '.board-canvas__zoom-controls', '.board-canvas__item',
                       '.board-canvas__item--folder', '.boards-tab-panel', '.boards-tab-panel__breadcrumb']) {
      report.boards[sel] = await page.evaluate(CHROME_JS, sel);
    }
    // Enter a board so the breadcrumb + card tier is on screen too.
    const folder = page.locator('.board-canvas__item--folder').first();
    if (await folder.count()) {
      await folder.dblclick();
      await page.waitForTimeout(1200);
      await shot(page, 'boards-canvas-inside-folder', null);
    }
  } else { console.log('  MISS Boards rail button'); }

  // ── 2. Scene Crafter (real File → New story, real rail click) ──────────────
  console.log('\n── Scene Crafter ──');
  const storiesBefore = await page.locator('.nav-story-row').count();
  await page.locator('.wc-menu', { hasText: 'File' }).click();
  await page.locator('.wc-menu-item', { hasText: 'New story' }).click();
  await page.locator('.nav-story-row').nth(storiesBefore).waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('.nav-story-title').nth(storiesBefore).click();
  await page.waitForTimeout(600);
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
  await page.locator('.sc-columns').waitFor({ state: 'visible', timeout: 12000 });
  await page.waitForTimeout(900);

  await shot(page, 'crafter-setup-full', null);
  await shot(page, 'crafter-ref-columns', '.sc-ref-col--characters', 8);
  await shot(page, 'crafter-boards-gallery', '.sc-board-list', 10);
  for (const sel of ['.scene-crafter-page', '.scene-crafter-header', '.sc-suggest', '.sc-panel',
                     '.sc-ref-card', '.sc-ref-band', '.sc-board-row', '.sc-board-row--new',
                     '.sc-col-head', '.sc-canvas-chip']) {
    report.sceneCrafter[sel] = await page.evaluate(CHROME_JS, sel);
  }

  // Open-in-new-tab: "+ New board" mints a board, clicking its gallery row
  // opens it as its own Scene Crafter tab (SKY-11069 model).
  const newBoard = page.locator('[data-testid="crafter-new-board"]');
  if (await newBoard.count()) {
    await newBoard.click();
    await page.waitForTimeout(1500);
    await shot(page, 'crafter-board-tab-open', null);
    for (const sel of ['.sc-canvas-head', '.sc-canvas-stage', '.cvb-root', '.sc-canvas-name']) {
      report.sceneCrafter[sel] = await page.evaluate(CHROME_JS, sel);
    }
    await shot(page, 'crafter-canvas-head', '.sc-canvas-head', 6);
    // Back to Setup via the pinned tab so the probe grid mounts on a live page.
    const setupTab = page.locator('.sc-tab, [data-testid="crafter-tab-setup"]').first();
    if (await setupTab.count()) { await setupTab.click().catch(() => {}); await page.waitForTimeout(600); }
  }

  // ── 3. Overlay-tier probe grid ────────────────────────────────────────────
  console.log('\n── Overlay tier probe ──');
  const probe = await page.evaluate((catalogue) => {
    const host = document.createElement('div');
    host.id = 'sky11480-probe';
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;padding:18px;' +
      'display:grid;grid-template-columns:repeat(4,1fr);gap:14px;align-content:start;' +
      'background:radial-gradient(90% 90% at 50% 40%,rgba(20,26,48,.55),rgba(6,8,15,.85))';
    document.body.appendChild(host);
    const out = [];
    for (const [label, spec, ancestorSpec] of catalogue) {
      const cell = document.createElement('div');
      cell.style.cssText = 'display:flex;flex-direction:column;gap:5px;min-width:0';
      const cap = document.createElement('div');
      cap.textContent = label;
      cap.style.cssText = 'font:600 9.5px/1.3 system-ui;color:#9cabc4;white-space:nowrap;' +
        'overflow:hidden;text-overflow:ellipsis';
      cell.appendChild(cap);
      const mk = (s) => {
        const [tag, ...cls] = s.split('.');
        const e = document.createElement(tag || 'div');
        for (const c of cls) e.classList.add(c);
        return e;
      };
      let mount = cell;
      if (ancestorSpec) { const a = mk(ancestorSpec); cell.appendChild(a); mount = a; }
      const el = mk(spec);
      el.style.minHeight = '58px';
      el.style.padding = '10px';
      el.textContent = 'Aa';
      mount.appendChild(el);
      host.appendChild(cell);
      const cs = getComputedStyle(el);
      out.push({
        label, spec,
        background: cs.backgroundColor,
        backgroundImage: cs.backgroundImage === 'none' ? '' : cs.backgroundImage.slice(0, 48),
        backdropFilter: cs.backdropFilter,
        border: cs.borderTopWidth + ' ' + cs.borderTopColor,
        radius: cs.borderTopLeftRadius,
        boxShadow: cs.boxShadow,
      });
    }
    return out;
  }, OVERLAY_CATALOGUE);
  report.overlay = probe;
  await page.waitForTimeout(400);
  await shot(page, 'overlay-tier-probe-grid', null);
  // Second pane so the labels stay legible at 4-up.
  await page.evaluate(() => {
    const h = document.getElementById('sky11480-probe');
    if (h) h.style.gridTemplateColumns = 'repeat(2,1fr)';
  });
  await page.waitForTimeout(300);
  await shot(page, 'overlay-tier-probe-grid-2up', null);
  await page.evaluate(() => document.getElementById('sky11480-probe')?.remove());

  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(`\nreport → ${OUT}/report.json`);

  await app.close().catch(() => {});
  cleanup(fixture);
}

main().catch((err) => { console.error(err); process.exit(1); });
