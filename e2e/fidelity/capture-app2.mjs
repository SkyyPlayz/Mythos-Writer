// App capture v2 — dismiss blocking modals, verify navigation actually happened,
// dump per-surface text. Reuses the v1 seed.
// Harness rules: see lib.mjs header (no Close-clicks, dismiss `Not now` first,
// verify nav via --active, never pipe the runner through `head`).
//
// SKY-10353 (Ivy M10 fidelity gate evidence gap): this harness used to seed
// every agent `enabled: false` and never select a story, so rail-brainstorm,
// rail-scene-crafter and rail-timeline all captured empty/AI-off states. The
// AI-off pass below is kept as the regression baseline; the added AI-on pass
// is what actually exercises the AI-on rails (R11's mandated side-by-side).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('capture-app2');
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 1920, height: 1080 };
const now = new Date().toISOString();
const storyId = 'aud-story-001';
const STORY_TITLE = 'The Last City of Veynn';

const PROSE = {
  s1: "Kael dealt cards the way other men made confessions — slowly, and only when cornered.",
  s2: "The stairwell yawned like a throat carved into the belly of the city. Damp air rolled up from below, thick with the smell of rot, smoke, and something metallic.",
  s3: "The gate had not been broken so much as persuaded.",
};
// SKY-10353: scenes now carry the timeline frontmatter (chronologicalDate,
// metaPov, metaWordCount) the real IPC handler (`timeline:getScenes` →
// `readSceneFile`) reads — without it every scene is "unwritten" (wordCount
// 0) and the Aeon "you are here" marker + POV fields never appear, no matter
// how much prose is in the body.
const chapters = [
  { id: 'aud-ch-001', title: 'Chapter 1: The Quiet Before', order: 0, scenes: [
    { id: 'aud-sc-000', title: 'The Long Dusk', order: 0, body: PROSE.s3, date: '870-01-03', pov: 'Mira Veynn', mood: 'tense' },
  ] },
  { id: 'aud-ch-002', title: 'Chapter 2: Fractures', order: 1, scenes: [
    { id: 'aud-sc-001', title: "The Smuggler's Bargain", order: 0, body: PROSE.s1, date: '870-01-09', pov: 'Kael Thorne', mood: 'tense' },
    { id: 'aud-sc-002', title: 'Into the Undercity', order: 1, body: PROSE.s2, date: '870-01-12', pov: 'Mira Veynn', mood: 'ominous' },
    { id: 'aud-sc-003', title: 'The Broken Gate', order: 2, body: PROSE.s3, date: '870-01-18', pov: 'Kael Thorne', mood: 'triumphant' },
  ] },
];

function seedFixture() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-a2-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-'));
  // SKY-9028: the notes fixture needs its own root, declared in vault-settings.
  // Without `notesVaultRoot` the app falls back to a default under userData and
  // seeds it fresh — the Notes captures then show the SKY-15 seed layout instead
  // of the fixture below (the "audit's own test vault never appeared" failure
  // in PLAN.md GAP P0 #1).
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosNotesVault-'));
  return { userData, vaultDir, notesVaultDir };
}

function agentCfg(aiEnabled, extra = {}) {
  return {
    enabled: aiEnabled, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85,
    maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5,
    maxTokensPerDay: 500000, ...extra,
  };
}

