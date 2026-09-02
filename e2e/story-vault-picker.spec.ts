/**
 * story-vault-picker.spec.ts — SKY-11169 (Story-vault picker UI, carve-out of SKY-11150)
 *
 * Reachability E2E from a FRESH profile: nothing under test is pre-seeded.
 * SKY-11150 shipped the story-vault registry data layer + an IPC-level E2E
 * (story-vault-registry.spec.ts) but no picker UI — this spec drives the
 * real StoryVaultPicker component (LeftRail Zone 0) end to end.
 *
 *   TC-SVP-01  First open migrates the registry: picker shows "Story" and
 *              <mythosRoot>/story-vaults.json appears with ONE entry.
 *   TC-SVP-02  "+ New story vault…" (text-prompt modal) creates "Second World":
 *              listed in the menu, NOT active, registered on disk. Rename
 *              renames it in place.
 *   TC-SVP-03  Switching to "Second World" swaps the active vault (picker +
 *              registry + vault-settings.vaultRoot) — and the picker still
 *              resolves BOTH vaults afterward (proves the v2-format gate
 *              recognizes a registered non-default dirname, not just the
 *              literal "Story Vault" — SKY-11169's storyVaultRootFor fix).
 *   TC-SVP-04  "Pair to notes vault…" pairs the active (Second World) story
 *              vault to the seeded notes vault — pairedNotesVaultId persists.
 *   TC-SVP-05  Full restart: "Second World" is still active, still paired,
 *              and the picker still lists both vaults (the v2 gate survives
 *              a cold boot with a non-default vaultRoot).
 *
 * Run:
 *   npx playwright test e2e/story-vault-picker.spec.ts --reporter=list
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
import { clickStoryNav } from './helpers/navGuard';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const NOW = '2026-08-01T00:00:00.000Z';

const STORY_ID = 'story-svp-1';
const STORY_TITLE = 'The Picker Saga';
const SECOND_VAULT_NAME = 'Second World';
const RENAMED_VAULT_NAME = 'Second World Renamed';
const NOTES_VAULT_DISPLAY_NAME = 'Notes';

// ─── Fixture: minimal hand-written v2 MythosVault (single story vault) ────────
// <bundle>/mythos.json + <bundle>/Story Vault/<Story>/… + <bundle>/Notes Vault/.
// Crucially, NO story-vaults.json — TC-SVP-01 proves lazy migration on first
// open. The notes vault registry IS pre-seeded (one entry) — it is not the
// thing under test here, only the pairing TARGET (SKY-11058 already has its
// own reachability E2E for notes-vault creation).

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
      id: 'vault-svp-1',
      name: 'SVP Test Vault',
      createdAt: NOW,
      stories: [
        { id: STORY_ID, title: STORY_TITLE, folder: STORY_TITLE, createdAt: NOW, updatedAt: NOW },
      ],
      // Seed marker present → the demo-content seeder must never run here.
      seed: { layout: 'veynn-v2', mode: 'blank', seededAt: NOW },
    }, null, 2),
  );

  const spine = [
    { dir: 'Part 1', chapters: [{ dir: 'Chapter 01', id: 'ch-svp-1', title: 'Chapter One' }] },
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

  fs.writeFileSync(
    path.join(chapterDir, 'Scene 01.md'),
    `---\nid: scene-svp-1\ntitle: The Opening\nstatus: draft\nupdatedAt: ${NOW}\n---\n\nOnce upon a time.\n`,
  );

  // Pre-seed the notes registry (pairing target — not under test here).
  const notesVaultId = 'notes-vault-svp-1';
  fs.writeFileSync(
    path.join(bundle, 'notes-vaults.json'),
    JSON.stringify({
      version: 1,
      vaults: [{
        id: notesVaultId,
        displayName: NOTES_VAULT_DISPLAY_NAME,
        dirName: 'Notes Vault',
        createdAt: NOW,
        origin: 'created',
      }],
      activeId: notesVaultId,
    }, null, 2),
  );
}

// ─── App plumbing (same pattern as story-vault-registry.spec.ts) ─────────────

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

/** Open the story-vault picker dropdown menu. */
async function openPickerMenu(pg: Page): Promise<void> {
  await pg.locator('[data-testid="story-vault-picker-btn"]').click();
  await expect(pg.locator('[data-testid="story-vault-picker-menu"]')).toBeVisible({ timeout: 6_000 });
}

