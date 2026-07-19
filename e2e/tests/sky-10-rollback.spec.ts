/**
 * sky-10-rollback.spec.ts — SKY-10
 *
 * End-to-end coverage for per-scene versioned drafts: edit → save → rollback
 * restores prior text, and the pre-rollback state is itself snapshotted.
 *
 * Drives the main-process IPC surface (electron-main) against a real seeded
 * vault to exercise the entire snapshot writer + version registry + rollback
 * path together. UI is covered in the component test
 * (frontend/src/components/SceneHistoryPane/SceneHistoryPane.test.tsx).
 *
 * Acceptance criteria mapping (SKY-10):
 *   AC1  per-scene .md files exist after seeding
 *   AC2  each save produces a snapshot file under versions/<sceneId>/
 *   AC3  rollback restores prior content and snapshots the pre-rollback state
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
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
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: notesVaultDir };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

let userData: string;
let vaultDir: string;
let notesVaultDir: string;

test.beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky10-ud-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky10-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky10-notes-'));
});

test.afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

test('TC-SK10-01: edit → save → rollback restores prior text and snapshots the pre-rollback state', async () => {
  seedUserData(userData, vaultDir, notesVaultDir);
  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Locate the seeded scene file (SKY-15 layout: per-story Manuscript scaffold).
    const sceneFile = path.join(vaultDir, 'My First Story', 'Manuscript', '01 - Opening', '01 - Scene One.md');
    expect(fs.existsSync(sceneFile)).toBe(true);

    // Resolve sceneId via IPC: vault:manifest:read triggers reindexVault, which
    // populates manifest.scenes (the flat orphan list) from the scaffolded files.
    // The nested stories[].chapters[].scenes[] structure is NOT populated on a
    // fresh vault. The flat list also adopts the story-root planning docs
    // (Outline.md, Synopsis.md, Beat Sheet.md) as orphan "scenes" — their
    // relative order versus the real Manuscript scene depends on directory
    // read order, which is not stable — so pick the one actually under
    // Manuscript/ rather than assuming index [0].
    const manifest = await page.evaluate(() => (window as never as { api: { readManifest: () => Promise<unknown> } }).api.readManifest()) as {
      scenes: Array<{ id: string; path: string }>;
    };
    const scene = manifest.scenes.find((s) => s.path.split(path.sep).join('/').includes('Manuscript/'));
    expect(scene).toBeDefined();
    const sceneId = scene!.id;

    // Drive the renderer-facing IPC bridge directly via `window.api`.
    const saveOne = (prose: string): Promise<unknown> =>
      page.evaluate(
        async ({ id, prose }) => window.api.sceneSave({ sceneId: id, prose, intent: 'save' } as never),
        { id: sceneId, prose },
      );

    await saveOne('Take 1: prose one.');
    await saveOne('Take 2: prose two.');
    await saveOne('Take 3: prose three.');

    // Three saves should produce three snapshot files (pre-save captures the
    // state being replaced — first save captures the seeded scene, the next
    // two capture the prior takes).
    const versionsDir = path.join(vaultDir, 'My First Story', 'Manuscript', '01 - Opening', 'versions', sceneId);
    expect(fs.existsSync(versionsDir)).toBe(true);
    const snapshotFiles = fs.readdirSync(versionsDir).filter((f) => f.endsWith('.md'));
    expect(snapshotFiles.length).toBeGreaterThanOrEqual(3);

    // Fetch the version list newest-first.
    const versions = await page.evaluate(
      async (id) => window.api.versionList(id) as Promise<{ versions: SceneVersion[] }>,
      sceneId,
    );
    expect(versions.versions.length).toBeGreaterThanOrEqual(3);

    // Roll back to the oldest snapshot (the seeded original prose).
    const oldest = versions.versions[versions.versions.length - 1];
    const rolled = await page.evaluate(
      async ({ id, ts }) => window.api.versionRollback(id, ts) as Promise<{ restoredVersion: SceneVersion; preRollbackVersion: SceneVersion }>,
      { id: sceneId, ts: oldest.ts },
    );

    // Disk should now reflect the restored content.
    const onDiskAfter = fs.readFileSync(sceneFile, 'utf-8');
    expect(onDiskAfter).toContain(rolled.restoredVersion.content.trim());

    // Pre-rollback intent snapshot should be present and contain the "Take 3" prose.
    expect(rolled.preRollbackVersion.intent).toBe('pre-rollback');
    expect(rolled.preRollbackVersion.content).toContain('Take 3');
  } finally {
    await app.close().catch(() => {});
  }
});