function writeFixture({ userData, vaultDir, notesVaultDir }, aiEnabled) {
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
    gettingStartedDismissed: true, vaultUpgradePromptShown: true,
    // M11a master AI gate (SKY-9160): explicit either way so the AI-off pass
    // can't accidentally inherit "absent means enabled".
    ai: { enabled: aiEnabled },
    agents: {
      writingAssistant: agentCfg(aiEnabled, { scanIntervalSeconds: 30 }),
      brainstorm: agentCfg(aiEnabled),
      archive: agentCfg(aiEnabled, { continuityCheckIntervalSeconds: 60 }),
    },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));

  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
    version: '1', vaultRoot: vaultDir,
    stories: [{ id: storyId, title: STORY_TITLE, path: `stories/${storyId}`, createdAt: now, updatedAt: now,
      chapters: chapters.map(c => ({ id: c.id, title: c.title, path: `stories/${storyId}/chapters/${c.id}`, order: c.order, createdAt: now, updatedAt: now,
        scenes: c.scenes.map(s => ({ id: s.id, title: s.title, order: s.order, chapterId: c.id, storyId,
          path: `stories/${storyId}/chapters/${c.id}/scenes/${s.id}.md`, draftState: 'in-progress', createdAt: now, updatedAt: now,
          blocks: [{ id: `${s.id}-b1`, type: 'prose', content: s.body, order: 0, updatedAt: now }] })) })) }],
    entities: [], suggestions: [], scenes: [], chapters: [],
  }, null, 2));
  for (const c of chapters) {
    const dir = path.join(vaultDir, 'stories', storyId, 'chapters', c.id, 'scenes');
    fs.mkdirSync(dir, { recursive: true });
    for (const s of c.scenes) fs.writeFileSync(path.join(dir, `${s.id}.md`), [
      '---', `id: ${s.id}`, `title: "${s.title}"`, 'draftState: in-progress', `updatedAt: ${now}`,
      `chronologicalDate: ${s.date}`, `metaPov: ${s.pov}`, `metaMood: ${s.mood}`, `metaWordCount: ${s.body.split(/\s+/).length}`,
      '---', '', s.body, '',
    ].join('\n'));
  }

  // SKY-10353: eras/spans/plotline (§8.4 AGE OF ASH / THE VEIL / RECKONING +
  // PLOTLINES) so Timeline's Progress mode renders named spec content
  // instead of the empty-state hints — same shape as the TC-TL-NAV-0x fixture
  // in e2e/timeline.spec.ts (seedNavTimeline).
  const timelineId = 'tl-aud';
  fs.writeFileSync(path.join(vaultDir, 'timelines.json'), JSON.stringify({
    schemaVersion: 1,
    activeTimelineId: timelineId,
    timelines: [{
      id: timelineId, name: STORY_TITLE, kind: 'story', axis: 'calendar',
      calendar: { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 },
      createdAt: now, updatedAt: now,
    }],
    eras: [
      { id: 'aud-era-ash', timelineId, name: 'AGE OF ASH', startWhen: 0, endWhen: 16 },
      { id: 'aud-era-veil', timelineId, name: 'THE VEIL', startWhen: 16, endWhen: 32 },
      { id: 'aud-era-reckoning', timelineId, name: 'RECKONING', startWhen: 32, endWhen: 48 },
    ],
    spans: [
      { id: 'aud-book-1', timelineId, name: 'BOOK ONE', startWhen: 0, endWhen: 24 },
      { id: 'aud-book-2', timelineId, name: 'BOOK TWO', startWhen: 24, endWhen: 48 },
    ],
    rows: [
      { id: 'aud-row-main', timelineId, name: 'Main Plot', kind: 'plotline', color: '#00f0ff' },
    ],
    events: [
      { id: 'aud-card-1', timelineId, name: 'The Smuggler\'s Bargain', when: 4, chapter: 2, rowId: 'aud-row-main', pov: 'Kael Thorne' },
      { id: 'aud-card-2', timelineId, name: 'The Broken Gate', when: 20, chapter: 2, rowId: 'aud-row-main', pov: 'Kael Thorne' },
    ],
  }, null, 2));

  // Seed a notes side so Notes Editor has content (Obsidian-style folders + emoji test).
  const notes = [
    ['Worldbuilding/Locations/The Sunken Gate.md', '# The Sunken Gate\n\nAn ancient floodgate.\n\n[[The Great Deep]]\n'],
    ['Worldbuilding/Locations/The Last City of Veynn.md', '# The Last City of Veynn\n\nCapital.\n'],
    ['Worldbuilding/Factions/The Ash Court.md', '# The Ash Court\n'],
    ['Characters/Mira Veynn.md', '# Mira Veynn\n\nProtagonist.\n'],
    ['Research/Tide Mechanics.md', '# Tide Mechanics\n'],
    ['🌊 Emoji Folder Test/🔥 Emoji Note Test.md', '# 🔥 Emoji Note Test\n\nEmoji in title, folder and body 🎭.\n'],
  ];
  for (const [rel, body] of notes) {
    const p = path.join(notesVaultDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
}

function cleanupFixture({ userData, vaultDir, notesVaultDir }) {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
}

async function run(aiEnabled, prefix) {
  const fixture = seedFixture();
  writeFixture(fixture, aiEnabled);

  const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${fixture.userData}`, '--no-sandbox'], timeout: 90000 });
  const page = await app.firstWindow();
  page.on('dialog', d => void d.accept().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize(VIEWPORT);
  try { await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }); } catch {}
  await page.waitForTimeout(2500);

  // ── dismiss anything blocking ───────────────────────────────────────────────
  const alive = () => !page.isClosed();
  async function clearBlockers() {
    // Only dismiss labels that cannot close the app window itself.
    for (let i = 0; i < 4; i++) {
      if (!alive()) return;
      let acted = false;
      for (const label of ['Not now', 'Dismiss', 'Later', 'Skip', 'Got it']) {
        if (!alive()) return;
        const b = page.locator(`button:has-text("${label}")`).first();
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
  const shot = async (name, noPrefix = false) => {
    await page.waitForTimeout(800);
    const fileName = noPrefix ? name : `${prefix}${name}`;
    await page.screenshot({ path: `${OUT}/${fileName}.png` });
    texts[name] = await page.evaluate(() => document.body.innerText);
    console.log(`  shot ${fileName}`);
  };
  await shot('00-boot');

  // ── rail nav with verification ──────────────────────────────────────────────
  async function goRail(label) {
    await clearBlockers();
    const ok = await page.evaluate((lbl) => {
      const items = [...document.querySelectorAll('.nav-rail__item, [class*="nav-rail__item"]')];
      for (const el of items) {
        const box = el.closest('button,[role="button"],li,div') || el;
        if ((box.innerText || '').replace(/[^A-Za-z ]/g, '').trim() === lbl) { box.click(); return true; }
      }
      return false;
    }, label);
    await page.waitForTimeout(2000);
    const active = await page.evaluate(() => {
      const a = document.querySelector('.nav-rail__item--active, [class*="nav-rail__item"][class*="active"]');
      return a ? (a.closest('button,li,div')?.innerText || a.innerText || '').replace(/\n/g, ' ').trim() : '(none)';
    });
    console.log(`  goRail ${label} -> clicked=${ok} active="${active}"`);
    return ok;
  }

  // SKY-10353: a pre-seeded manifest story is never auto-selected — Scene
  // Crafter shows "No Story Selected" and Timeline shows its no-story state
  // until a story is actually clicked (the real user flow). Do this once, up
  // front, so every later rail in the loop below sees the same selected-story
  // app state.
  //
  // SKY-10382: select through the Stories *popover row* (AppNavRail
  // `nav-rail-story-<id>` → handleRailStorySelect → setSelectedStory), via a
  // DOM click like goRail's. The previous approach — dismiss the popover's
  // backdrop, then Playwright-click the sidebar `.nav-story-title` under it —
  // failed silently: Playwright's actionability check refuses a click on an
  // element covered by the popover backdrop, the `.catch(() => {})` swallowed
  // the timeout, and the log reported visibility as if it were a click. That
  // is exactly why rail-scene-crafter kept capturing "No Story Selected"
  // while every goRail (DOM click, immune to overlays) still "worked".
  await goRail('Story Writer');
  await clearBlockers();
  // Story Writer is the boot-default active section, so goRail's click just
  // toggled the Stories popover open (prototype `pick()` behavior). If a
  // blocker dialog ate that toggle, click the rail item once more.
  const popoverOpen = () => page.evaluate(() => !!document.querySelector('[data-testid="nav-rail-stories"]'));
  if (!(await popoverOpen())) {
    await goRail('Story Writer');
  }
  let storySelected = false;
  if (await popoverOpen()) {
    storySelected = await page.evaluate((sid) => {
      const row = document.querySelector(`[data-testid="nav-rail-story-${sid}"]`);
      if (row) { row.click(); return true; }
      return false;
    }, storyId);
  }
  if (!storySelected) {
    // Fallback: sidebar StoryNavigator title, still as a DOM click so no
    // stray overlay can intercept it.
    storySelected = await page.evaluate((title) => {
      const el = [...document.querySelectorAll('.nav-story-title')].find((t) => (t.textContent || '').trim() === title);
      if (el) { el.click(); return true; }
      return false;
    }, STORY_TITLE);
  }
  await page.waitForTimeout(1000);
  console.log(`  selectStory clicked=${storySelected}`);

  for (const r of ['Notes Editor', 'Scene Crafter', 'Brainstorm', 'Timeline', 'Vault Graph', 'Story Writer']) {
    if (await goRail(r)) {
      const railName = 'rail-' + r.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      // SKY-10382: rail-brainstorm is the one surface whose on-screen content
      // actually differs by AI state (chat vs manual board), so name both
      // captures explicitly instead of relying on the ai-on- prefix — other
      // rails keep the plain/`ai-on-` scheme since they don't change.
      const name = r === 'Brainstorm' ? `rail-brainstorm-${aiEnabled ? 'ai-on' : 'ai-off'}` : railName;
      await shot(name, r === 'Brainstorm');
      // Non-timing verification (harness rule #3): confirm the story
      // selection actually landed on the two surfaces that go blank without
      // it, instead of assuming the earlier click "probably worked".
      if (r === 'Scene Crafter' || r === 'Timeline') {
        const emptyState = texts[name].includes('No Story Selected') || texts[name].includes('Select a story to view its timeline');
        console.log(`  storySelected(${r})=${!emptyState}`);
      }
      // M10-S3: the SUGGESTED CARDS rail is what SKY-10353 was filed to
      // capture — assert it by rendered text, not by assuming selection held.
      if (r === 'Scene Crafter') {
        console.log(`  sceneCrafterSuggestedCards=${texts[name].includes('SUGGESTED CARDS')}`);
      }
    }
  }

  // ── editor: open a scene, capture depths, then the notes split ──────────────
  await goRail('Story Writer');
  await clearBlockers();
  try {
    const storyRow = page.locator('.nav-story-row').first();
    if (await storyRow.isVisible({ timeout: 4000 }).catch(() => false)) {
      await storyRow.locator('.nav-expand-btn, button').first().click().catch(() => {});
      await page.waitForTimeout(500);
      const rows = page.locator('.nav-chapter-row');
      const cn = await rows.count().catch(() => 0);
      for (let i = 0; i < cn; i++) await rows.nth(i).locator('.nav-expand-btn, button').first().click().catch(() => {});
      await page.waitForTimeout(600);
      await shot('editor-tree-expanded');
      const scene = page.locator('.nav-scene-row').first();
      if (await scene.isVisible({ timeout: 2000 }).catch(() => false)) { await scene.click(); await page.waitForTimeout(1800); await shot('editor-scene-open'); }
    }
  } catch (e) { console.log('tree nav: ' + String(e).slice(0, 120)); }

  for (const d of ['Full Book', 'Part', 'Chapter', 'Scene']) {
    const b = page.locator(`button:has-text("${d}")`).first();
    if (await b.isVisible({ timeout: 1200 }).catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(1300); await shot(`depth-${d.toLowerCase().replace(/ /g, '-')}`); }
  }

  // Emoji check: does the tree render the emoji folder/note?
  const emoji = await page.evaluate(() => {
    const t = document.body.innerText;
    return { hasWave: t.includes('🌊'), hasFire: t.includes('🔥'), sample: (t.match(/.{0,40}Emoji.{0,40}/g) || []).slice(0, 4) };
  });
  console.log('EMOJI: ' + JSON.stringify(emoji));

  fs.writeFileSync(`${OUT}/${prefix}app-text.json`, JSON.stringify(texts, null, 1));
  await app.close().catch(() => {});
  cleanupFixture(fixture);
}

// Keep the existing AI-off captures (unprefixed filenames — the regression
// baseline everything else compares against), and add the AI-on pass R11
// requires for the side-by-side (SKY-10353). Add, don't replace.
await run(false, '');
await run(true, 'ai-on-');
console.log('DONE');
