/**
 * story-tab-subview.spec.ts — SKY-2095, SKY-9019
 *
 * E2E tests for Story tab sub-view bar: defaults, switching, and round-trip persistence.
 *
 *   AC-SV-01  Story tab is active by default on launch
 *   AC-SV-02  Sub-view bar is visible inside the Story tab
 *   AC-SV-03  Default sub-view is Editor (aria-selected=true); exactly four tabs in strip
 *   AC-SV-04  Clicking Scene Crafter RAIL item switches to kanban view; sub-view bar hidden
 *             (SKY-9019/M5: Scene Crafter is a rail destination, no longer a sub-tab)
 *   AC-SV-05  Story Writer rail click after a Notes round-trip lands on the
 *             editor (Beta 4 M3 — Scene Crafter has its own rail module now)
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
import { clickStoryNav } from './helpers/navGuard';
import { confirmNewStoryModalIfOpen } from './helpers/newStoryModal';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

function baseSettings() {
  return {
    apiKey: 'sk-ant-test-key-for-e2e',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: false,
        model: 'claude-sonnet-4-6',
        scanIntervalSeconds: 30,
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: false,
        model: 'claude-haiku-4-5-20251001',
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: false,
        model: 'claude-sonnet-4-6',
        continuityCheckIntervalSeconds: 60,
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
}

function seedUserData(userData: string, vaultDir: string): void {
  const appSettings = baseSettings();
  const vaultSettings = { vaultRoot: vaultDir };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined); });
  await page.waitForLoadState('domcontentloaded');
  return page;
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-subview-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-subview-vault-'));
  seedUserData(userData, vaultDir);

  app = await launchApp(userData);
  page = await firstWindow(app);
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
});

test.afterAll(async () => {
  const proc = app?.process();
  await Promise.race([
    app?.close().catch(() => undefined),
    new Promise<void>((r) => setTimeout(r, 5_000)),
  ]);
  try { if (proc && !proc.killed) proc.kill('SIGKILL'); } catch { /* already exited */ }
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});

// ─── AC-SV-01: Story tab active by default ───────────────────────────────────

test('AC-SV-01: Story tab is active by default', async () => {
  const storyTab = page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"]');
  await expect(storyTab).toBeVisible({ timeout: 10_000 });
  await expect(storyTab).toHaveAttribute('aria-current', 'page');
});

// ─── AC-SV-02: Sub-view bar visible in Story tab ─────────────────────────────

test('AC-SV-02: Story sub-view bar is visible', async () => {
  const bar = page.locator('[data-testid="story-subview-bar"]');
  await expect(bar).toBeVisible({ timeout: 5_000 });
});

// ─── AC-SV-03: Default sub-view is Editor; Editor · Book · Structure ─────────
// Slice B: Coach removed from the strip (Coach = Writer hand on the partner).

test('AC-SV-03: Editor sub-view is selected by default; strip has exactly three tabs', async () => {
  const editorTab = page.locator('[data-testid="story-subview-editor"]');
  await expect(editorTab).toBeVisible({ timeout: 5_000 });
  await expect(editorTab).toHaveAttribute('aria-selected', 'true');

  const allTabs = page.locator('[data-testid="story-subview-bar"] [role="tab"]');
  await expect(allTabs).toHaveCount(3);
  await expect(page.locator('[data-testid="story-subview-book"]')).toBeVisible();
  await expect(page.locator('[data-testid="story-subview-structure"]')).toBeVisible();
  await expect(page.locator('[data-testid="story-subview-coach"]')).toHaveCount(0);

  // Scene Crafter and Timeline must NOT be in the sub-tab strip (rail only).
  await expect(page.locator('[data-testid="story-subview-kanban"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="story-subview-timeline"]')).toHaveCount(0);
});

// ─── AC-SV-04: Scene Crafter rail item switches to kanban; sub-view bar hidden ──
// SKY-9019/M5: Scene Crafter is a standalone rail destination.
// Clicking it navigates to the kanban canvas; the story sub-view bar is hidden
// because kanban has no sub-tabs of its own.

