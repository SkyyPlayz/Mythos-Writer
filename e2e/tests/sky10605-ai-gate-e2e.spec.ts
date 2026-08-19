/**
 * sky10605-ai-gate-e2e.spec.ts — SKY-10605 (M11c Tests line, child of SKY-10577)
 *
 * PLAN.md §M11 Tests line: "E2E both-state walkthrough per workspace; settings
 * persistence across restart; network-silence assert; agent-comment
 * hide/restore round-trip." This spec covers the first three; the
 * agent-comment round-trip is blocked on the comments-gutter fix from the
 * same SKY-9025 audit and is explicitly out of scope here.
 *
 *   1. Network silence — with `ai.enabled: false` on disk (and every
 *      per-agent enable TRUE plus a syntactically-real API key, so a leaky
 *      gate would actually fire), walk every workspace (Story Writer editor,
 *      Notes, Scene Crafter, Brainstorm, Timeline) while intercepting all
 *      http(s) requests from the app's windows and assert ZERO reach any AI
 *      provider host. A canary fetch at the end proves the recorder is live
 *      (the assert is not vacuous). Nothing is allowlisted: the accepted
 *      M11b carve-out — `electron-main/src/voice.ts` calls api.openai.com
 *      for Dictate (STT) / Read (TTS) ungated — never fires because this
 *      walkthrough deliberately avoids the Dictate/Read buttons.
 *      Scope: page.route sees the RENDERER's network stack (the window CSP
 *      permits direct connect-src to api.anthropic.com / api.openai.com, so
 *      this surface is real). Main-process egress is gated by aiMasterGate
 *      before any provider call — covered at unit level by
 *      electron-main/src/aiMasterGate.test.ts.
 *   2. Off→on round-trip — boot AI-off, confirm AI surfaces are gone, then
 *      flip the REAL Settings → AI features switch (not the fixture file)
 *      and assert the surfaces return WITH prior agent content intact: a
 *      pre-seeded Brainstorm session transcript (Sessions/*.md in the Notes
 *      Vault) reappears in chat byte-identical on disk — the gate is
 *      display-only, nothing is deleted or regenerated.
 *   3. Restart persistence — boot AI-on, flip the real switch off, relaunch
 *      against the SAME userData dir (two-vault-firstrun TC-SK9-02 pattern)
 *      and assert `ai.enabled: false` survived — both in a fresh
 *      app-settings.json read and in the relaunched UI (Assistant tab gone,
 *      switch unchecked, manual-mode note shown).
 *
 * Real end-to-end path throughout: renderer boots against a real
 * `app-settings.json`, reads it via the real `settingsGet` IPC round trip
 * (no `window.api` seam stubbed) through `useAiEnabled`. Fixture + helpers
 * adapted from sky10507-ai-precedence.spec.ts.
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
import { clickStoryNav } from '../helpers/navGuard';

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');
const STORY_TITLE = 'AI Gate Fixture';

// Known first-party AI/LLM API hosts. Matched by exact hostname or any
// subdomain — one of these appearing in the recorded traffic fails the test.
const AI_PROVIDER_HOSTS = [
  'anthropic.com',
  'openai.com',
  'openrouter.ai',
  'generativelanguage.googleapis.com',
  'aiplatform.googleapis.com',
  'openai.azure.com',
  'mistral.ai',
  'cohere.com',
  'cohere.ai',
  'groq.com',
  'together.xyz',
  'deepseek.com',
  'x.ai',
  'perplexity.ai',
];

function isAiProviderUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return AI_PROVIDER_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}

// Distinctive markers proving the round-trip shows the PRIOR transcript, not
// a regenerated one (no LLM runs in these tests, so these can't be produced
// any other way).
const SESSION_USER_MARKER = 'marker-SKY10605-user: what if the keeper is the ghost?';
const SESSION_AGENT_MARKER = 'marker-SKY10605-agent: she drowned decades before the light failed.';
const SESSION_FILE_NAME = '2026-08-01 brainstorm sky10605b.md';

interface Fixture {
  userData: string;
  vaultDir: string;
  notesVaultDir: string;
}

function agentCfg(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85,
    maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5,
    maxTokensPerDay: 500_000, ...extra,
  };
}

/** A parseable Sessions/*.md brainstorm transcript (mythosFormat/agentSessions.ts). */
function sessionFileContent(): string {
  return [
    '---',
    'mythosSession: 1',
    'id: sky10605-brainstorm-session',
    'agent: brainstorm',
    'title: Lighthouse twist',
    'startedAt: 2026-08-01T10:00:00.000Z',
    'updatedAt: 2026-08-01T10:05:00.000Z',
    'turns: 2',
    '---',
    '',
    '# Lighthouse twist',
    '',
    '<!-- mythos:turn user 2026-08-01T10:00:00.000Z -->',
    '**You:**',
    '',
    SESSION_USER_MARKER,
    '<!-- /mythos:turn -->',
    '',
    '<!-- mythos:turn agent 2026-08-01T10:05:00.000Z -->',
    '**Agent:**',
    '',
    SESSION_AGENT_MARKER,
    '<!-- /mythos:turn -->',
    '',
  ].join('\n');
}

