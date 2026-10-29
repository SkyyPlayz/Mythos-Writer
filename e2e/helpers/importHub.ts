// #1765 — shared setup for the import-hub e2e specs (story-import.spec.ts,
// story-import-epub.spec.ts): a fresh profile with a real Mythos v2 vault,
// the one native-dialog seam, and the Settings → Vault & Files → "Import
// your writing" entry point reached by clicking.

import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import { closeElectronApp } from './electronTeardown';

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');

export interface ImportHubScratch {
  userData: string;
  workDir: string;
  /** The Mythos vault folder (holds mythos.json). */
  mythosRoot: string;
  storyVaultPath: string;
  notesVaultPath: string;
}

export async function launchImportApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', '--force-prefers-reduced-motion', ...extraArgs],
    timeout: 60_000,
  });
  const proc = app.process();
  proc.stdout?.on('data', (d: Buffer) => console.log('[main:out]', d.toString().trimEnd()));
  proc.stderr?.on('data', (d: Buffer) => console.log('[main:err]', d.toString().trimEnd()));
  return app;
}

export async function readyWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  await pg.waitForFunction(
    () => typeof (window as { api?: { createVaultFromOptions?: unknown } }).api?.createVaultFromOptions === 'function',
    undefined,
    { timeout: 20_000 },
  );
  return pg;
}

/**
 * Setup, not under test: a fresh profile (onboarding done) plus a real
 * Mythos v2 vault created + activated through the same IPC "New Mythos
 * vault…" uses. Relaunches so the shell boots straight into it.
 */
export async function setUpImportVault(prefix: string): Promise<ImportHubScratch & { app: ElectronApplication; page: Page }> {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `mythos-${prefix}-ud-`));
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `mythos-${prefix}-work-`));
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );

  const setupApp = await launchImportApp(userData);
  const setupPage = await readyWindow(setupApp);
  const created = await setupPage.evaluate(
    (parent) => (window as unknown as {
      api: { createVaultFromOptions: (p: unknown) => Promise<{ ok: boolean; mythosRoot?: string; storyVaultPath?: string; notesVaultPath?: string; error?: string }> };
    }).api.createVaultFromOptions({
      mode: 'template', destinationParent: parent, name: 'Import Hub Vault', exactName: true, activate: true,
    }),
    workDir,
  );
  expect(created.ok, created.error).toBe(true);
  await closeElectronApp(setupApp);

  const app = await launchImportApp(userData);
  const page = await readyWindow(app);
  return {
    userData,
    workDir,
    mythosRoot: created.mythosRoot!,
    storyVaultPath: created.storyVaultPath!,
    notesVaultPath: created.notesVaultPath!,
    app,
    page,
  };
}

/**
 * Patch ONLY dialog.showOpenDialog to resolve with `filePath` — Playwright
 * cannot drive the native picker. Everything downstream (safety check,
 * parsing, preview, commit, disk writes) runs for real.
 */
export async function stubOpenDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, { file }: { file: string }) => {
    (dialog as unknown as Record<string, unknown>).showOpenDialog = async () => (
      { canceled: false, filePaths: [file] }
    );
  }, { file: filePath });
}

/** Recursively collect all *.md files under `dir`. */
export function findMdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findMdFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** Gear → Vault & Files → the "Import your writing" section, by clicking. */
export async function openImportSection(page: Page): Promise<Locator> {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
  await page.locator('.app-menu-gear-btn').click();
  await page.getByRole('tab', { name: 'Vault & Files' }).click();
  const section = page.locator('section[aria-labelledby="section-import"]');
  await expect(section).toBeVisible({ timeout: 10_000 });
  await section.scrollIntoViewIfNeeded();
  return section;
}
