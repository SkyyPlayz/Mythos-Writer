/**
 * scene-save-perf.spec.ts — SKY-6198
 *
 * Permanent E2E regression guard for the `scene:save` IPC path (SKY-6194
 * architecture: manifest.json split into structure-only metadata + per-scene
 * `.md` prose files). SKY-6595/SKY-6596 and SKY-6195 already added a unit-level
 * proxy for this (electron-main/src/manifestPerf.test.ts, which measures
 * `writeManifestAtomic` directly on a 3000-scene synthetic manifest object).
 * This spec is the complementary E2E layer the ticket asks for: it drives the
 * *real* `scene:save` IPC round trip through a live Electron process — main
 * process, real vault-on-disk seeding, real IPC serialization — rather than
 * calling the manifest-write function in isolation. A future regression in
 * the IPC wiring around `scene:save` (not just in `writeManifestAtomic`
 * itself) would still be caught here even if the unit test stayed green.
 *
 * Methodology (matches the PR #889 freeze-audit benchmark this guards
 * against): two vaults with the SAME per-scene prose size (8KB, matching the
 * PR #889 fixture) but different scene COUNTS (50 vs 600). Pre-SKY-6596,
 * `scene:save` re-serialized every scene's embedded prose on every save, so
 * manifest.json size (and save cost) scaled with total vault prose bytes
 * (count × prose-size) — saving one scene in the 600-scene vault would have
 * cost ~12x what it cost in the 50-scene vault, on top of an already-large
 * per-save baseline. Post-fix, manifest.json is structure-only (prose lives
 * in `.md` files, stripped from every write unconditionally — see
 * `stripEmbeddedProseForPersist` in manifest.ts), so on-disk manifest size is
 * bounded by scene COUNT alone (a few hundred bytes of metadata per scene),
 * independent of how large each scene's prose is.
 *
 * The sharp, non-flaky assertion is the absolute manifest.json byte-size
 * bound below: if prose ever leaks back into the write path, 600 scenes ×
 * 8KB would blow the bound by ~4x even before JSON-escaping overhead, so
 * this fails hard and immediately rather than needing a timing race to catch
 * it. Wall-clock save-time bounds are kept as a secondary, generously-bounded
 * signal (CI runners under shared load are noisy — see the calibration notes
 * on the existing SKY-797 perf gate and manifestPerf.test.ts) since disk I/O
 * timing is inherently less reliable in CI than a byte count.
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

// Matches PR #889's "8KB-scene" synthetic vault fixture exactly.
const PROSE_BYTES_PER_SCENE = 8 * 1024;
const STORY_ID = 'story-save-perf';
const CHAPTER_ID = 'chapter-save-perf';

function buildProse(bytes: number): string {
  const unit = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ';
  return unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);
}

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

/**
 * Seeds a vault with `sceneCount` scenes, each carrying `proseBytes` of prose,
 * mirroring the on-disk shape scene:save expects: structure-only manifest
 * entries (blocks: [] — no embedded prose, matching post-SKY-6596 shape) plus
 * one `.md` file per scene holding the real prose. Returns the seeded scene ids.
 */
function seedSaveVault(vaultDir: string, sceneCount: number, proseBytes: number): string[] {
  const now = new Date().toISOString();
  fs.mkdirSync(vaultDir, { recursive: true });

  const ids = Array.from({ length: sceneCount }, (_, i) => `sc-perf-${i.toString().padStart(4, '0')}`);
  const sceneEntries = ids.map((id, idx) => ({
    id,
    title: `Scene ${idx}`,
    path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${id}.md`,
    order: idx,
    chapterId: CHAPTER_ID,
    storyId: STORY_ID,
    blocks: [],
    createdAt: now,
    updatedAt: now,
  }));

  const manifest = {
    schemaVersion: 2,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [{
      id: STORY_ID,
      title: 'Save Perf Story',
      path: `stories/${STORY_ID}`,
      chapters: [{
        id: CHAPTER_ID,
        title: 'Save Perf Chapter',
        path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`,
        order: 0,
        scenes: sceneEntries,
        createdAt: now,
        updatedAt: now,
      }],
      createdAt: now,
      updatedAt: now,
    }],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
    provenance: {},
    boardReferences: [],
    smartFolders: [],
  };
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');
  fs.writeFileSync(path.join(vaultDir, 'arcs.json'), JSON.stringify([]), 'utf-8');

  const prose = buildProse(proseBytes);
  for (const id of ids) {
    const scenePath = path.join(vaultDir, 'stories', STORY_ID, 'chapters', CHAPTER_ID, 'scenes', `${id}.md`);
    fs.mkdirSync(path.dirname(scenePath), { recursive: true });
    const fm = [
      '---',
      `id: ${id}`,
      `title: Scene ${id}`,
      `chapterId: ${CHAPTER_ID}`,
      `storyId: ${STORY_ID}`,
      `updatedAt: ${now}`,
      '---',
      '',
    ].join('\n');
    fs.writeFileSync(scenePath, fm + prose);
  }
  return ids;
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', '--force-prefers-reduced-motion', ...extraArgs],
    timeout: 60_000,
  });
  return app;
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  await pg.waitForFunction(() => Boolean((window as unknown as { api?: unknown }).api), null, { timeout: 20_000 });
  return pg;
}

