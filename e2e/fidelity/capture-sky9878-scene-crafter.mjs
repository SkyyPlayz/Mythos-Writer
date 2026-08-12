// SKY-9878 (M10-S3) fidelity capture — Scene Crafter SUGGESTED CARDS rail,
// both the Scene Setup (closed) view and the Canvas Board (open) view, and
// an AI-off pass for the R11 side-by-side. Seeds a CHARACTERS/LOCATIONS/
// ITEMS & SYSTEMS vault fixture, creates a story through the real UI flow
// (same as e2e/tests/sceneCrafter.spec.ts — a pre-seeded manifest story
// wasn't reliably picked up as "selected" by the newer SKY-9019/M5 nav), then
// drops a pre-built canvas board on disk so the rail + a live board both
// render real content with no AI call.
// Harness rules: see lib.mjs header.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('capture-sky9878-scene-crafter');
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 1920, height: 1080 };
const STORY_TITLE = 'The Last City of Veynn';

function seedFixture(aiEnabled) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-9878-cap-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-9878-cap-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-9878-cap-notes-'));

  const agentCfg = (extra = {}) => ({
    enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85,
    maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5,
    maxTokensPerDay: 500000, ...extra,
  });
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
    gettingStartedDismissed: true, vaultUpgradePromptShown: true,
    ai: { enabled: aiEnabled },
    agents: { writingAssistant: agentCfg(), brainstorm: agentCfg({ enabled: true }), archive: agentCfg() },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));

  const notes = [
    ['Characters/Liora Ashen.md', 'Seeker turned believer.'],
    ['Characters/The Lamplighter.md', "Kael's new rival."],
    ['Locations/Ward Violet.md', "The district that doesn't exist."],
    ['Locations/The Mirewood.md', 'A drowned forest.'],
    ['Items & Systems/Brass Token.md', "The Broker's marker."],
    ['Items & Systems/The Nine Bells.md', 'City signal system.'],
  ];
  for (const [rel, body] of notes) {
    const p = path.join(notesVaultDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }

  return { userData, vaultDir, notesVaultDir };
}

function cleanup(fixture) {
  fs.rmSync(fixture.userData, { recursive: true, force: true });
  fs.rmSync(fixture.vaultDir, { recursive: true, force: true });
  fs.rmSync(fixture.notesVaultDir, { recursive: true, force: true });
}

async function fillPrompt(page, response) {
  const input = page.locator('.prompt-modal-input');
  await input.waitFor({ state: 'visible', timeout: 6000 });
  await input.fill(response);
  await page.locator('.prompt-modal-ok').click();
  await input.waitFor({ state: 'detached', timeout: 6000 });
}

async function run(aiEnabled, shotPrefix) {
  const fixture = seedFixture(aiEnabled);
  const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${fixture.userData}`, '--no-sandbox'], timeout: 90000 });
  const page = await app.firstWindow();
  page.on('dialog', (d) => void d.accept().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize(VIEWPORT);
  await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const shot = async (name) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${shotPrefix}${name}.png` });
    console.log(`  shot ${shotPrefix}${name}`);
  };

  // Create + select the story via the real UI flow (mirrors sceneCrafter.spec.ts).
  await page.locator('.nav-add-btn').first().click();
  await fillPrompt(page, STORY_TITLE);
  await page.locator('.nav-story-row', { hasText: STORY_TITLE }).waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('.nav-story-title', { hasText: STORY_TITLE }).click();
  await page.waitForTimeout(500);

  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
  await page.locator('.sc-columns').waitFor({ state: 'visible', timeout: 10000 });
  await shot('rail-scene-crafter-setup');

  // Discover the on-disk story slug (Boards/<slug>/) and drop a pre-built
  // canvas board — no AI call needed to open a populated board for the shot.
  const scenesDir = path.join(fixture.notesVaultDir, 'scenes');
  const slug = fs.existsSync(scenesDir)
    ? fs.readdirSync(scenesDir, { withFileTypes: true }).find((e) => e.isDirectory())?.name
    : undefined;
  if (slug) {
    const boardsDir = path.join(fixture.notesVaultDir, 'Boards', slug);
    fs.mkdirSync(boardsDir, { recursive: true });
    fs.writeFileSync(path.join(boardsDir, 'The Broken Gate — board 1.canvas.json'), JSON.stringify({
      nodes: [
        { id: 'b1-0', type: 'text', x: 40, y: 40, width: 220, height: 100, text: 'Cold open on the sealed door\n\nBeat 1' },
        { id: 'b1-1', type: 'file', x: 320, y: 40, width: 200, height: 90, file: 'Characters/Liora Ashen', color: '1' },
      ],
      edges: [{ id: 'edge-0', fromNode: 'b1-0', toNode: 'b1-1' }],
    }, null, 2));

    // Force a fresh listNotesVault() read so the new board file is picked up:
    // Story Writer nav lands on 'editor' sub-view when leaving kanban, then
    // Scene Crafter remounts the page and re-fetches the vault listing.
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"]').click();
    await page.waitForTimeout(500);
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
    await page.locator('.sc-columns').waitFor({ state: 'visible', timeout: 10000 });

    const boardRow = page.locator('.sc-board-row', { hasText: 'The Broken Gate' });
    if (await boardRow.isVisible({ timeout: 4000 }).catch(() => false)) {
      await boardRow.click();
      await page.getByTestId('canvas-board').waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
      await shot('rail-scene-crafter-canvas');
    } else {
      console.log('  MISS board row "The Broken Gate"');
    }
  } else {
    console.log('  MISS scenes/<slug> directory — board seed skipped');
  }

  await app.close().catch(() => {});
  cleanup(fixture);
}

await run(true, 'ai-on-');
await run(false, 'ai-off-');
console.log('DONE');
