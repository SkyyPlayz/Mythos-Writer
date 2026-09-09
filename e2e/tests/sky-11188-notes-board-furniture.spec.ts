/**
 * sky-11188-notes-board-furniture.spec.ts — SKY-11188 (Notes Board 5/9):
 * furniture types + column-ref as a real wikilink. BOARDS-SPEC.md v2 §4/§6.
 *
 * Drives the actual built app (out/main/main.js) against a REAL notes vault
 * fixture. Per COMPANY-STANDARDS §4c the thing under test — furniture CRUD
 * and its cascade-delete — is NEVER pre-seeded: every furniture item and
 * connector in these tests is created by the app itself through the Boards
 * toolbar, never written directly into `.mythos-board.json`.
 *
 * Coverage:
 *   1. Reachability — the furniture toolbar is reachable from an ordinary
 *      Boards-tab visit, and each kind renders on the canvas once created.
 *   2. Furniture CRUD — create a column, delete it via its own delete
 *      button; it disappears from the canvas AND from the on-disk sidecar.
 *   3. Cascade-delete (§4 acceptance criterion) — connect two furniture
 *      items with the "Connector" tool, delete one endpoint, and the line
 *      furniture is gone too — no dangling `line` record survives in the
 *      sidecar.
 *   4. Column ref (§4/§2/§11 acceptance criterion) — a column item whose
 *      `ref` names an existing note renders as a clickable link and clicking
 *      it opens that note in the Notes editor.
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
const SIDECAR = '.mythos-board.json';

function makeTemp(slug: string): { tempRoot: string; userData: string; notesDir: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `mythos-sky11188-${slug}-`));
  const userData = path.join(tempRoot, 'userData');
  const storyDir = path.join(tempRoot, 'story-vault');
  const notesDir = path.join(tempRoot, 'notes-vault');
  for (const d of [userData, storyDir, notesDir]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyDir, notesVaultRoot: notesDir }, null, 2),
  );
  return { tempRoot, userData, notesDir };
}

function mkNote(notesDir: string, rel: string, body = '# Note\n'): void {
  const abs = path.join(notesDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function bootToBoards(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  const boardsBtn = page.locator('nav[aria-label="Main navigation"] button[aria-label="Boards"]');
  await expect(boardsBtn).toHaveCount(1);
  await boardsBtn.click();
  await expect(page.locator('[role="main"][aria-label="Boards"]')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 8_000 });
  return page;
}

function readSidecar(notesDir: string, folderRel = ''): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(notesDir, folderRel, SIDECAR), 'utf-8'));
}

const furnitureItems = (page: Page) => page.locator('.board-canvas__furniture');
const furnitureOfKind = (page: Page, kind: string) => page.locator(`.board-canvas__furniture[data-kind="${kind}"]`);

/** The furniture-creation toolbar is reachable directly on the Boards tab — no test-only hooks. */
async function addFurniture(page: Page, label: string): Promise<void> {
  await page.locator('.boards-tab-panel__furniture-btn', { hasText: label }).click();
}

