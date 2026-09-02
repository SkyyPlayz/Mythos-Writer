// SKY-10508 — M9 re-pass evidence (Ivy fidelity-gate verdict 1d90cf53).
// Makes the three "unprovable" M9 spec items provable:
//   1. References typed roles — fixture prose carries wiki-links that populate
//      Location · pinned / Character · POV / (Note ·) unresolved link /
//      Location · hub, plus a [[New Thing]] whose creation resolves live.
//   2. Continuity flag cards — Archive agent ENABLED + three seeded conflicts
//      (one per scope tag), each of the three per-flag actions exercised
//      against real vault notes (file patched / suggestion row / ignored).
//   3. Side-by-sides — prototype vs app for References / Notes / Scenes /
//      Continuity, captured MANUALLY (not rightpanel.mjs — SKY-10504), with
//      per-shot distinctness verification (sha1 of every capture must differ).
// Harness rules: see lib.mjs header (no Close-clicks, dismiss `Not now` first,
// verify nav via markers, never pipe the runner through `head`).
//
// Usage: node e2e/fidelity/sky10508-m9-repass.mjs [--proto] [--app] [--montage]
//        (no flags = all three phases; app phase needs a display — xvfb-run)
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { chromium, _electron as electron } from 'playwright';
import { serveProto, outDir, chromiumLaunchOptions, mainJs as MAIN_JS, requireBuild } from './lib.mjs';

const OUT = outDir('sky10508-m9-repass');
const flags = process.argv.slice(2);
const runAll = flags.length === 0;
const doProto = runAll || flags.includes('--proto');
const doApp = runAll || flags.includes('--app');
const doMontage = runAll || flags.includes('--montage');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

// ── prototype ────────────────────────────────────────────────────────────────
if (doProto) {
  const proto = await serveProto();
  const browser = await chromium.launch(chromiumLaunchOptions());
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(proto.url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3500);

  const clickRail = (label) => page.evaluate((l) => {
    const hit = [...document.querySelectorAll('div,span,button,a')].filter((e) => {
      if ((e.innerText || '').trim() !== l) return false;
      const r = e.getBoundingClientRect();
      return r.left < 110 && r.width > 8 && r.height > 8;
    });
    if (!hit.length) return false;
    hit.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
    hit[0].click();
    return true;
  }, label);

  // Right-panel tab in the editor view (right third of the window only).
  const clickRightTab = (label) => page.evaluate((l) => {
    for (const el of document.querySelectorAll('button,div,span')) {
      if ((el.innerText || '').trim() !== l) continue;
      const r = el.getBoundingClientRect();
      if (r.left < 1400 || r.width < 8 || r.height < 8 || r.height > 60) continue;
      el.click();
      return true;
    }
    return false;
  }, label);

  check('proto: rail Story Writer', await clickRail('Story Writer'));
  await page.waitForTimeout(2500);
  for (const tab of ['References', 'Notes', 'Scenes']) {
    const ok = await clickRightTab(tab);
    await page.waitForTimeout(1500);
    const text = await page.evaluate(() => document.body.innerText);
    const marker = tab === 'References' ? 'Tide Mechanics' : tab === 'Notes' ? 'SCENE NOTES' : 'oard';
    check(`proto: ${tab} tab`, ok && text.includes(marker));
    await page.screenshot({ path: `${OUT}/proto-${tab.toLowerCase()}.png`, clip: { x: 1520, y: 0, width: 400, height: 1080 } });
  }
  // Continuity flags feed lives on the Notes Editor's right agent panel.
  check('proto: rail Notes Editor', await clickRail('Notes Editor'));
  await page.waitForTimeout(2500);
  const hasFlags = await page.evaluate(() => document.body.innerText.includes('CONTINUITY FLAGS'));
  check('proto: CONTINUITY FLAGS visible', hasFlags);
  await page.screenshot({ path: `${OUT}/proto-continuity.png`, clip: { x: 1520, y: 0, width: 400, height: 1080 } });
  await browser.close();
  await proto.close();
}

