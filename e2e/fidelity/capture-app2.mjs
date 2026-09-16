// App capture v2 — dismiss blocking modals, verify navigation actually happened,
// dump per-surface text. Reuses the v1 seed.
// Harness rules: see lib.mjs header (no Close-clicks, dismiss `Not now` first,
// verify nav via --active, never pipe the runner through `head`).
//
// SKY-10353 (Ivy M10 fidelity gate — evidence gap): two problems made this
// harness photograph states the features aren't actually in:
// 1. Agents were seeded `enabled: false` unconditionally, so `rail-brainstorm`
//    only ever captured the AI-off path — R11's mandated AI-on/AI-off
//    side-by-side was never producible. Fix: `run(prefix, aiEnabled)` runs the
//    WHOLE capture twice — AI-off keeps the original unprefixed filenames
//    (regression baseline, unchanged), AI-on adds `ai-on-`-prefixed captures
//    alongside. Add, don't replace.
// 2. No story was ever selected, so `rail-scene-crafter` and `rail-timeline`
//    captured "No Story Selected" / empty-state hints instead of real content.
//    Fix: select the seeded story's first scene BEFORE the rail loop (moved
//    the existing tree-expand block earlier) and verify the selection landed
//    via the `.nav-scene-row.active` class — polled, not a timing guess — per
//    the harness rule in lib.mjs. The vault fixture also grew chronological
//    dates + POV/mood scene metadata and a seeded `timelines.json` (plotline
//    rows + events), so Timeline's era bands, "you are here" marker, POV
//    text and plotline counts render real content instead of empty state.
//    NOTE: the prototype's literal named eras (AGE OF ASH / THE VEIL /
//    RECKONING) can't be reproduced by any fixture — the shipped app derives
//    its Lanes eras ruler from `scene.chronologicalTime.date` year buckets
//    (frontend/src/timelineAeon.ts `deriveAeonTimeline`), not user-named era
//    labels. That's a real app-capability gap vs. the prototype, not a
//    fixture bug — flagged separately, not silently papered over here.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('capture-app2');
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 1920, height: 1080 };
const storyId = 'aud-story-001';

