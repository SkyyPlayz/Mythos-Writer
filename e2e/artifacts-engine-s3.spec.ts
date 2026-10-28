// S3 engine path: bind, edit, write-back, undo, theme vars, and a refresh that does not write.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const HARNESS = path.resolve(__dirname, 'harness/artifacts-harness.html');

function seedUserData(userData: string, vaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir }));
}

async function launch(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, ...extraArgs],
    timeout: 60_000,
  });
}

async function openHarness(page: Page): Promise<void> {
  await page.goto(`file://${HARNESS}`);
  await page.waitForSelector('#bind');
}

test('bind, edit, write-back, undo, theme, and a refresh that does not write', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-s3-user-'));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-s3-vault-'));
  const noteDir = path.join(vault, 'entities', 'characters');
  fs.mkdirSync(noteDir, { recursive: true });
  const note = path.join(noteDir, 'Hero.md');
  fs.writeFileSync(note, 'hello');
  fs.writeFileSync(path.join(vault, 'manifest.json'), JSON.stringify({ stories: [], scenes: [], entities: [] }));
  seedUserData(userData, vault);
  const app = await launch(userData);
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await openHarness(page);
    await page.evaluate(() => { (window as unknown as { __noteSeed?: string }).__noteSeed = 'hello'; });
    await page.click('#bind');
    await expect(page.locator('#note')).toHaveValue('hello');
    await page.click('#edit');
    await expect(page.locator('#note')).toHaveValue('hello user');
    await page.click('#write-back');
    await expect(page.locator('#note')).toHaveValue('hello user\nfrom artifact');
    await page.click('#undo');
    await expect(page.locator('#note')).toHaveValue('hello user');
    await page.click('#save');
    const saved = await page.evaluate(() => (window as unknown as { __savedNote?: string }).__savedNote);
    fs.writeFileSync(note, saved ?? '');
    expect(fs.readFileSync(note, 'utf8')).toBe('hello user');

    const frame = page.frames().find((item) => item !== page.mainFrame());
    expect(frame).toBeTruthy();
    await frame?.evaluate(() => {
      (window as unknown as { __msgs?: unknown[] }).__msgs = [];
      window.addEventListener('message', (event) => {
        const data = event.data as { type?: string } | null;
        if (data && data.type === 'theme') {
          (window as unknown as { __msgs?: unknown[] }).__msgs?.push(data);
        }
      });
    });
    await page.click('#theme');
    await expect.poll(async () => frame?.evaluate(() => (window as unknown as { __msgs?: unknown[] }).__msgs?.length ?? 0)).toBe(1);
    const vars = await frame?.evaluate(() => (window as unknown as { __msgs?: Array<{ vars?: Record<string, string> }> }).__msgs?.[0]?.vars);
    expect(vars).toEqual({ '--ink': '#112233' });

    const before = fs.readFileSync(note, 'utf8');
    await page.click('#refresh');
    await expect(page.locator('#status')).toContainText('flag_off');
    await page.click('#ipc-write');
    await expect(page.locator('#status')).toContainText('flag_off');
    expect(fs.readFileSync(note, 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(vault, '.mythos', 'artifacts'))).toBe(false);
  } finally {
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vault, { recursive: true, force: true });
  }
});
