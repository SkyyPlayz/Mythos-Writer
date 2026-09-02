/**
 * sky10604-ai-walkthrough.spec.ts — SKY-10604 (M11c), item 2.
 *
 * Both-state walkthrough of all six workspaces (AI master ON, then OFF,
 * against otherwise IDENTICAL fixtures — every per-agent enable stays true
 * in both). Per workspace the same table asserts:
 *
 *   - CORE layout: the workspace's non-AI landmarks are present and usable
 *     in BOTH states (the layout is identical minus AI elements — nothing
 *     collapses, no dead chrome, no missing panels), and
 *   - AI elements: present with the master ON, absent (count 0) with it
 *     OFF — the only thing allowed to differ between the two states.
 *
 * Each workspace is screenshotted in each state into the test-results
 * output dir (sky10604-<workspace>-<state>.png) — the side-by-side fidelity
 * evidence for the PR (P0.3).
 *
 * Run: npx playwright test e2e/tests/sky10604-ai-walkthrough.spec.ts --reporter=list
 */

import { test, expect, type ElectronApplication, type Page, type Locator } from '@playwright/test';
import { closeElectronApp } from '../helpers/electronTeardown';
import {
  createSuiteFixture,
  cleanupSuiteFixture,
  launchSuiteApp,
  firstSuiteWindow,
  goStoryWriter,
  goSceneCrafter,
  goNotesEditor,
  goBrainstorm,
  goTimeline,
  goVaultGraph,
  openSettingsDialog,
  closeSettingsDialog,
} from '../helpers/aiOffSuite';

interface WorkspaceCase {
  name: string;
  go: (page: Page) => Promise<void>;
  /** Non-AI landmarks — must be visible in BOTH states. */
  core: (page: Page) => Locator[];
  /** AI elements — visible with master ON, count 0 with master OFF. */
  ai: (page: Page) => Locator[];
}

const grs = (page: Page) => page.locator('[data-testid="global-right-sidebar"]');

const WORKSPACES: WorkspaceCase[] = [
  {
    name: 'story-writer',
    go: goStoryWriter,
    core: (page) => [
      page.locator('.ProseMirror').first(),
      grs(page).getByRole('tab', { name: 'Scenes' }),
    ],
    ai: (page) => [grs(page).getByRole('tab', { name: 'Assistant' })],
  },
  {
    name: 'scene-crafter',
    go: goSceneCrafter,
    // The SUGGESTED CARDS rail itself is manual-safe chrome: present in both
    // states, but credited to the Brainstorm Agent only while AI is on
    // (SKY-9878 contract) — asserted in the dedicated hint test below.
    core: (page) => [page.locator('.sc-suggest')],
    ai: () => [],
  },
  {
    name: 'notes-editor',
    // SKY-11228: Flags moved to its own sibling tab (no longer stacked above
    // the chat on Agent), so reach it explicitly to assert it still renders.
    go: async (page) => {
      await goNotesEditor(page);
      const flagsTab = page.locator('[data-testid="notes-right-tab-flags"]');
      if (await flagsTab.isVisible().catch(() => false)) {
        await flagsTab.click();
      }
    },
    core: (page) => [
      page.locator('[data-testid="notes-tab-center"]'),
      page.locator('[data-testid="notes-brainstorm-panel"]'),
    ],
    // R11: AI off drops the WHOLE right-panel tab strip (Properties-only
    // panel, no dead single-tab chrome) plus the continuity flags block.
    ai: (page) => [
      page.locator('.notes-right-tabs'),
      page.locator('[data-testid="notes-continuity-flags"]'),
    ],
  },
  {
    name: 'brainstorm',
    go: goBrainstorm,
    core: (page) => [page.locator('[data-testid="bs-collections"]')],
    // M11b: chat mode (and the chat/board mode switch) exist only with AI on.
    ai: (page) => [
      page.locator('[data-testid="bsc-mode-chat"]'),
      page.locator('.brainstorm-input'),
    ],
  },
  {
    name: 'timeline',
    go: goTimeline,
    core: (page) => [page.locator('[data-testid="timeline-root"]')],
    ai: (page) => [grs(page).getByRole('tab', { name: 'Assistant' })],
  },
  {
    name: 'vault-graph',
    go: goVaultGraph,
    core: (page) => [
      page.locator('#app-tabpanel-vault-graph'),
      page.locator('[data-testid="vault-graph-view"], .vgv-state').first(),
    ],
    ai: (page) => [grs(page).getByRole('tab', { name: 'Assistant' })],
  },
];

async function walkAndAssert(aiOn: boolean): Promise<void> {
  const fixture = createSuiteFixture(aiOn);
  let app: ElectronApplication | undefined;
  try {
    app = await launchSuiteApp(fixture.userData);
    const page = await firstSuiteWindow(app);

    for (const ws of WORKSPACES) {
      await ws.go(page);
      for (const core of ws.core(page)) {
        await expect(core, `${ws.name}: core layout must survive AI ${aiOn ? 'on' : 'off'}`)
          .toBeVisible({ timeout: 10_000 });
      }
      for (const ai of ws.ai(page)) {
        if (aiOn) {
          await expect(ai, `${ws.name}: AI element missing with master ON`).toBeVisible({ timeout: 10_000 });
        } else {
          await expect(ai, `${ws.name}: AI element leaked with master OFF`).toHaveCount(0);
        }
      }
      await page.screenshot({
        path: test.info().outputPath(`sky10604-${ws.name}-${aiOn ? 'ai-on' : 'ai-off'}.png`),
      });
    }

    // Settings is reachable and the master card reflects the state.
    await openSettingsDialog(page);
    await page.locator('[data-testid="settings-cat-agents"]').click();
    await expect(
      page.locator('.ai-master-card input[role="switch"][aria-label="AI features"]'),
    ).toHaveJSProperty('checked', aiOn);
    await page.screenshot({
      path: test.info().outputPath(`sky10604-settings-${aiOn ? 'ai-on' : 'ai-off'}.png`),
    });
    await closeSettingsDialog(page);
  } finally {
    await closeElectronApp(app);
    cleanupSuiteFixture(fixture);
  }
}

test('SKY-10604 walkthrough: AI ON — core layout + every AI element present per workspace', async () => {
  await walkAndAssert(true);
});

test('SKY-10604 walkthrough: AI OFF — layout identical minus AI elements per workspace', async () => {
  await walkAndAssert(false);
});

test('SKY-10604 walkthrough: Scene Crafter rail credit flips between agent and vault copy', async () => {
  // The rail is core chrome in both states; its CREDIT is the AI element.
  for (const aiOn of [true, false]) {
    const fixture = createSuiteFixture(aiOn);
    let app: ElectronApplication | undefined;
    try {
      app = await launchSuiteApp(fixture.userData);
      const page = await firstSuiteWindow(app);
      await goStoryWriter(page);
      await goSceneCrafter(page);
      const hint = page.locator('.sc-suggest-hint');
      if (aiOn) {
        await expect(hint).toContainText('the Brainstorm Agent keeps this list stocked from your vault.');
      } else {
        await expect(hint).toContainText('this list is drawn straight from your Notes Vault.');
        await expect(hint).not.toContainText('Brainstorm Agent');
      }
    } finally {
      await closeElectronApp(app);
      cleanupSuiteFixture(fixture);
    }
  }
});
