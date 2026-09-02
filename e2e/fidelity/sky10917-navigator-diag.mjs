// Diagnostic: verify the Story Navigator context menu opens on right-click
// and screenshot before/after for the contrast fix.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('sky10917-navigator-diag');
fs.mkdirSync(OUT, { recursive: true });
const now = new Date().toISOString();
const SID = 'nd-story';
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-nd-'));
const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-nd-'));
const ac = { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: .85, maxTokensPerHour: 1e5, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 5e5 };
fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
  apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
  agents: { writingAssistant: { ...ac, scanIntervalSeconds: 30 }, brainstorm: ac, archive: { ...ac, continuityCheckIntervalSeconds: 60 } },
  theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
}, null, 2));
fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir }, null, 2));

const CH = [
  { id: 'nd-c1', title: 'Chapter 1: The Quiet Before', scenes: [
    { id: 'nd-s1', t: "The Watcher's Call", b: 'Mira Veynn had counted the bells.' },
    { id: 'nd-s2', t: 'A City in Shadows', b: 'By morning the rumor had grown teeth.' }] },
  { id: 'nd-c2', title: 'Chapter 2: Fractures', scenes: [
    { id: 'nd-s3', t: "The Smuggler's Bargain", b: 'Kael dealt cards the way other men made confessions.' }] },
];
fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
  version: '1', vaultRoot: vaultDir,
  stories: [{ id: SID, title: 'Navigator Diag Story', path: `stories/${SID}`, genre: 'Epic Fantasy', createdAt: now, updatedAt: now,
    chapters: CH.map((c, ci) => ({ id: c.id, title: c.title, path: `stories/${SID}/chapters/${c.id}`, order: ci, createdAt: now, updatedAt: now,
      scenes: c.scenes.map((s, si) => ({ id: s.id, title: s.t, order: si, chapterId: c.id, storyId: SID,
        path: `stories/${SID}/chapters/${c.id}/scenes/${s.id}.md`, draftState: 'in-progress', createdAt: now, updatedAt: now,
        blocks: [{ id: s.id + '-b', type: 'prose', content: s.b, order: 0, updatedAt: now }] })) })) }],
  entities: [], suggestions: [], scenes: [], chapters: [],
}, null, 2));
for (const c of CH) {
  const d = path.join(vaultDir, 'stories', SID, 'chapters', c.id, 'scenes');
  fs.mkdirSync(d, { recursive: true });
  for (const s of c.scenes) fs.writeFileSync(path.join(d, s.id + '.md'),
    ['---', `id: ${s.id}`, `title: "${s.t}"`, 'draftState: in-progress', `updatedAt: ${now}`, '---', '', s.b, ''].join('\n'));
}

const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'], timeout: 90000 });
const page = await app.firstWindow();
page.on('dialog', d => void d.accept().catch(() => {}));
await page.waitForLoadState('domcontentloaded');
await page.setViewportSize({ width: 1920, height: 1080 });
try { await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }); } catch {}
await page.waitForTimeout(3000);
for (const l of ['Not now', 'Dismiss', 'Got it', 'Skip']) {
  const b = page.locator(`button:has-text("${l}")`).first();
  if (await b.isVisible({ timeout: 500 }).catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(400); }
}
await page.keyboard.press('Escape').catch(() => {});

for (let i = 0; i < 3; i++) {
  const btns = page.locator('.nav-expand-btn');
  const n = await btns.count().catch(() => 0);
  for (let j = 0; j < n; j++) await btns.nth(j).click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
}

await page.screenshot({ path: `${OUT}/tree-baseline.png` });

// Contrast check: compare computed color of a non-active scene title vs the
// active one, and log both so it's visible whether the fix landed.
const rows = page.locator('.nav-scene-row');
const rowCount = await rows.count().catch(() => 0);
console.log('scene rows = ' + rowCount);
const colors = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.nav-scene-title')];
  return rows.map((el) => ({ text: el.textContent, color: getComputedStyle(el).color }));
});
console.log('SCENE_TITLE_COLORS=' + JSON.stringify(colors));

// Right-click a scene row → menu should open with Rename/Move/Delete.
if (rowCount > 0) {
  const box = await rows.nth(0).boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await page.waitForTimeout(400);
  }
}
const menu = page.locator('[data-testid="story-navigator-context-menu"]');
const menuVisible = await menu.isVisible({ timeout: 1000 }).catch(() => false);
const menuItems = menuVisible ? await menu.locator('[role="menuitem"]').allTextContents() : [];
console.log('scene menu visible = ' + menuVisible + ' items=' + JSON.stringify(menuItems));
await page.screenshot({ path: `${OUT}/scene-context-menu.png` });
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(300);

// Right-click a chapter row.
const chRows = page.locator('.nav-chapter-row');
if (await chRows.count().catch(() => 0) > 0) {
  const box = await chRows.nth(0).boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await page.waitForTimeout(400);
  }
}
const chMenuVisible = await menu.isVisible({ timeout: 1000 }).catch(() => false);
const chMenuItems = chMenuVisible ? await menu.locator('[role="menuitem"]').allTextContents() : [];
console.log('chapter menu visible = ' + chMenuVisible + ' items=' + JSON.stringify(chMenuItems));
await page.screenshot({ path: `${OUT}/chapter-context-menu.png` });
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(300);

await app.close().catch(() => {});
fs.rmSync(userData, { recursive: true, force: true });
fs.rmSync(vaultDir, { recursive: true, force: true });
console.log('DONE');
