/**
 * capture-sky-11212-screenshot.spec.ts — SKY-11212 PR evidence (not part of CI)
 *
 * One-off Playwright script to capture a real-app screenshot of the Scene
 * Crafter LOCATIONS/CHARACTERS/ITEMS & SYSTEMS `+` picker fix: the picker
 * used to offer every vault note regardless of category (owner's repro
 * screenshot showed the LOCATIONS picker listing "Kael Thorne", "Mira
 * Veynn", "The Broker", "Project Bible", "The Council" — none of them
 * locations). It now starts from the column's own category, and a note's
 * category is its tag signal (character/location/item) when it has one,
 * falling back to its top-level folder otherwise (tag overrides folder).
 *
 * The seeded vault reproduces the owner's exact repro shape plus two
 * tag-vs-folder conflicts to demonstrate the deeper fix (tag priority, not
 * just folder restriction):
 *   - Characters/Kael Thorne.md, Characters/Mira Veynn.md,
 *     Characters/The Broker.md — plain character notes (folder signal only).
 *   - Notes/Project Bible.md, Notes/The Council.md — misc notes, no
 *     category at all.
 *   - Locations/The Undercity.md, Locations/The Sunken Gate.md — plain
 *     location notes (folder signal only).
 *   - Characters/Hidden Harbor.md — filed under Characters/ but tagged
 *     `location` in frontmatter: tag wins, so it must classify LOCATIONS.
 *   - Locations/Ashfall Docks.md — filed under Locations/ but tagged
 *     `character` in frontmatter: tag wins, so it must classify CHARACTERS.
 *   - Items & Systems/Drownlight.md — plain item/system note.
 *
 * The scene removes "The Sunken Gate" from the LOCATIONS column first (the
 * un-remove path), then opens the `+` picker so it has something concrete to
 * offer back — proving the picker is restricted to the LOCATIONS category
 * (only "The Sunken Gate" is offered) rather than empty by coincidence.
 *
 * Output: pr-screenshots/sky-11212-scene-crafter-category-filter/*.png
 *
 * Run (after `npm run build:electron`):
 *   xvfb-run -a npx playwright test e2e/capture-sky-11212-screenshot.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-11212-scene-crafter-category-filter');

function ensureDir(d: string) {
  fs.mkdirSync(d, { recursive: true });
}

async function shot(page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }) {
  ensureDir(OUT_DIR);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), clip });
  console.log(`  wrote ${name}.png`);
}

async function applyTheme(page: Page) {
  await page.evaluate(() => {
    const bgApp = getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim() || '#0e1116';
    const textBody = getComputedStyle(document.documentElement).getPropertyValue('--text-body').trim() || '#bfd6e8';
    document.documentElement.style.backgroundColor = bgApp;
    document.body.style.backgroundColor = bgApp;
    document.body.style.color = textBody;
  }).catch(() => undefined);
  await page.waitForTimeout(300);
}

// Owner's exact repro names (PR body) plus two tag-vs-folder conflicts that
// demonstrate the deeper fix (tag priority over folder).
const NOTES: Array<[string, string]> = [
  ['Characters/Kael Thorne.md', '# Kael Thorne\n\nSmuggler — witty, guarded, survivor.\n'],
  ['Characters/Mira Veynn.md', '# Mira Veynn\n\nReluctant heir — resourceful, haunted.\n'],
  ['Characters/The Broker.md', '# The Broker\n\nAntagonist — elusive, always watching.\n'],
  ['Notes/Project Bible.md', '# Project Bible\n\nCanon facts, timelines, style guide.\n'],
  ['Notes/The Council.md', '# The Council\n\nRuling body of the Undercity — five seats.\n'],
  ['Locations/The Undercity.md', '# The Undercity\n\nDrowned streets, stacked walkways.\n'],
  ['Locations/The Sunken Gate.md', '# The Sunken Gate\n\nAncient floodgate. Opens at low tide.\n'],
  [
    'Characters/Hidden Harbor.md',
    '---\ntags: [location]\n---\n# Hidden Harbor\n\nA smugglers’ cove tucked behind the reef.\n',
  ],
  [
    'Locations/Ashfall Docks.md',
    '---\ntags: [character]\n---\n# Ashfall Docks\n\nDockhand who never left after the fire.\n',
  ],
  ['Items & Systems/Drownlight.md', '# Drownlight\n\nBurns underwater. Misbehaves near flame.\n'],
];

test('capture SKY-11212 Scene Crafter LOCATIONS picker screenshot', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11212-user-'));
  const storyVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11212-story-'));
  const notesVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11212-notes-'));

  for (const [rel, body] of NOTES) {
    const p = path.join(notesVault, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, theme: 'dark',
    gettingStartedDismissed: true, notesTabUpgradeToastShown: true, vaultUpgradePromptShown: true,
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: storyVault, notesVaultRoot: notesVault,
  }, null, 2));

  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });

  const page: Page = await app.firstWindow();
  page.on('dialog', (d) => void d.accept().catch(() => undefined));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await applyTheme(page);

  // Instant-create a story (SKY-9021/9896): File → New story, no prompt.
  const before = await page.locator('.nav-story-row').count();
  await page.locator('.wc-menu', { hasText: 'File' }).click();
  await page.locator('.wc-menu-item', { hasText: 'New story' }).click();
  await page.locator('.nav-story-row').nth(before).waitFor({ state: 'visible', timeout: 8_000 });
  await page.locator('.nav-story-title').nth(before).click();
  await page.waitForTimeout(500);

  // Scene Crafter rail item.
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
  await page.locator('.sc-columns').waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(700);

  const characters = page.getByTestId('sc-ref-col-characters');
  const locations = page.getByTestId('sc-ref-col-locations');
  const items = page.getByTestId('sc-ref-col-items');
  await expect(locations).toBeVisible({ timeout: 8_000 });

  // Sanity: tag-priority classification landed where the fix says it should
  // before we screenshot it — Hidden Harbor (Characters/ folder, `location`
  // tag) sits in LOCATIONS; Ashfall Docks (Locations/ folder, `character`
  // tag) sits in CHARACTERS.
  await expect(locations.getByText('Hidden Harbor')).toBeVisible({ timeout: 8_000 });
  await expect(characters.getByText('Ashfall Docks')).toBeVisible({ timeout: 8_000 });
  await expect(characters.getByText('Kael Thorne')).toBeVisible();
  await expect(characters.getByText('Mira Veynn')).toBeVisible();
  await expect(characters.getByText('The Broker')).toBeVisible();
  await expect(items.getByText('Drownlight')).toBeVisible();
  await expect(locations.getByText('Project Bible')).toHaveCount(0);
  await expect(locations.getByText('The Council')).toHaveCount(0);

  await shot(page, '1-vault-ref-columns-classified');

  // Remove "The Sunken Gate" from THIS scene's LOCATIONS column so the `+`
  // picker below has a real same-category note to offer back (the
  // un-remove path) instead of an empty state.
  await locations.getByRole('button', { name: 'Remove The Sunken Gate from this scene' }).click();
  await expect(locations.getByText('The Sunken Gate')).toHaveCount(0);

  // Open the LOCATIONS `+` picker — this is the fix under test.
  await locations.getByRole('button', { name: 'Add a note to LOCATIONS' }).click();
  await page.getByRole('textbox', { name: 'Search notes to add to LOCATIONS' }).waitFor({ state: 'visible', timeout: 5_000 });
  await page.waitForTimeout(300);

  // The picker offers only the removed same-category note, never a
  // character/misc note — this is the SKY-11212 regression the owner hit.
  await expect(locations.getByRole('button', { name: /the sunken gate/i })).toBeVisible();
  await expect(locations.getByRole('button', { name: /kael thorne/i })).toHaveCount(0);
  await expect(locations.getByRole('button', { name: /mira veynn/i })).toHaveCount(0);
  await expect(locations.getByRole('button', { name: /the broker/i })).toHaveCount(0);
  await expect(locations.getByRole('button', { name: /project bible/i })).toHaveCount(0);
  await expect(locations.getByRole('button', { name: /the council/i })).toHaveCount(0);
  await expect(locations.getByRole('button', { name: /drownlight/i })).toHaveCount(0);
  await expect(locations.getByRole('button', { name: /ashfall docks/i })).toHaveCount(0);

  // Full-window shot: all three columns, LOCATIONS picker open, CHARACTERS/
  // ITEMS & SYSTEMS columns visible alongside for context (proving those
  // notes are NOT what the LOCATIONS picker is offering).
  await shot(page, '2-locations-picker-category-filtered');

  // Tight crop over just the three vault-reference columns for a legible
  // PR-comment-sized image.
  const box = await characters.boundingBox();
  const itemsBox = await items.boundingBox();
  if (box && itemsBox) {
    const clip = {
      x: Math.max(0, box.x - 12),
      y: Math.max(0, box.y - 12),
      width: Math.min(1600 - box.x + 12, itemsBox.x + itemsBox.width - box.x + 24),
      height: 760,
    };
    await shot(page, '3-locations-picker-category-filtered-crop', clip);
  }

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(storyVault, { recursive: true, force: true });
  fs.rmSync(notesVault, { recursive: true, force: true });
});
