// SKY-11049 fidelity capture — Setup (closed) view, suggested-card selection
// before/after the .sc-sugg-card--on fix. Same fixture shape as the SKY-9878
// capture (Characters/Locations/Items & Systems) so it's directly comparable.
// Harness rules: see lib.mjs header.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('capture-sky11049-suggested-card-selection');
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 1200, height: 900 };
const STORY_TITLE = 'The Last City of Veynn';

function seedFixture() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11049-cap-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11049-cap-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11049-cap-notes-'));

  const agentCfg = (extra = {}) => ({
    enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85,
    maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5,
    maxTokensPerDay: 500000, ...extra,
  });
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
    gettingStartedDismissed: true, vaultUpgradePromptShown: true,
    ai: { enabled: true },
    agents: { writingAssistant: agentCfg(), brainstorm: agentCfg({ enabled: true }), archive: agentCfg() },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));

  const notes = [
    ['Characters/Liora Ashen.md', 'Seeker turned believer.'],
    ['Characters/The Lamplighter.md', "Kael's new rival."],
    ['Locations/Ward Violet.md', "The district that doesn't exist."],
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

async function run() {
  const fixture = seedFixture();
  const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${fixture.userData}`, '--no-sandbox'], timeout: 90000 });
  const page = await app.firstWindow();
  page.on('dialog', (d) => void d.accept().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize(VIEWPORT);
  await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // Instant-create (SKY-9021/9896): File → New story, no prompt.
  const before = await page.locator('.nav-story-row').count();
  await page.locator('.wc-menu', { hasText: 'File' }).click();
  await page.locator('.wc-menu-item', { hasText: 'New story' }).click();
  await page.locator('.nav-story-row').nth(before).waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('.nav-story-title').nth(before).click();
  await page.waitForTimeout(500);

  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
  await page.locator('.sc-columns').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(700);

  const card = page.locator('.sc-suggest').getByRole('button', { name: /Liora Ashen/i });
  await card.waitFor({ state: 'visible', timeout: 8000 });

  await page.screenshot({ path: `${OUT}/1-before-click-unselected.png` });
  console.log('  shot 1-before-click-unselected');

  await card.click();
  // Move the mouse off the card so the shot shows the resting selected state,
  // not the hover+selected combo (both are now visually identical, SKY-11049).
  await page.mouse.move(600, 500);
  await page.waitForTimeout(300);

  await page.screenshot({ path: `${OUT}/2-after-click-selected.png` });
  console.log('  shot 2-after-click-selected');

  await app.close().catch(() => {});
  cleanup(fixture);
}

await run();
console.log('DONE');
