/**
 * note-template-picker-onCreated.spec.ts — SKY-10926
 *
 * TemplatePicker.tsx (frontend/src/TemplatePicker.tsx) — the "New note from
 * template" popover opened from StoryNavigator's blank-mode template CTA —
 * takes an optional `onCreated?: (path: string) => void` prop that fires
 * specifically when the user creates a brand-new custom note (as opposed to
 * `onApplied`, which fires on both create AND cancel-to-close paths). The
 * DesktopShell.tsx call site previously passed `onApplied`/`onClose` but not
 * `onCreated` — the callback was dead: nothing downstream was notified that
 * a new note had been created.
 *
 * The fix wires `onCreated` to two real, already-existing refresh/notify
 * mechanisms (DesktopShell.tsx, near the <TemplatePicker> call site):
 *   1. `checkGettingStartedItem('notes-vault')` — the same
 *      checklist-completion pattern EntityBrowser's onEntityCreated already
 *      uses for `add-character`. This is directly observable without any
 *      navigation: the Getting Started panel's "notes-vault" checklist item
 *      flips to done live, in place, right after template creation.
 *   2. A `notesRefreshSignal` counter threaded through NotesTabPanel into
 *      VaultBrowser (frontend/src/components/VaultBrowser/index.tsx), so an
 *      already-mounted Notes tree also refetches without a manual reload.
 *
 * TC-TP-01 below asserts (1): it is a true reachability test — without the
 * onCreated wiring, nothing else marks the 'notes-vault' checklist item done
 * when a note is created via the template picker, so the test fails if the
 * callback prop is dead.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright install chromium
 *   npx playwright test e2e/note-template-picker-onCreated.spec.ts --reporter=list
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

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Seed userData so the app boots directly into DesktopShell's editor view
 * with a fresh story, `onboardingStartMode: 'blank'` (so the StoryNavigator
 * template CTA — the only entry point into TemplatePicker — is visible), and
 * an untouched Getting Started checklist (so 'notes-vault' starts unchecked).
 */
function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    onboardingStartMode: 'blank',
    firstLaunchAt: Date.now(),
    gettingStartedProgress: { completedItems: [], dismissed: false },
    rightSidebarVisible: true,
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
    rightSidebarPanels: [{ id: 'scene-notes', collapsed: false }],
  };

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(appSettings, null, 2),
  );
  // layoutMode: 'blank' — otherwise electron-main/src/main.ts#getLayoutMode()
  // defaults to 'default' and scaffolds the standard Mythos vault folders
  // (Archive/Daily Notes/Inbox/Research/Stories/Universes/Templates) into
  // notesVaultDir on first boot, which would bury the reachability
  // assertions below in unrelated seeded content.
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir, layoutMode: 'blank' }, null, 2),
  );
}