async function run(prefix, aiEnabled) {
  const now = new Date().toISOString();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-a2-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-'));
  // SKY-9028: the notes fixture needs its own root, declared in vault-settings.
  // Without `notesVaultRoot` the app falls back to a default under userData and
  // seeds it fresh — the Notes captures then show the SKY-15 seed layout instead
  // of the fixture below (the "audit's own test vault never appeared" failure
  // in PLAN.md GAP P0 #1).
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosNotesVault-'));

  const agentCfg = (extra = {}) => ({
    enabled: aiEnabled, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85,
    maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5,
    maxTokensPerDay: 500000, ...extra,
  });
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
    gettingStartedDismissed: true, vaultUpgradePromptShown: true,
    ai: { enabled: aiEnabled },
    agents: { writingAssistant: agentCfg({ scanIntervalSeconds: 30 }), brainstorm: agentCfg(), archive: agentCfg({ continuityCheckIntervalSeconds: 60 }) },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));

  const PROSE = {
    s1: "Kael dealt cards the way other men made confessions — slowly, and only when cornered.",
    s2: "The stairwell yawned like a throat carved into the belly of the city. Damp air rolled up from below, thick with the smell of rot, smoke, and something metallic.",
    s3: "The gate had not been broken so much as persuaded.",
  };
  // Chronological date (year buckets) + POV/mood: feeds the Timeline surface's
  // real era ruler, "you are here" marker and key-event POV text (SKY-10353) —
  // see frontend/src/timelineAeon.ts deriveAeonTimeline.
  const chapters = [
    { id: 'aud-ch-001', title: 'Chapter 1: The Quiet Before', order: 0, scenes: [
      { id: 'aud-sc-000', title: 'The Long Dusk', order: 0, body: PROSE.s3, date: '1490-01-01', pov: 'Mira', mood: 'ominous' },
    ] },
    { id: 'aud-ch-002', title: 'Chapter 2: Fractures', order: 1, scenes: [
      { id: 'aud-sc-001', title: "The Smuggler's Bargain", order: 0, body: PROSE.s1, date: '1490-04-01', pov: 'Kael', mood: 'tense' },
      { id: 'aud-sc-002', title: 'Into the Undercity', order: 1, body: PROSE.s2, date: '1491-01-01', pov: 'Kael', mood: 'grim' },
      { id: 'aud-sc-003', title: 'The Broken Gate', order: 2, body: PROSE.s3, date: '1491-03-01', pov: 'Mira', mood: 'triumphant' },
    ] },
  ];
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
    version: '1', vaultRoot: vaultDir,
    stories: [{ id: storyId, title: 'The Last City of Veynn', path: `stories/${storyId}`, createdAt: now, updatedAt: now,
      chapters: chapters.map(c => ({ id: c.id, title: c.title, path: `stories/${storyId}/chapters/${c.id}`, order: c.order, createdAt: now, updatedAt: now,
        scenes: c.scenes.map(s => ({ id: s.id, title: s.title, order: s.order, chapterId: c.id, storyId,
          path: `stories/${storyId}/chapters/${c.id}/scenes/${s.id}.md`, draftState: 'in-progress', createdAt: now, updatedAt: now,
          blocks: [{ id: `${s.id}-b1`, type: 'prose', content: s.body, order: 0, updatedAt: now }] })) })) }],
    entities: [], suggestions: [], scenes: [], chapters: [],
  }, null, 2));
  for (const c of chapters) {
    const dir = path.join(vaultDir, 'stories', storyId, 'chapters', c.id, 'scenes');
    fs.mkdirSync(dir, { recursive: true });
    for (const s of c.scenes) fs.writeFileSync(path.join(dir, `${s.id}.md`),
      ['---', `id: ${s.id}`, `title: "${s.title}"`, 'draftState: in-progress', `updatedAt: ${now}`,
        `chronologicalDate: ${s.date}`, `metaPov: ${s.pov}`, `metaMood: ${s.mood}`,
        '---', '', s.body, ''].join('\n'));
  }
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
  // M21 timelines store (SKY-10353): plotline rows + events so Timeline's
  // Plotlines panel shows real counts instead of "+ Plotline in the toolbar
  // adds one" — see plotlineRows()/plotlineEventCounts in TimelineRoot.tsx.
  const tlId = 'aud-tl-story';
  fs.writeFileSync(path.join(vaultDir, 'timelines.json'), JSON.stringify({
    schemaVersion: 1,
    activeTimelineId: tlId,
    timelines: [{
      id: tlId, name: 'Story Timeline', kind: 'story', axis: 'calendar',
      calendar: { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 },
      createdAt: now, updatedAt: now, source: 'manual',
    }],
    eras: [], spans: [],
    rows: [
      { id: 'row:main-plot', timelineId: tlId, name: 'Main Plot', kind: 'plotline', color: '#00f0ff', source: 'manual' },
      { id: 'row:undercity', timelineId: tlId, name: 'The Undercity', kind: 'plotline', color: '#9b5fff', source: 'manual' },
    ],
    events: [
      { id: 'event:bargain', timelineId: tlId, name: "The Smuggler's Bargain", when: 1, rowId: 'row:main-plot', chapter: 2, sceneId: 'aud-sc-001', source: 'manual' },
      { id: 'event:undercity', timelineId: tlId, name: 'Into the Undercity', when: 2, rowId: 'row:undercity', chapter: 2, sceneId: 'aud-sc-002', source: 'manual' },
      { id: 'event:gate', timelineId: tlId, name: 'The Broken Gate', when: 3, rowId: 'row:main-plot', chapter: 2, sceneId: 'aud-sc-003', source: 'manual' },
    ],
  }, null, 2));

  const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'], timeout: 90000 });
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
  const shot = async (name) => {
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/${prefix}${name}.png` });
    texts[name] = await page.evaluate(() => document.body.innerText);
    console.log(`  [${prefix || 'ai-off'}] shot ${name}`);
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

  // Poll for `.nav-scene-row.active` rather than a timing guess (lib.mjs rule
  // #3) — selecting a scene also sets the app's `selectedStory` (see
  // handleSelectScene in DesktopShell.tsx), which is what Scene Crafter and
  // Timeline need to render real content instead of "No Story Selected".
  async function waitForActiveScene(timeoutMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!alive()) return false;
      const active = await page.evaluate(() =>
        !!document.querySelector('.nav-scene-row.active, [class*="nav-scene-row"][class*="active"]'));
      if (active) return true;
      await page.waitForTimeout(200);
    }
    return false;
  }

  // ── select the seeded story/scene FIRST, so every later rail (Scene
  // Crafter, Timeline) captures real content instead of an empty state ──────
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
      if (await scene.isVisible({ timeout: 2000 }).catch(() => false)) {
        await scene.click();
        const selected = await waitForActiveScene();
        console.log(`  scene select -> active=${selected}`);
        await shot('editor-scene-open');
      }
    }
  } catch (e) { console.log('tree nav: ' + String(e).slice(0, 120)); }

  for (const d of ['Full Book', 'Part', 'Chapter', 'Scene']) {
    const b = page.locator(`button:has-text("${d}")`).first();
    if (await b.isVisible({ timeout: 1200 }).catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(1300); await shot(`depth-${d.toLowerCase().replace(/ /g, '-')}`); }
  }

  for (const r of ['Notes Editor', 'Scene Crafter', 'Brainstorm', 'Timeline', 'Vault Graph', 'Story Writer']) {
    if (await goRail(r)) await shot('rail-' + r.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  }

  // Emoji check: does the tree render the emoji folder/note?
  const emoji = await page.evaluate(() => {
    const t = document.body.innerText;
    return { hasWave: t.includes('🌊'), hasFire: t.includes('🔥'), sample: (t.match(/.{0,40}Emoji.{0,40}/g) || []).slice(0, 4) };
  });
  console.log(`EMOJI [${prefix || 'ai-off'}]: ` + JSON.stringify(emoji));

  fs.writeFileSync(`${OUT}/${prefix}app-text.json`, JSON.stringify(texts, null, 1));
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
}

// AI-off keeps the original unprefixed filenames (regression baseline,
// unchanged paths — e2e/fidelity/output/capture-app2/rail-brainstorm.png etc).
// AI-on adds `ai-on-`-prefixed captures alongside so R11's mandated
// side-by-side is actually producible (SKY-10353).
await run('', false);
await run('ai-on-', true);
console.log('DONE');