test('AC-SV-04: clicking Scene Crafter RAIL item switches to kanban; sub-view bar hidden', async () => {
  const nav = page.locator('nav[aria-label="Main navigation"]');
  const sceneCrafterRailBtn = nav.locator('button[aria-label="Scene Crafter"]');
  await expect(sceneCrafterRailBtn).toBeVisible({ timeout: 5_000 });
  await sceneCrafterRailBtn.click();

  // Kanban content renders.
  await expect(page.locator('.shell-kanban')).toBeVisible({ timeout: 5_000 });

  // Sub-view bar is hidden when on a rail-only destination.
  await expect(page.locator('[data-testid="story-subview-bar"]')).not.toBeVisible({ timeout: 3_000 });
});

// ─── AC-SV-05: Story Writer rail click lands on the editor (Beta 4 M3) ───────
// Scene Crafter has its own rail module now (BETA-REFINE M3 / FULL-SPEC §4),
// so clicking the Story Writer rail item after a Notes round-trip lands on
// the EDITOR sub-view — kanban no longer piggybacks on the Story restore.

test('AC-SV-05: Story Writer rail click lands on the editor after a Notes round-trip', async () => {
  // Precondition: Scene Crafter should be active from AC-SV-04; confirm kanban content visible.
  await expect(page.locator('.shell-kanban')).toBeVisible({ timeout: 3_000 });

  // Switch to Notes tab.
  const notesTab = page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]');
  await notesTab.click();
  await expect(notesTab).toHaveAttribute('aria-current', 'page', { timeout: 3_000 });

  // Story sub-view bar should be gone while Notes tab is active.
  const bar = page.locator('[data-testid="story-subview-bar"]');
  await expect(bar).not.toBeVisible({ timeout: 2_000 });

  // Switch back via the Story Writer rail item.
  const storyTab = page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"]');
  await clickStoryNav(page);
  await expect(storyTab).toHaveAttribute('aria-current', 'page', { timeout: 3_000 });

  // Story Writer is the editor module — the editor sub-view is selected and bar is visible.
  await expect(bar).toBeVisible({ timeout: 3_000 });
  const editorTab = page.locator('[data-testid="story-subview-editor"]');
  await expect(editorTab).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });
});

// ─── F1 gate tests (moved from f1-beta-gate → e2e-shard-1 / test:e2e:story-tab-subview) ───
// STALE from shard move: original f1-beta-gate always File→New story before
// touching msv-*. App repro on tip 999cfb79: no story → msv-root/toolbar/add-chapter
// count 0; after New story → all 1. N1/H5 not implicated.

async function answerTextPrompt(p: Page, text: string): Promise<void> {
  const input = p.locator('.prompt-modal-input');
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill(text);
  await p.locator('.prompt-modal-ok').click();
}

/** Restore the original gate's createAndSelectStory → Story Writer path. */
async function ensureStoryManuscript(p: Page): Promise<void> {
  await clickStoryNav(p);
  if (await p.getByTestId('msv-toolbar').isVisible({ timeout: 1_500 }).catch(() => false)) return;
  await p.locator('.wc-menu', { hasText: 'File' }).click();
  await p.locator('.wc-menu-item', { hasText: 'New story' }).click();
  await confirmNewStoryModalIfOpen(p);
  await expect(p.locator('.nav-story-row').first()).toBeVisible({ timeout: 8_000 });
  await p.locator('.nav-story-title').first().click();
  await p.keyboard.press('Escape').catch(() => {});
  await clickStoryNav(p);
  await expect(p.getByTestId('msv-toolbar')).toBeVisible({ timeout: 10_000 });
}

test('F1#13: msv-toolbar computed height is 36px', async () => {
  test.skip(!fs.existsSync(MAIN_JS), 'needs build');
  await ensureStoryManuscript(page);
  const tb = page.getByTestId('msv-toolbar');
  await expect(tb).toBeVisible({ timeout: 10_000 });
  const h = await tb.evaluate((el) => Math.round(el.getBoundingClientRect().height));
  expect(h).toBe(36);
});

