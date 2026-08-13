/**
 * a11y-focus.spec.ts — SKY-143, updated for SKY-9022/M6, SKY-10084
 *
 * Regression tests verifying keyboard tab-focus navigation through VaultBrowser
 * and landmark accessibility of the global right sidebar.
 *
 * SKY-9022/M6 removed the old panel-stack system; Vault Browser's function is
 * now the Notes workspace sidebar (its one home), reached via the Notes
 * Editor rail tab and always rendered with `lockScope initialScope="notes"`.
 * In that mode the Story/Notes/Both scope bar (`vb-scope-*`) never renders
 * (see `VaultBrowser/index.tsx`, `{!lockScope && ...}`), so the original
 * scope-bar tab-order assertions no longer have anything to test. These
 * cases were rewritten to cover the toolbar that replaced it as the first
 * keyboard-focusable region of the Notes Vault panel.
 *
 *   TC-A11Y-01  Notes toolbar tab order — Tab cycles through the 5-button toolbar in DOM order
 *   TC-A11Y-02  Tree reachable by Tab   — Tab past the toolbar reaches the notes tree content
 *   TC-A11Y-03  Right sidebar landmark  — expanded/collapsed right sidebar exposes a
 *               discoverable landmark name+role (SKY-10084: PR #1201's M6 sidebar
 *               rewrite dropped these, regressing landmark navigation for screen readers)
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/a11y-focus.spec.ts --reporter=list
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

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    // GlobalRightSidebar only mounts once rightSidebarVisible is an explicit
    // boolean (undefined = not rendered at all, see DesktopShell SKY-1686).
    // TC-A11Y-03 asserts on its landmark, so it must be seeded true.
    rightSidebarVisible: true,
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
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', '--force-prefers-reduced-motion', ...extraArgs],
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

// SKY-9022/M6: Vault Browser's function is the Notes workspace sidebar, its
// one home — navigate to the Notes Editor tab to reach it (lockScope +
// initialScope="notes", so `vb-notes-vault` renders directly, no scope-switch).
async function openVaultPanel(pg: Page): Promise<void> {
  await pg.locator('button.nav-rail__item[aria-label="Notes Editor"]').click();
  await expect(pg.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 8_000 });
}

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-a11y-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-a11y-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-a11y-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── TC-A11Y-01: Notes Vault toolbar tab order ────────────────────────────────
//
// Verifies the 5-button toolbar (New note / New folder / Sort / Auto-reveal /
// Collapse all / Expand all) is in the tab order and that Tab moves focus
// through the buttons in DOM order. This replaces the old scope-bar tab-order
// coverage, which no longer applies once VaultBrowser is locked to notes scope.

test('TC-A11Y-01: Notes Vault toolbar buttons are keyboard-focusable via Tab', async () => {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  await openVaultPanel(page);

  const newNoteBtn = page.locator('[data-testid="vb-btn-new-note"]');
  await expect(newNoteBtn).toBeVisible({ timeout: 6_000 });

  // Anchor the traversal only once focus RESTS on the button: startup steals
  // focus once, deterministically but late (the editor auto-focuses when its
  // data finishes loading — slower since the Liquid Neon shell), so re-focus
  // until it survives a settle window before pressing Tab.
  await expect(async () => {
    await newNoteBtn.focus();
    await page.waitForTimeout(200);
    const active = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset?.testid
        ?? document.activeElement?.tagName ?? 'none',
    );
    expect(active, `focus stolen by: ${active}`).toBe('vb-btn-new-note');
  }).toPass({ timeout: 15_000 });

  // Tab → New folder button
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-testid="vb-btn-new-folder"]')).toBeFocused();

  // Tab → Sort button
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-testid="vb-btn-sort"]')).toBeFocused();
});

// ─── TC-A11Y-02: Search field reachable by Tab past the toolbar ──────────────
//
// Verifies that Tab navigation past the toolbar reaches the notes search
// input, confirming VaultBrowser content beyond the toolbar is part of the
// natural tab order.

test('TC-A11Y-02: Tab past the toolbar reaches the notes search input', async () => {
  await openVaultPanel(page);

  const newNoteBtn = page.locator('[data-testid="vb-btn-new-note"]');

  // Same anchor-then-settle as TC-A11Y-01: a late async re-focus (editor
  // data finishing load) can steal focus right after we set it, so verify
  // it survives a settle window before starting the Tab traversal.
  await expect(async () => {
    await newNoteBtn.focus();
    await page.waitForTimeout(200);
    const active = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset?.testid
        ?? document.activeElement?.tagName ?? 'none',
    );
    expect(active, `focus stolen by: ${active}`).toBe('vb-btn-new-note');
  }).toPass({ timeout: 15_000 });

  await page.keyboard.press('Tab'); // → New folder btn
  await page.keyboard.press('Tab'); // → Sort btn
  await page.keyboard.press('Tab'); // → Auto-reveal btn
  await page.keyboard.press('Tab'); // → Collapse all btn
  await page.keyboard.press('Tab'); // → Expand all btn
  await page.keyboard.press('Tab'); // → search input

  await expect(page.locator('[data-testid="vb-search-input"]')).toBeFocused();
});

// ─── TC-A11Y-03: Right sidebar landmark name/role ─────────────────────────────
//
// SKY-10084: PR #1201's M6 sidebar rewrite dropped the landmark attributes
// from GlobalRightSidebar (`aria-label`/`role="complementary"`), so
// screen-reader users navigating by landmark lost the ability to identify or
// jump to this region — especially while collapsed, where only the "Show
// right sidebar" button remained discoverable, and only via linear tab
// order. Verifies both the expanded and collapsed states expose a named
// complementary landmark.

test('TC-A11Y-03: right sidebar exposes a complementary landmark, expanded and collapsed', async () => {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // TC-A11Y-01/02 leave activeTab on Notes (via openVaultPanel). GlobalRightSidebar
  // is force-hidden while the Notes tab's brainstorm rail is expanded (DesktopShell:
  // `!(activeTab === 'notes' && !notesBrainstormCollapsed)`), so switch back to the
  // Story Writer tab first — otherwise the sidebar never mounts.
  await page.locator('button.nav-rail__item[aria-label="Story Writer"]').click();

  const sidebar = page.locator('[data-testid="global-right-sidebar"]');
  await expect(sidebar).toBeVisible({ timeout: 8_000 });
  await expect(sidebar).toHaveAttribute('aria-label', 'Right sidebar');
  await expect(page.getByRole('complementary', { name: 'Right sidebar' })).toBeVisible();

  await page.locator('[data-testid="global-right-sidebar"] .grs-hide-btn').click();

  const edge = page.locator('[data-testid="grs-edge"]');
  await expect(edge).toBeVisible({ timeout: 8_000 });
  await expect(edge).toHaveAttribute('role', 'complementary');
  await expect(edge).toHaveAttribute('aria-label', 'Right sidebar (hidden)');
  await expect(page.getByRole('complementary', { name: 'Right sidebar (hidden)' })).toBeVisible();

  // Restore visibility for any subsequent tests in this file.
  await edge.locator('.grs-show-btn').click();
  await expect(sidebar).toBeVisible({ timeout: 8_000 });
});