/**
 * Every per-agent enable is TRUE in all three tests — the master switch must
 * carry the entire off state on its own (SKY-10507 proved that precedence;
 * here it makes the network-silence assert as adversarial as possible).
 */
function createFixture(
  aiEnabled: boolean,
  opts: { apiKey?: string; seedBrainstormSession?: boolean } = {},
): Fixture {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-10605-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-10605-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-10605-notes-'));

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: opts.apiKey ?? '', onboardingComplete: true, rightSidebarVisible: true,
    ai: { enabled: aiEnabled },
    agents: {
      writingAssistant: agentCfg({ enabled: true }),
      brainstorm: agentCfg({ enabled: true }),
      archive: agentCfg({ enabled: true }),
      betaReader: { enabled: true, model: 'claude-sonnet-4-6' },
    },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: vaultDir, notesVaultRoot: notesVaultDir,
  }, null, 2));

  const now = new Date().toISOString();
  const storyId = '10605-story';
  const chapterId = '10605-chapter';
  const sceneId = '10605-scene';
  const sceneDir = path.join(vaultDir, 'stories', storyId, 'chapters', chapterId, 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(
    path.join(sceneDir, `${sceneId}.md`),
    '---\ntitle: "Fixture Scene"\n---\n\nShe checked the settings twice.\n',
    'utf8',
  );
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
    version: '1', vaultRoot: vaultDir,
    stories: [{
      id: storyId, title: STORY_TITLE, path: `stories/${storyId}`, createdAt: now, updatedAt: now,
      chapters: [{
        id: chapterId, title: 'Chapter One', storyId, order: 0, createdAt: now, updatedAt: now,
        scenes: [{
          id: sceneId, title: 'Fixture Scene', path: `stories/${storyId}/chapters/${chapterId}/scenes/${sceneId}.md`,
          chapterId, storyId, order: 0, draftState: 'in-progress', createdAt: now, updatedAt: now, blocks: [],
        }],
      }],
    }],
    entities: [], suggestions: [], scenes: [], chapters: [],
  }, null, 2));

  fs.mkdirSync(path.join(notesVaultDir, 'Characters'), { recursive: true });
  fs.writeFileSync(path.join(notesVaultDir, 'Characters', 'Rell Anders.md'), 'POV. Careful, methodical.');

  if (opts.seedBrainstormSession) {
    fs.mkdirSync(path.join(notesVaultDir, 'Sessions'), { recursive: true });
    fs.writeFileSync(path.join(notesVaultDir, 'Sessions', SESSION_FILE_NAME), sessionFileContent(), 'utf8');
  }

  return { userData, vaultDir, notesVaultDir };
}

function cleanupFixture(fixture: Fixture): void {
  fs.rmSync(fixture.userData, { recursive: true, force: true });
  fs.rmSync(fixture.vaultDir, { recursive: true, force: true });
  fs.rmSync(fixture.notesVaultDir, { recursive: true, force: true });
}

function readAppSettings(userData: string): { ai?: { enabled?: boolean } } {
  return JSON.parse(fs.readFileSync(path.join(userData, 'app-settings.json'), 'utf-8'));
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
  page.on('dialog', (d) => void d.accept().catch(() => undefined));
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
  return page;
}

async function closeApp(app: ElectronApplication | undefined): Promise<void> {
  const proc = app?.process();
  await Promise.race([
    app?.close().catch(() => undefined) ?? Promise.resolve(),
    new Promise<void>((r) => setTimeout(r, 5_000)),
  ]);
  try {
    if (proc && !proc.killed) proc.kill('SIGKILL');
  } catch { /* already exited */ }
}

async function selectStoryAndOpenScene(page: Page): Promise<void> {
  await clickStoryNav(page);
  await page.locator('.nav-story-title', { hasText: STORY_TITLE }).click();
  await expect(page.locator('[data-testid="lr-story-card"]')).toBeVisible({ timeout: 8_000 });
}

async function goToBrainstorm(page: Page): Promise<void> {
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Brainstorm"]').click();
  await expect(page.locator('[data-testid="bs-collections"]')).toBeVisible({ timeout: 10_000 });
}