test('F1#10: dropcap gated off — ::first-letter float none when class absent', async () => {
  test.skip(!fs.existsSync(MAIN_JS), 'needs build');
  await ensureStoryManuscript(page);
  const root = page.getByTestId('msv-root');
  await expect(root).toBeVisible({ timeout: 10_000 });
  expect(await root.getAttribute('class')).not.toContain('msv-root--dropcap');
  await page.getByRole('button', { name: /^Scene$/i }).click().catch(() => {});
  await page.waitForTimeout(400);
  const editor = page.locator('.block-editor--chromeless .ProseMirror, .ProseMirror').first();
  if (await editor.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await editor.click();
    await page.keyboard.type('Once upon a time the gates closed.');
    await page.waitForTimeout(200);
    const float = await page.evaluate(() => {
      const p = document.querySelector('.msv-root:not(.msv-root--dropcap) .ProseMirror > p:first-child')
        ?? document.querySelector('.ProseMirror > p:first-child');
      return p ? getComputedStyle(p, '::first-letter').float : null;
    });
    expect(float).toBe('none');
  }
});

test('F1#9: + Chapter via in-app modal keeps order across reload', async () => {
  // Self-contained relaunch (own userData) — proves createChapter × editor-flush
  // race does not wipe chapters from nav or manifest.
  test.setTimeout(180_000);
  test.skip(!fs.existsSync(MAIN_JS), 'needs build');
  const ownUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-f1-9-'));
  const ownVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-f1-9-v-'));
  seedUserData(ownUserData, ownVault);

  let titlesBefore: string[] = [];
  {
    const ownApp = await launchApp(ownUserData);
    try {
      const p = await firstWindow(ownApp);
      await expect(p.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
      await p.locator('.wc-menu', { hasText: 'File' }).click();
      await p.locator('.wc-menu-item', { hasText: 'New story' }).click();
      await confirmNewStoryModalIfOpen(p);
      await expect(p.locator('.nav-story-row').first()).toBeVisible({ timeout: 8_000 });
      await p.locator('.nav-story-title').first().click();
      await p.keyboard.press('Escape').catch(() => {});
      await clickStoryNav(p);
      await expect(p.getByTestId('msv-toolbar')).toBeVisible({ timeout: 10_000 });

      // Type then add chapters quickly — the unmount flush must not wipe them.
      const editor = p.locator('.ProseMirror, [contenteditable="true"]').first();
      if (await editor.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await editor.click();
        await p.keyboard.type('Race seed prose.');
      }
      await p.getByTestId('msv-add-chapter').click();
      await answerTextPrompt(p, 'Chapter Alpha');
      await p.getByTestId('msv-add-chapter').click();
      await answerTextPrompt(p, 'Chapter Bravo');
      await p.getByTestId('msv-add-chapter').click();
      await answerTextPrompt(p, 'Chapter Charlie');
      await p.waitForTimeout(1200);

      titlesBefore = (await p.locator('.nav-chapter-title').allTextContents()).map((t) => t.trim()).filter(Boolean);
      expect(titlesBefore.filter((t) => /Alpha|Bravo|Charlie/.test(t))).toEqual(
        expect.arrayContaining(['Chapter Alpha', 'Chapter Bravo', 'Chapter Charlie']),
      );
      const idx = (name: string) => titlesBefore.findIndex((t) => t.includes(name));
      expect(idx('Alpha')).toBeLessThan(idx('Bravo'));
      expect(idx('Bravo')).toBeLessThan(idx('Charlie'));

      // Disk: manifest must list the three chapters in chrono order.
      await expect.poll(() => {
        try {
          const man = JSON.parse(fs.readFileSync(path.join(ownVault, 'manifest.json'), 'utf-8'));
          const story = man.stories?.[0];
          const ch = (story?.parts?.[0]?.chapters ?? story?.chapters ?? []) as Array<{ title?: string; order?: number }>;
          return ch
            .slice()
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map((c) => c.title ?? '')
            .filter((t) => /Alpha|Bravo|Charlie/.test(t));
        } catch {
          return [];
        }
      }).toEqual(['Chapter Alpha', 'Chapter Bravo', 'Chapter Charlie']);
    } finally {
      await ownApp.close();
    }
  }

  const ownApp2 = await launchApp(ownUserData);
  try {
    const p2 = await firstWindow(ownApp2);
    await expect(p2.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
    await clickStoryNav(p2);
    await expect(p2.locator('.nav-story-row').first()).toBeVisible({ timeout: 8_000 });
    await p2.locator('.nav-story-title').first().click();
    await p2.keyboard.press('Escape').catch(() => {});
    await expect(p2.locator('.nav-chapter-title').first()).toBeVisible({ timeout: 8_000 });
    const titlesAfter = (await p2.locator('.nav-chapter-title').allTextContents()).map((t) => t.trim()).filter(Boolean);
    expect(titlesAfter.filter((t) => /Alpha|Bravo|Charlie/.test(t))).toEqual(
      expect.arrayContaining(['Chapter Alpha', 'Chapter Bravo', 'Chapter Charlie']),
    );
    const idx = (name: string) => titlesAfter.findIndex((t) => t.includes(name));
    expect(idx('Alpha')).toBeLessThan(idx('Bravo'));
    expect(idx('Bravo')).toBeLessThan(idx('Charlie'));
  } finally {
    await ownApp2.close();
    fs.rmSync(ownUserData, { recursive: true, force: true });
    fs.rmSync(ownVault, { recursive: true, force: true });
  }
});

// ─── F1b gate (moved from e2e/f1b-verify → e2e-shard-1 / test:e2e:story-tab-subview) ───
// F4#6 live crumbs + F2#5 chrome containment. Multi-part part crumb stays
// PARTIAL (unit-only); this e2e proves StructuralBreadcrumb is mounted live.

test('F4#6: StructuralBreadcrumb live in msv-crumbs', async () => {
  test.skip(!fs.existsSync(MAIN_JS), 'needs build');
  await ensureStoryManuscript(page);
  const crumbs = page.getByTestId('msv-crumbs');
  await expect(crumbs).toBeVisible({ timeout: 10_000 });
  await expect(crumbs.getByTestId('struct-breadcrumb')).toBeVisible();
  await expect(crumbs.getByTestId('struct-breadcrumb-root')).toBeVisible();
  // Chapter depth shows a chapter crumb; part crumb for multi-part is unit-only.
  await expect(crumbs).toContainText(/Ch\.\s*\d+|Chapter/);
});

test('F2#5: sheet editables contain no nav/chrome nodes', async () => {
  test.skip(!fs.existsSync(MAIN_JS), 'needs build');
  await ensureStoryManuscript(page);
  const sheet = page.getByTestId('msv-sheet');
  if (!(await sheet.isVisible({ timeout: 1_500 }).catch(() => false))) {
    const zoom = page.getByTestId('msv-zoom-chapter');
    if (await zoom.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await zoom.click();
    }
  }
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  const leak = await page.evaluate(() => {
    const sheetEl = document.querySelector('[data-testid="msv-sheet"]');
    if (!sheetEl) return { ok: false, reason: 'no sheet' };
    const editables = sheetEl.querySelectorAll('[contenteditable="true"], .ProseMirror');
    const offenders: string[] = [];
    editables.forEach((el) => {
      if (
        el.querySelector(
          '[data-msv-chrome], .msv-crumbs, .msv-zoombar, .msv-toolbar, .struct-breadcrumb',
        )
      ) {
        offenders.push(el.getAttribute('data-testid') || el.className || el.tagName);
      }
      if (el.closest('[data-msv-chrome]')) offenders.push('editable-inside-chrome');
    });
    const crumbs = document.querySelector('[data-testid="msv-crumbs"]');
    const chromeOutside =
      !!document.querySelector('.msv-zoombar[data-msv-chrome="true"]') &&
      !!document.querySelector('.msv-toolbar[data-msv-chrome="true"]') &&
      !!crumbs &&
      !sheetEl.contains(crumbs);
    return {
      ok: offenders.length === 0 && chromeOutside && editables.length > 0,
      offenders,
      chromeOutside,
      editableCount: editables.length,
    };
  });
  expect(leak.ok, JSON.stringify(leak)).toBe(true);
});