/** Answer the useTextPrompt modal (window.prompt is unsupported in Electron). */
async function fillPrompt(pg: Page, response: string): Promise<void> {
  const input = pg.locator('.prompt-modal-overlay .prompt-modal-input');
  await input.waitFor({ state: 'visible', timeout: 6_000 });
  await input.fill(response);
  await pg.locator('.prompt-modal-overlay .prompt-modal-ok').click();
  await input.waitFor({ state: 'detached', timeout: 6_000 });
}

interface StoryVaultEntry {
  id: string;
  displayName: string;
  dirName: string;
  origin?: string;
  pairedNotesVaultId: string | null;
}

interface StoryRegistryOnDisk {
  version: number;
  vaults: StoryVaultEntry[];
  activeId: string;
}

function readRegistry(bundle: string): StoryRegistryOnDisk | null {
  const p = path.join(bundle, 'story-vaults.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as StoryRegistryOnDisk;
}

function readVaultSettings(userData: string): { vaultRoot?: string } {
  const raw = fs.readFileSync(path.join(userData, 'vault-settings.json'), 'utf-8');
  return JSON.parse(raw) as { vaultRoot?: string };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe.serial('SKY-11169 — Story vault picker UI (fresh profile)', () => {
  let tmpRoot: string;
  let userData: string;
  let bundle: string;
  let app: ElectronApplication | undefined;
  let page: Page;

  test.beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-svp-e2e-'));
    userData = path.join(tmpRoot, 'user-data');
    bundle = path.join(tmpRoot, 'SVP Test Vault');
    seedV2Vault(bundle);
    seedUserData(userData, bundle);
    // The whole point: the registry must NOT exist before first open.
    expect(fs.existsSync(path.join(bundle, 'story-vaults.json'))).toBe(false);
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await closeElectronApp(app);
    removeTempDirs(tmpRoot);
  });

  test('TC-SVP-01: first open migrates the registry — picker shows "Story", story-vaults.json written', async () => {
    await clickStoryNav(page);

    const pickerName = page.locator('[data-testid="story-vault-picker-btn"] .story-vault-picker-name');
    await expect(pickerName).toBeVisible({ timeout: 10_000 });
    await expect(pickerName).toHaveText('Story');

    // Lazy migration wrote the registry beside mythos.json: exactly one
    // entry, pointing at the existing "Story Vault" dir, and it is active.
    await expect
      .poll(() => readRegistry(bundle)?.vaults.length ?? 0, { timeout: 10_000 })
      .toBe(1);
    const registry = readRegistry(bundle)!;
    expect(registry.vaults[0]).toMatchObject({ displayName: 'Story', dirName: 'Story Vault' });
    expect(registry.activeId).toBe(registry.vaults[0].id);
  });

  test('TC-SVP-02: "+ New story vault…" creates "Second World" — listed, registered, NOT active', async () => {
    await openPickerMenu(page);
    await page.locator('[data-testid="menu-item-create"]').click();
    await fillPrompt(page, SECOND_VAULT_NAME);

    // Registered on disk: two vaults, activeId unchanged, dir created —
    // entirely through the button click, never pre-seeded (§4c).
    await expect
      .poll(() => readRegistry(bundle)?.vaults.length ?? 0, { timeout: 10_000 })
      .toBe(2);
    const registry = readRegistry(bundle)!;
    const second = registry.vaults.find((v) => v.displayName === SECOND_VAULT_NAME);
    expect(second).toMatchObject({ dirName: SECOND_VAULT_NAME });
    expect(registry.activeId).toBe(
      registry.vaults.find((v) => v.displayName === 'Story')!.id,
    );
    expect(fs.existsSync(path.join(bundle, SECOND_VAULT_NAME))).toBe(true);

    // The picker did NOT switch — the button still shows the original vault…
    await expect(
      page.locator('[data-testid="story-vault-picker-btn"] .story-vault-picker-name'),
    ).toHaveText('Story');

    // …but the menu now lists the new vault.
    await openPickerMenu(page);
    const menu = page.locator('[data-testid="story-vault-picker-menu"]');
    await expect(
      menu.getByRole('menuitem', { name: SECOND_VAULT_NAME, exact: true }),
    ).toBeVisible({ timeout: 6_000 });
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
  });

  test('TC-SVP-03: switching to "Second World" swaps the active vault — picker still resolves both afterward', async () => {
    await openPickerMenu(page);
    await page
      .locator('[data-testid="story-vault-picker-menu"]')
      .getByRole('menuitem', { name: SECOND_VAULT_NAME, exact: true })
      .click();

    // No confirmation dialog for story vaults (no link-report IPC exists) —
    // the picker swaps directly.
    await expect(
      page.locator('[data-testid="story-vault-picker-btn"] .story-vault-picker-name'),
    ).toHaveText(SECOND_VAULT_NAME, { timeout: 10_000 });

    // Registry + vault-settings both point at Second World.
    await expect
      .poll(() => {
        const reg = readRegistry(bundle);
        return reg?.vaults.find((v) => v.id === reg.activeId)?.displayName;
      }, { timeout: 10_000 })
      .toBe(SECOND_VAULT_NAME);
    await expect
      .poll(() => readVaultSettings(userData).vaultRoot, { timeout: 10_000 })
      .toBe(path.join(bundle, SECOND_VAULT_NAME));

    // The empty "Second World" vault has no stories — LeftRail shows the
    // no-story-selected state, proving the app actually re-rooted onto the
    // new (empty) vault rather than just relabeling the button.
    await expect(page.locator('[data-testid="lr-story-card"]')).toHaveCount(0, { timeout: 10_000 });

    // SKY-11169 regression proof: re-open the menu — BOTH vaults still
    // resolve. Before the storyVaultRootFor fix, mythosRootForStoryVault()
    // only recognized the literal "Story Vault" dirname, so switching to a
    // non-default name would silently demote storyVaultRegistry:list to its
    // legacy-vault fallback (vaults: null) and the picker would vanish.
    await openPickerMenu(page);
    const menu = page.locator('[data-testid="story-vault-picker-menu"]');
    await expect(menu.getByRole('menuitem', { name: '✓ Second World', exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Story', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('TC-SVP-04: "Pair to notes vault…" pairs the active vault — pairedNotesVaultId persists', async () => {
    await openPickerMenu(page);
    await page.locator('[data-testid="menu-item-pair"]').click();

    const pairMenu = page.locator('[data-testid="story-vault-picker-pair-menu"]');
    await expect(pairMenu).toBeVisible({ timeout: 6_000 });
    await pairMenu.getByRole('menuitem', { name: NOTES_VAULT_DISPLAY_NAME, exact: true }).click();

    await expect
      .poll(() => {
        const reg = readRegistry(bundle);
        return reg?.vaults.find((v) => v.displayName === SECOND_VAULT_NAME)?.pairedNotesVaultId;
      }, { timeout: 10_000 })
      .toBe('notes-vault-svp-1');
  });

  test('TC-SVP-04b: "Rename active vault…" renames the active entry (round-trip so later TCs still see "Second World")', async () => {
    await openPickerMenu(page);
    await page.locator('[data-testid="menu-item-rename"]').click();
    await fillPrompt(page, RENAMED_VAULT_NAME);

    await expect(
      page.locator('[data-testid="story-vault-picker-btn"] .story-vault-picker-name'),
    ).toHaveText(RENAMED_VAULT_NAME, { timeout: 10_000 });
    await expect
      .poll(() => readRegistry(bundle)?.vaults.find((v) => v.dirName === SECOND_VAULT_NAME)?.displayName, {
        timeout: 10_000,
      })
      .toBe(RENAMED_VAULT_NAME);

    // Rename targets the active ENTRY, not its on-disk dirName — swap the
    // display name back so TC-SVP-05's fixture-name assertions still hold.
    await openPickerMenu(page);
    await page.locator('[data-testid="menu-item-rename"]').click();
    await fillPrompt(page, SECOND_VAULT_NAME);
    await expect(
      page.locator('[data-testid="story-vault-picker-btn"] .story-vault-picker-name'),
    ).toHaveText(SECOND_VAULT_NAME, { timeout: 10_000 });
  });

  test('TC-SVP-05: restart — "Second World" is still active, still paired, picker still lists both', async () => {
    await closeElectronApp(app);
    app = await launchApp(userData);
    page = await firstWindow(app);

    await clickStoryNav(page);
    await expect(
      page.locator('[data-testid="story-vault-picker-btn"] .story-vault-picker-name'),
    ).toHaveText(SECOND_VAULT_NAME, { timeout: 15_000 });

    const registry = readRegistry(bundle)!;
    expect(registry.vaults).toHaveLength(2);
    expect(
      registry.vaults.find((v) => v.id === registry.activeId)?.displayName,
    ).toBe(SECOND_VAULT_NAME);
    expect(
      registry.vaults.find((v) => v.displayName === SECOND_VAULT_NAME)?.pairedNotesVaultId,
    ).toBe('notes-vault-svp-1');

    // The v2 gate survives a cold boot with a non-default active vaultRoot.
    await openPickerMenu(page);
    const menu = page.locator('[data-testid="story-vault-picker-menu"]');
    await expect(menu.getByRole('menuitem', { name: '✓ Second World', exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Story', exact: true })).toBeVisible();
  });
});
