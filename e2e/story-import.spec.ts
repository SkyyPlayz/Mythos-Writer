/**
 * story-import.spec.ts — SKY-8002
 *
 * REAL end-to-end coverage for Settings → Vault & Files → "Import a story"
 * (frontend/src/components/SettingsPanel/sections/ImportStorySection.tsx).
 *
 * Unlike electron-main/src/storyImport.test.ts (a Vitest unit test against a
 * mocked/tmp fs, no UI, no IPC, no real Electron app), this spec drives the
 * genuine app: UI click -> window.api.storyImportPickFile -> native dialog ->
 * window.api.storyImportRun -> the real STORY_IMPORT_RUN IPC handler in
 * electron-main/src/main.ts -> docxToStoryMarkdown / splitStoryMarkdown ->
 * writeImportedStoryToVault -> real .md scene files + manifest.json on disk.
 *
 * Per COMPANY-STANDARDS §4a, the only seam faked is the native OS file-picker
 * dialog (Playwright cannot drive `dialog.showOpenDialog`) — same pattern as
 * e2e/export-formats.spec.ts's `patchSaveDialog`. Nothing else is stubbed:
 * storyImportPickFile / storyImportRun and every handler downstream of them
 * run for real.
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
const FIXTURE_DOCX = path.resolve(__dirname, 'fixtures/story-import.docx');

// Must match the real headings baked into e2e/fixtures/story-import.docx
// (see e2e/fixtures/build-story-import-docx.cjs).
const STORY_TITLE = 'The Story Import Chronicle';
const CHAPTER_TITLES = ['The Story Import Chronicle', 'The Long Road'];
const SCENE_TITLES = ['Opening Gambit', 'Turning Point'];
const SCENE_PROSE_SNIPPETS = [
  'first real bytes hit the disk',
  'fresh heading and fresh prose',
];

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const agent = {
    enabled: false, model: 'claude-sonnet-4-6', autoApply: false,
    confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
    maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
  };
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: { ...agent, scanIntervalSeconds: 30 },
      brainstorm: agent,
      archive: { ...agent, continuityCheckIntervalSeconds: 60 },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

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
  pg.on('console', (m) => console.log('[renderer:' + m.type() + ']', m.text()));
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

/**
 * Patch ONLY dialog.showOpenDialog to resolve with `filePath` — the one
 * legitimate seam Playwright cannot drive natively. Everything downstream
 * (storyImportRun IPC handler, docx parsing, disk writes) runs for real.
 */
async function stubOpenDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, { file }: { file: string }) => {
    (dialog as unknown as Record<string, unknown>).showOpenDialog = async () => (
      { canceled: false, filePaths: [file] }
    );
  }, { file: filePath });
}

/** Recursively collect all *.md files under `dir`. */
function findMdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMdFiles(full));
    } else if (entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-story-import-userdata-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-story-import-vault-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-story-import-notes-'));
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

test('Import a story (.docx) writes real scene/chapter files to the vault on disk', async () => {
  expect(fs.existsSync(FIXTURE_DOCX), `missing fixture: ${FIXTURE_DOCX}`).toBe(true);
  expect(app, 'app failed to launch').toBeTruthy();

  // Open Settings -> Vault & Files (same nav pattern as settings-vault-path.spec.ts).
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await page.locator('.app-menu-gear-btn').click();
  await page.getByRole('tab', { name: 'Vault & Files' }).click();

  const section = page.locator('#section-import-story').locator('..');
  await expect(section).toBeVisible({ timeout: 8_000 });

  // Format is docx by default, but select it explicitly for clarity/robustness.
  await section.locator('[data-testid="import-story-format-docx"]').click();

  // Stub ONLY the native file picker to return our real fixture .docx.
  await stubOpenDialog(app!, FIXTURE_DOCX);

  // Click "Import story…" -> window.api.storyImportPickFile('docx') (fake
  // dialog) -> window.api.storyImportRun('docx', FIXTURE_DOCX) (REAL IPC,
  // REAL mammoth parse, REAL vault write) -> UI success state.
  await section.locator('[data-testid="import-story-run"]').click();

  const done = section.locator('[data-testid="import-story-done"]');
  await expect(done).toBeVisible({ timeout: 20_000 });
  await expect(done).toContainText(STORY_TITLE);
  await expect(done).toContainText('2 chapters');
  await expect(done).toContainText('2 scenes');

  // ─── Load-bearing assertions: the REAL filesystem ───────────────────────
  // Scope to Manuscript/ — a fresh vault boot seeds an unrelated "My First
  // Story" sample outside Manuscript/ that would otherwise pollute the count.
  const mdFiles = findMdFiles(path.join(vaultDir, 'Manuscript'));
  expect(mdFiles.length, `expected 2 scene .md files under ${vaultDir}, found: ${mdFiles.join(', ')}`).toBe(2);

  const contents = mdFiles.map((f) => fs.readFileSync(f, 'utf-8'));
  const allText = contents.join('\n---\n');

  for (const title of SCENE_TITLES) {
    expect(allText, `expected scene title "${title}" in written files`).toContain(title);
  }
  for (const snippet of SCENE_PROSE_SNIPPETS) {
    expect(allText, `expected prose snippet "${snippet}" in written files`).toContain(snippet);
  }

  // Chapter directory names should reflect the real chapter titles parsed
  // out of the docx (slugified by the vault writer).
  for (const chTitle of CHAPTER_TITLES) {
    const found = mdFiles.some((f) => {
      const dir = path.dirname(f).toLowerCase();
      return chTitle
        .toLowerCase()
        .split(/\s+/)
        .every((word) => dir.includes(word.replace(/[^a-z0-9]/g, '')));
    });
    expect(found, `expected a chapter dir matching "${chTitle}" among: ${mdFiles.join(', ')}`).toBe(true);
  }

  // manifest.json on disk records the imported story + chapter/scene counts.
  const manifestPath = path.join(vaultDir, 'manifest.json');
  expect(fs.existsSync(manifestPath), 'manifest.json missing after import').toBe(true);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const story = manifest.stories.find((s: { title: string }) => s.title === STORY_TITLE);
  expect(story, `story "${STORY_TITLE}" missing from manifest.json`).toBeTruthy();
  expect(story.chapters.length).toBe(2);
  expect(story.chapters.reduce((n: number, c: { scenes: unknown[] }) => n + c.scenes.length, 0)).toBe(2);

  // A Story Plan note is also written to the Notes Vault.
  const planFiles = findMdFiles(path.join(notesVaultDir, 'Plans'));
  expect(planFiles.length, 'expected a Story Plan note under Plans/').toBeGreaterThan(0);
});
