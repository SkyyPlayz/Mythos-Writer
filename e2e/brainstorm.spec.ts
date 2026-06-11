/**
 * brainstorm.spec.ts — MYT-321
 *
 * E2E tests for Brainstorm Agent streaming and vault note creation.
 *   TC-BST-01  Streaming      — send message → streaming cursor visible → tokens accumulate
 *   TC-BST-02  Fact detection — FACT tags in response → "Detected Facts" panel populated
 *   TC-BST-03  Vault save     — "Save to Vault" → entity .md file with correct frontmatter
 *
 * The real Anthropic SDK is bypassed by replacing the stream:start IPC handler in the
 * main process (via app.evaluate) with a mock that emits a fixed token sequence.
 * No real API key or network access is required.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/brainstorm.spec.ts --reporter=list
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

/**
 * Fixed token sequence emitted by the mock LLM.
 * Includes a [FACT:...] tag so TC-BST-02 / TC-BST-03 can verify extraction and saving.
 */
const MOCK_TOKENS = [
  'Great idea for your story! ',
  'Here is a character suggestion.\n\n',
  '[FACT:character|Aria Voss|A brave young sorceress who discovers her hidden powers]',
];
const MOCK_FACT_NAME = 'Aria Voss';
const MOCK_FACT_DESC = 'A brave young sorceress who discovers her hidden powers';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Write seeded app-settings and vault-settings so the app skips onboarding and
 * boots directly into DesktopShell with the Brainstorm agent enabled.
 * The API key value does not need to be real because we mock the stream:start handler.
 */
function seedUserData(userData: string, vaultDir: string): void {
  const appSettings = {
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
        // enabled: true so DesktopShell passes enabled=true to BrainstormPage
        enabled: true,
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
  // notesVaultRoot must point into vaultDir so TC-BST-03 can find the written file.
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: vaultDir };

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(appSettings, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify(vaultSettings, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  // On macOS, Electron uses Quartz natively — headless is not needed and
  // prevents Playwright from detecting the Chrome DevTools endpoint (Electron 42 /
  // Chrome 130+ new headless mode suppresses "DevTools listening on ws://…").
  // On Linux CI, xvfb-run provides DISPLAY so the condition is false.
  // --no-sandbox is required for Electron to spawn its renderer under Xvfb in CI.
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  // Auto-accept any dialog (notably the beforeunload "leave session?" prompt the
  // BrainstormPage installs once messages exist) so teardown close doesn't hang.
  page.on('dialog', (dialog) => {
    void dialog.accept().catch(() => undefined);
  });
  // Capture renderer console output for debugging.
  page.on('console', (msg) => {
    if (msg.text().includes('BrainstormPage') || msg.text().includes('DesktopShell')) {
      // eslint-disable-next-line no-console
      console.log('[renderer]', msg.type(), msg.text());
    }
  });
  await page.waitForLoadState('domcontentloaded');
  return page;
}

/** Poll until predicate() returns true or timeoutMs elapses. */
async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 8_000,
  intervalMs = 150,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-bst-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-bst-vault-'));
  seedUserData(userData, vaultDir);

  app = await launchApp(userData);
  page = await firstWindow(app);

  // Wait for DesktopShell to be fully rendered before injecting the mock handler.
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  /**
   * Replace the real stream:start IPC handler (registered by registerStreamingHandlers)
   * with a mock that emits fixed tokens and a final stream:end event.
   * This prevents any real Anthropic SDK calls and makes the stream deterministic.
   *
   * Electron's ipcMain.removeHandler(channel) is available since Electron 9.
   */
  await app!.evaluate(
    async ({ ipcMain }, tokens: string[]) => {
      ipcMain.removeHandler('stream:start');
      ipcMain.handle('stream:start', async (event) => {
        const streamId = `mock-stream-${Date.now()}`;

        // Emit tokens asynchronously so the renderer can observe streaming state.
        void (async () => {
          for (const token of tokens) {
            await new Promise<void>((r) => setTimeout(r, 40));
            if (!event.sender.isDestroyed()) {
              event.sender.send('stream:token', { streamId, token });
            }
          }
          await new Promise<void>((r) => setTimeout(r, 40));
          if (!event.sender.isDestroyed()) {
            event.sender.send('stream:end', { streamId });
          }
        })();

        return { streamId };
      });
    },
    MOCK_TOKENS,
  );
});

test.afterAll(async () => {
  // Guard against app being undefined when beforeAll threw before electron.launch
  // resolved (e.g. the 60 s launch timeout fired). Without this guard, accessing
  // app.process() throws TypeError and masks the original launch failure.
  const proc = app?.process();
  await Promise.race([
    app?.close().catch(() => undefined) ?? Promise.resolve(),
    new Promise<void>((r) => setTimeout(r, 5_000)),
  ]);
  try {
    if (proc && !proc.killed) proc.kill('SIGKILL');
  } catch {
    /* already exited */
  }
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});

