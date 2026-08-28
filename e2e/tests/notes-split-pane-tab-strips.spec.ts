/**
 * notes-split-pane-tab-strips.spec.ts — SKY-9784
 *
 * M8 gap: the Notes workspace's split second pane (NoteSplitPane.tsx) was a
 * bare <select> + single ✕ — never grew into the Obsidian-parity tab strip
 * (WorkspaceTabBar: tabs, ✕, +, overflow ▾, per-pane ⋮ menu, drag-across-panes)
 * SKY-8907/SKY-9342 shipped for the Story split editor's SplitEditorPane.
 * This mirrors e2e/tests/split-pane-tab-strips.spec.ts (SKY-8907) for the
 * Notes surface.
 *
 * Coverage (ticket acceptance: "Obsidian-parity tab checks pass per pane:
 * open/close/reorder/drag-across/overflow"):
 *   - splitting Notes gives each pane its own, independent tab strip
 *   - opening a note in a pane adds a tab to THAT pane's strip only
 *   - the global workspace tab strip hides while the Notes split is active
 *   - dragging a tab from one pane's strip onto the other's moves it
 *   - the overflow ▾ dropdown surfaces tabs clipped by a narrow strip
 *   - the per-pane ⋮ menu's "Close pane" collapses the split
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/tests/notes-split-pane-tab-strips.spec.ts --reporter=list
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

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');

function seedBaseSettings(userData: string, vaultDir: string, notesVaultDir: string): void {
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

function seedNotesVault(notesVaultDir: string, noteNames: string[]): void {
  fs.mkdirSync(notesVaultDir, { recursive: true });
  fs.writeFileSync(path.join(notesVaultDir, '.notes-vault'), '');
  for (const name of noteNames) {
    fs.writeFileSync(path.join(notesVaultDir, `${name}.md`), `# ${name}\n\nContent for ${name}.\n`);
  }
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
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

async function openNotesTab(page: Page): Promise<void> {
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
  await expect(page.locator('[data-testid="notes-tab-center"]')).toBeVisible({ timeout: 8_000 });
}

async function openNote(page: Page, noteBaseName: string): Promise<void> {
  await page.locator('[data-testid^="vb-row-"]', { hasText: noteBaseName }).first().click();
}

/** Mirrors split-pane-tab-strips.spec.ts's dragTabToOtherPane, adapted to the
 * Notes panes' strip testids (notes-split-pane-{1,2}-tab-strip). */
async function dragNoteTabToOtherPane(page: Page, fromPane: 1 | 2, tabTitle: string, toPane: 1 | 2): Promise<void> {
  const fromTab = page.locator(`[data-testid="notes-split-pane-${fromPane}-tab-strip"] [role="tab"]`, { hasText: tabTitle });
  const toStrip = page.locator(`[data-testid="notes-split-pane-${toPane}-tab-strip"]`);

  await fromTab.evaluate((el) => {
    const dt = new DataTransfer();
    el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  });
  await toStrip.evaluate((el) => {
    const dt = new DataTransfer();
    el.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  });
  // Best-effort cleanup dispatch: the drop above may already have moved this
  // tab into the other pane's strip, in which case fromTab no longer matches
  // any element and Playwright would otherwise poll for its default 30s
  // action timeout before the .catch() below swallows the error. A short
  // timeout here fails fast instead of stalling every drag by ~30s.
  await fromTab.evaluate(
    (el) => el.dispatchEvent(new DragEvent('dragend', { bubbles: true } as never)),
    undefined,
    { timeout: 1_000 },
  ).catch(() => {});
}

