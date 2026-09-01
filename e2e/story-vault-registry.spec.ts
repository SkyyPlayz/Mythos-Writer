/**
 * story-vault-registry.spec.ts — SKY-11150 (per-Mythos story vault registry)
 *
 * Reachability E2E from a FRESH profile: nothing under test is pre-seeded.
 * The fixture is a normal single-story-vault v2 MythosVault (no
 * story-vaults.json on disk — the app migrates the registry on first open).
 *
 *   TC-SVR-01  First open migrates the registry: storyVaultRegistry:list returns
 *              one entry and <mythosRoot>/story-vaults.json appears on disk.
 *   TC-SVR-02  storyVaultRegistry:create creates "Second World" — listed in the
 *              registry, NOT active, directory exists on disk.
 *   TC-SVR-03  storyVaultRegistry:pair pairs the second story vault to a fake
 *              notes vault id — pairedNotesVaultId persists in story-vaults.json.
 *   TC-SVR-04  Full restart — pairing survives (pairedNotesVaultId still set).
 *
 * Run:
 *   npx playwright test e2e/story-vault-registry.spec.ts --reporter=list
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

const STORY_ID = 'story-svr-1';
const STORY_TITLE = 'The Registry World';
const SECOND_VAULT_NAME = 'Second World';
const FAKE_NOTES_VAULT_ID = 'notes-fake-id-svr-001';

// ─── Fixture: minimal hand-written v2 MythosVault (single story vault) ────────
// <bundle>/mythos.json + <bundle>/Story Vault/<Story>/… + <bundle>/Notes Vault/
// Crucially, NO story-vaults.json — TC-SVR-01 proves lazy migration on first open.

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
      id: 'vault-svr-1',
      name: 'SVR Test Vault',
      createdAt: NOW,
      stories: [
        { id: STORY_ID, title: STORY_TITLE, folder: STORY_TITLE, createdAt: NOW, updatedAt: NOW },
      ],
      seed: { layout: 'veynn-v2', mode: 'blank', seededAt: NOW },
    }, null, 2),
  );

  const spine = [
    { dir: 'Part 1', chapters: [{ dir: 'Chapter 01', id: 'ch-svr-1', title: 'Chapter One' }] },
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
    `---\nid: scene-svr-1\ntitle: The Opening\nstatus: draft\nupdatedAt: ${NOW}\n---\n\nOnce upon a time.\n`,
  );
}

// ─── App plumbing ─────────────────────────────────────────────────────────────

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

// ─── Registry disk helpers ────────────────────────────────────────────────────

interface StoryVaultEntry {
  id: string;
  displayName: string;
  dirName: string;
  origin: string;
  pairedNotesVaultId: string | null;
}

interface StoryVaultRegistryOnDisk {
  version: number;
  vaults: StoryVaultEntry[];
  activeId: string;
}

function readStoryRegistry(bundle: string): StoryVaultRegistryOnDisk | null {
  const p = path.join(bundle, 'story-vaults.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as StoryVaultRegistryOnDisk;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe.serial('SKY-11150 — Story vault registry (fresh profile)', () => {
  let tmpRoot: string;
  let userData: string;
  let bundle: string;
  let app: ElectronApplication | undefined;
  let page: Page;

  // Populated by TC-SVR-02 for use in TC-SVR-03 / TC-SVR-04.
  let secondVaultId: string;

  test.beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-svr-e2e-'));
    userData = path.join(tmpRoot, 'user-data');
    bundle = path.join(tmpRoot, 'SVR Test Vault');
    seedV2Vault(bundle);
    seedUserData(userData, bundle);
    // The whole point: story-vaults.json must NOT exist before first open.
    expect(fs.existsSync(path.join(bundle, 'story-vaults.json'))).toBe(false);

    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await closeElectronApp(app);
    removeTempDirs(tmpRoot);
  });

  test('TC-SVR-01: first open migrates registry — storyVaultRegistry:list returns one entry, story-vaults.json exists', async () => {
    // Wait for the app shell to be ready.
    await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 15_000 });

    // Call the IPC handler through the preload API.
    const result = await page.evaluate(async () => {
      return await (window as any).electronAPI.storyVaultRegistryList();
    });

    expect(result.vaults).not.toBeNull();
    expect(result.vaults).toHaveLength(1);
    expect(result.activeId).toBeTruthy();
    expect(result.vaults[0]).toMatchObject({ dirName: 'Story Vault' });
    expect(result.vaults[0].id).toBe(result.activeId);

    // Lazy migration must have written the file on disk.
    await expect
      .poll(() => fs.existsSync(path.join(bundle, 'story-vaults.json')), { timeout: 10_000 })
      .toBe(true);

    const reg = readStoryRegistry(bundle)!;
    expect(reg.vaults).toHaveLength(1);
    expect(reg.vaults[0].dirName).toBe('Story Vault');
    expect(reg.activeId).toBe(reg.vaults[0].id);
  });

  test('TC-SVR-02: storyVaultRegistry:create creates "Second World" — listed, NOT active, dir exists', async () => {
    const result = await page.evaluate(async (name: string) => {
      return await (window as any).electronAPI.storyVaultRegistryCreate(name);
    }, SECOND_VAULT_NAME);

    expect(result.entry).toBeTruthy();
    expect(result.entry.displayName).toBe(SECOND_VAULT_NAME);
    secondVaultId = result.entry.id as string;
    expect(secondVaultId).toBeTruthy();

    // Registry on disk: two vaults, activeId unchanged (first vault).
    await expect
      .poll(() => readStoryRegistry(bundle)?.vaults.length ?? 0, { timeout: 10_000 })
      .toBe(2);

    const reg = readStoryRegistry(bundle)!;
    const second = reg.vaults.find((v) => v.id === secondVaultId);
    expect(second).toMatchObject({ displayName: SECOND_VAULT_NAME, origin: 'created' });

    // Active id is still the first vault (setActive was NOT called).
    const firstVault = reg.vaults.find((v) => v.id !== secondVaultId);
    expect(reg.activeId).toBe(firstVault!.id);

    // Directory was created on disk.
    expect(fs.existsSync(path.join(bundle, SECOND_VAULT_NAME))).toBe(true);

    // The new vault starts with no pairing.
    expect(second!.pairedNotesVaultId).toBeNull();
  });

  test('TC-SVR-03: storyVaultRegistry:pair pairs the second story vault to a fake notes vault id — persists', async () => {
    const result = await page.evaluate(
      async ({ vaultId, notesId }: { vaultId: string; notesId: string }) => {
        return await (window as any).electronAPI.storyVaultRegistryPair(vaultId, notesId);
      },
      { vaultId: secondVaultId, notesId: FAKE_NOTES_VAULT_ID },
    );

    expect(result.entry).toBeTruthy();
    expect(result.entry.id).toBe(secondVaultId);
    expect(result.entry.pairedNotesVaultId).toBe(FAKE_NOTES_VAULT_ID);

    // Verify the pairing persisted to disk.
    await expect
      .poll(() => {
        const reg = readStoryRegistry(bundle);
        return reg?.vaults.find((v) => v.id === secondVaultId)?.pairedNotesVaultId ?? null;
      }, { timeout: 10_000 })
      .toBe(FAKE_NOTES_VAULT_ID);
  });

  test('TC-SVR-04: full restart — pairedNotesVaultId survives', async () => {
    await closeElectronApp(app);
    app = await launchApp(userData);
    page = await firstWindow(app);

    await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 15_000 });

    // Re-list after restart.
    const result = await page.evaluate(async () => {
      return await (window as any).electronAPI.storyVaultRegistryList();
    });

    expect(result.vaults).toHaveLength(2);
    const second = (result.vaults as StoryVaultEntry[]).find((v) => v.id === secondVaultId);
    expect(second).toBeTruthy();
    expect(second!.pairedNotesVaultId).toBe(FAKE_NOTES_VAULT_ID);

    // Disk also still has the pairing.
    const reg = readStoryRegistry(bundle)!;
    expect(reg.vaults.find((v) => v.id === secondVaultId)?.pairedNotesVaultId).toBe(FAKE_NOTES_VAULT_ID);
  });
});
