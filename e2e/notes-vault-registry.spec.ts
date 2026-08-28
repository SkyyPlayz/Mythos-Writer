/**
 * notes-vault-registry.spec.ts — SKY-11058 (multiple Notes vaults per Mythos vault)
 *
 * Reachability E2E from a FRESH profile: nothing under test is pre-seeded.
 * The fixture is a normal single-notes-vault v2 MythosVault (no
 * notes-vaults.json on disk — the app migrates the registry on first open);
 * the second notes vault is created entirely through the picker UI.
 *
 *   TC-NVR-01  First open migrates the registry: picker shows "Notes" and
 *              <mythosRoot>/notes-vaults.json appears with ONE entry.
 *   TC-NVR-02  "+ New notes vault…" (text-prompt modal) creates "Research":
 *              listed in the menu, NOT active, registered on disk.
 *   TC-NVR-03  Switching to "Research" shows the link-resolution report
 *              dialog (manuscript has a [[wikilink]]); confirming swaps the
 *              active vault (picker + registry + vault-settings).
 *   TC-NVR-04  A note created via the Notes tree lands in the NEW vault's
 *              directory (the notes list re-read the new root).
 *   TC-NVR-05  Full restart: "Research" is still the active vault.
 *
 * Run:
 *   npx playwright test e2e/notes-vault-registry.spec.ts --reporter=list
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

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const NOW = '2026-08-01T00:00:00.000Z';

const STORY_ID = 'story-nvr-1';
const STORY_TITLE = 'The Registry';
const LINKED_NOTE_STEM = 'World Notes';
const SCENE_PROSE = `She checked the [[${LINKED_NOTE_STEM}]] one last time before dawn.`;
const SECOND_VAULT_NAME = 'Research';
const NEW_NOTE_TITLE = 'Research Log';

// ─── Fixture: minimal hand-written v2 MythosVault (single notes vault) ───────
// Same bundle shape as comments-v2.spec.ts: <bundle>/mythos.json,
// <bundle>/Story Vault/<Story>/…, <bundle>/Notes Vault/. Crucially, NO
// notes-vaults.json — TC-NVR-01 proves the app migrates it on first open.

function seedUserData(userData: string, bundle: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({
      vaultRoot: path.join(bundle, 'Story Vault'),
      notesVaultRoot: path.join(bundle, 'Notes Vault'),
    }, null, 2),
  );
}

function seedV2Vault(bundle: string): void {
  const storyDir = path.join(bundle, 'Story Vault', STORY_TITLE);
  const chapterDir = path.join(storyDir, 'Part 1', 'Chapter 01');
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.mkdirSync(path.join(bundle, 'Notes Vault'), { recursive: true });

  fs.writeFileSync(
    path.join(bundle, 'mythos.json'),
    JSON.stringify({
      formatVersion: 2,
      id: 'vault-nvr-1',
      name: 'Registry Vault',
      createdAt: NOW,
      stories: [
        { id: STORY_ID, title: STORY_TITLE, folder: STORY_TITLE, createdAt: NOW, updatedAt: NOW },
      ],
      // Seed marker present → the demo-content seeder must never run here.
      seed: { layout: 'veynn-v2', mode: 'blank', seededAt: NOW },
    }, null, 2),
  );

  const spine = [
    { dir: 'Part 1', chapters: [{ dir: 'Chapter 01', id: 'ch-nvr-1', title: 'Chapter One' }] },
  ];
  fs.writeFileSync(
    path.join(storyDir, 'book.md'),
    [
      '---',
      `id: ${STORY_ID}`,
      `title: ${STORY_TITLE}`,
      `createdAt: ${NOW}`,
      `updatedAt: ${NOW}`,
      '---',
      `# ${STORY_TITLE}`,
      '',
      '## Part 1',
      '',
      '- [[Part 1/Chapter 01|Chapter One]]',
      '',
      '<!-- mythos:spine',
      JSON.stringify(spine),
      '-->',
      '',
    ].join('\n'),
  );

  // ONE story file with a [[stem]] that exists in the original notes vault —
  // this is what makes the pre-swap link-resolution dialog appear (the swap
  // target is empty, so the stem no longer resolves there).
  fs.writeFileSync(
    path.join(chapterDir, 'Scene 01.md'),
    `---\nid: scene-nvr-1\ntitle: The Ledger\nstatus: draft\nupdatedAt: ${NOW}\n---\n${SCENE_PROSE}`,
  );

  // The note the manuscript links to, in the ORIGINAL notes vault.
  fs.writeFileSync(
    path.join(bundle, 'Notes Vault', `${LINKED_NOTE_STEM}.md`),
    `---\ntitle: "${LINKED_NOTE_STEM}"\ncreatedAt: ${NOW}\n---\n\nEverything known about the world.\n`,
  );
}

// ─── App plumbing (same pattern as comments-v2.spec.ts) ──────────────────────

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
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

/** Open the Notes tab (the picker lives in its toolbar). */
async function openNotesTab(pg: Page): Promise<void> {
  const nav = pg.locator('nav[aria-label="Main navigation"]');
  await expect(nav).toBeVisible({ timeout: 15_000 });
  await nav.locator('button[aria-label="Notes Editor"]').click();
  await expect(pg.locator('[data-testid="notes-tab-panel"]')).toBeVisible({ timeout: 8_000 });
}

