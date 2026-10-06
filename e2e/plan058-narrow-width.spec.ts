/**
 * PLAN-058 NW — narrow-width Notes / Brainstorm chrome (900 / 936–962 / 1024).
 *
 * NW-1: Agent composer + Send usable @900 (not ~70px clipped).
 * NW-2: Right-pane tab labels readable @900 (Props short label, no ellipsis crunch).
 * NW-3: PROPERTIES tab does not sit under Collapse @936–962 (hit-test, not bbox overlap).
 * NW-4: Saved left 500 @900/1024 — disk + rendered width stay 500; body may overflow (C3 floor).
 * NW-5: Soft-FAIL — no auto sidebar shrink to “fit” narrow window.
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
import { closeElectronApp, removeTempDirs } from './helpers/electronTeardown';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const MIN_COMPOSER_INPUT_PX = 120;
const WIDTHS_NW3 = [936, 940, 962] as const;

interface Fixture {
  userData: string;
  vaultDir: string;
  notesVaultDir: string;
}

function agentCfg(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    model: 'claude-haiku-4-5-20251001',
    autoApply: false,
    confidenceThreshold: 0.85,
    maxTokensPerHour: 100_000,
    maxSuggestionsPerHour: 50,
    heartbeatIntervalMinutes: 5,
    maxTokensPerDay: 500_000,
    ...extra,
  };
}

const nwTempDirs: string[] = [];

function seedFixture(opts: { notesSidebarWidth?: number } = {}): Fixture {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-nw-ud-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-nw-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-nw-notes-'));
  nwTempDirs.push(userData, vaultDir, notesVaultDir);

  const tabShell = {
    activeTab: 'notes',
    storySubView: 'editor',
    notesSubView: 'editor',
    storySidebarWidth: 240,
    notesSidebarWidth: opts.notesSidebarWidth ?? 268,
    storySidebarCollapsed: false,
    notesSidebarCollapsed: false,
  };

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(
      {
        apiKey: 'sk-ant-test-key-for-e2e',
        onboardingComplete: true,
        ai: { enabled: true },
        agents: {
          writingAssistant: { ...agentCfg({ enabled: false }), scanIntervalSeconds: 30 },
          brainstorm: agentCfg(),
          archive: {
            ...agentCfg({ enabled: false }),
            continuityCheckIntervalSeconds: 60,
          },
        },
        theme: 'dark',
        snapshots: { maxPerScene: 100, maxAgeDays: 30 },
        activeLayout: { leftSidebar: { panels: [] }, tabShell },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );

  fs.mkdirSync(path.join(notesVaultDir, 'Characters'), { recursive: true });
  fs.writeFileSync(
    path.join(notesVaultDir, 'Characters', 'NW.md'),
    '---\ntype: character\n---\n\n# NW\n',
  );

  const now = new Date().toISOString();
  const storyId = 'plan058-nw-story';
  const chapterId = 'plan058-nw-ch';
  const sceneId = 'plan058-nw-sc';
  const sceneDir = path.join(vaultDir, 'stories', storyId, 'chapters', chapterId, 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(path.join(sceneDir, `${sceneId}.md`), '---\ntitle: "NW"\n---\n\nHello.\n');
  fs.writeFileSync(
    path.join(vaultDir, 'manifest.json'),
    JSON.stringify({
      version: '1',
      vaultRoot: vaultDir,
      stories: [
        {
          id: storyId,
          title: 'NW Story',
          path: `stories/${storyId}`,
          createdAt: now,
          updatedAt: now,
          chapters: [
            {
              id: chapterId,
              title: 'Ch',
              storyId,
              order: 0,
              createdAt: now,
              updatedAt: now,
              scenes: [
                {
                  id: sceneId,
                  title: 'NW',
                  path: `stories/${storyId}/chapters/${chapterId}/scenes/${sceneId}.md`,
                  chapterId,
                  storyId,
                  order: 0,
                  draftState: 'in-progress',
                  createdAt: now,
                  updatedAt: now,
                  blocks: [],
                },
              ],
            },
          ],
        },
      ],
      entities: [],
      suggestions: [],
      scenes: [],
      chapters: [],
    }),
  );

  return { userData, vaultDir, notesVaultDir };
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const headlessArgs =
    process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...headlessArgs],
    timeout: 60_000,
  });
}

async function setContentSize(app: ElectronApplication, w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('no BrowserWindow');
    win.setContentSize(size.w, size.h);
  }, { w, h });
  await new Promise((r) => setTimeout(r, 250));
}

async function goNotesAgent(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Notes' })
    .click();
  await expect(page.locator('[data-testid="notes-tab-center"]')).toBeVisible({ timeout: 15_000 });
  const agentTab = page.locator('[data-testid="notes-right-tab-agent"]');
  if (await agentTab.isVisible().catch(() => false)) {
    await agentTab.click();
  }
  await expect(page.locator('[data-testid="notes-brainstorm-panel"]')).toBeVisible({
    timeout: 10_000,
  });
}

async function assertPropsCollapseHitTest(page: Page): Promise<void> {
  const hit = await page.evaluate(() => {
    const props = document.querySelector(
      '[data-testid="notes-right-tab-props"]',
    ) as HTMLElement | null;
    const collapse = document.querySelector(
      '[data-testid="notes-brainstorm-collapse"]',
    ) as HTMLElement | null;
    if (!props || !collapse) return { ok: false, reason: 'missing' };
    const pr = props.getBoundingClientRect();
    const cr = collapse.getBoundingClientRect();
    const centerProps = document.elementFromPoint(
      pr.left + pr.width / 2,
      pr.top + pr.height / 2,
    );
    const centerCollapse = document.elementFromPoint(
      cr.left + cr.width / 2,
      cr.top + cr.height / 2,
    );
    const propsHitOk = !!(centerProps && (centerProps === props || props.contains(centerProps)));
    const collapseHitOk = !!(
      centerCollapse && (centerCollapse === collapse || collapse.contains(centerCollapse))
    );
    return {
      ok: propsHitOk && collapseHitOk,
      propsHitOk,
      collapseHitOk,
      propsText: props.innerText,
    };
  });
  expect(hit.ok, `NW-3 hit-test @ width: ${JSON.stringify(hit)}`).toBe(true);
}

test.describe('PLAN-058 NW — narrow-width Notes chrome', () => {
  test.afterEach(() => {
    while (nwTempDirs.length > 0) {
      const dir = nwTempDirs.pop();
      if (!dir) continue;
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  });

  test('NW-1..NW-3 @900 / 936–962 / 1024: composer, tab labels, Properties vs Collapse', async () => {
    const fixture = seedFixture();
    let app: ElectronApplication | undefined;
    try {
      app = await launchApp(fixture.userData);
      const page = await app.firstWindow();
      page.on('dialog', (d) => void d.accept().catch(() => undefined));
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
      await goNotesAgent(page);

      for (const w of [900, 1024] as const) {
        await setContentSize(app, w, 900);
        const composer = await page.evaluate(() => {
          const input = document.querySelector(
            '.notes-tab-sidebar-right .brainstorm-input',
          ) as HTMLElement | null;
          const send = document.querySelector(
            '.notes-tab-sidebar-right .brainstorm-send-btn',
          ) as HTMLElement | null;
          const ir = input?.getBoundingClientRect();
          const sr = send?.getBoundingClientRect();
          const propsTab = document.querySelector('[data-testid="notes-right-tab-props"]');
          return {
            inputW: ir?.width ?? 0,
            sendW: sr?.width ?? 0,
            propsLabel: propsTab?.textContent?.trim() ?? '',
            propsInner: (propsTab as HTMLElement | null)?.innerText?.trim() ?? '',
          };
        });
        expect(composer.inputW, `NW-1 composer width @${w}`).toBeGreaterThanOrEqual(
          MIN_COMPOSER_INPUT_PX,
        );
        expect(composer.sendW, `NW-1 Send width @${w}`).toBeGreaterThan(40);
        if (w === 900) {
          expect(composer.propsInner, 'NW-2 short tab label @900').toMatch(/^props$/i);
        } else {
          expect(composer.propsInner, 'NW-2 full tab label @1024').toMatch(/^properties$/i);
        }
        await page.locator('[data-testid="notes-right-tab-props"]').click();
        await assertPropsCollapseHitTest(page);
        await page.locator('[data-testid="notes-right-tab-agent"]').click();
      }

      for (const w of WIDTHS_NW3) {
        await setContentSize(app, w, 900);
        await page.locator('[data-testid="notes-right-tab-props"]').click();
        const label = await page.locator('[data-testid="notes-right-tab-props"]').innerText();
        expect(label.trim(), `NW-2 full Properties @${w}`).toMatch(/^properties$/i);
        await assertPropsCollapseHitTest(page);
      }

      const shotPath = path.join(
        process.cwd(),
        'test-results',
        'plan058-nw-notes-900.png',
      );
      fs.mkdirSync(path.dirname(shotPath), { recursive: true });
      await page.screenshot({ path: shotPath, fullPage: false });
      expect(fs.existsSync(shotPath)).toBe(true);
    } finally {
      await closeElectronApp(app);
      removeTempDirs(fixture.userData, fixture.vaultDir, fixture.notesVaultDir);
    }
  });

  test('NW-4 / NW-5: saved left 500 @900 and @1024 — no sidebar shrink', async () => {
    const fixture = seedFixture({ notesSidebarWidth: 500 });
    let app: ElectronApplication | undefined;
    try {
      app = await launchApp(fixture.userData);
      const page = await app.firstWindow();
      page.on('dialog', (d) => void d.accept().catch(() => undefined));
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
      await goNotesAgent(page);

      for (const w of [900, 1024] as const) {
        await setContentSize(app, w, 900);
        const layout = await page.evaluate(() => {
          const left = document.querySelector('.notes-tab-sidebar-left');
          const body = document.querySelector('.notes-tab-body');
          return {
            leftW: left?.getBoundingClientRect().width ?? 0,
            bodyOverflow: body ? body.scrollWidth - body.clientWidth : 0,
          };
        });
        expect(Math.round(layout.leftW), `NW-4/NW-5 rendered left @${w}`).toBe(500);
        if (w === 900) {
          expect(layout.bodyOverflow, 'NW-4 C3 residual overflow @900').toBeGreaterThan(0);
        }

        const disk = JSON.parse(
          fs.readFileSync(path.join(fixture.userData, 'app-settings.json'), 'utf-8'),
        ) as { activeLayout?: { tabShell?: { notesSidebarWidth?: number } } };
        expect(disk.activeLayout?.tabShell?.notesSidebarWidth, `NW-5 disk @${w}`).toBe(500);
      }
    } finally {
      await closeElectronApp(app);
      removeTempDirs(fixture.userData, fixture.vaultDir, fixture.notesVaultDir);
    }
  });
});
