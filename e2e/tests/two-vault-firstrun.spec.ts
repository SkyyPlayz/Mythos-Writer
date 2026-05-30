/**
 * two-vault-firstrun.spec.ts — SKY-9 / SKY-15
 *
 * First-run seeding contract for the two-vault layout. Boots Electron with
 * empty Story Vault + Notes Vault directories and asserts the SKY-15
 * canonical layout appears after the app finishes initializing:
 *
 *   <storyVaultDir>/My First Story/Manuscript/01 - Opening/01 - Scene One.md
 *   <storyVaultDir>/My First Story/Outline.md
 *   <storyVaultDir>/My First Story/Synopsis.md
 *   <notesVaultDir>/{Universes,Stories,Inbox,Research,Daily Notes,Archive}/.gitkeep
 *   <notesVaultDir>/Universes/My First Universe/{Characters,...,Items}/
 *   <notesVaultDir>/Stories/My First Story/
 *
 * Also asserts a second launch on the same dirs is a no-op — no duplicate
 * .gitkeep writes, no overwrite of user-added files.
 *
 * Acceptance criteria mapping:
 *   AC2  first-run seeding produces SKY-15 canonical layout
 *   AC4  TC-01 boot path (DesktopShell renders) still works with new defaults
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

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: false, model: 'claude-sonnet-4-6', autoApply: false,
        confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: notesVaultDir };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 30_000,
  });
  return app;
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

let userData: string;
let vaultDir: string;
let notesVaultDir: string;

test.beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-firstrun-ud-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-firstrun-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-firstrun-notes-'));
});

test.afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

test('TC-SK9-01: first run seeds SKY-15 Notes Vault layout (6 top-level folders + example universe + example story)', async () => {
  seedUserData(userData, vaultDir, notesVaultDir);
  const app = await launchApp(userData);
  try {
    await firstWindow(app);
    // Story Vault: per-story Manuscript scaffold + seeded Outline.md + Synopsis.md
    const storyRoot = path.join(vaultDir, 'My First Story');
    expect(fs.existsSync(path.join(storyRoot, 'Manuscript', '01 - Opening', '01 - Scene One.md'))).toBe(true);
    expect(fs.existsSync(path.join(storyRoot, 'Outline.md'))).toBe(true);
    expect(fs.existsSync(path.join(storyRoot, 'Synopsis.md'))).toBe(true);
    // Notes Vault: 6 top-level folders each with .gitkeep
    for (const dir of ['Universes', 'Stories', 'Inbox', 'Research', 'Daily Notes', 'Archive']) {
      expect(fs.existsSync(path.join(notesVaultDir, dir))).toBe(true);
      expect(fs.existsSync(path.join(notesVaultDir, dir, '.gitkeep'))).toBe(true);
    }
    // Example universe with the six category subfolders
    const universeRoot = path.join(notesVaultDir, 'Universes', 'My First Universe');
    for (const sub of ['Characters', 'Locations', 'Factions', 'History', 'Systems', 'Items']) {
      expect(fs.existsSync(path.join(universeRoot, sub))).toBe(true);
    }
    // Per-story notes folder mirroring the Story Vault sibling
    expect(fs.existsSync(path.join(notesVaultDir, 'Stories', 'My First Story'))).toBe(true);
  } finally {
    await app.close().catch(() => {});
  }
});

test('TC-SK9-02: second launch preserves user-added files and does not rewrite .gitkeep', async () => {
  seedUserData(userData, vaultDir, notesVaultDir);

  // First launch — seeds the layout.
  let app = await launchApp(userData);
  try {
    await firstWindow(app);
  } finally {
    await app.close().catch(() => {});
  }

  // Simulate a user writing real content into Universes/, then deleting the
  // sentinel so we can detect any spurious re-seed on next boot.
  const userFile = path.join(notesVaultDir, 'Universes', 'Aerith.md');
  fs.writeFileSync(userFile, '# Aerith\n', 'utf-8');
  fs.unlinkSync(path.join(notesVaultDir, 'Universes', '.gitkeep'));

  // Second launch — must NOT touch user file and must NOT re-create .gitkeep
  // (the directory already exists and is no longer empty).
  app = await launchApp(userData);
  try {
    await firstWindow(app);
    expect(fs.existsSync(userFile)).toBe(true);
    expect(fs.readFileSync(userFile, 'utf-8')).toBe('# Aerith\n');
    expect(fs.existsSync(path.join(notesVaultDir, 'Universes', '.gitkeep'))).toBe(false);
    // Inbox/ on the other hand is still untouched-empty, so its sentinel
    // should survive across runs (acts as a control case).
    expect(fs.existsSync(path.join(notesVaultDir, 'Inbox', '.gitkeep'))).toBe(true);
  } finally {
    await app.close().catch(() => {});
  }
});

test('TC-SK9-03: Blank layout mode skips all per-vault scaffolding', async () => {
  // Override layoutMode to 'blank' before boot. ensure*VaultDir creates the
  // vault root but the scaffold functions become no-ops.
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: false, model: 'claude-sonnet-4-6', autoApply: false,
        confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  const vaultSettings = {
    vaultRoot: vaultDir,
    notesVaultRoot: notesVaultDir,
    layoutMode: 'blank',
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));

  const app = await launchApp(userData);
  try {
    await firstWindow(app);
    // No My First Story/, no Outline.md, no Synopsis.md
    expect(fs.existsSync(path.join(vaultDir, 'My First Story'))).toBe(false);
    // None of the six Notes Vault top-level folders should have been seeded.
    // Manifest files written by the Story Vault DB are expected at the story
    // vault root, but the notes vault must remain pristine in blank mode.
    for (const dir of ['Universes', 'Stories', 'Inbox', 'Research', 'Daily Notes', 'Archive']) {
      expect(fs.existsSync(path.join(notesVaultDir, dir))).toBe(false);
    }
  } finally {
    await app.close().catch(() => {});
  }
});
