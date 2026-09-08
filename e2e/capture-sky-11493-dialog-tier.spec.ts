/**
 * capture-sky-11493-dialog-tier.spec.ts — SKY-11493 PR evidence (NOT part of CI)
 *
 * Opens the two destructive confirmations from the SKY-11480 OT-5 list through
 * ordinary UI, over live content, and screenshots them — plus the computed
 * fill / backdrop-filter of every OT-5 dialog it can reach, so the PR body can
 * cite measured values rather than inferred ones.
 *
 *   1-brainstorm-delete-confirm     BrainstormPage `.bs-delete-confirm-dialog`
 *   2-scene-history-restore-confirm SceneHistory `.history-confirm-dialog`
 *   3-idea-discard-confirm          IdeaDetailDrawer `.idd-discard-dialog` (if reached)
 *
 * Modeled on e2e/capture-sky-11450-overlay-tier.spec.ts (same seed/launch shape).
 *
 * Output: pr-screenshots/sky-11493-dialog-tier/<SHOT_PREFIX><name>.png
 *
 * Run (after `npm run build:electron`):
 *   SHOT_PREFIX=after- xvfb-run -a npx playwright test \
 *     e2e/capture-sky-11493-dialog-tier.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-11493-dialog-tier');
const PREFIX = process.env.SHOT_PREFIX ?? '';
const NOW = '2026-09-08T00:00:00.000Z';
const STORY_TITLE = 'Dialog Tier Story';
const SEED_PROSE = [
  'The lantern flickered once, casting long shadows across the stone floor.',
  'Mira counted the steps down into the cistern — forty-one, the same as the night before —',
  'and stopped where the water began. Something under the surface was glowing.',
].join(' ');

test.setTimeout(180_000);

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${PREFIX}${name}.png`) });
  console.log(`  wrote ${PREFIX}${name}.png`);
}

/** Computed chrome of the first match — what actually paints, not what the CSS says. */
async function chromeOf(page: Page, selector: string) {
  const result = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      background: cs.backgroundColor,
      backdropFilter: cs.backdropFilter || (cs as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter,
      border: `${cs.borderTopWidth} ${cs.borderTopColor}`,
      boxShadow: cs.boxShadow.slice(0, 120),
    };
  }, selector);
  console.log(`  chrome ${selector}: ${JSON.stringify(result)}`);
  return result;
}

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(
      {
        onboardingComplete: true,
        theme: 'dark',
        gettingStartedDismissed: true,
        // Brainstorm page renders its idea list only when the agent is enabled.
        // Nothing is ever sent — no prompt is submitted in this capture.
        apiKey: 'sk-ant-test-key-for-capture',
        agents: { brainstorm: { enabled: true, model: 'claude-haiku-4-5-20251001' } },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

function seedV2Vault(bundle: string): void {
  const storyDir = path.join(bundle, 'Story Vault', STORY_TITLE);
  const chapterDir = path.join(storyDir, 'Part 1', 'Chapter 01');
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.mkdirSync(path.join(bundle, 'Notes Vault'), { recursive: true });

  const spine = {
    parts: [
      {
        id: 'part-1',
        title: 'Part 1',
        chapters: [{ id: 'ch-1', title: 'Chapter One', scenes: [{ id: 'scene-dt-1', title: 'The Cistern' }] }],
      },
    ],
  };

  fs.writeFileSync(
    path.join(storyDir, 'Story.md'),
    [
      `---\nid: story-dt\ntitle: ${STORY_TITLE}\nupdatedAt: ${NOW}\n---`,
      '',
      '- [[Part 1/Chapter 01|Chapter One]]',
      '',
      '<!-- mythos:spine',
      JSON.stringify(spine),
      '-->',
      '',
    ].join('\n'),
  );

  fs.writeFileSync(
    path.join(chapterDir, 'Scene 01.md'),
    `---\nid: scene-dt-1\ntitle: The Cistern\nstatus: draft\nupdatedAt: ${NOW}\n---\n${SEED_PROSE}`,
  );
}

async function clickStorySection(pg: Page): Promise<void> {
  const nav = pg.locator('nav[aria-label="Main navigation"]');
  await expect(nav).toBeVisible({ timeout: 15_000 });
  const storyBtn = nav.getByRole('button', { name: /^story( writer)?$/i }).first();
  await expect(storyBtn).toBeVisible({ timeout: 10_000 });
  if ((await storyBtn.getAttribute('aria-current')) !== 'page') {
    await storyBtn.click();
  }
  const backdrop = pg.locator('[data-testid="nav-rail-stories-backdrop"]');
  if (await backdrop.count()) {
    await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    await expect(backdrop).toHaveCount(0);
  }
}

async function openManuscript(pg: Page): Promise<void> {
  await clickStorySection(pg);
  const cta = pg.locator('[data-testid="nav-empty-cta"]');
  if (await cta.isVisible().catch(() => false)) {
    await cta.click();
  }
  await expect(pg.locator('.nav-scene-row').first()).toBeVisible({ timeout: 20_000 });
  await pg.locator('.nav-scene-row').first().click();
  await expect(pg.locator('.ProseMirror').first()).toBeVisible({ timeout: 15_000 });
  await expect(pg.getByTestId('msv-title-menu-btn')).toBeVisible({ timeout: 10_000 });
}

test('capture SKY-11493 dialog tier screenshots', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-dialog-tier-shots-'));
  const userData = path.join(tmpRoot, 'user-data');
  const bundle = path.join(tmpRoot, 'Dialog Tier Vault');
  seedV2Vault(bundle);
  seedUserData(userData, path.join(bundle, 'Story Vault'), path.join(bundle, 'Notes Vault'));

  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    env: { ...process.env, MYTHOS_DISABLE_BOOT_MIGRATION: '1' },
    timeout: 60_000,
  });

  try {
    const page: Page = await app.firstWindow();
    page.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
    page.on('dialog', (d) => void d.accept().catch(() => undefined));
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1000);

    const theme = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const g = (n: string) => cs.getPropertyValue(n).trim();
      return {
        '--glass-fill': g('--glass-fill'), '--blur-panel': g('--blur-panel'),
        '--glass-fill-overlay': g('--glass-fill-overlay'), '--blur-panel-overlay': g('--blur-panel-overlay'),
        '--bg-elevated': g('--bg-elevated'),
      };
    });
    console.log('theme:', JSON.stringify(theme));

    // ── 2. Scene History → Restore → confirm (destructive #1) ─────────────
    await openManuscript(page);
    // A snapshot must exist before History has anything to restore.
    await page.getByTestId('msv-title-menu-btn').click();
    await page.getByTestId('msv-title-menu-snapshot').click();
    await page.waitForTimeout(600);
    await page.getByTestId('msv-title-menu-btn').click();
    await page.getByTestId('msv-title-menu-history').click();
    const history = page.locator('[role="dialog"][aria-label="Draft history"]');
    await expect(history).toBeVisible({ timeout: 10_000 });
    await expect(history.locator('.history-item-btn').first()).toBeVisible({ timeout: 10_000 });
    await history.locator('.history-item-btn').first().click();
    await history.getByRole('button', { name: /^Restore draft from/ }).click();
    await expect(page.locator('.history-confirm-dialog')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await shot(page, '2-scene-history-restore-confirm');
    await chromeOf(page, '.history-confirm-dialog');
    // Cancel, then close history.
    await page.locator('.history-confirm-actions button').first().click();
    await expect(page.locator('.history-confirm-dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close draft history' }).click();
    await expect(history).toHaveCount(0);

    // ── 1. Brainstorm → idea ⋮ → Delete → confirm (destructive #2) ────────
    await page.keyboard.press('Control+3');
    const panel = page.locator('#app-tabpanel-brainstorm');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(600);
    // Ctrl+N creates a loose idea and opens the detail drawer.
    await panel.click({ position: { x: 20, y: 20 } }).catch(() => undefined);
    await page.keyboard.press('Control+n');
    await page.waitForTimeout(700);

    // Detail drawer: type something, then Escape — the discard confirm is the
    // third OT-5 surface, so capture it when it shows up.
    const drawerInput = page.locator('.idd-drawer input, .idd-drawer textarea').first();
    if (await drawerInput.isVisible().catch(() => false)) {
      await drawerInput.fill('Glowing cistern water');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      if (await page.locator('.idd-discard-dialog').isVisible().catch(() => false)) {
        await shot(page, '3-idea-discard-confirm');
        await chromeOf(page, '.idd-discard-dialog');
        // Save → the idea persists as a card and the drawer closes.
        await page.locator('.idd-discard-dialog .idd-btn-accent').click();
        await page.waitForTimeout(300);
      }
    }
    // Close the drawer if it is still open (any close/done control).
    for (const name of [/^close/i, /^done/i, /^save/i]) {
      const btn = page.locator('.idd-drawer').getByRole('button', { name }).first();
      if (await btn.isVisible().catch(() => false)) { await btn.click(); break; }
    }
    await page.waitForTimeout(400);

    const card = page.locator('[data-testid^="idea-card-"]').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.hover();
    await card.locator('.idea-card-menu-button').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(page.locator('[data-testid="bs-delete-confirm"]')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await shot(page, '1-brainstorm-delete-confirm');
    await chromeOf(page, '.bs-delete-confirm-dialog');
    await page.locator('.bs-delete-confirm-cancel').click();
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
