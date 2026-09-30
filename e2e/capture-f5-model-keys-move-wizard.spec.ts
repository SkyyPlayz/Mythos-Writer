/**
 * F5#3 verify + capture — Models & Keys → Move vault… opens MoveVaultWizard.
 *
 * Real Electron app (not HTML fixtures). Done-when:
 *   - Settings › Model & keys shows Hands & files / mk-keys-files
 *   - Clicking "Move vault…" opens dialog aria-label "Move vault to a different folder"
 *   - 1440×900 screenshot written to agent-store media/beta-f5/
 *
 * Not part of CI path filter by design (capture-*); run manually after build:
 *   npx playwright test e2e/capture-f5-model-keys-move-wizard.spec.ts --reporter=list
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

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = '/cursor/stores/bc-fb92daf9-4bac-4b89-898c-bb6f10dab5c7/media/beta-f5';
const NOW = '2026-09-29T16:00:00.000Z';
const MYTHOS_NAME = 'F5 Move Wizard Vault';
const STORY_ID = 'story-f5-mk-move';
const STORY_TITLE = 'Glass Tide';

function seedV2Vault(bundle: string): { storyVault: string; notesVault: string } {
  const storyVault = path.join(bundle, 'Story Vault');
  const notesVault = path.join(bundle, 'Notes Vault');
  const agentVault = path.join(bundle, 'Agent Vault');
  const storyDir = path.join(storyVault, STORY_TITLE);
  const chapterDir = path.join(storyDir, 'Part 1', 'Chapter 01');
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.mkdirSync(notesVault, { recursive: true });
  fs.mkdirSync(agentVault, { recursive: true });
  for (const f of ['partner.md', 'writer.md', 'analyst.md', 'archivist.md']) {
    fs.writeFileSync(path.join(agentVault, f), `# ${f}\n`);
  }

  fs.writeFileSync(
    path.join(bundle, 'mythos.json'),
    JSON.stringify({
      formatVersion: 2,
      id: 'vault-f5-mk-move',
      name: MYTHOS_NAME,
      createdAt: NOW,
      stories: [
        { id: STORY_ID, title: STORY_TITLE, folder: STORY_TITLE, createdAt: NOW, updatedAt: NOW },
      ],
      seed: { layout: 'veynn-v2', mode: 'blank', seededAt: NOW },
    }, null, 2),
  );

  const spine = [
    { dir: 'Part 1', chapters: [{ dir: 'Chapter 01', id: 'ch-f5-mk-1', title: 'Chapter One' }] },
  ];
  fs.writeFileSync(
    path.join(storyDir, 'book.md'),
    [
      '---',
      `id: ${STORY_ID}`,
      `title: ${STORY_TITLE}`,
      `createdAt: ${NOW}`,
      `updatedAt: ${NOW}`,
      '---',
      `# ${STORY_TITLE}`,
      '',
      '## Part 1',
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
    `---\nid: scene-f5-mk-1\ntitle: The Gate\nstatus: draft\nupdatedAt: ${NOW}\n---\nProse.\n`,
  );
  return { storyVault, notesVault };
}

function seedUserData(userData: string, storyVault: string, notesVault: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({
      onboardingComplete: true,
      theme: 'dark',
      ai: { enabled: true },
      rightSidebarVisible: true,
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({
      vaultRoot: storyVault,
      notesVaultRoot: notesVault,
      recentProjects: [
        { name: MYTHOS_NAME, vaultRoot: storyVault, notesVaultRoot: notesVault, openedAt: NOW },
      ],
    }, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', '--force-prefers-reduced-motion', ...extraArgs],
    timeout: 60_000,
  });
}

test('F5#3: Move vault… from Model & keys opens MoveVaultWizard', async () => {
  test.setTimeout(180_000);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-f5-mk-move-'));
  const userData = path.join(tempRoot, 'userData');
  const bundle = path.join(tempRoot, 'bundle');
  const { storyVault, notesVault } = seedV2Vault(bundle);
  seedUserData(userData, storyVault, notesVault);

  const app = await launchApp(userData);
  const page: Page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });

  // Dismiss first-run overlays
  for (const label of ['Not now', 'Dismiss', 'Got it', 'Skip']) {
    const b = page.locator(`button:has-text("${label}")`).first();
    if (await b.isVisible({ timeout: 400 }).catch(() => false)) {
      await b.click().catch(() => {});
    }
  }
  await page.keyboard.press('Escape').catch(() => {});

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('.settings-title')).toBeVisible({ timeout: 8_000 });
  await page.locator('[data-testid="settings-cat-agents"]').click();

  await expect(page.locator('[data-testid="mk-keys-files"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="mk-keys-move"]')).toHaveText(/Move vault/);
  await expect(page.locator('[data-testid="mk-keys-move-hint"]')).toContainText(
    'Keys and memory move with the vault',
  );

  await page.locator('[data-testid="mk-keys-move"]').click();
  const wizard = page.getByRole('dialog', { name: 'Move vault to a different folder' });
  await expect(wizard).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('[data-testid="mv-browse"]')).toBeVisible();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const shotPath = path.join(OUT_DIR, 'f5-model-keys-move-wizard-1440x900.png');
  await page.screenshot({ path: shotPath, fullPage: false });
  expect(fs.existsSync(shotPath)).toBe(true);

  await app.close().catch(() => undefined);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