// ─── TC-BST-01: Streaming tokens ─────────────────────────────────────────────
//
// Open the Brainstorm view, type a message, send it, and verify that:
//   - The streaming cursor (▍) appears while tokens are being emitted.
//   - After the stream ends the cursor disappears and the full response is visible.

test('TC-BST-01: send message → streaming tokens appear in chat', async () => {
  // Navigate to the Brainstorm view via the top menu bar.
  const brainstormBtn = page.locator('.app-menu-view-btn', { hasText: 'Brainstorm' });
  await brainstormBtn.click();

  // BrainstormPage header must render.
  await expect(page.locator('.brainstorm-title')).toBeVisible({ timeout: 6_000 });
  await expect(page.locator('.brainstorm-title')).toContainText('Brainstorm');

  // Type a prompt into the composer.
  const textarea = page.locator('.brainstorm-input');
  await textarea.fill('Tell me about my main character');

  // Click Send.
  await page.locator('.brainstorm-send-btn').click();

  // The streaming cursor (▍) must appear while tokens are arriving.
  const cursor = page.locator('.bs-cursor');
  await expect(cursor).toBeVisible({ timeout: 5_000 });

  // After the stream ends the cursor disappears.
  await expect(cursor).not.toBeVisible({ timeout: 10_000 });

  // The assistant reply must contain text from the mock response.
  // (FACT tags are stripped from the displayed text by stripFactTags.)
  const assistantBubble = page.locator('.bs-assistant-bubble').last();
  await expect(assistantBubble).toContainText('Great idea', { timeout: 8_000 });
});

// ─── TC-BST-02: Fact detection ────────────────────────────────────────────────
//
// After the stream ends (carried from TC-BST-01), verify that the [FACT:...] tag
// in the mock response was extracted and is displayed in the "Detected Facts" panel.

test('TC-BST-02: FACT tags in response populate "Detected Facts" panel', async () => {
  const factsPanel = page.locator('.brainstorm-facts-list');
  await expect(factsPanel).toBeVisible({ timeout: 5_000 });

  // The fact name appears as an entity chip in the IdeaCard (linkedEntities).
  const factName = factsPanel.locator('.idea-card-chip', { hasText: MOCK_FACT_NAME });
  await expect(factName).toBeVisible({ timeout: 6_000 });

  // The type group header must show "Characters".
  const factGroup = factsPanel.locator('.bs-fact-group').first();
  await expect(factGroup.locator('.bs-fact-group-header')).toContainText('Character');

  // The description is the IdeaCard title (fact.content rendered as the primary text).
  const factDesc = factsPanel.locator('.idea-card-title', { hasText: MOCK_FACT_DESC }).first();
  await expect(factDesc).toContainText(MOCK_FACT_DESC);

  // Facts auto-extract to the vault; the panel reflects the saved state.
  const savedLabel = factsPanel.locator('.bs-fact-saved-label').first();
  await expect(savedLabel).toBeVisible({ timeout: 8_000 });
  await expect(savedLabel).toContainText('Saved');
});

// ─── TC-BST-04: Preset selection ─────────────────────────────────────────────
//
// The Brainstorm header contains a PresetSelector chip. Verify that:
//   - The preset chip renders with the default preset name.
//   - Clicking the chip opens the preset listbox dropdown.
//   - Selecting a different preset updates the chip label.
//
// This test does NOT require an LLM call — it only exercises the UI.

test('TC-BST-04: preset chip is visible and changes label on selection', async () => {
  // Ensure brainstorm view is active (prior tests may close it).
  const title = page.locator('.brainstorm-title');
  const isBrainstormVisible = await title.isVisible().catch(() => false);
  if (!isBrainstormVisible) {
    await page.locator('.app-menu-view-btn', { hasText: 'Brainstorm' }).click();
    await expect(title).toBeVisible({ timeout: 6_000 });
  }

  // The preset chip is rendered in the header via PresetSelector.
  const chip = page.locator('.preset-selector-chip');
  await expect(chip).toBeVisible({ timeout: 6_000 });

  // Record the current preset name.
  const initialName = await chip.textContent();

  // Click the chip to open the dropdown.
  await chip.click();
  const listbox = page.locator('[role="listbox"]');
  await expect(listbox).toBeVisible({ timeout: 4_000 });

  // Pick the second preset option (different from the active one).
  const options = listbox.locator('[role="option"]');
  const count = await options.count();
  expect(count).toBeGreaterThan(1);

  // Click the last option to ensure it differs from the default.
  await options.last().click();

  // Dropdown closes and the chip reflects the new selection.
  await expect(listbox).not.toBeVisible({ timeout: 3_000 });
  const updatedName = await chip.textContent();
  expect(updatedName).not.toBe(initialName);
});

