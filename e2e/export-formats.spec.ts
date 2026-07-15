/**
 * export-formats.spec.ts — Beta 4 M14 (FULL-SPEC §5.5)
 *
 * REAL export smoke: unlike export.spec.ts (which stubs the export IPC
 * handlers), this suite drives the genuine DOCX / PDF / EPUB pipelines
 * end-to-end and asserts real files land on disk with the right magic bytes.
 * This is the M14 acceptance check — "export produces files for all three
 * formats on Linux CI".
 *
 * Only `dialog.showSaveDialog` is patched (Playwright cannot drive native
 * dialogs); everything else — scope resolution, buildDocx, printToPDF,
 * buildEpub, atomic writes — is production code.
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

const STORY_ID = 'fmt-story-001';
const CHAPTER_ID = 'fmt-chapter-001';
const STORY_TITLE = 'Format Smoke Chronicle';
const SCENE_TITLES = ['The Opening Scene', 'The Second Scene'];
const SCENE_PROSE = [
  'Once upon a time in a land of tests, every assertion passed.\n\nA second paragraph kept the compiler honest.',
  'The second scene arrived so separators had something to separate.',
];

function seedVault(vaultDir: string): void {
  const now = new Date().toISOString();
  const scenes = SCENE_TITLES.map((title, i) => {
    const id = `fmt-scene-00${i + 1}`;
    const scenePath = `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${id}.md`;
    const abs = path.join(vaultDir, scenePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `# ${title}\n\n${SCENE_PROSE[i]}\n`);
    return {
      id,
      title,
      path: scenePath,
      order: i,
      chapterId: CHAPTER_ID,
      storyId: STORY_ID,
      createdAt: now,
      updatedAt: now,
      blocks: [
        { id: `blk-${i}`, type: 'paragraph', content: SCENE_PROSE[i], order: 0, updatedAt: now },
      ],
    };
  });

  const manifest = {
    schemaVersion: 1,
    stories: [
      {
        id: STORY_ID,
        title: STORY_TITLE,
        path: `stories/${STORY_ID}`,
        synopsis: 'A smoke test with a real synopsis page.',
        chapters: [
          {
            id: CHAPTER_ID,
            title: 'Chapter One',
            path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`,
            order: 0,
            createdAt: now,
            updatedAt: now,
            scenes,
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ],
    scenes: [],
    arcs: [],
    entities: [],
  };

  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

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

/** Patch ONLY dialog.showSaveDialog to write into exportDir (real handlers run). */
async function patchSaveDialog(app: ElectronApplication, exportDir: string): Promise<void> {
  await app.evaluate(({ dialog }, { dir }: { dir: string }) => {
    let counter = 0;
    (dialog as unknown as Record<string, unknown>).showSaveDialog = async (
      options: { filters?: Array<{ extensions?: string[] }> },
    ) => {
      const ext = options?.filters?.[0]?.extensions?.[0] ?? 'bin';
      const getBuiltinModule = (process as unknown as {
        getBuiltinModule: (id: string) => unknown;
      }).getBuiltinModule;
      const nodePath = getBuiltinModule('path') as typeof import('path');
      return { canceled: false, filePath: nodePath.join(dir, `real-export-${counter++}.${ext}`) };
    };
  }, { dir: exportDir });
}

async function openExportDialog(page: Page): Promise<void> {
  const storyTitle = page.locator('.nav-story-title', { hasText: STORY_TITLE }).first();
  await expect(storyTitle).toBeVisible({ timeout: 10_000 });
  await storyTitle.click();

  await page.locator('.wc-menu', { hasText: 'File' }).click();
  await page.locator('.wc-menu-item', { hasText: 'Export…' }).click();
  await page.locator('[role="dialog"][aria-labelledby="export-dialog-title"]').waitFor({ state: 'visible', timeout: 6_000 });
}

/** Select a format card, run the export, wait for the Done state, close. */
async function runExport(page: Page, formatValue: string): Promise<void> {
  await openExportDialog(page);
  const dialog = page.locator('[role="dialog"][aria-labelledby="export-dialog-title"]');
  await dialog.locator(`input[type="radio"][value="${formatValue}"]`).click();
  await dialog.getByRole('button', { name: /^Export/ }).click();
  await expect(dialog.getByText('Export complete')).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 4_000 });
}

function findExport(exportDir: string, ext: string): string {
  const hit = fs.readdirSync(exportDir).find((f) => f.endsWith(`.${ext}`));
  expect(hit, `expected a .${ext} file in ${exportDir}`).toBeTruthy();
  return path.join(exportDir, hit!);
}

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let exportDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-fmt-ud-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-fmt-vault-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-fmt-notes-'));
  exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-fmt-out-'));

  seedVault(vaultDir);
  seedUserData(userData, vaultDir, notesVaultDir);

  app = await launchApp(userData);
  page = await app.firstWindow();
  page.on('console', (m) => console.log('[renderer:' + m.type() + ']', m.text()));
  page.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await page.waitForLoadState('domcontentloaded');

  await patchSaveDialog(app, exportDir);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  for (const dir of [userData, vaultDir, notesVaultDir, exportDir]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── AC-M14-1: real DOCX bytes on disk ───────────────────────────────────────

test('AC-M14-1: DOCX export produces a real OOXML file on disk', async () => {
  await runExport(page, 'docx');

  const file = findExport(exportDir, 'docx');
  const buf = fs.readFileSync(file);
  expect(buf.length, 'DOCX must not be empty').toBeGreaterThan(1000);
  expect(buf.subarray(0, 2).toString('latin1'), 'DOCX is a ZIP (PK magic)').toBe('PK');
  expect(buf.toString('latin1')).toContain('word/document.xml');
});

// ─── AC-M14-2: real PDF bytes on disk (printToPDF pipeline) ──────────────────

test('AC-M14-2: PDF export produces a real PDF file on disk', async () => {
  await runExport(page, 'pdf');

  const file = findExport(exportDir, 'pdf');
  const buf = fs.readFileSync(file);
  expect(buf.length, 'PDF must not be empty').toBeGreaterThan(1000);
  expect(buf.subarray(0, 5).toString('latin1'), 'PDF magic bytes').toBe('%PDF-');
});

// ─── AC-M14-3: real EPUB bytes on disk ───────────────────────────────────────

test('AC-M14-3: EPUB export produces a real EPUB file on disk', async () => {
  await runExport(page, 'epub');

  const file = findExport(exportDir, 'epub');
  const buf = fs.readFileSync(file);
  expect(buf.length, 'EPUB must not be empty').toBeGreaterThan(500);
  expect(buf.subarray(0, 2).toString('latin1'), 'EPUB is a ZIP (PK magic)').toBe('PK');
  // The EPUB mimetype entry is STORED (uncompressed) first — readable raw.
  expect(buf.toString('latin1')).toContain('application/epub+zip');
});
