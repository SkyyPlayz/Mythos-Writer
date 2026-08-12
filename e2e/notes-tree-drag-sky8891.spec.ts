/**
 * notes-tree-drag-sky8891.spec.ts — SKY-8891 / SKY-9130
 *
 * Notes-tree drag mechanics against the real packaged Electron app + real
 * filesystem (no mocked window.api), following folder-ops-sky7995.spec.ts.
 *
 * Coverage:
 *   DR-01  Edge-drop reorder at the vault root — insert line renders, order
 *          persists to .vb-order.json, rows repaint in the new order, and the
 *          sort mode flips to Manual.
 *   DR-02  Edge-drop reorder INSIDE a folder — the persisted key and entries
 *          are exact POSIX paths ('/', never '\'), so a Windows-separator
 *          regression (the SKY-8881 class of bug) fails on any OS.
 *   DR-03  Drag-only root strip — vb-root-drop-zone absent before a drag,
 *          present mid-drag, gone after drag end.
 *   DR-04  Hover auto-expand — dwelling a drag over a collapsed folder for
 *          ~500ms expands it.
 *   DR-05  Self-nest guard — dropping a folder onto its own child is refused
 *          by the main process (vault.ts moveVaultFile) and nothing on disk
 *          changes.
 *
 * All dragover/drop events carry explicit clientY coordinates so the thirds
 * logic in VirtualTree resolves the intended zone; events without coordinates
 * (clientY 0, outside every row rect) deliberately keep the legacy whole-row
 * nest behavior that folder-ops-sky7995.spec.ts depends on.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/notes-tree-drag-sky8891.spec.ts --reporter=list
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
const ORDER_FILE = '.vb-order.json';

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

/** Fixture tree, written before launch so app seeding never kicks in. */
function seedNotesVault(root: string): void {
  fs.mkdirSync(path.join(root, 'Keep'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Pack'), { recursive: true });
  for (const rel of ['alpha.md', 'beta.md', 'gamma.md', 'Keep/inner.md', 'Pack/one.md', 'Pack/two.md']) {
    fs.writeFileSync(path.join(root, ...rel.split('/')), `# ${rel}\n`);
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

async function waitUntil(predicate: () => boolean, timeoutMs = 10_000, intervalMs = 150): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function readOrderFile(root: string): Record<string, string[]> {
  return JSON.parse(fs.readFileSync(path.join(root, ORDER_FILE), 'utf-8'));
}

/** Dispatch dragstart on a tree row, carrying its path in the DataTransfer. */
async function dispatchDragStart(pg: Page, rowPath: string): Promise<void> {
  await pg.locator(`[data-testid="vb-row-${rowPath}"]`).evaluate((el, p) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', p);
    el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  }, rowPath);
}

async function dispatchDragEnd(pg: Page, rowPath: string): Promise<void> {
  await pg.locator(`[data-testid="vb-row-${rowPath}"]`).evaluate((el) => {
    el.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
  });
}

/**
 * Dispatch dragover (and optionally drop) on a target row at a specific
 * vertical zone. The thirds resolver in VirtualTree reads e.clientY against
 * the row's bounding rect, so the coordinate is computed in-page.
 */
async function dispatchDragToZone(
  pg: Page,
  fromPath: string,
  targetPath: string,
  zone: 'top' | 'middle' | 'bottom',
  alsoDrop: boolean,
): Promise<void> {
  await pg.locator(`[data-testid="vb-row-${targetPath}"]`).evaluate(
    (el, arg) => {
      const rect = el.getBoundingClientRect();
      const clientY = arg.zone === 'top'
        ? rect.top + 2
        : arg.zone === 'bottom'
          ? rect.bottom - 2
          : rect.top + rect.height / 2;
      const dt = new DataTransfer();
      dt.setData('text/plain', arg.fromPath);
      el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientY, dataTransfer: dt }));
      if (arg.alsoDrop) {
        el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientY, dataTransfer: dt }));
      }
    },
    { fromPath, zone, alsoDrop },
  );
}

/** Visual y-position of a row — react-window rows are absolutely positioned,
 *  so DOM order says nothing; the bounding box is the displayed order. */
async function rowY(pg: Page, rowPath: string): Promise<number> {
  const box = await pg.locator(`[data-testid="vb-row-${rowPath}"]`).boundingBox();
  expect(box, `row ${rowPath} has no bounding box`).toBeTruthy();
  return box!.y;
}

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-notes-drag-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-story-vault-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-notes-vault-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  seedNotesVault(notesVaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);
  page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined); });

  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  // SKY-9022/M6: Vault Browser's function is the Notes workspace sidebar,
  // its one home — navigate to the Notes Editor tab to reach it.
  await page.locator('button.nav-rail__item[aria-label="Notes Editor"]').click();
  await expect(page.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 6_000 });
  await expect(page.locator('[data-testid="vb-row-alpha.md"]')).toBeVisible({ timeout: 8_000 });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── DR-01: edge-drop reorder at the vault root ─────────────────────────────