/** Open the notes-vault picker dropdown menu. */
async function openPickerMenu(pg: Page): Promise<void> {
  await pg.locator('[data-testid="notes-vault-picker-btn"]').click();
  await expect(pg.locator('[data-testid="notes-vault-picker-menu"]')).toBeVisible({ timeout: 6_000 });
}

/** Answer the useTextPrompt modal (window.prompt is unsupported in Electron). */
async function fillPrompt(pg: Page, response: string): Promise<void> {
  const input = pg.locator('.prompt-modal-overlay .prompt-modal-input');
  await input.waitFor({ state: 'visible', timeout: 6_000 });
  await input.fill(response);
  await pg.locator('.prompt-modal-overlay .prompt-modal-ok').click();
  await input.waitFor({ state: 'detached', timeout: 6_000 });
}

interface RegistryOnDisk {
  version: number;
  vaults: Array<{ id: string; displayName: string; dirName: string; origin: string }>;
  activeId: string;
}

function readRegistry(bundle: string): RegistryOnDisk | null {
  const p = path.join(bundle, 'notes-vaults.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as RegistryOnDisk;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe.serial('SKY-11058 — Notes vault registry (fresh profile)', () => {
  let tmpRoot: string;
  let userData: string;
  let bundle: string;
  let app: ElectronApplication | undefined;
  let page: Page;

  test.beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-nvr-e2e-'));
    userData = path.join(tmpRoot, 'user-data');
    bundle = path.join(tmpRoot, 'Registry Vault');
    seedV2Vault(bundle);
    seedUserData(userData, bundle);
    // The whole point: the registry must NOT exist before first open.
    expect(fs.existsSync(path.join(bundle, 'notes-vaults.json'))).toBe(false);
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await closeElectronApp(app);
    removeTempDirs(tmpRoot);
  });

  test('TC-NVR-01: first open migrates the registry — picker shows "Notes", notes-vaults.json written', async () => {
    await openNotesTab(page);

    const pickerName = page.locator('[data-testid="notes-vault-picker-btn"] .notes-vault-picker-name');
    await expect(pickerName).toBeVisible({ timeout: 10_000 });
    await expect(pickerName).toHaveText('Notes');

    // Lazy migration wrote the registry beside mythos.json: exactly one
    // entry, pointing at the existing "Notes Vault" dir, and it is active.
    await expect
      .poll(() => readRegistry(bundle)?.vaults.length ?? 0, { timeout: 10_000 })
      .toBe(1);
    const registry = readRegistry(bundle)!;
    expect(registry.vaults[0]).toMatchObject({ displayName: 'Notes', dirName: 'Notes Vault' });
    expect(registry.activeId).toBe(registry.vaults[0].id);
  });

  test('TC-NVR-02: "+ New notes vault…" creates "Research" — listed, registered, NOT active', async () => {
    await openPickerMenu(page);
    await page.locator('[data-testid="menu-item-create"]').click();
    await fillPrompt(page, SECOND_VAULT_NAME);

    // Registered on disk: two vaults, activeId unchanged, dir created.
    await expect
      .poll(() => readRegistry(bundle)?.vaults.length ?? 0, { timeout: 10_000 })
      .toBe(2);
    const registry = readRegistry(bundle)!;
    const research = registry.vaults.find((v) => v.displayName === SECOND_VAULT_NAME);
    expect(research).toMatchObject({ dirName: SECOND_VAULT_NAME, origin: 'created' });
    expect(registry.activeId).toBe(
      registry.vaults.find((v) => v.displayName === 'Notes')!.id,
    );
    expect(fs.existsSync(path.join(bundle, SECOND_VAULT_NAME))).toBe(true);

    // The picker did NOT switch — the button still shows the original vault…
    await expect(
      page.locator('[data-testid="notes-vault-picker-btn"] .notes-vault-picker-name'),
    ).toHaveText('Notes');

    // …but the menu now lists the new vault.
    await openPickerMenu(page);
    const menu = page.locator('[data-testid="notes-vault-picker-menu"]');
    await expect(
      menu.getByRole('menuitem', { name: SECOND_VAULT_NAME, exact: true }),
    ).toBeVisible({ timeout: 6_000 });
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
  });

  test('TC-NVR-03: switching to "Research" shows the link report, confirm swaps the active vault', async () => {
    await openPickerMenu(page);
    await page
      .locator('[data-testid="notes-vault-picker-menu"]')
      .getByRole('menuitem', { name: SECOND_VAULT_NAME, exact: true })
      .click();

    // The manuscript has [[World Notes]] (plus book.md's chapter wikilink),
    // none of which resolve in the empty "Research" vault → the pre-swap
    // confirmation dialog must appear with the resolution report.
    const dialog = page.locator('[data-testid="notes-vault-switch-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toContainText(`Switch to “${SECOND_VAULT_NAME}”?`);
    await expect(dialog).toContainText(/0 of \d+ linked notes resolve/);
    await expect(dialog.locator('.notes-vault-picker-unresolved')).toContainText(
      `[[${LINKED_NOTE_STEM.toLowerCase()}]]`,
    );

    await page.locator('[data-testid="notes-vault-switch-confirm"]').click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // Picker now shows the new active vault.
    await expect(
      page.locator('[data-testid="notes-vault-picker-btn"] .notes-vault-picker-name'),
    ).toHaveText(SECOND_VAULT_NAME, { timeout: 10_000 });

    // Registry + vault-settings both point at Research.
    await expect
      .poll(() => {
        const reg = readRegistry(bundle);
        return reg?.vaults.find((v) => v.id === reg.activeId)?.displayName;
      }, { timeout: 10_000 })
      .toBe(SECOND_VAULT_NAME);
    await expect
      .poll(() => {
        try {
          const raw = fs.readFileSync(path.join(userData, 'vault-settings.json'), 'utf-8');
          return (JSON.parse(raw) as { notesVaultRoot?: string }).notesVaultRoot;
        } catch {
          return undefined;
        }
      }, { timeout: 10_000 })
      .toBe(path.join(bundle, SECOND_VAULT_NAME));
  });

  test('TC-NVR-04: a note created via the Notes tree lands in the NEW vault directory', async () => {
    // The Notes tree now reads the Research root (empty vault).
    await expect(page.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="vb-btn-new-note"]').click();

    const dialog = page.locator('.ntd-dialog');
    await expect(dialog).toBeVisible({ timeout: 6_000 });
    await dialog.locator('[data-testid="ntd-blank-title"]').fill(NEW_NOTE_TITLE);
    await dialog.locator('[data-testid="ntd-submit"]').click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });

    // The file lands inside <mythosRoot>/Research/, NOT the original vault.
    const newNotePath = path.join(bundle, SECOND_VAULT_NAME, `${NEW_NOTE_TITLE}.md`);
    await expect.poll(() => fs.existsSync(newNotePath), { timeout: 10_000 }).toBe(true);
    expect(
      fs.existsSync(path.join(bundle, 'Notes Vault', `${NEW_NOTE_TITLE}.md`)),
    ).toBe(false);

    // …and the re-read tree shows it.
    await expect(
      page.locator(`[data-testid="vb-row-${NEW_NOTE_TITLE}.md"]`),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('TC-NVR-05: restart — "Research" is still the active vault', async () => {
    await closeElectronApp(app);
    app = await launchApp(userData);
    page = await firstWindow(app);

    await openNotesTab(page);
    await expect(
      page.locator('[data-testid="notes-vault-picker-btn"] .notes-vault-picker-name'),
    ).toHaveText(SECOND_VAULT_NAME, { timeout: 15_000 });

    // The active vault's content loads (the note created in TC-NVR-04).
    await expect(
      page.locator(`[data-testid="vb-row-${NEW_NOTE_TITLE}.md"]`),
    ).toBeVisible({ timeout: 10_000 });

    // Registry persisted across the restart: 2 vaults, Research active.
    const registry = readRegistry(bundle)!;
    expect(registry.vaults).toHaveLength(2);
    expect(
      registry.vaults.find((v) => v.id === registry.activeId)?.displayName,
    ).toBe(SECOND_VAULT_NAME);
  });
});
