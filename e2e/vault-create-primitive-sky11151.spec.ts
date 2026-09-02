/**
 * vault-create-primitive-sky11151.spec.ts — SKY-11151
 *
 * Reachability E2E from a FRESH profile for THE shared vault-creation primitive
 * (window.api.createVaultFromOptions → vault:create-from-options). Nothing under
 * test is pre-seeded (§4c): each case drives the real IPC surface a caller (first
 * run / New Mythos vault… / Settings Add vault…) uses and verifies the vault on
 * disk at a CHOSEN, NON-default location under a CHOSEN name — a default-location
 * test would prove nothing.
 *
 *   TC-CVP-01  template — creates the ready-shape (6 empty Notes-Vault folders,
 *              no note files) + machinery, at a chosen non-default parent/name.
 *   TC-CVP-02  blank — Obsidian-parity empty: machinery only, ZERO visible
 *              folders/files in the Notes Vault at creation.
 *   TC-CVP-03  import — copies a source Markdown tree byte-for-byte into a NEW
 *              vault (never adopts the source) and reports a per-target tally.
 *   TC-CVP-04  blank stays empty across a full relaunch + the vault-open /
 *              seed-marker rebuild path — the real §3a acceptance test, not
 *              merely "looks empty right after create."
 *
 * Run:
 *   npx playwright test e2e/vault-create-primitive-sky11151.spec.ts --reporter=list
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

// The RECOMMENDED template's ready-shape (mirrors TEMPLATE_NOTES_SKELETON in
// electron-main/src/mythosFormat/createVaultFromOptions.ts).
const TEMPLATE_SKELETON = ['Characters', 'Locations', 'Stories', 'Plot', 'Worldbuilding', 'Research'];

// ─── Fresh profile: onboarding already complete so the wizard never intercepts
// the renderer; NO vault-settings — every vault under test is created via IPC. ──
function seedUserData(userData: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
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

async function readyWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  // window.api is exposed by the preload synchronously on every window, even on
  // the no-vault shell — wait for the primitive's method to be bound.
  await pg.waitForFunction(
    () => typeof (window as { api?: { createVaultFromOptions?: unknown } }).api?.createVaultFromOptions === 'function',
    undefined,
    { timeout: 20_000 },
  );
  return pg;
}

type CreateResult = {
  ok: boolean;
  mode?: string;
  mythosRoot?: string;
  storyVaultPath?: string;
  notesVaultPath?: string;
  vaultName?: string;
  importTally?: { imported: number; skipped: number; sourceCount: number; warnings: string[] };
  error?: string;
};

async function createVault(
  page: Page,
  payload: Record<string, unknown>,
): Promise<CreateResult> {
  return page.evaluate(
    async (p) => (window as unknown as { api: { createVaultFromOptions: (x: unknown) => Promise<CreateResult> } })
      .api.createVaultFromOptions(p),
    payload,
  ) as Promise<CreateResult>;
}

/** Visible (non-dotfile) entries in a dir — the "what the user sees in the tree" set. */
function visibleEntries(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => !n.startsWith('.'));
}

