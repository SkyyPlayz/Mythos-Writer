/**
 * readme-screenshots.spec.ts
 *
 * Captures the eight README window shots into docs/screenshots/readme/:
 *   welcome, story-writer, notes, scene-crafter, partner, timeline,
 *   vault-graph, settings-model-keys
 *
 * Each shot is the full Electron content area at exactly 1440×900, with no clip.
 * Electron's getContentSize can land a couple of pixels off the request; the
 * spec measures that delta and sets the content size again so the PNG is
 * 1440×900. The demo project is The Last City of Veynn (createMythosVault
 * seedDemo). No AI key is written into the profile.
 *
 * The seed writes electron-main/vitest.readme-seed.config.ts because vitest
 * resolves its config from that package. That file is removed at import
 * (pre-clean), in a finally around the seed, in afterAll, and on process
 * exit. MYTHOS_README_SEED_FAIL=1 throws after the config is written so a
 * failed run can be checked; CI does not set it.
 *
 * The demo profile marks the Notes-tab upgrade toast as already shown, and
 * the partner and settings shots assert that toast is gone. Model & keys
 * selects LM Studio. A stub on 127.0.0.1:1234 returns an empty model list,
 * so the panel stays on the real idle state and does not show a
 * "not running" warning. Ollama is not selected.
 *
 * Run:
 *   xvfb-run -a npx playwright test e2e/readme-screenshots.spec.ts --reporter=list
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const REPO_ROOT = path.resolve(__dirname, '..');
const MAIN_JS = path.join(REPO_ROOT, 'out/main/main.js');
const SCREENSHOT_DIR = path.join(REPO_ROOT, 'docs/screenshots/readme');
const SEED_CONFIG = path.join(REPO_ROOT, 'electron-main/vitest.readme-seed.config.ts');
const CONTENT = { width: 1440, height: 900 };
const NOTES_TOAST = 'Your notes are in the new Notes tab.';
const LMSTUDIO_URL = 'http://127.0.0.1:1234/v1';

let modelStub: http.Server | null = null;

function startModelStub(): Promise<void> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [] }));
  });
  modelStub = server;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(1234, '127.0.0.1', () => resolve());
  });
}

function stopModelStub(): Promise<void> {
  const server = modelStub;
  modelStub = null;
  if (!server) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

function removeSeedConfig(): void {
  fs.rmSync(SEED_CONFIG, { force: true });
}

removeSeedConfig();
process.on('exit', removeSeedConfig);

const SHOTS = [
  'welcome',
  'story-writer',
  'notes',
  'scene-crafter',
  'partner',
  'timeline',
  'vault-graph',
  'settings-model-keys',
] as const;

interface SeedResult {
  ok: true;
  storyVaultPath: string;
  notesVaultPath: string;
  firstSceneId: string;
  firstScenePath: string;
}

function strippedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of [
    'SKYYPLAYZ_GITHUB_PAT',
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'OPENROUTER_API_KEY',
  ]) {
    delete env[key];
  }
  env.MYTHOS_DISABLE_BOOT_MIGRATION = '1';
  return env;
}

function seedVeynn(parent: string): SeedResult {
  const vaultParent = path.join(parent, 'vaults');
  const outFile = path.join(parent, 'seed-result.json');
  const testFile = path.join(parent, 'seed-veynn.test.ts');
  fs.mkdirSync(parent, { recursive: true });
  const createVault = path.join(REPO_ROOT, 'electron-main/src/mythosFormat/createVault.ts');
  fs.writeFileSync(testFile, `
import fs from 'node:fs';
import { it } from 'vitest';
import { createMythosVault } from ${JSON.stringify(createVault)};

it('seeds the demo vault', () => {
  const parent = ${JSON.stringify(vaultParent)};
  fs.mkdirSync(parent, { recursive: true });
  const result = createMythosVault(parent, { name: 'Demo', exactName: true, seedDemo: true });
  if (!result.ok) throw new Error('createMythosVault failed');
  fs.writeFileSync(${JSON.stringify(outFile)}, JSON.stringify(result));
});
`);
  removeSeedConfig();
  fs.writeFileSync(SEED_CONFIG, `import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: [${JSON.stringify(testFile)}],
    globalSetup: [],
    testTimeout: 30000,
  },
});
`);
  try {
    if (process.env.MYTHOS_README_SEED_FAIL === '1') {
      throw new Error('injected readme seed failure');
    }
    execFileSync('npx', ['vitest', 'run', '--config', SEED_CONFIG], {
      cwd: path.join(REPO_ROOT, 'electron-main'),
      env: strippedEnv(),
      stdio: 'inherit',
    });
  } finally {
    removeSeedConfig();
  }
  return JSON.parse(fs.readFileSync(outFile, 'utf8')) as SeedResult;
}

function writeProfile(userData: string, seed: SeedResult | null): void {
  fs.mkdirSync(userData, { recursive: true });
  if (!seed) {
    fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({ apiKey: '' }, null, 2));
    return;
  }
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '',
    onboardingComplete: true,
    notesTabUpgradeToastShown: true,
    theme: 'dark',
    // LM Studio needs no API key, so the key field stays unmounted. The
    // capture listens on its default port and answers /v1/models with an
    // empty list, which is the real idle state: no "not running" warning.
    provider: { kind: 'lmstudio', apiKey: '', baseUrl: LMSTUDIO_URL, model: '' },
    writingPartner: { modelKeysProvider: 'lmstudio' },
    lastOpenedScene: {
      sceneId: seed.firstSceneId,
      scenePath: seed.firstScenePath,
      scrollTop: 0,
      cursorLine: 0,
      openAtDepth: 'book',
    },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: seed.storyVaultPath,
    notesVaultRoot: seed.notesVaultPath,
    layoutMode: 'default',
    recentProjects: [{
      name: 'Demo',
      vaultRoot: seed.storyVaultPath,
      notesVaultRoot: seed.notesVaultPath,
      openedAt: now,
    }],
  }, null, 2));
}

async function launch(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    env: strippedEnv(),
    timeout: 60_000,
  });
}

async function contentSize(app: ElectronApplication): Promise<{ width: number; height: number }> {
  return app.evaluate(({ BrowserWindow }) => {
    const [width, height] = BrowserWindow.getAllWindows()[0].getContentSize();
    return { width, height };
  });
}

async function fitWindow(app: ElectronApplication, page: Page): Promise<void> {
  const apply = (width: number, height: number) => app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.setZoomFactor(1);
    win.setContentSize(size.width, size.height);
  }, { width, height });

  await apply(CONTENT.width, CONTENT.height);
  let size = await contentSize(app);
  if (size.width !== CONTENT.width || size.height !== CONTENT.height) {
    await apply(
      CONTENT.width - (size.width - CONTENT.width),
      CONTENT.height - (size.height - CONTENT.height),
    );
    size = await contentSize(app);
  }
  expect(size.width, 'content width').toBe(CONTENT.width);
  expect(size.height, 'content height').toBe(CONTENT.height);
  await page.setViewportSize({ width: CONTENT.width, height: CONTENT.height });
}

async function settleNotesToast(page: Page): Promise<void> {
  const toast = page.getByTestId('app-toast').filter({ hasText: NOTES_TOAST });
  if (await toast.isVisible().catch(() => false)) {
    await expect(toast).toBeHidden({ timeout: 8_000 });
  }
  await expect(page.getByText(NOTES_TOAST)).toHaveCount(0);
}

async function saveShot(page: Page, name: (typeof SHOTS)[number]): Promise<void> {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const file = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file, type: 'png', animations: 'disabled' });
  const png = PNG.sync.read(fs.readFileSync(file));
  expect(png.width, name).toBe(CONTENT.width);
  expect(png.height, name).toBe(CONTENT.height);
  console.log(`SHOT ${name}.png ${png.width}x${png.height} bytes=${fs.statSync(file).size}`);
}

test.describe.configure({ mode: 'serial' });

let seed: SeedResult;
let seedRoot: string;

test.beforeAll(async () => {
  for (const key of ['SKYYPLAYZ_GITHUB_PAT', 'GH_TOKEN', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY']) {
    delete process.env[key];
  }
  await startModelStub();
  seedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-readme-seed-'));
  seed = seedVeynn(seedRoot);
  expect(seed.ok).toBe(true);
  expect(seed.firstScenePath).toContain('The Last City of Veynn');
});

test.afterAll(async () => {
  removeSeedConfig();
  await stopModelStub();
  if (seedRoot) fs.rmSync(seedRoot, { recursive: true, force: true });
});

test('screenshot: welcome', async () => {
  test.setTimeout(120_000);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-readme-welcome-'));
  writeProfile(userData, null);
  const app = await launch(userData);
  try {
    const page = await app.firstWindow();
    page.on('dialog', (d) => { void d.accept().catch(() => undefined); });
    await fitWindow(app, page);
    await expect(page.getByText('Start from a template')).toBeVisible({ timeout: 20_000 });
    await saveShot(page, 'welcome');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('screenshot: demo window', async () => {
  test.setTimeout(180_000);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-readme-demo-'));
  writeProfile(userData, seed);
  const app = await launch(userData);
  try {
    const page = await app.firstWindow();
    page.on('dialog', (d) => { void d.accept().catch(() => undefined); });
    await fitWindow(app, page);
    await expect(page.getByRole('heading', { name: 'The Last City of Veynn', level: 2 })).toBeVisible({ timeout: 30_000 });
    await saveShot(page, 'story-writer');

    await page.locator('[data-testid="nav-rail-notes"]').click();
    const mira = page.locator('[data-testid="vb-row-Characters/Mira Veynn.md"]');
    if (!(await mira.isVisible().catch(() => false))) {
      await page.locator('[data-testid="vb-row-Characters"]').click();
    }
    await expect(mira).toBeVisible({ timeout: 15_000 });
    await mira.click();
    await expect(page.locator('[data-testid="note-title"]')).toHaveText('Mira Veynn', { timeout: 15_000 });
    await saveShot(page, 'notes');

    await page.locator('[data-testid="nav-rail-crafter"]').click();
    await expect(page.locator('[data-testid="nav-rail-crafter"]')).toHaveAttribute('aria-current', 'page');
    await saveShot(page, 'scene-crafter');

    await page.evaluate(() => localStorage.removeItem('brainstorm:draft'));
    await page.locator('[data-testid="nav-rail-brainstorm"]').click();
    const dismiss = page.getByRole('button', { name: 'Dismiss' });
    if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
    await expect(page.getByText('Recovered your previous brainstorm draft')).toHaveCount(0);
    await expect(page.getByText('IDEA COLLECTIONS').first()).toBeVisible({ timeout: 15_000 });
    await settleNotesToast(page);
    await saveShot(page, 'partner');

    await page.locator('[data-testid="nav-rail-timeline"]').click();
    await expect(page.locator('[data-testid="nav-rail-timeline"]')).toHaveAttribute('aria-current', 'page');
    await saveShot(page, 'timeline');

    await page.locator('[data-testid="nav-rail-vault-graph"]').click();
    await expect(page.locator('[data-testid="nav-rail-vault-graph"]')).toHaveAttribute('aria-current', 'page');
    await saveShot(page, 'vault-graph');

    await page.locator('.app-menu-gear-btn').click();
    await page.locator('[data-testid="settings-cat-agents"]').click();
    await expect(page.getByText('OpenRouter').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(() => {
      return !document.querySelector('[data-testid="model-list-loading"]')
        && !document.querySelector('[data-testid="model-list-error"]')
        && !document.querySelector('[data-testid="ollama-not-running-hint"]');
    }, undefined, { timeout: 15_000 });
    await expect(page.getByText('Ollama is not running')).toHaveCount(0);
    await expect(page.getByTestId('ollama-not-running-hint')).toHaveCount(0);
    await expect(page.getByText(/could not reach|network error reaching/i)).toHaveCount(0);
    await settleNotesToast(page);
    const frame = await page.evaluate(() => {
      const body = document.querySelector('.settings-body');
      const api = document.querySelector('[data-testid="mk-bucket-api"]');
      if (!body || !api) return { ok: false as const, reason: 'missing settings scroller' };
      const bodyRect = () => body.getBoundingClientRect();
      // Subscription bucket stays above the fold.
      body.scrollTop += api.getBoundingClientRect().top - bodyRect().top;
      const c = body.getBoundingClientRect();
      const shown = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.bottom > c.top + 4 && r.top < c.bottom - 4 && r.width > 0 && r.height > 0;
      };
      const textShown = (needle: string) => {
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          if (node.textContent?.includes(needle) && node.parentElement) {
            const r = node.parentElement.getBoundingClientRect();
            if (r.bottom > c.top + 4 && r.top < c.bottom - 4 && r.width > 0 && r.height > 0) return true;
          }
          node = walker.nextNode();
        }
        return false;
      };
      return {
        ok: true as const,
        openRouter: shown('[data-testid="mk-prov-openrouter"]'),
        pasteKey: shown('[data-testid="mk-prov-paste-key"]'),
        ollama: shown('[data-testid="mk-prov-ollama"]'),
        lmstudio: shown('[data-testid="mk-prov-lmstudio"]'),
        llamacpp: shown('[data-testid="mk-prov-llamacpp"]'),
        cli: shown('[data-testid="mk-bucket-cli"]'),
        key: shown('[data-testid="mk-api-key"]'),
        claudeRow: shown('[data-testid="mk-claude-row"]'),
        subscription: textShown('USE MY SUBSCRIPTION'),
        comingSoon: textShown('Coming soon'),
        ollamaDown: textShown('Ollama is not running'),
      };
    });
    expect(frame, JSON.stringify(frame)).toMatchObject({
      ok: true,
      openRouter: true,
      pasteKey: true,
      ollama: true,
      lmstudio: true,
      llamacpp: true,
      cli: false,
      key: false,
      claudeRow: false,
      subscription: false,
      comingSoon: false,
      ollamaDown: false,
    });
    await saveShot(page, 'settings-model-keys');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