/** Seed a minimal story → chapter → scene so the app has something to show. */
function seedMinimalVault(vaultDir: string): void {
  const storyId = 'test-story-01';
  const chapterId = 'test-chapter-01';
  const sceneId = 'test-scene-01';

  const storyDir = path.join(vaultDir, 'Manuscript', storyId, chapterId);
  fs.mkdirSync(storyDir, { recursive: true });

  const sceneContent = [
    '---',
    `id: ${sceneId}`,
    'title: Opening Scene',
    'order: 0',
    'draftState: in-progress',
    `createdAt: ${new Date().toISOString()}`,
    `updatedAt: ${new Date().toISOString()}`,
    '---',
    '',
    '<!-- BLOCKS_JSON',
    JSON.stringify([]),
    'END_BLOCKS_JSON -->',
  ].join('\n');

  fs.writeFileSync(path.join(storyDir, `${sceneId}.md`), sceneContent);

  const scenePath = `Manuscript/${storyId}/${chapterId}/${sceneId}.md`;
  const now = new Date(Date.now() - 5_000).toISOString();
  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    stories: [
      {
        id: storyId,
        title: 'Test Story',
        createdAt: now,
        updatedAt: now,
        chapters: [
          {
            id: chapterId,
            title: 'Chapter One',
            order: 0,
            path: `Manuscript/${storyId}/${chapterId}`,
            createdAt: now,
            updatedAt: now,
            scenes: [
              {
                id: sceneId,
                title: 'Opening Scene',
                path: scenePath,
                order: 0,
                draftState: 'in-progress',
                blocks: [],
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
        ],
      },
    ],
    scenes: [],
    entities: [],
    suggestions: [],
    chapters: [],
    provenance: {},
    boardReferences: [],
  };

  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
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
  const page = await app.firstWindow();
  page.on('console', (m) => console.log('[renderer:' + m.type() + ']', m.text()));
  page.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function waitForShell(page: Page): Promise<void> {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
}

// ─── TC-TP-01: TemplatePicker onCreated reachability ───────────────────────────

test.describe('TC-TP-01: TemplatePicker onCreated wiring', () => {
  let userData: string;
  let vaultDir: string;
  let notesVaultDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-tp01-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-tp01-vault-'));
    notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-tp01-notes-'));
    seedMinimalVault(vaultDir);
    seedUserData(userData, vaultDir, notesVaultDir);
    app = await launchApp(userData);
    page = await firstWindow(app);
    await waitForShell(page);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
    fs.rmSync(notesVaultDir, { recursive: true, force: true });
  });

  test('creating a note via the template picker checks off the Getting Started "notes-vault" item live, with no navigation or reload', async () => {
    // Baseline: blank-mode CTA is reachable, and the checklist item this
    // test cares about starts unchecked.
    const cta = page.locator('[data-testid="vs-template-cta"]');
    await expect(cta).toBeVisible({ timeout: 10_000 });

    const gsItem = page.locator('[data-testid="gs-item-notes-vault"]');
    await expect(gsItem).toBeVisible({ timeout: 10_000 });
    await expect(gsItem).toHaveAttribute('aria-checked', 'false');

    // Open TemplatePicker and create a brand-new blank note — the "create",
    // not "apply an existing template and bail" path (buildTemplateNote's
    // 'blank' template writes straight to the notes vault via writeNotesVault).
    await cta.click();
    await expect(page.locator('[data-testid="template-blank"]')).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="template-blank"]').click();
    await page.locator('[data-testid="tp-note-name"]').fill('SKY-10926 Reachability Note');
    await page.locator('[data-testid="tp-apply"]').click();

    // The picker closes on successful create (onApplied fires right after
    // onCreated in TemplatePicker.tsx's handleApply).
    await expect(page.locator('[data-testid="tp-apply"]')).not.toBeVisible({ timeout: 8_000 });

    // The reachability assertion: without any tab switch, panel reopen, or
    // app reload, the Getting Started panel's notes-vault item is now done.
    // This only happens if TemplatePicker's onCreated actually fired the
    // DesktopShell handler that calls checkGettingStartedItem('notes-vault') —
    // dead wiring would leave this item (and its aria-checked state) unchanged.
    await expect(gsItem).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 });
    await expect(gsItem).toHaveClass(/gs-item--done/);

    // Confirm the note actually landed on disk under the Notes Vault (sanity
    // check that we exercised the real create path, not a mocked one).
    // sanitizeVaultName (shared/vaultNameSanitizer.ts) preserves case and
    // whitespace verbatim — only OS-reserved characters are stripped — so
    // the file is named exactly after the typed note name.
    const files = fs.readdirSync(notesVaultDir).filter((f) => f.endsWith('.md'));
    expect(files).toContain('SKY-10926 Reachability Note.md');
  });

  test('the note is also visible in the Notes Editor tree without a manual reload', async () => {
    // Independently exercises the second half of the fix: VaultBrowser's
    // notesRefreshSignal. Navigating to the Notes Editor tab always mounts a
    // fresh VaultBrowser (which fetches on mount regardless of this signal),
    // so this is a softer regression guard — the file must be visible here
    // whether or not that particular wiring bump matters at this point in
    // the flow — but it confirms the create path didn't silently fail.
    await page.locator('button.nav-rail__item[aria-label="Notes Editor"]').click();
    await expect(page.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 8_000 });
    await expect(
      page.locator('.vb-name', { hasText: 'SKY-10926 Reachability Note' }),
    ).toBeVisible({ timeout: 8_000 });
  });
});