test.describe('SKY-11151 — shared vault-creation primitive (reachability)', () => {
  let app: ElectronApplication;
  let page: Page;
  let tmpRoot: string;
  let userData: string;
  let chosenParent: string;

  test.beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-cvp-e2e-'));
    userData = path.join(tmpRoot, 'user-data');
    // A CHOSEN, non-default parent (NOT <userData>/vaults) — proves the caller's
    // destinationParent is honoured on disk.
    chosenParent = path.join(tmpRoot, 'ChosenLocation');
    fs.mkdirSync(chosenParent, { recursive: true });
    seedUserData(userData);
    app = await launchApp(userData);
    page = await readyWindow(app);
  });

  test.afterAll(async () => {
    await closeElectronApp(app);
    removeTempDirs(tmpRoot);
  });

  test('TC-CVP-01: template — ready-shape (6 empty folders, no notes) at chosen parent/name', async () => {
    const res = await createVault(page, {
      mode: 'template',
      destinationParent: chosenParent,
      name: 'Template Vault',
      exactName: true,
    });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe('template');

    const mythosRoot = res.mythosRoot!;
    // Created at the CHOSEN parent, under the CHOSEN name.
    expect(path.dirname(mythosRoot)).toBe(chosenParent);
    expect(path.basename(mythosRoot)).toBe('Template Vault');

    // Machinery present.
    expect(fs.existsSync(path.join(mythosRoot, 'mythos.json'))).toBe(true);
    expect(fs.existsSync(path.join(res.storyVaultPath!, '.mythos'))).toBe(true);

    // Ready-shape: exactly the 6 skeleton folders in the Notes Vault, folders
    // only (no note files inside).
    const notesEntries = visibleEntries(res.notesVaultPath!).sort();
    expect(notesEntries).toEqual([...TEMPLATE_SKELETON].sort());
    for (const dir of TEMPLATE_SKELETON) {
      const p = path.join(res.notesVaultPath!, dir);
      expect(fs.statSync(p).isDirectory()).toBe(true);
      expect(fs.readdirSync(p)).toHaveLength(0);
    }
  });

  test('TC-CVP-02: blank — Obsidian-parity empty (zero visible folders/files) at chosen parent/name', async () => {
    const res = await createVault(page, {
      mode: 'blank',
      destinationParent: chosenParent,
      name: 'Blank Vault',
      exactName: true,
    });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe('blank');

    const mythosRoot = res.mythosRoot!;
    expect(path.dirname(mythosRoot)).toBe(chosenParent);
    expect(path.basename(mythosRoot)).toBe('Blank Vault');

    // Machinery exists…
    expect(fs.existsSync(path.join(mythosRoot, 'mythos.json'))).toBe(true);
    expect(fs.existsSync(path.join(res.storyVaultPath!, '.mythos'))).toBe(true);

    // …but nothing the user sees in the tree — Notes AND Story vault roots have
    // zero visible entries at creation.
    expect(visibleEntries(res.notesVaultPath!)).toEqual([]);
    expect(visibleEntries(res.storyVaultPath!)).toEqual([]);
  });

  test('TC-CVP-03: import — copies a source Markdown tree into a NEW vault + reports tally', async () => {
    // A user source tree (the primitive copies IN — it never adopts the source).
    const source = path.join(tmpRoot, 'MySourceNotes');
    fs.mkdirSync(path.join(source, 'Lore'), { recursive: true });
    fs.writeFileSync(path.join(source, 'Index.md'), '# Index\n\n[[Lore/Dragons]]\n');
    fs.writeFileSync(path.join(source, 'Lore', 'Dragons.md'), '# Dragons\n\nThey are old.\n');

    const res = await createVault(page, {
      mode: 'import',
      destinationParent: chosenParent,
      name: 'Imported Vault',
      exactName: true,
      importSources: [{ kind: 'notes', srcPath: source }],
    });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe('import');
    expect(res.importTally).toBeTruthy();
    expect(res.importTally!.imported).toBe(2);

    // Files landed in the NEW vault's Notes Vault, byte-for-byte.
    const dstDragons = path.join(res.notesVaultPath!, 'Lore', 'Dragons.md');
    expect(fs.existsSync(dstDragons)).toBe(true);
    expect(fs.readFileSync(dstDragons, 'utf-8')).toBe('# Dragons\n\nThey are old.\n');

    // Source folder is untouched (never adopted).
    expect(fs.existsSync(path.join(source, 'Index.md'))).toBe(true);
    expect(fs.existsSync(path.join(source, '.mythos'))).toBe(false);
    expect(fs.existsSync(path.join(source, 'mythos.json'))).toBe(false);
  });

  test('TC-CVP-04: blank stays empty across a full relaunch + vault-open rebuild path', async () => {
    // Create AND activate a blank vault so a relaunch re-opens it and runs the
    // seed-marker / index rebuild path — the real re-seed failure mode (§3a).
    const activationParent = path.join(tmpRoot, 'ActivatedLocation');
    fs.mkdirSync(activationParent, { recursive: true });
    const res = await createVault(page, {
      mode: 'blank',
      destinationParent: activationParent,
      name: 'Persisted Blank',
      exactName: true,
      activate: true,
    });
    expect(res.ok).toBe(true);
    const notesVaultPath = res.notesVaultPath!;
    const storyVaultPath = res.storyVaultPath!;
    expect(visibleEntries(notesVaultPath)).toEqual([]);

    // Full relaunch on the SAME profile — the activated blank vault is re-opened
    // and ensureMythosV2SeedMarker runs; a regression here would re-seed folders.
    await closeElectronApp(app);
    app = await launchApp(userData);
    page = await readyWindow(app);

    // Give the vault-open path a beat to run its rebuild, then assert STILL empty.
    await expect
      .poll(() => visibleEntries(notesVaultPath).length, { timeout: 10_000 })
      .toBe(0);
    expect(visibleEntries(notesVaultPath)).toEqual([]);
    expect(visibleEntries(storyVaultPath)).toEqual([]);
  });
});