// ── app fixture ──────────────────────────────────────────────────────────────
const NOW = new Date().toISOString();
const SID = 'rp2-story', CID = 'rp2-c1';
const S1 = 'rp2-s1', S2 = 'rp2-s2', S3 = 'rp2-s3';
// Anchor sentences double as continuity manuscript excerpts (real substrings).
const S1_PROSE = 'The stairwell yawned like a throat. [[Mira Veynn]] entered [[The Sunken Gate]] at high tide, reciting what she knew of [[Tide Mechanics]]. Three days later, the bells of [[The Last City of Veynn]] rang for the Drowning of the Coast in 312 AG. She would need a [[New Thing]] before dawn.';
const S2_PROSE = 'By morning the rumor had grown teeth. Beyond [[The Sunken Gate]], all roads bent back toward [[The Last City of Veynn]].';
const S3_PROSE = 'The bells rang again over [[The Last City of Veynn]], and this time nobody counted them.';
const GATE_EXCERPT = 'the inner passage opens only at low tide';
const FOUNDING_EXCERPT = 'founded in 298 AG, before the Drowning';
const WARD_EXCERPT = 'Ward Violet falls the night before the descent';

function seedFixture() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-10508-ud-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-10508-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosNotes-10508-'));
  const ac = { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 1e5, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 5e5 };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
    gettingStartedProgress: { completedItems: [], dismissed: true },
    agents: {
      writingAssistant: { ...ac, scanIntervalSeconds: 30 },
      brainstorm: ac,
      // Archive agent ENABLED — the whole point of the continuity fixture.
      archive: { ...ac, enabled: true, continuityCheckIntervalSeconds: 60 },
    },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    rightSidebarVisible: true, rightSidebarWidth: 360,
    rightSidebarPanels: [{ id: 'archive-continuity', collapsed: false }],
    archiveStoryEditConsentGiven: true,
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));

  const sceneMeta = (id, title, order, prose) => ({
    id, title, order, chapterId: CID, storyId: SID,
    path: `stories/${SID}/chapters/${CID}/scenes/${id}.md`, draftState: 'in-progress',
    createdAt: NOW, updatedAt: NOW,
    ...(id === S1 ? { timelineMetadata: { pov: 'Mira Veynn' } } : {}),
    blocks: [{ id: `${id}-b`, type: 'prose', content: prose, order: 0, updatedAt: NOW }],
  });
  const entity = (id, name, type, dir) => ({
    id, name, type, path: `entities/${dir}/${name}.md`, createdAt: NOW, updatedAt: NOW,
  });
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
    version: '1', vaultRoot: vaultDir,
    stories: [{ id: SID, title: 'The Last City of Veynn', path: `stories/${SID}`, genre: 'Epic Fantasy', pov: 'Mira Veynn', createdAt: NOW, updatedAt: NOW,
      chapters: [{ id: CID, title: 'Fractures', path: `stories/${SID}/chapters/${CID}`, order: 0, createdAt: NOW, updatedAt: NOW,
        scenes: [
          sceneMeta(S1, 'Into the Undercity', 0, S1_PROSE),
          sceneMeta(S2, 'A City in Shadows', 1, S2_PROSE),
          sceneMeta(S3, "The Watcher's Call", 2, S3_PROSE),
        ] }] }],
    entities: [
      entity('ent-gate', 'The Sunken Gate', 'location', 'locations'),
      entity('ent-mira', 'Mira Veynn', 'character', 'characters'),
      entity('ent-city', 'The Last City of Veynn', 'location', 'locations'),
    ],
    suggestions: [], scenes: [], chapters: [], provenance: {}, boardReferences: [], smartFolders: [],
  }, null, 2));

  const sceneDir = path.join(vaultDir, 'stories', SID, 'chapters', CID, 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  for (const [id, title, prose] of [[S1, 'Into the Undercity', S1_PROSE], [S2, 'A City in Shadows', S2_PROSE], [S3, "The Watcher's Call", S3_PROSE]]) {
    fs.writeFileSync(path.join(sceneDir, `${id}.md`),
      ['---', `id: ${id}`, `title: "${title}"`, 'draftState: in-progress', `updatedAt: ${NOW}`, '---', '', prose, ''].join('\n'));
  }

  // Entity notes in the STORY vault — flag 1's "Edit notes to match" patches
  // The Sunken Gate note, so its excerpt must exist on disk verbatim.
  const entFile = (dir, name, body) => {
    const d = path.join(vaultDir, 'entities', dir);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `${name}.md`), ['---', `title: "${name}"`, '---', '', `# ${name}`, '', body, ''].join('\n'));
  };
  entFile('locations', 'The Sunken Gate', `A drowned arch at the harbor floor; ${GATE_EXCERPT}.`);
  entFile('characters', 'Mira Veynn', 'Nineteen, counts bells, does not trust the Council.');
  entFile('locations', 'The Last City of Veynn', 'The last city standing after the Drowning of the Coast.');

  // Notes-vault notes backing flags 2 and 3. No "Tide Mechanics" and no
  // "New Thing" anywhere — those two must stay unresolved at boot.
  const noteFile = (rel, body) => {
    const abs = path.join(notesVaultDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  noteFile('Events/Founding of Veynn.md', `---\ntitle: "Founding of Veynn"\n---\n\nThe city was ${FOUNDING_EXCERPT} of the Coast.\n`);
  noteFile('Timeline/Ward Violet.md', `---\ntitle: "Ward Violet"\n---\n\nIn every telling, ${WARD_EXCERPT}.\n`);

  // Seed the three continuity conflicts (one per scope) — same table shape the
  // proven m9d harness used; migrations skip the CREATE and keep the rows.
  const mythosDir = path.join(vaultDir, '.mythos');
  fs.mkdirSync(mythosDir, { recursive: true });
  const db = new DatabaseSync(path.join(mythosDir, 'state.db'));
  db.exec(`CREATE TABLE IF NOT EXISTS continuity_issues (
      id TEXT PRIMARY KEY, category TEXT NOT NULL, severity TEXT NOT NULL,
      manuscript_scene_id TEXT NOT NULL, manuscript_offset INTEGER NOT NULL, manuscript_excerpt TEXT NOT NULL,
      vault_note_path TEXT NOT NULL, vault_line INTEGER NOT NULL, vault_excerpt TEXT NOT NULL,
      rationale TEXT NOT NULL, proposed_match_archive TEXT NOT NULL, proposed_suggest_story TEXT NOT NULL,
      status TEXT NOT NULL, resolved_at TEXT, resolved_action TEXT, created_at TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'story_vault');`);
  const ins = db.prepare(`INSERT INTO continuity_issues
      (id, scope, category, severity, manuscript_scene_id, manuscript_offset, manuscript_excerpt,
       vault_note_path, vault_line, vault_excerpt, rationale, proposed_match_archive, proposed_suggest_story,
       status, resolved_at, resolved_action, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'open', NULL, NULL, ?)`);
  const anchor = (needle) => {
    const off = S1_PROSE.indexOf(needle);
    if (off < 0) throw new Error(`anchor not in S1 prose: ${needle}`);
    return off;
  };
  const M1 = 'entered [[The Sunken Gate]] at high tide';
  const M2 = 'the Drowning of the Coast in 312 AG';
  const M3 = 'Three days later';
  ins.run('fl-story-vault', 'story_vault', 'location_attribute_mismatch', 'high', S1, anchor(M1), M1,
    'entities/locations/The Sunken Gate.md', GATE_EXCERPT,
    `Scene has Mira entering the Gate at high tide; the note "The Sunken Gate" says ${GATE_EXCERPT}.`,
    'The inner passage opens at high tide.',
    'Change the crossing so Mira waits for low tide.', NOW);
  ins.run('fl-vault-internal', 'vault_internal', 'factual_contradiction', 'medium', S1, anchor(M2), M2,
    'Events/Founding of Veynn.md', FOUNDING_EXCERPT,
    `Scene dates the Drowning of the Coast to 312 AG; "Founding of Veynn" says the city was ${FOUNDING_EXCERPT}. Both cannot hold.`,
    'Align the founding note to 312 AG.',
    'Keep 298 AG and reword the scene’s Drowning date.', NOW);
  ins.run('fl-timeline', 'timeline', 'factual_contradiction', 'medium', S1, anchor(M3), M3,
    'Timeline/Ward Violet.md', WARD_EXCERPT,
    `Scene opens “Three days later”, but the timeline note says ${WARD_EXCERPT} — the order is inverted.`,
    'Move Ward Violet after the descent on the timeline.',
    'Reword the opener to match the timeline order.', NOW);
  db.close();
  return { userData, vaultDir, notesVaultDir };
}

// ── app run ──────────────────────────────────────────────────────────────────
if (doApp) {
  const fx = seedFixture();
  const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${fx.userData}`, '--no-sandbox'], timeout: 90000 });
  const page = await app.firstWindow();
  page.on('dialog', (x) => void x.accept().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(3000);
  for (const l of ['Not now', 'Dismiss', 'Got it', 'Skip']) {
    const b = page.locator(`button:has-text("${l}")`).first();
    if (await b.isVisible({ timeout: 500 }).catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(400); }
  }
  await page.keyboard.press('Escape').catch(() => {});

  const openScene = async (title) => {
    for (let i = 0; i < 3; i++) {
      const btns = page.locator('.nav-expand-btn');
      const n = await btns.count().catch(() => 0);
      for (let j = 0; j < n; j++) await btns.nth(j).click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
    const row = page.locator('.nav-scene-row', { hasText: title }).first();
    if (await row.count().catch(() => 0) > 0) {
      await row.click({ force: true, timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(2200);
    }
    return !/Select a scene|Welcome to Mythos/.test(await page.evaluate(() => document.body.innerText));
  };
  check('app: scene open', await openScene('Into the Undercity'));

  // Right-panel tab click — right third of the window only (same filter the
  // old harness used; the CAPTURES here are verified distinct below).
  const clickRightTab = async (label) => {
    const ok = await page.evaluate((l) => {
      for (const el of document.querySelectorAll('button,[role="tab"],div,span')) {
        if ((el.innerText || '').trim() !== l) continue;
        const r = el.getBoundingClientRect();
        if (r.left < 1400 || r.width < 8 || r.height < 8) continue;
        el.click();
        return true;
      }
      return false;
    }, label);
    await page.waitForTimeout(1700);
    return ok;
  };
  const rightColumnText = () => page.evaluate(() => {
    const out = [];
    // SKY-10591: don't skip elements with children — an element with mixed
    // (text + inline element) content is a container too, and skipping it
    // drops its own text nodes entirely. Emit each element's OWN text nodes
    // only; nested elements contribute their own words on their own pass.
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.left < 1500 || r.width < 4) return;
      const t = [...el.childNodes].filter(n => n.nodeType === 3)
        .map(n => n.textContent.trim()).filter(Boolean).join(' ');
      if (t) out.push(t);
    });
    return [...new Set(out)].join('\n');
  });
  const shootRight = (name) => page.screenshot({ path: `${OUT}/${name}.png`, clip: { x: 1520, y: 0, width: 400, height: 1080 } });

  // 1. References — all four typed roles + the unresolved [[New Thing]].
  check('app: References tab', await clickRightTab('References'));
  let refText = await rightColumnText();
  fs.writeFileSync(`${OUT}/app-references.txt`, refText);
  check('app: Location · pinned (The Sunken Gate)', refText.includes('The Sunken Gate') && refText.includes('Location · pinned'));
  check('app: Character · POV (Mira Veynn)', refText.includes('Mira Veynn') && refText.includes('Character · POV'));
  check('app: unresolved link (Tide Mechanics)', refText.includes('Tide Mechanics') && refText.includes('unresolved link'));
  check('app: Location · hub (The Last City of Veynn)', refText.includes('The Last City of Veynn') && refText.includes('Location · hub'));
  check('app: New Thing unresolved with Create', refText.includes('New Thing') && refText.includes('+ Create'));
  await shootRight('app-references');

  // 2. Notes tab — prototype copy.
  check('app: Notes tab', await clickRightTab('Notes'));
  const notesText = await rightColumnText();
  fs.writeFileSync(`${OUT}/app-notes.txt`, notesText);
  check('app: scene-notes copy', /promote a note to the vault by dragging it onto the navigator/i.test(notesText));
  await shootRight('app-notes');

  // 3. Scenes tab — canvas boards (SKY-10503 copy already fixed; just capture).
  check('app: Scenes tab', await clickRightTab('Scenes'));
  const scenesText = await rightColumnText();
  fs.writeFileSync(`${OUT}/app-scenes.txt`, scenesText);
  check('app: canvas boards copy', /canvas board/i.test(scenesText));
  await shootRight('app-scenes');

  // 4. Assistant — continuity flag cards, one per scope.
  check('app: Assistant tab', await clickRightTab('Assistant'));
  await page.locator('[data-testid="ic-scope-tag"]').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  const scopeTags = await page.locator('[data-testid="ic-scope-tag"]').allInnerTexts().catch(() => []);
  check('app: 3 flag cards', scopeTags.length === 3, `scopes=[${scopeTags.join(', ')}]`);
  check('app: scope Story ↔ Vault', scopeTags.some((t) => t.includes('Story') && t.includes('Vault')));
  check('app: scope Vault internal', scopeTags.includes('Vault internal'));
  check('app: scope Timeline', scopeTags.includes('Timeline'));
  const contText = await rightColumnText();
  fs.writeFileSync(`${OUT}/app-continuity.txt`, contText);
  // M12.B3 (SKY-10738): owner's annotated-screenshot ruling replaces the
  // prototype's three actions with two — "Suggest fix" / "Open sources".
  check('app: two actions on cards (M12.B3)', contText.includes('Suggest fix') && contText.includes('Open sources'));
  // Put the flag cards at the top of the sidebar viewport so all three are in
  // frame (the Assistant tab stacks AGENTS/SUGGESTIONS/ANALYSIS above them).
  await page.evaluate(() => {
    document.querySelector('[data-testid="ic-scope-tag"]')
      ?.closest('li')?.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(500);
  await shootRight('app-continuity');

  // 5. Exercise each per-flag action (acceptance box 3).
  // 5a. Suggest fix → Update your notes → Apply Change → the Sunken Gate
  // note is patched (M12.B3: "Suggest fix" opens the choice first).
  await page.locator('button[aria-label^="Suggest fix"]').first().click({ timeout: 5000 });
  await page.waitForTimeout(300);
  await page.locator('button[aria-label="Update your notes to match the story"]').click({ timeout: 5000 });
  await page.waitForTimeout(800);
  await shootRight('app-action-match-expand');
  await page.locator('button[aria-label="Apply vault change"]').click({ timeout: 5000 });
  await page.waitForTimeout(1500);
  const gateNote = fs.readFileSync(path.join(fx.vaultDir, 'entities/locations/The Sunken Gate.md'), 'utf8');
  check('action: Edit notes to match patched the note', gateNote.includes('The inner passage opens at high tide.') && !gateNote.includes(GATE_EXCERPT));

  // 5b. Suggest fix → Suggest a story change → Apply Edit → suggestion row
  // lands (verified from state.db after the app closes).
  await page.locator('button[aria-label^="Suggest fix"]').nth(1).click({ timeout: 5000 });
  await page.waitForTimeout(300);
  await page.locator('button[aria-label="Suggest a change to the story"]').click({ timeout: 5000 });
  await page.waitForTimeout(800);
  await shootRight('app-action-suggest-expand');
  await page.locator('button[aria-label="Apply suggested edit"]').click({ timeout: 5000 });
  await page.waitForTimeout(1500);

  // 5c. Ignore → the last card leaves the open list.
  await page.locator('button[aria-label^="Ignore"]').first().click({ timeout: 5000 });
  await page.waitForTimeout(1500);
  const remaining = await page.locator('[data-testid="ic-scope-tag"]').count().catch(() => 0);
  check('action: all three flags resolved/ignored', remaining === 0, `remaining=${remaining}`);
  await shootRight('app-continuity-after-actions');

  // 6. [[New Thing]] — create from the References row, then it resolves live.
  check('app: References tab (again)', await clickRightTab('References'));
  await page.locator('button[aria-label="New Thing — unresolved link, create the note"]').click({ timeout: 5000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/app-newthing-created.png` });
  const noteOnDisk = fs.existsSync(path.join(fx.notesVaultDir, 'New Thing.md'));
  check('action: + Create wrote New Thing.md to the Notes Vault', noteOnDisk);

  // Back to the story editor via the left nav rail's Story Writer entry,
  // reopen the scene if the create-flow deselected it, and re-read References.
  await page.evaluate(() => {
    const hit = [...document.querySelectorAll('div,span,button,a')].filter((e) => {
      const label = ((e.innerText || '') + ' ' + (e.getAttribute('title') || '')).trim();
      if (!/Story Writer/i.test(label)) return false;
      const r = e.getBoundingClientRect();
      return r.left < 110 && r.width > 8 && r.height > 8;
    }).sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0];
    if (hit) hit.click();
  });
  await page.waitForTimeout(2500);
  // The create-flow deselects story/chapter/scene — always reopen the scene.
  check('app: scene reopened after create', await openScene('Into the Undercity'));
  await clickRightTab('References');
  refText = await rightColumnText();
  fs.writeFileSync(`${OUT}/app-references-resolved.txt`, refText);
  // Tide Mechanics stays unresolved by design, so `+ Create` is still on the
  // panel — the proof is the New Thing row's aria flipping to "Open New Thing"
  // with a `Note · pinned` subtitle.
  const newThingOpen = await page.locator('button[aria-label="Open New Thing"]').count().catch(() => 0);
  const newThingCreate = await page.locator('button[aria-label="New Thing — unresolved link, create the note"]').count().catch(() => 0);
  check('action: New Thing resolved live (Note · pinned, Create gone)',
    newThingOpen === 1 && newThingCreate === 0 && /Note · pinned/.test(refText));
  await shootRight('app-references-resolved');

  await app.close().catch(() => {});
  // Suggestion row written by 5b — read state.db after the app has closed.
  const db2 = new DatabaseSync(path.join(fx.vaultDir, '.mythos', 'state.db'));
  const sugg = db2.prepare("SELECT source_agent, status, rationale FROM suggestions WHERE source_agent='archive'").all();
  const iss = db2.prepare('SELECT id, status, resolved_action FROM continuity_issues ORDER BY id').all();
  db2.close();
  check('action: Suggest story change landed a proposed archive suggestion', sugg.length === 1 && sugg[0].status === 'proposed', JSON.stringify(sugg));
  fs.writeFileSync(`${OUT}/app-db-after.json`, JSON.stringify({ suggestions: sugg, continuity: iss }, null, 2));
  const byId = Object.fromEntries(iss.map((r) => [r.id, r]));
  check('db: story_vault flag resolved via match', byId['fl-story-vault']?.status === 'resolved' && byId['fl-story-vault']?.resolved_action === 'match_archive_to_story');
  check('db: vault_internal flag resolved via suggest', byId['fl-vault-internal']?.status === 'resolved' && byId['fl-vault-internal']?.resolved_action === 'suggest_story_change');
  check('db: timeline flag ignored', byId['fl-timeline']?.status === 'ignored' && byId['fl-timeline']?.resolved_action === 'ignore');

  for (const d of [fx.userData, fx.vaultDir, fx.notesVaultDir]) fs.rmSync(d, { recursive: true, force: true });

  // Distinctness — the SKY-10504 failure mode was four identical screenshots.
  const tabShots = ['app-references', 'app-notes', 'app-scenes', 'app-continuity'];
  const hashes = tabShots.map((n) => crypto.createHash('sha1').update(fs.readFileSync(`${OUT}/${n}.png`)).digest('hex'));
  check('captures: 4 app tab shots are pairwise distinct', new Set(hashes).size === tabShots.length,
    tabShots.map((n, i) => `${n}=${hashes[i].slice(0, 8)}`).join(' '));
}

