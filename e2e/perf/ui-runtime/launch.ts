/**
 * launch.ts — SKY-8217 shared harness plumbing.
 *
 * Launches the REAL packaged Electron build (electron-vite `out/main/main.js`)
 * headless via Playwright's `_electron`, the same way scene-save-perf.spec.ts
 * and export-formats.spec.ts already do it. Every UI-runtime perf metric
 * module in this directory launches through here — never `electron-vite dev`.
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { expect } from '@playwright/test';
import { clickStoryNav } from '../../helpers/navGuard';

export const MAIN_JS = path.resolve(__dirname, '../../../out/main/main.js');

export const STORY_ID = 'perf-ui-runtime-story';
export const CHAPTER_ID = 'perf-ui-runtime-chapter';
export const SCENE_ID = 'perf-ui-runtime-scene';
export const SCENE_TITLE = 'Perf Harness Scene';

/**
 * ~250 words of prose — long enough that the editor mounts a real document
 * (not an empty-state placeholder) for the keystroke-latency measurement.
 */
export const SCENE_BODY = [
  'The signal tower had stood on the ridge since before the town had a name,',
  'its cables humming faintly whenever the wind came in off the strait. Mara',
  'climbed the service ladder the way she always did, one hand over the other,',
  'counting rungs out of habit rather than need. Forty-two to the platform,',
  'sixty more to the lamp room, and from there the whole coastline unrolled',
  'like a chart someone had left open on a desk.',
  '',
  'Tonight the readings were wrong. Not dramatically — a half-degree drift on',
  'the bearing, a flicker in the relay log that resolved before she could',
  'trace it — but wrong in the way that made her trust the instruments less',
  'than her own memory of how the tower usually sounded. She logged it anyway,',
  'because the log was the only thing anyone would believe later.',
].join('\n');

export interface SeedOptions {
  apiKey?: string;
  agentsEnabled?: boolean;
}

/** App-settings + vault-settings shape matching scene-save-perf.spec.ts / writing-assistant.spec.ts. */
export function seedUserData(
  userData: string,
  vaultDir: string,
  notesVaultDir: string,
  opts: SeedOptions = {},
): void {
  const { apiKey = '', agentsEnabled = false } = opts;
  const agent = {
    enabled: agentsEnabled,
    model: 'claude-haiku-4-5-20251001',
    autoApply: false,
    confidenceThreshold: 0.85,
    maxTokensPerHour: 100_000,
    maxSuggestionsPerHour: 50,
    heartbeatIntervalMinutes: 5,
    maxTokensPerDay: 500_000,
  };
  const appSettings = {
    apiKey,
    onboardingComplete: true,
    agents: {
      writingAssistant: { ...agent, scanIntervalSeconds: 3600, waScanInterval: 3600 },
      brainstorm: agent,
      archive: { ...agent, continuityCheckIntervalSeconds: 3600 },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    // GRS (GlobalRightSidebar) — which hosts the "Writing Coach panel" header
    // metric 4 needs — only renders once rightSidebarVisible is an explicit
    // boolean (see DesktopShell.tsx's grsVisible state); an unset field leaves
    // it undefined and GRS never mounts. Matches writing-assistant.spec.ts's seed.
    rightSidebarVisible: true,
    notesTabUpgradeToastShown: true,
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

/** Seeds a single-scene vault — enough surface for the editor + Writing Coach panel. */
export function seedVault(vaultDir: string): void {
  const now = new Date().toISOString();
  const sceneDir = path.join(vaultDir, `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes`);
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(
    path.join(sceneDir, `${SCENE_ID}.md`),
    ['---', `id: ${SCENE_ID}`, `title: "${SCENE_TITLE}"`, `updatedAt: ${now}`, '---', '', SCENE_BODY, ''].join('\n'),
  );

  const manifest = {
    schemaVersion: 1,
    stories: [
      {
        id: STORY_ID,
        title: 'Perf Harness Story',
        path: `stories/${STORY_ID}`,
        chapters: [
          {
            id: CHAPTER_ID,
            title: 'Chapter One',
            path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`,
            order: 0,
            scenes: [
              {
                id: SCENE_ID,
                title: SCENE_TITLE,
                path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`,
                order: 0,
                chapterId: CHAPTER_ID,
                storyId: STORY_ID,
                blocks: [
                  { id: 'perf-block-0001', type: 'prose', content: SCENE_BODY, order: 0, updatedAt: now },
                ],
                draftState: 'in-progress',
                createdAt: now,
                updatedAt: now,
              },
            ],
            createdAt: now,
            updatedAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
  };
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

export interface Scratch {
  userData: string;
  vaultDir: string;
  notesVaultDir: string;
}

export function makeScratch(prefix: string): Scratch {
  return {
    userData: fs.mkdtempSync(path.join(os.tmpdir(), `mythos-${prefix}-ud-`)),
    vaultDir: fs.mkdtempSync(path.join(os.tmpdir(), `mythos-${prefix}-vault-`)),
    notesVaultDir: fs.mkdtempSync(path.join(os.tmpdir(), `mythos-${prefix}-notes-`)),
  };
}

export function rmScratch(s: Scratch): void {
  for (const dir of [s.userData, s.vaultDir, s.notesVaultDir]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export interface LaunchOptions {
  /**
   * PERFORMANCE.md §3/§4 targets 1, 2 and 4 (keystroke latency, idle CPU,
   * dropped-frames-with-agents) are measured with motion reduced, matching
   * how scene-save-perf.spec.ts always launches. Target 3 (ambient animation
   * fps) is the one case that needs a variant WITHOUT this flag — the ambient
   * wallpaper/ambience layers are a no-op animation under reduced motion
   * (frontend/src/theme/liquidNeon.css `@media (prefers-reduced-motion)`), so
   * measuring fps with it set would just measure "0 dropped frames because
   * nothing is animating," not the real ambient-animation target.
   */
  reducedMotion?: boolean;
}

/** Launches the packaged build headless — mirrors scene-save-perf.spec.ts's launchApp exactly. */
export async function launchApp(userData: string, opts: LaunchOptions = {}): Promise<ElectronApplication> {
  const { reducedMotion = true } = opts;
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const motionArgs = reducedMotion ? ['--force-prefers-reduced-motion'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...motionArgs, ...extraArgs],
    timeout: 60_000,
  });
}

export async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  page.on('dialog', (dialog) => void dialog.accept().catch(() => undefined));
  await page.waitForFunction(() => Boolean((window as unknown as { api?: unknown }).api), null, { timeout: 20_000 });
  await page.waitForLoadState('domcontentloaded');
  return page;
}

/** Navigates to Story → Editor and opens the seeded scene, focusing the ProseMirror document. */
export async function openSeededScene(page: Page): Promise<void> {
  await clickStoryNav(page);
  await page.locator('[data-testid="story-subview-editor"]').click();
  await expect(page.locator('.nav-story-row').first()).toBeVisible({ timeout: 20_000 });
  const sceneRow = page.locator('.nav-scene-row', { hasText: SCENE_TITLE });
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();
}

/** OS process id of the (first) renderer WebContents, for /proc/<pid>/stat sampling. */
export async function rendererOsPid(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win.webContents.getOSProcessId();
  });
}

/** OS process id of the Electron main process. */
export function mainOsPid(app: ElectronApplication): number {
  const pid = app.process().pid;
  if (!pid) throw new Error('Electron main process has no pid — app may have exited');
  return pid;
}