/**
 * Drives `window.api.sceneSave` directly (bypassing the editor UI entirely —
 * the IPC handler's cost depends only on vault-settings + payload, not on
 * anything rendered) `reps` times for the given scene, returning per-call
 * wall-clock ms as measured in the renderer around the `invoke` await. First
 * call is a cold-cache read (see main.ts's `sceneSaveManifestCache`); the
 * rest exercise the warm-cache repeat-save path real autosave hits.
 */
async function timedSaves(page: Page, sceneId: string, prose: string, reps: number): Promise<number[]> {
  return page.evaluate(
    async ({ sceneId, prose, reps }) => {
      const times: number[] = [];
      const api = (window as unknown as {
        api: { sceneSave: (p: { sceneId: string; prose: string; intent?: string }) => Promise<unknown> };
      }).api;
      for (let i = 0; i < reps; i++) {
        const start = performance.now();
        await api.sceneSave({ sceneId, prose: prose + ' '.repeat(i), intent: 'auto' });
        times.push(performance.now() - start);
      }
      return times;
    },
    { sceneId, prose, reps },
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Generous, CI-jitter-tolerant absolute bounds — see manifestPerf.test.ts and
// the SKY-797 perf gate for the same calibration philosophy: loose enough to
// survive shared-runner noise, tight enough to fail fast on an actual
// re-introduction of O(vault-prose) cost (which would blow these by many Xs,
// not by a jitter-sized margin).
const COLD_SAVE_MS_BUDGET = process.env.CI ? 6000 : 3000;
const REPEAT_SAVE_MS_BUDGET = process.env.CI ? 1500 : 600;
const REPS = 5;

for (const sceneCount of [50, 600]) {
  test.describe(`SKY-6198 — scene:save perf guard (${sceneCount} scenes × 8KB prose)`, () => {
    let userData: string;
    let vaultDir: string;
    let notesVaultDir: string;
    let app: ElectronApplication | undefined;
    let page: Page;
    let sceneIds: string[];

    test.beforeAll(async () => {
      userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-save-perf-user-'));
      vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-save-perf-vault-'));
      notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-save-perf-notes-'));
      seedUserData(userData, vaultDir, notesVaultDir);
      sceneIds = seedSaveVault(vaultDir, sceneCount, PROSE_BYTES_PER_SCENE);

      app = await launchApp(userData);
      page = await firstWindow(app);
    });

    test.afterAll(async () => {
      await app?.close().catch(() => {});
      fs.rmSync(userData, { recursive: true, force: true });
      fs.rmSync(vaultDir, { recursive: true, force: true });
      fs.rmSync(notesVaultDir, { recursive: true, force: true });
    });

    test(`manifest.json stays structure-only after a real save (${sceneCount} scenes)`, async () => {
      const prose = buildProse(PROSE_BYTES_PER_SCENE);
      const times = await timedSaves(page, sceneIds[0], prose, REPS);

      const manifestBytes = fs.statSync(path.join(vaultDir, 'manifest.json')).size;
      // The regression this guards against: if prose leaked back into the
      // manifest write, `sceneCount` scenes × 8KB would alone exceed this
      // bound several times over (e.g. 600 × 8KB ≈ 4.7MB vs. the ~1.2MB cap
      // below) — well outside jitter/formatting noise, so this is a sharp,
      // deterministic catch, not a timing race.
      const structureOnlyBudgetBytes = sceneCount * 2 * 1024; // ~2KB/scene of pure metadata headroom
      expect(manifestBytes).toBeLessThan(structureOnlyBudgetBytes);
      // Sanity: the manifest is not literally empty/broken.
      expect(manifestBytes).toBeGreaterThan(sceneCount * 50);

      const coldMs = times[0];
      const repeatMedianMs = median(times.slice(1));
      // eslint-disable-next-line no-console
      console.log(
        `[SKY-6198 perf] ${sceneCount} scenes × 8KB prose — manifest.json: ${(manifestBytes / 1024).toFixed(1)} KB; ` +
          `cold save: ${coldMs.toFixed(1)}ms; repeat-save median (n=${REPS - 1}): ${repeatMedianMs.toFixed(1)}ms`,
      );
      expect(coldMs).toBeLessThan(COLD_SAVE_MS_BUDGET);
      expect(repeatMedianMs).toBeLessThan(REPEAT_SAVE_MS_BUDGET);
    });
  });
}