test('SKY-11188: furniture toolbar is reachable and each kind renders on the canvas', async () => {
  test.setTimeout(120_000);
  const { tempRoot, userData, notesDir } = makeTemp('reach');
  mkNote(notesDir, 'Intro.md', '# Intro\n');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await expect(fs.existsSync(path.join(notesDir, SIDECAR))).toBe(false);

    for (const label of ['Column', 'To-do list', 'Table', 'Image', 'Sketch', 'Colour swatch']) {
      await addFurniture(page, label);
    }

    await expect(furnitureItems(page)).toHaveCount(6);
    await expect(furnitureOfKind(page, 'column')).toBeVisible();
    await expect(furnitureOfKind(page, 'check')).toBeVisible();
    await expect(furnitureOfKind(page, 'table')).toBeVisible();
    await expect(furnitureOfKind(page, 'swatch')).toBeVisible();

    // §14: image/sketch are explicitly labelled placeholders, not the real pipeline.
    await expect(furnitureOfKind(page, 'image')).toContainText('placeholder');
    await expect(furnitureOfKind(page, 'sketch')).toContainText('placeholder');

    // A real sidecar now exists — every one of these is a genuine app write.
    const sidecar = readSidecar(notesDir);
    expect((sidecar.furniture as unknown[]).length).toBe(6);
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('SKY-11188: furniture CRUD — delete removes it from the canvas and the sidecar', async () => {
  test.setTimeout(120_000);
  const { tempRoot, userData, notesDir } = makeTemp('crud');
  mkNote(notesDir, 'Intro.md', '# Intro\n');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await addFurniture(page, 'Column');
    await expect(furnitureOfKind(page, 'column')).toBeVisible();

    const col = furnitureOfKind(page, 'column');
    await col.hover();
    await col.locator('.board-canvas__furniture-delete').click();

    await expect(furnitureItems(page)).toHaveCount(0);
    await expect.poll(() => {
      const sidecar = readSidecar(notesDir);
      return (sidecar.furniture as unknown[]).length;
    }).toBe(0);
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('SKY-11188 §4 acceptance criterion: deleting an item cascade-deletes every connector line, zero dangling records', async () => {
  test.setTimeout(120_000);
  const { tempRoot, userData, notesDir } = makeTemp('cascade');
  mkNote(notesDir, 'Intro.md', '# Intro\n');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await addFurniture(page, 'Column');
    await addFurniture(page, 'Table');
    await expect(furnitureItems(page)).toHaveCount(2);

    // Connect the two via the "Connector" tool — a real two-click interaction,
    // not a seeded line record.
    await page.locator('.boards-tab-panel__furniture-btn', { hasText: 'Connector' }).click();
    await furnitureOfKind(page, 'column').click();
    await furnitureOfKind(page, 'table').click();

    await expect.poll(() => {
      const sidecar = readSidecar(notesDir);
      return (sidecar.furniture as Array<{ k: string }>).filter((f) => f.k === 'line').length;
    }).toBe(1);
    await expect(page.locator('.board-canvas__lines line')).toHaveCount(1);

    // Delete one endpoint — the line must go with it, with no dangling record.
    const col = furnitureOfKind(page, 'column');
    await col.hover();
    await col.locator('.board-canvas__furniture-delete').click();

    await expect(furnitureOfKind(page, 'table')).toBeVisible(); // the OTHER endpoint survives
    await expect(page.locator('.board-canvas__lines line')).toHaveCount(0);

    const sidecar = readSidecar(notesDir);
    const furniture = sidecar.furniture as Array<{ k: string }>;
    expect(furniture.some((f) => f.k === 'line')).toBe(false);
    expect(furniture.some((f) => f.k === 'column')).toBe(false);
    expect(furniture.some((f) => f.k === 'table')).toBe(true);
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('SKY-11188 §4/§2/§11 acceptance criterion: a column ref renders as a real link and opens the note', async () => {
  test.setTimeout(120_000);
  const { tempRoot, userData, notesDir } = makeTemp('ref');
  mkNote(notesDir, 'Mira Veynn.md', '# Mira Veynn\n\nA character note.\n');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);

    // Seed the ref via a direct app IPC call from the renderer — the toolbar
    // doesn't build a note-picker UI (out of scope, §4), but the ref itself
    // must resolve/render/navigate exactly like a [[wikilink]] once set, and
    // this still exercises that through the app's own IPC surface, not a
    // hand-written sidecar file.
    await page.evaluate(async () => {
      await (window as unknown as { api: { notesBoardFurnitureCreate: (f: string, i: unknown) => Promise<unknown> } }).api.notesBoardFurnitureCreate('', {
        k: 'column',
        x: 400,
        y: 44,
        title: 'Quick links',
        items: [{ t: 'Mira Veynn', ref: 'Mira Veynn.md' }],
      });
    });
    // Navigate away and back — a real reload of the board's own data (the
    // IPC layer has no push channel, unlike the vault-change watcher paths
    // other Boards specs use), without tearing down the Electron window.
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Boards"]').click();
    await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 8_000 });

    const refLink = page.locator('.board-canvas__furniture-ref', { hasText: 'Mira Veynn' });
    await expect(refLink).toBeVisible();
    await refLink.click();

    // Clicking the ref opens the note in the Notes editor (real wikilink behaviour).
    await expect(page.locator('[role="tabpanel"][aria-labelledby="app-tab-notes"]')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('A character note.')).toBeVisible({ timeout: 8_000 });
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
