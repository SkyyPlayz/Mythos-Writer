// M10-S3 (SKY-9878) fidelity captures: Scene Crafter SUGGESTED CARDS rail,
// prototype vs app, AI on and AI off.
// Prototype side: `Scene Crafter` rail destination — same capture as
// capture-proto.mjs's `rail-scene-crafter`, re-shot here so this script is
// self-contained.
// App side: a seeded story + real Characters/Locations/Items/Systems vault
// notes nested under Universes/<name>/… (the real Brainstorm-agent write
// shape — see brainstormNoteWriter.ts WORLD_KIND_DIR), captured once with
// the master AI toggle on and once off (M11b: same rail, different hint
// copy — restocking is vault-driven either way, never gated on AI).
// Harness rules: see lib.mjs header.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium, _electron as electron } from 'playwright';
import { serveProto, outDir, chromiumLaunchOptions, mainJs as MAIN_JS, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('m10-s3-scene-crafter');
fs.mkdirSync(OUT, { recursive: true });

// ── 1. prototype ─────────────────────────────────────────────────────────────
{
  const proto = await serveProto();
  const browser = await chromium.launch(chromiumLaunchOptions());
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(proto.url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3500);

  const clicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll('div,span,button,a')];
    const hit = els.filter((e) => {
      const t = (e.innerText || '').trim();
      if (t !== 'Scene Crafter') return false;
      const r = e.getBoundingClientRect();
      return r.left < 110 && r.width > 8 && r.height > 8;
    });
    if (!hit.length) return false;
    hit.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
    hit[0].click();
    return true;
  });
  console.log('proto rail Scene Crafter = ' + clicked);
  await page.waitForTimeout(2000);

  await page.screenshot({ path: `${OUT}/proto-scene-crafter-full.png` });
  // Rail-only clip — left ~360px holds SUGGESTED CARDS.
  await page.screenshot({ path: `${OUT}/proto-suggested-cards-rail.png`, clip: { x: 0, y: 0, width: 360, height: 1080 } });
  await browser.close();
  await proto.close();
}

// ── 2. app ───────────────────────────────────────────────────────────────────
const NOW = new Date().toISOString();
const STORY_ID = 'story-m10s3';

function seedFixture({ aiOff = false } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m10s3-ud-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-m10s3-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosNotes-m10s3-'));
  const agentDefaults = {
    enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85,
    maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000,
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
    gettingStartedProgress: { completedItems: [], dismissed: true },
    ...(aiOff ? { ai: { enabled: false } } : {}),
    agents: {
      writingAssistant: { ...agentDefaults, scanIntervalSeconds: 30 },
      brainstorm: { ...agentDefaults, enabled: true },
      archive: agentDefaults,
    },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));

  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
    version: '1', vaultRoot: vaultDir,
    stories: [{ id: STORY_ID, title: 'The Broken Gate', path: `stories/${STORY_ID}`, createdAt: NOW, updatedAt: NOW, chapters: [] }],
    entities: [], suggestions: [], scenes: [], chapters: [], provenance: {}, boardReferences: [], smartFolders: [],
  }, null, 2));

  // Real vault entity notes, nested Universes/<name>/<Category>/… — the same
  // shape brainstormNoteWriter.ts resolveProposalDestination() writes to.
  const universeDir = path.join(notesVaultDir, 'Universes', 'The Broken Gate');
  const note = (rel, content) => {
    const full = path.join(universeDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };
  note('Characters/Mira Veynn.md', '---\nhook: Reluctant heir — resourceful, haunted.\n---\n');
  note('Characters/Kael Thorne.md', '---\nhook: Smuggler — witty, guarded, survivor.\n---\n');
  note('Locations/The Undercity.md', '---\ndescription: Drowned streets, stacked walkways.\n---\n');
  note('Locations/The Sunken Gate.md', '---\ndescription: Ancient floodgate. Opens at low tide.\n---\n');
  note('Items/Brass Token.md', "# Brass Token\n\nThe Broker's marker.\n");
  note('Systems/Tide Mechanics.md', '# Tide Mechanics\n\nThe rules by which the deep breathes.\n');

  return { userData, vaultDir, notesVaultDir };
}

async function launchAndShoot(fixture, name) {
  const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${fixture.userData}`, '--no-sandbox'], timeout: 90000 });
  const page = await app.firstWindow();
  page.on('dialog', (x) => void x.accept().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Select the seeded story, then the Scene Crafter rail destination.
  await page.locator('.nav-story-title', { hasText: 'The Broken Gate' }).click().catch(() => {});
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click().catch(() => {});
  await page.locator('.sc-columns').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const groupCount = await page.locator('.sc-suggest-group').count().catch(() => 0);
  console.log(`${name}: rail groups rendered = ${groupCount}`);
  await page.screenshot({ path: `${OUT}/${name}-full.png` });
  const rail = page.locator('.sc-suggest');
  if (await rail.isVisible().catch(() => false)) {
    await rail.screenshot({ path: `${OUT}/${name}-rail.png` });
  }
  await app.close().catch(() => {});
}

const fx = seedFixture();
await launchAndShoot(fx, 'app-scene-crafter-ai-on');
const fxOff = seedFixture({ aiOff: true });
await launchAndShoot(fxOff, 'app-scene-crafter-ai-off');
for (const f of [fx, fxOff]) {
  fs.rmSync(f.userData, { recursive: true, force: true });
  fs.rmSync(f.vaultDir, { recursive: true, force: true });
  fs.rmSync(f.notesVaultDir, { recursive: true, force: true });
}
console.log('done → ' + OUT);
