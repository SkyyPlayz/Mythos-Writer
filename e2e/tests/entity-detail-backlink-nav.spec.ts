/**
 * entity-detail-backlink-nav.spec.ts — SKY-10926
 *
 * Reachability regression for the EntityDetail `onOpenEntity` prop.
 *
 * EntityDetail's "Connections" panel renders a per-relation backlink button
 * (`onClick={() => onOpenEntity?.(rel.target)}`, `disabled={!onOpenEntity}`)
 * — the same shape as the SKY-10915 dead-callback-prop bug: if no caller ever
 * passes `onOpenEntity`, the button is permanently disabled and the backlink
 * can never be clicked. DesktopShell now wires `onOpenEntity` to the same
 * `handleEntityMentionClick` navigation used by @-mention chips (SKY-616),
 * so clicking a backlink opens the target entity's own EntityDetail view via
 * the identical code path as any other "open this entity" action.
 *
 * This test seeds two entities on disk with a real typed relation between
 * them (Entity A → Entity B), opens Entity A's detail view via an @-mention
 * chip click (the existing, already-reachable path into EntityDetail), then
 * clicks the backlink to Entity B and asserts:
 *   - the backlink button is NOT disabled
 *   - EntityDetail now shows Entity B (name field flips to Entity B's name)
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

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');
const ENTITY_A_ID = 'ent_backlink_e2e_a';
const ENTITY_A_NAME = 'Corvin Blackwood';
const ENTITY_B_ID = 'ent_backlink_e2e_b';
const ENTITY_B_NAME = 'Selene Marrow';
const ENTITY_TYPE = 'character';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: false, model: 'claude-sonnet-4-6', autoApply: false,
        confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };

  const vaultSettings = {
    vaultRoot: vaultDir,
    notesVaultRoot: notesVaultDir,
  };

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(appSettings, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify(vaultSettings, null, 2),
  );
}

/**
 * Pre-seed two entities in the story vault, with a typed `relations:`
 * frontmatter block on Entity A pointing at Entity B — the same "Connections"
 * data shape the Archive agent writes (see electron-main/src/entityRelations.ts
 * serializeRelations/parseRelationsBlock). Entities live in vaultRoot, not the
 * notes vault; reindexEntities() picks up untracked .md files on entity:list.
 */
function seedEntities(storyVaultDir: string): void {
  const now = new Date().toISOString();
  const dir = path.join(storyVaultDir, 'entities', `${ENTITY_TYPE}s`);
  fs.mkdirSync(dir, { recursive: true });

  const entityA = [
    '---',
    `id: ${ENTITY_A_ID}`,
    `name: ${ENTITY_A_NAME}`,
    `type: ${ENTITY_TYPE}`,
    `createdAt: ${now}`,
    `updatedAt: ${now}`,
    'relations:',
    '  - type: ally of',
    `    target: ${ENTITY_B_ID}`,
    '---',
    '',
    'A weathered mercenary captain.',
  ].join('\n');
  fs.writeFileSync(path.join(dir, `${ENTITY_A_ID}.md`), entityA);

  const entityB = [
    '---',
    `id: ${ENTITY_B_ID}`,
    `name: ${ENTITY_B_NAME}`,
    `type: ${ENTITY_TYPE}`,
    `createdAt: ${now}`,
    `updatedAt: ${now}`,
    '---',
    '',
    'A reclusive alchemist.',
  ].join('\n');
  fs.writeFileSync(path.join(dir, `${ENTITY_B_ID}.md`), entityB);
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
  const proc = app.process();
  proc.stdout?.on('data', (d: Buffer) => console.log('[main:out]', d.toString().trimEnd()));
  proc.stderr?.on('data', (d: Buffer) => console.log('[main:err]', d.toString().trimEnd()));
  return app;
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  pg.on('console', (m) => console.log('[renderer:' + m.type() + ']', m.text()));
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

function findMdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findMdFiles(full));
    else if (entry.name.endsWith('.md')) results.push(full);
  }
  return results;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 10_000, intervalMs = 150): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// ─── Suite-level state ────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-backlink-nav-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-backlink-nav-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-backlink-nav-notes-'));

  seedUserData(userData, vaultDir, notesVaultDir);
  seedEntities(vaultDir);

  app = await launchApp(userData);
  page = await firstWindow(app);
});

test.afterAll(async () => {
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

test('SKY-10926: clicking a Connections backlink navigates EntityDetail to the target entity', async () => {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Create a story/chapter/scene so we have a prose editor to insert an
  // @-mention chip into (M3 instant-create: one click scaffolds all three).
  const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();

  await page.locator('.lr-nav-add').first().click();
  const sceneRow = page.locator('.nav-scene-row').first();
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.click();

  // Open Entity A's EntityDetail view via the @-mention chip click path
  // (SKY-616, handleEntityMentionClick) — an already-reachable route into
  // the standalone EntityDetail surface (DesktopShell's `selectedEntity`
  // branch), independent of the onOpenEntity wiring under test.
  // Type only the first word of the query — the mention picker's query
  // terminates on whitespace (see entity-mention.spec.ts EM-02, which
  // filters on the seeded entity's first name only), so typing the full
  // "Corvin Blackwood" would close the picker before the selection click.
  await editor.type('Met with @Corvin');
  const picker = page.locator('.entity-mention-picker');
  await expect(picker).toBeVisible({ timeout: 8_000 });
  await picker.locator('.entity-mention-picker-item').first().dispatchEvent('mousedown');

  const chip = page.locator('.entity-mention-chip');
  await expect(chip).toBeVisible({ timeout: 4_000 });

  // Wait for the scene's debounced autosave to flush to disk before
  // navigating away. Clicking the chip immediately after inserting it
  // unmounts the scene editor mid-debounce; its stale "flush on unmount"
  // callback would otherwise resurrect the just-cleared `selectedScene`
  // state a moment later and bounce the view back to the scene (unrelated
  // to the onOpenEntity wiring under test — see BlockEditor/RichTextEditor's
  // debounced onBlocksChange flush-on-unmount).
  const mentionMarker = `(entity://${ENTITY_A_ID})`;
  const savedInFile = await waitUntil(() => {
    const files = findMdFiles(vaultDir);
    return files.some((f) => {
      try { return fs.readFileSync(f, 'utf-8').includes(mentionMarker); } catch { return false; }
    });
  }, 15_000);
  expect(savedInFile, `Mention "${mentionMarker}" not found in any vault .md file`).toBe(true);

  await chip.click();

  const detail = page.locator('.entity-detail');
  await expect(detail).toBeVisible({ timeout: 8_000 });
  await expect(detail.locator('.entity-det-input').first()).toHaveValue(ENTITY_A_NAME, { timeout: 6_000 });

  // The "Connections" panel lists the typed relation to Entity B as a
  // backlink button. It must be enabled (not the SKY-10915 dead-prop shape).
  const backlinkBtn = detail.locator('.entity-det-backlink-scene', { hasText: ENTITY_B_NAME });
  await expect(backlinkBtn).toBeVisible({ timeout: 6_000 });
  await expect(backlinkBtn).toBeEnabled();

  await backlinkBtn.click();

  // EntityDetail now shows Entity B — proves onOpenEntity actually navigated.
  await expect(detail.locator('.entity-det-input').first()).toHaveValue(ENTITY_B_NAME, { timeout: 6_000 });
});