async function goToSceneCrafter(page: Page): Promise<void> {
  await clickStoryNav(page);
  await page.locator('.nav-story-title', { hasText: STORY_TITLE }).click();
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
  await expect(page.locator('.sc-suggest')).toBeVisible({ timeout: 10_000 });
}

/** Open Settings on the AI Agents category and return the master switch input. */
async function openSettingsAiMaster(page: Page) {
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('.settings-title')).toBeVisible({ timeout: 5_000 });
  await page.locator('[data-testid="settings-cat-agents"]').click();
  const toggle = page.getByRole('switch', { name: 'AI features' });
  // The input itself is visually hidden (opacity:0, 0×0) — assert on its
  // visible track instead.
  await expect(
    toggle.locator('xpath=following-sibling::span[contains(@class, "settings-toggle-track")]'),
  ).toBeVisible();
  return toggle;
}

/** The native checkbox is visually hidden (opacity:0, 0×0) — the clickable
 *  control is the sibling `.settings-toggle-track` (provider-settings.spec.ts
 *  pattern). */
async function flipAiMasterSwitch(page: Page): Promise<void> {
  const toggle = page.getByRole('switch', { name: 'AI features' });
  await toggle
    .locator('xpath=following-sibling::span[contains(@class, "settings-toggle-track")]')
    .click();
}

async function closeSettings(page: Page): Promise<void> {
  await page.locator('.settings-close').click();
  await expect(page.locator('.settings-title')).toHaveCount(0);
}

test('SKY-10605: AI off — full-workspace walkthrough emits zero requests to AI provider hosts', async () => {
  // Adversarial fixture: master OFF, every agent ON, and a syntactically-real
  // API key on disk — if the gate leaked anywhere, a request could actually fire.
  const fixture = createFixture(false, { apiKey: 'sk-ant-e2e-sky10605-gate' });
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(fixture.userData);
    const page = await app.firstWindow();
    page.on('dialog', (d) => void d.accept().catch(() => undefined));

    // Record ALL http(s) traffic from the app window, attached before the
    // renderer finishes booting. page.route (not context.route: the Electron
    // window pre-dates the CDP connection, and context-level routes do not
    // reach it — verified live, the canary below escaped). file:// (the
    // app's own asset loading) is deliberately not intercepted — network
    // silence is about egress. AI-provider requests are aborted, not
    // continued, so the canary never actually leaves the machine.
    const recorded: string[] = [];
    await page.route(/^https?:\/\//, async (route) => {
      const url = route.request().url();
      recorded.push(url);
      if (isAiProviderUrl(url)) await route.abort();
      else await route.continue();
    });

    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });

    // Story Writer: story dashboard + the real scene editor with fixture prose.
    await selectStoryAndOpenScene(page);
    const sceneRow = page.locator('.nav-scene-row', { hasText: 'Fixture Scene' }).first();
    await expect(sceneRow).toBeVisible({ timeout: 8_000 });
    await sceneRow.click();
    const editor = page.locator('.ProseMirror').first();
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await expect(editor).toContainText('She checked the settings twice.');

    // Notes workspace. (Dictate/Read live here and in the editor — this
    // walkthrough never clicks them; see header carve-out note.)
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
    await expect(page.locator('[data-testid="notes-tab-center"]')).toBeVisible({ timeout: 10_000 });

    // Scene Crafter — suggested-cards rail credits the vault when AI is off.
    await goToSceneCrafter(page);
    await expect(page.locator('.sc-suggest-hint')).toContainText('Notes Vault');

    // Brainstorm — board-only under AI-off.
    await goToBrainstorm(page);
    await expect(page.locator('[data-testid="bsc-mode-chat"]')).toHaveCount(0);

    // Timeline.
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Timeline"]').click();
    await expect(page.locator('[data-testid="timeline-root"]')).toBeVisible({ timeout: 10_000 });

    // The silence assert: not one recorded request touched an AI provider.
    // Nothing is allowlisted — any AI-provider hostname is a failure.
    expect(recorded.filter(isAiProviderUrl)).toEqual([]);

    // Canary: prove the recorder is live (assert above is not vacuous). CSP
    // permits connect-src api.anthropic.com, so this reaches the network
    // stack, where our route intercepts and aborts it pre-egress.
    const canary = await page.evaluate(async () => {
      try {
        await fetch('https://api.anthropic.com/sky10605-canary', { method: 'POST', body: '{}' });
        return 'resolved';
      } catch {
        return 'rejected';
      }
    });
    expect(canary).toBe('rejected');
    await expect.poll(() => recorded.filter(isAiProviderUrl).length, { timeout: 5_000 }).toBe(1);
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});

