import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('capture-brainstorm-app');
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 1920, height: 1080 };

async function run(label, aiEnabled) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-bs-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosNotesVault-'));

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

  const now = new Date().toISOString();
  const storyId = 'bs-story-001';
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
    version: '1', vaultRoot: vaultDir,
    stories: [{ id: storyId, title: 'The Last City of Veynn', path: `stories/${storyId}`, createdAt: now, updatedAt: now, chapters: [] }],
    entities: [], suggestions: [], scenes: [], chapters: [],
  }, null, 2));

  const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'], timeout: 90000 });
  const page = await app.firstWindow();
  page.on('dialog', d => void d.accept().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize(VIEWPORT);
  try { await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }); } catch {}
  await page.waitForTimeout(2500);

  const alive = () => !page.isClosed();
  async function clearBlockers() {
    for (let i = 0; i < 4; i++) {
      if (!alive()) return;
      let acted = false;
      for (const l of ['Not now', 'Dismiss', 'Later', 'Skip', 'Got it']) {
        if (!alive()) return;
        const b = page.locator(`button:has-text("${l}")`).first();
        if (await b.isVisible({ timeout: 400 }).catch(() => false)) {
          await b.click().catch(() => {}); acted = true;
          await page.waitForTimeout(500).catch(() => {});
        }
      }
      if (!acted) break;
    }
    if (alive()) await page.keyboard.press('Escape').catch(() => {});
    if (alive()) await page.waitForTimeout(400).catch(() => {});
  }
  await clearBlockers();

  const texts = {};
  const shot = async (name) => {
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    texts[name] = await page.evaluate(() => document.body.innerText);
    console.log('  shot ' + name);
  };

  async function goRail(l) {
    await clearBlockers();
    const ok = await page.evaluate((lbl) => {
      const items = [...document.querySelectorAll('.nav-rail__item, [class*="nav-rail__item"]')];
      for (const el of items) {
        const box = el.closest('button,[role="button"],li,div') || el;
        if ((box.innerText || '').replace(/[^A-Za-z ]/g, '').trim() === lbl) { box.click(); return true; }
      }
      return false;
    }, l);
    await page.waitForTimeout(2000);
    console.log(`  goRail ${l} -> clicked=${ok}`);
    return ok;
  }

  await goRail('Brainstorm');
  await shot(`${label}-rail-brainstorm`);

  const boardTab = page.locator('button:has-text("Board")').first();
  if (await boardTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await boardTab.click();
    await page.waitForTimeout(1500);
    await shot(`${label}-rail-brainstorm-board`);
  }

  fs.writeFileSync(`${OUT}/${label}-text.json`, JSON.stringify(texts, null, 1));
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
}

await run('ai-on', true);
await run('ai-off', false);
console.log('DONE');
