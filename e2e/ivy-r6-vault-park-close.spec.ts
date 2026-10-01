/**
 * Ivy R6 / Probe FAIL 5373977100 — parked vault switch on Settings close.
 *
 * Probe repro: Second active → bad-key → First card → park → clear key → Close
 * → switch completes to First; New Story + vault-settings.json show First.
 *
 * Fail branch (save still refused on Close) is covered in
 * DesktopShell.settingsVaultSwitch.test.tsx unit tests.
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
const NOW = '2026-10-01T00:00:00.000Z';

function readVaultSettings(userData: string): { vaultRoot?: string; notesVaultRoot?: string } {
  const file = path.join(userData, 'vault-settings.json');
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as { vaultRoot?: string; notesVaultRoot?: string };
}

/** Minimal MythosVault v2 bundle (same shape as sky-11236). */
function seedVault(bundle: string, opts: { id: string; name: string }): void {
  const storyTitle = `${opts.name} Story`;
  const chapterDir = path.join(bundle, 'Story Vault', storyTitle, 'Part 1', 'Chapter 01');
  const notesVault = path.join(bundle, 'Notes Vault');
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.mkdirSync(notesVault, { recursive: true });
  const storyId = `story-${opts.id}`;
  fs.writeFileSync(
    path.join(bundle, 'mythos.json'),
    JSON.stringify({
      formatVersion: 2,
      id: `vault-${opts.id}`,
      name: opts.name,
      createdAt: NOW,
      stories: [{ id: storyId, title: storyTitle, folder: storyTitle, createdAt: NOW, updatedAt: NOW }],
      seed: { layout: 'veynn-v2', mode: 'blank', seededAt: NOW },
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(bundle, 'Story Vault', storyTitle, 'book.md'),
    [
      '---', `id: ${storyId}`, `title: ${storyTitle}`, `createdAt: ${NOW}`, `updatedAt: ${NOW}`, '---',
      `# ${storyTitle}`, '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(chapterDir, 'Scene 01.md'),
    `---\nid: scene-${opts.id}\ntitle: Opening\nstatus: draft\nupdatedAt: ${NOW}\n---\nBody.`,
  );
  fs.writeFileSync(path.join(notesVault, `${opts.name}.md`), `# ${opts.name}\n`);
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  // Match notes-parity launch (DISPLAY=:1 works here; forced --headless does not).
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return page;
}

let userData: string;
let tmpRoot: string;
let firstStory: string;
let secondStory: string;
let firstNotes: string;
let secondNotes: string;

test.beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ivy-r6-'));
  userData = path.join(tmpRoot, 'user-data');
  const firstBundle = path.join(tmpRoot, 'First');
  const secondBundle = path.join(tmpRoot, 'Second');
  seedVault(firstBundle, { id: 'first', name: 'First' });
  seedVault(secondBundle, { id: 'second', name: 'Second' });
  firstStory = path.join(firstBundle, 'Story Vault');
  firstNotes = path.join(firstBundle, 'Notes Vault');
  secondStory = path.join(secondBundle, 'Story Vault');
  secondNotes = path.join(secondBundle, 'Notes Vault');

  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({
      apiKey: '',
      onboardingComplete: true,
      theme: 'dark',
      agents: {
        writingAssistant: {
          enabled: true, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30,
          autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
          maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
        },
        brainstorm: {
          enabled: true, model: 'claude-sonnet-4-6', autoApply: false,
          confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50,
          heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
        },
        archive: {
          enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60,
          autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
          maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
        },
        lineEditor: { enabled: false },
      },
      snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    }, null, 2),
  );
  // Second active; First registered (Probe repro).
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({
      vaultRoot: secondStory,
      notesVaultRoot: secondNotes,
      layoutMode: 'default',
      recentProjects: [
        { name: 'First', vaultRoot: firstStory, notesVaultRoot: firstNotes, openedAt: NOW },
        { name: 'Second', vaultRoot: secondStory, notesVaultRoot: secondNotes, openedAt: NOW },
      ],
    }, null, 2),
  );
});

test.afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('Ivy R6: park on bad-key, fix key, Close completes switch to First (Probe repro)', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await page.locator('[data-testid="nav-rail-vaults"]').waitFor({ timeout: 30_000 });
    await expect(page.locator(`[data-testid="nav-rail-vault-tile-${secondStory}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="nav-rail-vault-tile-${firstStory}"]`)).toBeVisible();

    // Open Settings → Model & keys; type a bad Anthropic API key (held-bad-key path).
    // Category tabs are role="tab" (settings-cat-agents), not role="button".
    await page.locator('.app-menu-gear-btn, [aria-label="Open settings"]').first().click();
    await expect(page.locator('[role="dialog"][aria-label="Settings"]')).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="settings-cat-agents"]').click();
    await expect(page.locator('[data-testid="model-keys-page"]')).toBeVisible({ timeout: 5_000 });
    // Legacy Anthropic field drives apiKeyError / held-bad-key (below ModelKeysSection).
    const keyInput = page.getByLabel(/anthropic api key/i);
    await keyInput.scrollIntoViewIfNeeded();
    await keyInput.fill('bad-key');

    // Click First vault tile → park (flush refused for bad key).
    await page.locator(`[data-testid="nav-rail-vault-tile-${firstStory}"]`).click();
    await expect(page.locator('[data-testid="settings-flush-retry"]')).toBeVisible({ timeout: 8_000 });
    // Main must still be on Second (no premature commit).
    expect(readVaultSettings(userData).vaultRoot).toBe(secondStory);

    // Fix key (clear) → Close → save succeeds → complete switch to First.
    await keyInput.fill('');
    await page.locator('[data-testid="settings-close"]').click();

    await expect.poll(() => readVaultSettings(userData).vaultRoot, { timeout: 15_000 })
      .toBe(firstStory);

    // New Story lands under First's Story Vault.
    const newStoryBtn = page.locator('[data-testid="shell-empty-new-story"]');
    if (await newStoryBtn.isVisible().catch(() => false)) {
      await newStoryBtn.click();
    } else {
      await page.getByRole('button', { name: /^New Story$/i }).first().click();
    }

    await expect.poll(() => {
      const storiesDir = path.join(firstStory, 'stories');
      return fs.existsSync(storiesDir) && fs.readdirSync(storiesDir).length > 0;
    }, { timeout: 15_000 }).toBe(true);

    expect(readVaultSettings(userData).vaultRoot).toBe(firstStory);
    const secondStories = path.join(secondStory, 'stories');
    if (fs.existsSync(secondStories)) {
      expect(fs.readdirSync(secondStories).length).toBe(0);
    }
  } finally {
    await app.close().catch(() => undefined);
  }
});
