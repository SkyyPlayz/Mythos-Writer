/**
 * User path for AI-SUGGEST B2: inbox Accept of a vault-kind row aimed at a
 * scene stays proposed and does not change the scene file.
 * IPC bridge: window.api.suggestionsUpsert, the same call e2e/suggestions.spec.ts uses.
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const SCENE_REL = 'stories/b2-guard/scene.md';
const SCENE_BYTES = 'SCENE BYTES UNCHANGED\n';

function seedUserData(userData: string, vaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: false,
        model: 'claude-sonnet-4-6',
        scanIntervalSeconds: 30,
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: false,
        model: 'claude-sonnet-4-6',
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: false,
        model: 'claude-sonnet-4-6',
        continuityCheckIntervalSeconds: 60,
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir }, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, ...extraArgs],
    timeout: 60_000,
  });
}

async function openReviewWindow(app: ElectronApplication, fromPage: Page): Promise<Page> {
  const existing = app.windows().find((w) => w.url().includes('floating-panel/review'));
  if (existing) {
    await existing.reload();
    await existing.waitForLoadState('domcontentloaded');
    await expect(existing.locator('.suggestion-review .sr-list')).toBeVisible({ timeout: 8_000 });
    return existing;
  }
  const windowPromise = app.waitForEvent('window', { timeout: 15_000 });
  await fromPage.evaluate(() => {
    return (window as unknown as { api: { panelFloat: (id: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<unknown> } }).api.panelFloat('review', { x: 80, y: 80, width: 980, height: 720 });
  });
  const win = await windowPromise;
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.suggestion-review .sr-list')).toBeVisible({ timeout: 8_000 });
  return win;
}

test('inbox Accept of a scene-targeted vault row stays proposed', async () => {
  test.setTimeout(120_000);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-b2-e2e-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-b2-e2e-vault-'));
  seedUserData(userData, vaultDir);
  const app = await launchApp(userData);
  try {
    const mainPage = await app.firstWindow();
    await mainPage.waitForLoadState('domcontentloaded');
    await expect(mainPage.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

    const sceneFull = path.join(vaultDir, SCENE_REL);
    fs.mkdirSync(path.dirname(sceneFull), { recursive: true });
    fs.writeFileSync(sceneFull, SCENE_BYTES, 'utf8');
    const before = crypto.createHash('sha256').update(fs.readFileSync(sceneFull)).digest('hex');
    const manifestPath = path.join(vaultDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      schemaVersion: number;
      scenes: unknown[];
    };
    manifest.schemaVersion = 3;
    manifest.scenes = [...(manifest.scenes ?? []), { id: 'b2-scene', path: SCENE_REL, title: 'B2 scene' }];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    const page = await openReviewWindow(app, mainPage);
    const id = `b2-scene-${Date.now()}`;
    await page.evaluate(
      ({ sugId, target }) => {
        return (window as unknown as { api: { suggestionsUpsert: (row: unknown) => Promise<unknown> } }).api.suggestionsUpsert({
          id: sugId,
          source_agent: 'writing-assistant',
          confidence: 0.9,
          rationale: 'B2 scene accept must not write',
          target_kind: 'vault',
          target_path: target,
          target_anchor: null,
          payload_json: JSON.stringify({ content: 'AI WROTE THE SCENE\n' }),
          status: 'proposed',
          created_at: new Date().toISOString(),
          applied_at: null,
          applied_run_id: null,
          budget_exceeded: 0,
        });
      },
      { sugId: id, target: SCENE_REL },
    );
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    const row = page.locator('.sr-row', { hasText: 'B2 scene accept must not write' });
    await expect(row).toBeVisible({ timeout: 8_000 });
    await row.locator('.sr-btn-accept').click();
    await expect(row).toBeVisible();
    await expect(row.locator('.sr-row-error')).toContainText("AI can't edit your manuscript");
    const stored = await page.evaluate((sugId) => {
      return (window as unknown as { api: { suggestionsGet: (suggestionId: string) => Promise<{ suggestion: { status: string } | null }> } }).api.suggestionsGet(sugId);
    }, id);
    expect(stored.suggestion?.status).toBe('proposed');
    const after = crypto.createHash('sha256').update(fs.readFileSync(sceneFull)).digest('hex');
    expect(after).toBe(before);
    expect(fs.readFileSync(sceneFull, 'utf8')).toBe(SCENE_BYTES);
    fs.mkdirSync('/opt/cursor/artifacts', { recursive: true });
    await page.screenshot({ path: '/opt/cursor/artifacts/ai-suggest-b2-manuscript-refusal.png' });
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  }
});