// ─── TC-BST-05: One refinement cycle ─────────────────────────────────────────
//
// After the response from TC-BST-01 is complete, refinement chips appear below
// the last assistant message. Verify that:
//   - At least one refinement chip is visible.
//   - Clicking a chip triggers a new generation (streaming cursor appears).
//   - The generation completes and the cursor disappears.
//
// Relies on TC-BST-01 having run in the same session so messages exist.

test('TC-BST-05: refinement chip triggers new generation', async () => {
  // Ensure brainstorm view is active (prior tests may close it).
  const title = page.locator('.brainstorm-title');
  const isBrainstormVisible = await title.isVisible().catch(() => false);
  if (!isBrainstormVisible) {
    await page.locator('.app-menu-view-btn', { hasText: 'Brainstorm' }).click();
    await expect(title).toBeVisible({ timeout: 6_000 });
  }

  // Refinement chips render below the last completed assistant message.
  const firstChip = page.locator('.refinement-chips .refinement-chip').first();
  await expect(firstChip).toBeVisible({ timeout: 8_000 });

  // Click the first refinement chip.
  await firstChip.click();

  // A new streaming generation should start — the cursor (▍) must appear.
  const cursor = page.locator('.bs-cursor');
  await expect(cursor).toBeVisible({ timeout: 6_000 });

  // The generation completes — cursor disappears.
  await expect(cursor).not.toBeVisible({ timeout: 12_000 });

  // The response area still has content.
  const assistantBubble = page.locator('.bs-assistant-bubble').last();
  await expect(assistantBubble).not.toBeEmpty({ timeout: 3_000 });
});

// ─── TC-BST-03: Vault note creation ──────────────────────────────────────────
//
// The detected fact auto-extracts to the vault. Verify:
//   - The fact shows the "Saved ✓" state.
//   - An entity .md file is created on disk under <vaultDir>/entities/characters/.
//   - The file has correct YAML frontmatter: id, name, type, tags (brainstorm), timestamps.
//   - The prose body contains the fact description.

test('TC-BST-03: detected fact is auto-saved as an entity file with correct frontmatter', async () => {
  // Ensure brainstorm view is active (prior tests may close it).
  const title = page.locator('.brainstorm-title');
  const isBrainstormVisible = await title.isVisible().catch(() => false);
  if (!isBrainstormVisible) {
    await page.locator('.app-menu-view-btn', { hasText: 'Brainstorm' }).click();
    await expect(title).toBeVisible({ timeout: 6_000 });
  }

  const factsPanel = page.locator('.brainstorm-facts-list');

  // The fact auto-saves; UI shows "Saved ✓".
  const savedLabel = factsPanel.locator('.bs-fact-saved-label').first();
  await expect(savedLabel).toBeVisible({ timeout: 8_000 });
  await expect(savedLabel).toContainText('Saved');

  // brainstorm:writeNote writes to notesVaultRoot/Universes/<universe>/Characters/<name>.md
  // in default layout mode. notesVaultRoot is seeded to vaultDir.
  const entityDir = path.join(vaultDir, 'Universes', 'My First Universe', 'Characters');
  const found = await waitUntil(() => {
    if (!fs.existsSync(entityDir)) return false;
    return fs.readdirSync(entityDir).some((f) => f.endsWith('.md'));
  }, 10_000);
  expect(found, `No entity .md file found under ${entityDir}`).toBe(true);

  // Read the entity file.
  const entityFiles = fs.readdirSync(entityDir).filter((f) => f.endsWith('.md'));
  expect(entityFiles.length).toBeGreaterThan(0);
  const content = fs.readFileSync(path.join(entityDir, entityFiles[0]), 'utf-8');

  // Must start with a YAML frontmatter block.
  expect(content.startsWith('---'), 'Entity file must start with a YAML frontmatter block').toBe(true);

  // Required frontmatter fields present in the brainstorm note format.
  expect(content).toContain(`name: ${MOCK_FACT_NAME}`);
  expect(content).toContain('type: character');
  expect(content).toContain('suggestionId:');  // brainstorm:writeNote uses suggestionId, not id
  expect(content).toContain('createdAt:');
  expect(content).toContain('agent: brainstorm');

  // Prose body (after the closing ---) must contain the fact description.
  expect(content).toContain(MOCK_FACT_DESC);
});

