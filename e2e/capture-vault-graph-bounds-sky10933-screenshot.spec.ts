/**
 * capture-vault-graph-bounds-sky10933-screenshot.spec.ts — SKY-10933 (not part of CI)
 *
 * One-off Playwright script to capture PR evidence for the Vault Graph sim
 * bounds fix: `computeSimExtent(nodeCount)` now grows the sim world to hold
 * constant node density instead of clamping every vault into a fixed
 * 1000x640 px box. Seeds a ~180-note vault (with [[wiki links]] across a few
 * category folders so the graph has real edges and isn't visually flat),
 * opens the Vault Graph and captures the settled layout. Not registered in
 * package.json/CI — run manually:
 *   npx playwright test e2e/capture-vault-graph-bounds-sky10933-screenshot.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/vault-graph-bounds-sky10933');

// Categories map to folders (electron-main/src/vaultGraph.ts CATEGORY_RULES),
// which drive the graph's per-category node coloring/legend.
const CATEGORIES: { folder: string; prefix: string }[] = [
  { folder: 'characters', prefix: 'Character' },
  { folder: 'locations', prefix: 'Location' },
  { folder: 'factions', prefix: 'Faction' },
  { folder: 'history', prefix: 'Event' },
  { folder: 'systems', prefix: 'System' },
  { folder: 'items', prefix: 'Item' },
];

const NOTE_COUNT = 181;

function buildNotes(): { relPath: string; content: string }[] {
  const notes: { relPath: string; content: string }[] = [];
  for (let i = 0; i < NOTE_COUNT; i += 1) {
    const cat = CATEGORIES[i % CATEGORIES.length];
    const name = `${cat.prefix} ${i}`;
    // Link to a handful of neighbours (previous few + a wraparound long-range
    // link) so the graph has real, varied edges rather than isolated dots.
    const links: string[] = [];
    for (let back = 1; back <= 3; back += 1) {
      const j = i - back;
      if (j >= 0) {
        const otherCat = CATEGORIES[j % CATEGORIES.length];
        links.push(`[[${otherCat.prefix} ${j}]]`);
      }
    }
    const longRange = (i * 37) % NOTE_COUNT;
    if (longRange !== i) {
      const otherCat = CATEGORIES[longRange % CATEGORIES.length];
      links.push(`[[${otherCat.prefix} ${longRange}]]`);
    }
    notes.push({
      relPath: path.join(cat.folder, `${name}.md`),
      content: `# ${name}\n\nA ${cat.folder.replace(/s$/, '')} entry in the vault.\n\nConnections: ${links.join(', ') || 'none'}\n`,
    });
  }
  return notes;
}

test('capture Vault Graph bounds screenshot (SKY-10933)', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-graph-bounds-shots-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-graph-bounds-shots-story-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-graph-bounds-shots-notes-'));
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));

  fs.mkdirSync(notesVaultDir, { recursive: true });
  fs.writeFileSync(path.join(notesVaultDir, '.notes-vault'), '');
  for (const cat of CATEGORIES) {
    fs.mkdirSync(path.join(notesVaultDir, cat.folder), { recursive: true });
  }
  for (const note of buildNotes()) {
    fs.writeFileSync(path.join(notesVaultDir, note.relPath), note.content);
  }

  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
  const page: Page = await app.firstWindow();
  // Force the sim's synchronous settle path (VaultGraphView canAnimateSim()
  // checks prefers-reduced-motion) instead of the rAF animation loop, so the
  // layout is deterministic and doesn't require guessing an animation delay.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('.shell-loading', { state: 'detached', timeout: 30_000 });

  // SKY-9019 M5: Vault Graph is a standalone top-level nav-rail tab.
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Vault Graph"]').click();
  await expect(page.locator('[data-testid="vault-graph-view"]')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('[data-testid="vault-graph-loading"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('[data-testid="vault-graph-canvas"]')).toBeVisible({ timeout: 8_000 });

  // Sanity: confirm the seeded note count actually landed (not truncated /
  // empty-state) before trusting the screenshot as evidence.
  const nodeCount = await page.locator('[data-testid^="vault-node-"]').count();
  expect(nodeCount).toBeGreaterThan(100);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.locator('[data-testid="vault-graph-view"]').screenshot({ path: path.join(OUT_DIR, 'graph-181-notes.png') });

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});