// ── side-by-sides ────────────────────────────────────────────────────────────
if (doMontage) {
  const pairs = [
    ['references', 'proto-references.png', 'app-references.png'],
    ['notes', 'proto-notes.png', 'app-notes.png'],
    ['scenes', 'proto-scenes.png', 'app-scenes.png'],
    ['continuity', 'proto-continuity.png', 'app-continuity.png'],
  ];
  const browser = await chromium.launch(chromiumLaunchOptions());
  const page = await browser.newPage({ viewport: { width: 900, height: 1180 } });
  for (const [name, protoPng, appPng] of pairs) {
    const p1 = path.join(OUT, protoPng), p2 = path.join(OUT, appPng);
    if (!fs.existsSync(p1) || !fs.existsSync(p2)) { check(`sxs: ${name}`, false, 'missing input'); continue; }
    const b64 = (f) => fs.readFileSync(f).toString('base64');
    await page.setContent(`<!doctype html><body style="margin:0;background:#0b0e14;font-family:system-ui;color:#e8eefc">
      <div style="display:flex;gap:20px;padding:20px;justify-content:center">
        <figure style="margin:0"><figcaption style="text-align:center;padding:6px;font-size:14px">PROTOTYPE</figcaption>
          <img src="data:image/png;base64,${b64(p1)}" style="width:400px;border:1px solid #333"></figure>
        <figure style="margin:0"><figcaption style="text-align:center;padding:6px;font-size:14px">APP</figcaption>
          <img src="data:image/png;base64,${b64(p2)}" style="width:400px;border:1px solid #333"></figure>
      </div></body>`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/sxs-${name}.png`, fullPage: true });
    check(`sxs: ${name}`, true);
  }
  await browser.close();
}

fs.writeFileSync(`${OUT}/verify.json`, JSON.stringify(checks, null, 2));
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed → ${OUT}`);
if (failed.length) { console.log('FAILED: ' + failed.map((f) => f.name).join(' | ')); process.exitCode = 1; }
console.log('DONE');