test('SKY-10605: AI off→on via the real Settings switch — surfaces return with prior agent content intact', async () => {
  const fixture = createFixture(false, { seedBrainstormSession: true });
  const sessionPath = path.join(fixture.notesVaultDir, 'Sessions', SESSION_FILE_NAME);
  const seededContent = fs.readFileSync(sessionPath, 'utf-8');
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(fixture.userData);
    const page = await firstWindow(app);

    // AI-off surface contract (SKY-10507 pattern): Assistant tab absent,
    // manual tabs present, Brainstorm chat gone.
    await selectStoryAndOpenScene(page);
    const grs = page.locator('[data-testid="global-right-sidebar"]');
    await expect(grs.getByRole('tab', { name: 'Scenes' })).toBeVisible();
    await expect(grs.getByRole('tab', { name: 'Assistant' })).toHaveCount(0);

    await goToBrainstorm(page);
    await expect(page.locator('[data-testid="bsc-mode-chat"]')).toHaveCount(0);
    await expect(page.locator('.brainstorm-input')).toHaveCount(0);

    // Flip ON through the real Settings UI — not by rewriting the fixture.
    const toggle = await openSettingsAiMaster(page);
    await expect(toggle).not.toBeChecked();
    await flipAiMasterSwitch(page);
    await expect(toggle).toBeChecked();
    // The switch persists immediately (no Save click) — wait for the write.
    await expect.poll(() => readAppSettings(fixture.userData).ai?.enabled, { timeout: 5_000 }).toBe(true);
    await closeSettings(page);

    // Brainstorm chat is back — reactively, same process — and it hydrates
    // the PRE-EXISTING session transcript, proving the off state displayed
    // nothing but deleted nothing.
    const chatModeBtn = page.locator('[data-testid="bsc-mode-chat"]');
    await expect(chatModeBtn).toBeVisible({ timeout: 10_000 });
    await chatModeBtn.click();
    await expect(page.locator('.bs-user-bubble', { hasText: SESSION_USER_MARKER })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.bs-assistant-bubble', { hasText: SESSION_AGENT_MARKER })).toBeVisible();

    // Assistant tab reappears on the story surface.
    await clickStoryNav(page);
    await expect(grs.getByRole('tab', { name: 'Assistant' })).toBeVisible({ timeout: 10_000 });

    // Display-only gate, on disk too: the transcript file is byte-identical —
    // nothing was regenerated, migrated, or lost across the round trip.
    expect(fs.readFileSync(sessionPath, 'utf-8')).toBe(seededContent);
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});

test('SKY-10605: flipping AI off in Settings persists across an app restart (same userData)', async () => {
  const fixture = createFixture(true);
  let app: ElectronApplication | undefined;
  try {
    // ── Launch 1: AI on. Baseline, then flip off via the real switch. ──
    app = await launchApp(fixture.userData);
    let page = await firstWindow(app);

    await selectStoryAndOpenScene(page);
    const grs = page.locator('[data-testid="global-right-sidebar"]');
    await expect(grs.getByRole('tab', { name: 'Assistant' })).toBeVisible({ timeout: 10_000 });

    const toggle = await openSettingsAiMaster(page);
    await expect(toggle).toBeChecked();
    await flipAiMasterSwitch(page);
    await expect(toggle).not.toBeChecked();
    await expect(page.locator('.ai-master-manual-note__title')).toHaveText('Manual mode is on');
    // The flip persists immediately; confirm the write landed before closing.
    await expect.poll(() => readAppSettings(fixture.userData).ai?.enabled, { timeout: 5_000 }).toBe(false);

    await closeApp(app);
    app = undefined;

    // ── Launch 2: same userData (two-vault-firstrun TC-SK9-02 pattern). ──
    expect(readAppSettings(fixture.userData).ai?.enabled).toBe(false);
    app = await launchApp(fixture.userData);
    page = await firstWindow(app);

    // Relaunched UI reflects AI-off: Assistant tab absent, manual tab present.
    await selectStoryAndOpenScene(page);
    const grs2 = page.locator('[data-testid="global-right-sidebar"]');
    await expect(grs2.getByRole('tab', { name: 'Scenes' })).toBeVisible();
    await expect(grs2.getByRole('tab', { name: 'Assistant' })).toHaveCount(0);

    // And Settings agrees: switch unchecked, manual-mode note shown.
    const toggle2 = await openSettingsAiMaster(page);
    await expect(toggle2).not.toBeChecked();
    await expect(page.locator('.ai-master-manual-note__title')).toHaveText('Manual mode is on');

    // The disk value did not drift during the relaunched session.
    expect(readAppSettings(fixture.userData).ai?.enabled).toBe(false);
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});