test('DR-01: dropping on a row edge reorders siblings, persists to .vb-order.json, flips sort to Manual', async () => {
  await dispatchDragStart(page, 'gamma.md');

  // Hover alpha's top third: the neon insertion line must render.
  await dispatchDragToZone(page, 'gamma.md', 'alpha.md', 'top', false);
  await expect(page.locator('[data-testid="vb-insert-line"]')).toBeVisible({ timeout: 4_000 });

  await dispatchDragToZone(page, 'gamma.md', 'alpha.md', 'top', true);
  await dispatchDragEnd(page, 'gamma.md');

  // Persisted: the root key lists gamma before alpha.
  const persisted = await waitUntil(() => {
    try {
      const order = readOrderFile(notesVaultDir)[''];
      return Array.isArray(order) && order.indexOf('gamma.md') !== -1 &&
        order.indexOf('gamma.md') < order.indexOf('alpha.md');
    } catch { return false; }
  });
  expect(persisted, '.vb-order.json did not record gamma.md ahead of alpha.md at the root key').toBe(true);

  // The tree repainted in manual order: gamma now renders above alpha.
  await expect.poll(async () => (await rowY(page, 'gamma.md')) < (await rowY(page, 'alpha.md')), {
    timeout: 6_000,
  }).toBe(true);

  // The gesture forced manual sort, persisted the same way the toolbar does.
  await expect(page.locator('[data-testid="vb-btn-sort"]')).toHaveAttribute('title', 'Sort: Manual');
});

// ─── DR-02: nested reorder — persisted paths are POSIX on every OS ──────────

test('DR-02: reorder inside a folder persists exact POSIX paths (SKY-8881 separator guard)', async () => {
  await expect(page.locator('[data-testid="vb-row-Pack/one.md"]')).toBeVisible({ timeout: 8_000 });

  await dispatchDragStart(page, 'Pack/two.md');
  await dispatchDragToZone(page, 'Pack/two.md', 'Pack/one.md', 'top', true);
  await dispatchDragEnd(page, 'Pack/two.md');

  const persisted = await waitUntil(() => {
    try {
      const order = readOrderFile(notesVaultDir);
      // Exact POSIX key and entries — '\' anywhere here fails on every OS.
      return JSON.stringify(order['Pack']) === JSON.stringify(['Pack/two.md', 'Pack/one.md']);
    } catch { return false; }
  });
  expect(persisted, `.vb-order.json Pack key is not the exact POSIX array: ${
    fs.existsSync(path.join(notesVaultDir, ORDER_FILE)) ? fs.readFileSync(path.join(notesVaultDir, ORDER_FILE), 'utf-8') : '(missing)'
  }`).toBe(true);

  await expect.poll(async () => (await rowY(page, 'Pack/two.md')) < (await rowY(page, 'Pack/one.md')), {
    timeout: 6_000,
  }).toBe(true);
});

// ─── DR-03: root strip only exists mid-drag ─────────────────────────────────

test('DR-03: vb-root-drop-zone is absent before a drag, present mid-drag, gone after', async () => {
  await expect(page.locator('[data-testid="vb-root-drop-zone"]')).toHaveCount(0);

  await dispatchDragStart(page, 'beta.md');
  await expect(page.locator('[data-testid="vb-root-drop-zone"]')).toBeVisible({ timeout: 4_000 });

  await dispatchDragEnd(page, 'beta.md');
  await expect(page.locator('[data-testid="vb-root-drop-zone"]')).toHaveCount(0);
});

// ─── DR-04: hover auto-expand ───────────────────────────────────────────────

test('DR-04: dwelling a drag over a collapsed folder auto-expands it after ~500ms', async () => {
  // Collapse everything, then verify the dwell re-expands Keep.
  await page.locator('[data-testid="vb-btn-collapse-all"]').click();
  await expect(page.locator('[data-testid="vb-row-Keep"]')).toHaveAttribute('aria-expanded', 'false');

  await dispatchDragStart(page, 'alpha.md');
  await dispatchDragToZone(page, 'alpha.md', 'Keep', 'middle', false);

  // No further dragover events needed: the dwell timer runs from first hover.
  await expect(page.locator('[data-testid="vb-row-Keep"]')).toHaveAttribute('aria-expanded', 'true', {
    timeout: 4_000,
  });
  await dispatchDragEnd(page, 'alpha.md');
});

// ─── DR-05: self-nest guard (parent spec item 7) ────────────────────────────

test('DR-05: dropping a folder onto its own child is refused and disk is untouched', async () => {
  // DR-04 expanded Keep, so its child row is on screen.
  await expect(page.locator('[data-testid="vb-row-Keep/inner.md"]')).toBeVisible({ timeout: 8_000 });

  await dispatchDragStart(page, 'Keep');
  // Middle zone on the child = nest into the child's folder → Keep into Keep,
  // which moveVaultFile (electron-main/src/vault.ts) must refuse.
  await dispatchDragToZone(page, 'Keep', 'Keep/inner.md', 'middle', true);
  await dispatchDragEnd(page, 'Keep');

  // Give any (incorrect) move time to land, then assert nothing changed.
  await new Promise((r) => setTimeout(r, 1_000));
  expect(fs.existsSync(path.join(notesVaultDir, 'Keep', 'inner.md')),
    'Keep/inner.md vanished — the self-nest guard failed').toBe(true);
  expect(fs.existsSync(path.join(notesVaultDir, 'Keep', 'Keep')),
    'Keep was nested into itself (guard bypassed)').toBe(false);
  await expect(page.locator('[data-testid="vb-row-Keep"]')).toBeVisible();
});