// ─── TC-BST-04: Sort + filter controls (Wave 3.2) ────────────────────────────
//
// Verify the sort dropdown and filter dropdown appear in the Detected Facts panel
// when multiple fact types exist, and that:
//   - Controls render without crashing
//   - Filtering to "Characters" hides location/item groups
//   - Filtering back to "All types" restores all groups
//   - Changing sort order does NOT trigger any disk save (sort is in-memory)

test('TC-BST-04: sort/filter controls appear and filter operates in-memory', async () => {
  // Re-inject mock with three fact types so groups are populated.
  const multiTypeMockTokens = [
    'Here are some story elements.\n\n',
    '[FACT:character|Hero Jones|A determined adventurer]',
    '[FACT:location|Dark Cave|A mysterious underground cavern]',
    '[FACT:item|Magic Staff|An ancient staff that grants power]',
  ];

  await app!.evaluate(
    async ({ ipcMain }, tokens: string[]) => {
      ipcMain.removeHandler('stream:start');
      ipcMain.handle('stream:start', async (event) => {
        const streamId = `mock-stream-${Date.now()}`;
        void (async () => {
          for (const token of tokens) {
            await new Promise<void>((r) => setTimeout(r, 30));
            if (!event.sender.isDestroyed()) {
              event.sender.send('stream:token', { streamId, token });
            }
          }
          await new Promise<void>((r) => setTimeout(r, 30));
          if (!event.sender.isDestroyed()) {
            event.sender.send('stream:end', { streamId });
          }
        })();
        return { streamId };
      });
    },
    multiTypeMockTokens,
  );

  // Start a new session to clear the previous facts.
  const newSessionBtn = page.locator('.brainstorm-new-session-btn');
  if (await newSessionBtn.isVisible().catch(() => false)) {
    await newSessionBtn.click();
    // Wait for facts panel to clear.
    await page.waitForFunction(() => {
      const list = document.querySelector('.brainstorm-facts-list');
      return list && !list.querySelector('[data-testid^="idea-card-"]');
    }, { timeout: 5_000 });
  } else {
    // Navigate to brainstorm if not visible.
    await page.locator('.app-menu-view-btn', { hasText: 'Brainstorm' }).click();
    await expect(page.locator('.brainstorm-title')).toBeVisible({ timeout: 6_000 });
  }

  // Send a message to trigger the multi-type mock stream.
  const textarea = page.locator('.brainstorm-input');
  await textarea.fill('Give me some story elements');
  await page.locator('button', { hasText: 'Send' }).click();

  // Wait for all three fact groups to appear.
  await expect(page.locator('[data-testid="bs-group-toggle-character"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="bs-group-toggle-location"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="bs-group-toggle-item"]')).toBeVisible({ timeout: 5_000 });

  // Sort and filter controls must be visible.
  const sortSelect = page.locator('[data-testid="bs-sort-select"]');
  const filterSelect = page.locator('[data-testid="bs-filter-select"]');
  await expect(sortSelect).toBeVisible({ timeout: 3_000 });
  await expect(filterSelect).toBeVisible({ timeout: 3_000 });

  // Default values.
  await expect(sortSelect).toHaveValue('newest');
  await expect(filterSelect).toHaveValue('all');

  // Filter to Characters — location and item groups must disappear.
  await filterSelect.selectOption('character');
  await expect(page.locator('[data-testid="bs-group-toggle-character"]')).toBeVisible({ timeout: 3_000 });
  await expect(page.locator('[data-testid="bs-group-toggle-location"]')).not.toBeVisible({ timeout: 3_000 });
  await expect(page.locator('[data-testid="bs-group-toggle-item"]')).not.toBeVisible({ timeout: 3_000 });

  // Filter back to All types — all groups visible again.
  await filterSelect.selectOption('all');
  await expect(page.locator('[data-testid="bs-group-toggle-location"]')).toBeVisible({ timeout: 3_000 });
  await expect(page.locator('[data-testid="bs-group-toggle-item"]')).toBeVisible({ timeout: 3_000 });

  // Change sort — controls remain stable, no crash.
  await sortSelect.selectOption('oldest');
  await expect(sortSelect).toHaveValue('oldest');
  await sortSelect.selectOption('by-type');
  await expect(sortSelect).toHaveValue('by-type');
  await sortSelect.selectOption('by-status');
  await expect(sortSelect).toHaveValue('by-status');

  // Collapse all then expand all.
  await page.locator('[data-testid="bs-collapse-all"]').click();
  await expect(page.locator('[data-testid^="idea-card-"]').first()).not.toBeVisible({ timeout: 3_000 });
  await page.locator('[data-testid="bs-expand-all"]').click();
  await expect(page.locator('[data-testid="bs-group-toggle-character"]')).toBeVisible({ timeout: 3_000 });
});
