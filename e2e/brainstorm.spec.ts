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
  const vaultSettings = { vaultRoot: vaultDir };

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
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`],
    timeout: 30_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
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
let app: ElectronApplication;
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
  await app.evaluate(
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
  await app.close().catch(() => {});
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

  // The fact name must appear in the panel.
  const factName = factsPanel.locator('.bs-fact-name', { hasText: MOCK_FACT_NAME });
  await expect(factName).toBeVisible({ timeout: 6_000 });

  // The type badge must show "Character".
  const factType = factsPanel.locator('.bs-fact-type').first();
  await expect(factType).toContainText('Character');

  // The description must match the mock FACT tag content.
  const factDesc = factsPanel.locator('.bs-fact-desc').first();
  await expect(factDesc).toContainText(MOCK_FACT_DESC);

  // "Save to Vault" button must be present (fact is still unsaved at this point).
  const saveBtn = factsPanel.locator('.bs-fact-save-btn').first();
  await expect(saveBtn).toBeVisible();
  await expect(saveBtn).toContainText('Save to Vault');
});

// ─── TC-BST-03: Vault note creation ──────────────────────────────────────────
//
// Click "Save to Vault" for the detected fact. Verify:
//   - The UI transitions to "Saved ✓" state.
//   - An entity .md file is created on disk under <vaultDir>/entities/characters/.
//   - The file has correct YAML frontmatter: id, name, type, tags (brainstorm), timestamps.
//   - The prose body contains the fact description.

test('TC-BST-03: "Save to Vault" creates entity file with correct frontmatter', async () => {
  const factsPanel = page.locator('.brainstorm-facts-list');

  // Click the "Save to Vault" button for the first (and only) detected fact.
  const saveBtn = factsPanel.locator('.bs-fact-save-btn').first();
  await saveBtn.click();

  // UI must update to "Saved ✓".
  const savedLabel = factsPanel.locator('.bs-fact-saved-label').first();
  await expect(savedLabel).toBeVisible({ timeout: 8_000 });
  await expect(savedLabel).toContainText('Saved');

  // An entity .md file must appear on disk.
  // createEntity writes to: <vaultDir>/entities/characters/<uuid>.md
  const entityDir = path.join(vaultDir, 'entities', 'characters');
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

  // Required frontmatter fields must be present.
  expect(content).toContain(`name: ${MOCK_FACT_NAME}`);
  expect(content).toContain('type: character');
  expect(content).toContain('id:');         // UUID is present but value is non-deterministic
  expect(content).toContain('createdAt:');
  expect(content).toContain('updatedAt:');

  // saveFactToVault passes tags: ['brainstorm'] → file must include "brainstorm".
  expect(content).toContain('brainstorm');

  // Prose body (after the closing ---) must contain the fact description.
  expect(content).toContain(MOCK_FACT_DESC);
});