test.describe('SKY-9784 Notes split — per-pane tab strips', () => {
  let userData: string;
  let vaultDir: string;
  let notesVaultDir: string;
  let app: ElectronApplication | undefined;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-notes-sp-tabs-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-notes-sp-tabs-story-'));
    notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-notes-sp-tabs-notes-'));
    seedBaseSettings(userData, vaultDir, notesVaultDir);
    seedNotesVault(notesVaultDir, ['Alpha', 'Beta', 'Gamma']);
    app = await launchApp(userData);
    page = await firstWindow(app);
    await page.waitForSelector('.shell-loading', { state: 'detached', timeout: 30_000 });
    await openNotesTab(page);
    await openNote(page, 'Alpha');
    await expect(page.locator('[data-testid="notes-split-toggle"]')).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="notes-split-toggle"]').click();
    await expect(page.locator('[data-testid="notes-split-row"]')).toBeVisible({ timeout: 8_000 });
  });

  test.afterAll(async () => {
    await app?.close();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
    fs.rmSync(notesVaultDir, { recursive: true, force: true });
  });

  test('each Notes split pane renders its own tab strip', async () => {
    await expect(page.locator('[data-testid="notes-split-pane-1-tab-strip"]')).toBeVisible();
    await expect(page.locator('[data-testid="notes-split-pane-2-tab-strip"]')).toBeVisible();
    // Defaults: pane 1 = Alpha (opened before splitting), pane 2 defaults to
    // the other note (Beta, prototype toggleNSplit).
    await expect(
      page.locator('[data-testid="notes-split-pane-1-tab-strip"] [role="tab"]', { hasText: 'Alpha' }),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="notes-split-pane-2-tab-strip"] [role="tab"]', { hasText: 'Beta' }),
    ).toBeVisible();
  });

  test('the global workspace tab strip is hidden while the Notes split is active', async () => {
    // Only the two per-pane WorkspaceTabBar instances should exist — no
    // third, global one (mirrors SKY-8907's Story-editor assertion).
    await expect(page.locator('.wtb-root[role="tablist"]')).toHaveCount(2);
  });

  test('opening Gamma from the vault tree adds a tab to pane 1 only', async () => {
    await openNote(page, 'Gamma');
    await expect(
      page.locator('[data-testid="notes-split-pane-1-tab-strip"] [role="tab"]', { hasText: 'Gamma' }),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="notes-split-pane-2-tab-strip"] [role="tab"]', { hasText: 'Gamma' }),
    ).toHaveCount(0);
    // Pane 2's own tab (Beta) is untouched — the strips don't share state.
    await expect(
      page.locator('[data-testid="notes-split-pane-2-tab-strip"] [role="tab"]', { hasText: 'Beta' }),
    ).toBeVisible();

    // Re-select Alpha so Gamma sits as a background (inactive) pane 1 tab —
    // the realistic Obsidian usage the next test drags away.
    await page.locator('[data-testid="notes-split-pane-1-tab-strip"] [role="tab"]', { hasText: 'Alpha' }).click();
    await expect(
      page.locator('[data-testid="notes-split-pane-1-tab-strip"] [role="tab"]', { hasText: 'Alpha' }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  test('dragging pane 1\'s (background) Gamma tab onto pane 2\'s strip moves it across', async () => {
    await dragNoteTabToOtherPane(page, 1, 'Gamma', 2);

    await expect(
      page.locator('[data-testid="notes-split-pane-2-tab-strip"] [role="tab"]', { hasText: 'Gamma' }),
    ).toBeVisible({ timeout: 8_000 });
    await expect(
      page.locator('[data-testid="notes-split-pane-2-tab-strip"] [role="tab"]', { hasText: 'Beta' }),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="notes-split-pane-1-tab-strip"] [role="tab"]', { hasText: 'Gamma' }),
    ).toHaveCount(0);
  });

  test('dragging Gamma back to pane 1 moves it again — reorder within a pane also works', async () => {
    await dragNoteTabToOtherPane(page, 2, 'Gamma', 1);
    await expect(
      page.locator('[data-testid="notes-split-pane-1-tab-strip"] [role="tab"]', { hasText: 'Gamma' }),
    ).toBeVisible({ timeout: 8_000 });

    // Drag-to-reorder within pane 1 (Alpha ↔ Gamma) — same DOM event
    // contract WorkspaceTabBar's onDrop/onTabReorder listens for.
    const alphaTab = page.locator('[data-testid="notes-split-pane-1-tab-strip"] [role="tab"]', { hasText: 'Alpha' });
    const gammaTab = page.locator('[data-testid="notes-split-pane-1-tab-strip"] [role="tab"]', { hasText: 'Gamma' });
    await alphaTab.evaluate((el) => {
      const dt = new DataTransfer();
      el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    });
    await gammaTab.evaluate((el) => {
      const dt = new DataTransfer();
      el.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    });
    await alphaTab.evaluate((el) => el.dispatchEvent(new DragEvent('dragend', { bubbles: true } as never))).catch(() => {});

    const pane1Tabs = page.locator('[data-testid="notes-split-pane-1-tab-strip"] [role="tab"]');
    await expect(pane1Tabs.first()).toHaveText(/Gamma/, { timeout: 8_000 });
  });

  test('overflow ▾ surfaces tabs clipped by a narrow pane 1 strip', async () => {
    await page.setViewportSize({ width: 900, height: 700 });
    // Open every note into pane 1 so its strip overflows at this width.
    await openNote(page, 'Beta');
    await openNote(page, 'Alpha');
    await openNote(page, 'Gamma');
    const overflowBtn = page.locator('[data-testid="notes-split-pane-1-tab-strip"] [data-testid="wtb-overflow-btn"]');
    await expect(overflowBtn).toBeVisible({ timeout: 8_000 });
    // The IntersectionObserver-driven hidden-tab set can still be settling
    // right after the layout change above — retry the click until the menu
    // (state toggled by that exact click) shows, rather than a single shot.
    await expect(async () => {
      await overflowBtn.click();
      await expect(
        page.locator('[data-testid="notes-split-pane-1-tab-strip"] [data-testid="wtb-overflow-menu"]'),
      ).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('pane 2\'s ⋮ menu "Close pane" collapses the Notes split', async () => {
    await page.locator('[data-testid="notes-split-pane-2-pane-menu-btn"]').click();
    await expect(page.locator('[data-testid="notes-split-pane-2-pane-menu"]')).toBeVisible();
    await page.locator('[data-testid="notes-split-pane-2-pane-menu-close"]').click();

    await expect(page.locator('[data-testid="notes-split-row"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="note-split-pane"]')).toHaveCount(0);
    // Notes editor is back to the single-pane view with the global strip.
    await expect(page.locator('.wtb-root[role="tablist"]')).toHaveCount(1);
  });
});
