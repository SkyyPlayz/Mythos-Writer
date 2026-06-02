/**
 * suggestions.spec.ts — MYT-354
 *
 * Smoke tests for the suggestion store and apply/reject/rollback IPC flow.
 *
 * Strategy: inject suggestions via window.api.suggestionsUpsert() (the same
 * IPC path an agent uses) then interact with the Suggestion Review panel UI to
 * accept/reject them. Post-condition checks read disk state directly and
 * query the audit log via IPC — no mocking of Electron internals.
 *
 * Coverage:
 *   TC-S-01  accept vault suggestion → vault file updated, audit row (action=apply), snapshot created
 *   TC-S-02  reject → suggestion archived (status=rejected), no vault write, audit row (action=reject)
 *   TC-S-03  apply vault suggestion → rollback → vault file restored to pre-apply content
 *   TC-S-04  budget cap: over-budget suggestion submission gets budget_exceeded=1, not auto-applied
 *
 * Run (after `npm run build:electron`):
 *   npx playwright install chromium   # first time only
 *   npx playwright test e2e/suggestions.spec.ts --reporter=list
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

/** Seed userData for standard flows (agents disabled, autoApply=false). */
function seedUserData(userData: string, vaultDir: string): void {
  const appSettings = {
    apiKey: '',
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
        model: 'claude-sonnet-4-6',
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
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

/**
 * Seed userData for the budget cap test.
 * writingAssistant.autoApply=true, maxSuggestionsPerHour=1.
 * Because countSuggestionsInWindowWithDb runs AFTER insertion, the very first
 * suggestion from writing-assistant with confidence >= 0.8 will have count=1
 * which satisfies 1 >= maxSuggestionsPerHour=1 → budgetExceeded=true.
 */
function seedBudgetUserData(userData: string, vaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: false,
        model: 'claude-sonnet-4-6',
        scanIntervalSeconds: 30,
        autoApply: true,           // enabled for budget-cap evaluation
        confidenceThreshold: 0.8,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 1,  // cap so low that the first suggestion hits it
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: false,
        model: 'claude-sonnet-4-6',
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
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

/** Poll predicate until it returns true or timeoutMs elapses. */
async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 10_000,
  intervalMs = 150,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// ─── TC-S-01 / TC-S-02 / TC-S-03: accept · reject · rollback ─────────────────

test.describe('Suggestion store IPC smoke (TC-S-01/02/03)', () => {
  let userData: string;
  let vaultDir: string;
  let app: ElectronApplication | undefined;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sug-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sug-vault-'));
    seedUserData(userData, vaultDir);
    app = await launchApp(userData);
    page = await firstWindow(app);
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  /**
   * Navigate to the Review tab, forcing a remount of SuggestionReview so it
   * fetches a fresh list from the DB. Switches to Stories first to ensure
   * the component actually unmounts.
   */
  async function openReviewTab(): Promise<void> {
    const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
    if (await storiesTab.isVisible()) await storiesTab.click();
    await page.waitForTimeout(200);
    await page.locator('.rail-tab', { hasText: 'Review' }).click();
    // Wait for the list to render (disappearance of loading spinner)
    await expect(page.locator('.suggestion-review .sr-list')).toBeVisible({ timeout: 6_000 });
  }

  // ── TC-S-01 ─────────────────────────────────────────────────────────────────
  //
  // 1. Upsert a vault suggestion (simulating what writing-assistant would do).
  // 2. Open Review tab — suggestion appears as an .sr-row.
  // 3. Click Accept.
  // 4. Vault file has new content · audit row action=apply · snapshot file created.

  test('TC-S-01: accept vault suggestion → vault file updated, audit row, snapshot', async () => {
    const id = `tc-s-01-${Date.now()}`;
    const targetPath = 'suggestions/tc-s-01.md';
    const originalContent = 'ORIGINAL TC-S-01\n';
    const newContent = 'UPDATED BY SUGGESTION TC-S-01\n';

    // Pre-create the target vault file so the snapshot captures a real original.
    const targetFullPath = path.join(vaultDir, targetPath);
    fs.mkdirSync(path.dirname(targetFullPath), { recursive: true });
    fs.writeFileSync(targetFullPath, originalContent, 'utf-8');

    // Propose the suggestion via the same IPC path an agent uses.
    await page.evaluate(
      ({ sugId, tp, nc }) => {
        return (window as any).api.suggestionsUpsert({
          id: sugId,
          source_agent: 'writing-assistant',
          confidence: 0.9,
          rationale: 'Improve opening line TC-S-01',
          target_kind: 'vault',
          target_path: tp,
          target_anchor: null,
          payload_json: JSON.stringify({ content: nc }),
          status: 'proposed',
          created_at: new Date().toISOString(),
          applied_at: null,
          applied_run_id: null,
          budget_exceeded: 0,
        });
      },
      { sugId: id, tp: targetPath, nc: newContent },
    );

    // Open the Review tab (fresh mount — fetches updated DB state).
    await openReviewTab();

    // The suggestion row should appear in the panel.
    const suggRow = page.locator('.sr-row', { hasText: 'Improve opening line TC-S-01' });
    await expect(suggRow).toBeVisible({ timeout: 8_000 });

    // Accept the suggestion via the Review panel UI.
    await suggRow.locator('.sr-btn-accept').click();

    // Optimistic update: row disappears immediately.
    await expect(suggRow).not.toBeVisible({ timeout: 5_000 });

    // ── Post-conditions ───────────────────────────────────────────────────────

    // 1. Vault file updated with new content.
    const fileUpdated = await waitUntil(() => {
      try {
        return fs.readFileSync(targetFullPath, 'utf-8').includes('UPDATED BY SUGGESTION TC-S-01');
      } catch { return false; }
    }, 8_000);
    expect(fileUpdated, 'Vault file should contain the suggested content after accept').toBe(true);

    // 2. Snapshot file created at .mythos/suggestion-snapshots/<id>.json.
    const snapshotPath = path.join(vaultDir, '.mythos', 'suggestion-snapshots', `${id}.json`);
    const snapshotCreated = await waitUntil(() => fs.existsSync(snapshotPath), 5_000);
    expect(snapshotCreated, `Snapshot file not found: ${snapshotPath}`).toBe(true);

    // 3. Snapshot captures the original (pre-apply) content.
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as {
      originalContent: string;
      path: string;
    };
    expect(snap.originalContent).toBe(originalContent);
    expect(snap.path).toBe(targetPath);

    // 4. Audit log contains an apply row.
    const auditResult = await page.evaluate((sugId) => {
      return (window as any).api.auditList(sugId);
    }, id) as { entries: Array<{ action: string; actor: string }> };

    expect(auditResult.entries.length).toBeGreaterThanOrEqual(1);
    expect(
      auditResult.entries.some((e) => e.action === 'apply'),
      'Audit log must have action=apply',
    ).toBe(true);
  });

  // ── TC-S-02 ─────────────────────────────────────────────────────────────────
  //
  // 1. Upsert a vault suggestion.
  // 2. Open Review tab — suggestion appears.
  // 3. Click Reject.
  // 4. Target vault file NOT created · audit row action=reject · status=rejected.

  test('TC-S-02: reject suggestion → archived, no vault write, audit row', async () => {
    const id = `tc-s-02-${Date.now()}`;
    const targetPath = 'suggestions/tc-s-02.md'; // intentionally no pre-existing file

    await page.evaluate(
      ({ sugId, tp }) => {
        return (window as any).api.suggestionsUpsert({
          id: sugId,
          source_agent: 'writing-assistant',
          confidence: 0.85,
          rationale: 'TC-S-02 reject candidate',
          target_kind: 'vault',
          target_path: tp,
          target_anchor: null,
          payload_json: JSON.stringify({ content: 'should-not-be-written' }),
          status: 'proposed',
          created_at: new Date().toISOString(),
          applied_at: null,
          applied_run_id: null,
          budget_exceeded: 0,
        });
      },
      { sugId: id, tp: targetPath },
    );

    await openReviewTab();

    const suggRow = page.locator('.sr-row', { hasText: 'TC-S-02 reject candidate' });
    await expect(suggRow).toBeVisible({ timeout: 8_000 });

    // Reject via the Review panel UI.
    await suggRow.locator('.sr-btn-reject').click();
    await expect(suggRow).not.toBeVisible({ timeout: 5_000 });

    // Brief settle to let any async work complete.
    await page.waitForTimeout(300);

    // ── Post-conditions ───────────────────────────────────────────────────────

    // 1. Vault file must NOT have been created.
    const targetFullPath = path.join(vaultDir, targetPath);
    expect(
      fs.existsSync(targetFullPath),
      'Vault file must not be written when a suggestion is rejected',
    ).toBe(false);

    // 2. DB status is rejected.
    const listResult = await page.evaluate(() => {
      return (window as any).api.suggestionsList('rejected');
    }) as { suggestions: Array<{ id: string; status: string }> };

    expect(
      listResult.suggestions.some((s) => s.id === id && s.status === 'rejected'),
      'Suggestion must appear in the rejected list',
    ).toBe(true);

    // 3. Audit log contains a reject row.
    const auditResult = await page.evaluate((sugId) => {
      return (window as any).api.auditList(sugId);
    }, id) as { entries: Array<{ action: string }> };

    expect(
      auditResult.entries.some((e) => e.action === 'reject'),
      'Audit log must have action=reject',
    ).toBe(true);
  });

  // ── TC-S-03 ─────────────────────────────────────────────────────────────────
  //
  // 1. Upsert a vault suggestion for a file that already has content.
  // 2. Accept — vault file updated, snapshot saved.
  // 3. Rollback via IPC — vault file restored to pre-apply content.
  // 4. Audit log contains both apply and rollback rows.

  test('TC-S-03: apply vault suggestion then rollback → file restored', async () => {
    const id = `tc-s-03-${Date.now()}`;
    const targetPath = 'suggestions/tc-s-03.md';
    const originalContent = 'ORIGINAL TC-S-03\n';
    const newContent = 'UPDATED BY TC-S-03\n';

    const targetFullPath = path.join(vaultDir, targetPath);
    fs.mkdirSync(path.dirname(targetFullPath), { recursive: true });
    fs.writeFileSync(targetFullPath, originalContent, 'utf-8');

    await page.evaluate(
      ({ sugId, tp, nc }) => {
        return (window as any).api.suggestionsUpsert({
          id: sugId,
          source_agent: 'writing-assistant',
          confidence: 0.88,
          rationale: 'TC-S-03 rollback test',
          target_kind: 'vault',
          target_path: tp,
          target_anchor: null,
          payload_json: JSON.stringify({ content: nc }),
          status: 'proposed',
          created_at: new Date().toISOString(),
          applied_at: null,
          applied_run_id: null,
          budget_exceeded: 0,
        });
      },
      { sugId: id, tp: targetPath, nc: newContent },
    );

    await openReviewTab();

    const suggRow = page.locator('.sr-row', { hasText: 'TC-S-03 rollback test' });
    await expect(suggRow).toBeVisible({ timeout: 8_000 });

    // Accept — this writes new content and creates snapshot.
    await suggRow.locator('.sr-btn-accept').click();
    await expect(suggRow).not.toBeVisible({ timeout: 5_000 });

    // Wait for vault file to contain new content.
    const newContentWritten = await waitUntil(() => {
      try {
        return fs.readFileSync(targetFullPath, 'utf-8').includes('UPDATED BY TC-S-03');
      } catch { return false; }
    }, 8_000);
    expect(newContentWritten, 'Vault file should have new content after accept').toBe(true);

    // Rollback via IPC (suggestion status is now 'applied', rollback is valid).
    const rollbackResult = await page.evaluate((sugId) => {
      return (window as any).api.suggestionsRollback(sugId);
    }, id) as { id: string; auditId: string; restoredPath: string | null };

    expect(rollbackResult.id).toBe(id);

    // Vault file must be restored to its original content.
    const restoredContent = fs.readFileSync(targetFullPath, 'utf-8');
    expect(restoredContent).toBe(originalContent);

    // Audit log must have both apply and rollback rows.
    const auditResult = await page.evaluate((sugId) => {
      return (window as any).api.auditList(sugId);
    }, id) as { entries: Array<{ action: string }> };

    const actions = auditResult.entries.map((e) => e.action);
    expect(actions).toContain('apply');
    expect(actions).toContain('rollback');
  });
});

// ─── TC-S-04: Per-agent budget cap ────────────────────────────────────────────
//
// Uses a dedicated app instance seeded with autoApply=true and a hard cap of
// maxSuggestionsPerHour=1.  After a single upsert the suggestion count in the
// rolling window equals the cap, so the IPC handler sets budget_exceeded=1 and
// does NOT auto-apply the suggestion.

test.describe('Budget cap enforcement (TC-S-04)', () => {
  let userData: string;
  let vaultDir: string;
  let app: ElectronApplication | undefined;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-budget-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-budget-vault-'));
    seedBudgetUserData(userData, vaultDir);
    app = await launchApp(userData);
    page = await firstWindow(app);
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  test('TC-S-04: over-budget suggestion has budget_exceeded=1 and stays proposed', async () => {
    const id = `tc-s-04-${Date.now()}`;
    const targetPath = 'suggestions/tc-s-04.md';

    // Confidence 0.95 > threshold 0.8 so budget enforcement is reached.
    // After insertion, countSuggestionsInWindowWithDb returns 1 which satisfies
    // 1 >= maxSuggestionsPerHour (1) → budgetExceeded=true, no auto-apply.
    await page.evaluate(
      ({ sugId, tp }) => {
        return (window as any).api.suggestionsUpsert({
          id: sugId,
          source_agent: 'writing-assistant',
          confidence: 0.95,
          rationale: 'TC-S-04 budget cap test',
          target_kind: 'vault',
          target_path: tp,
          target_anchor: null,
          payload_json: JSON.stringify({ content: 'budget-blocked' }),
          status: 'proposed',
          created_at: new Date().toISOString(),
          applied_at: null,
          applied_run_id: null,
          budget_exceeded: 0,
        });
      },
      { sugId: id, tp: targetPath },
    );

    // Brief settle — the handler is synchronous but IPC round-trip takes a tick.
    await page.waitForTimeout(300);

    // Fetch proposed suggestions.
    const listResult = await page.evaluate(() => {
      return (window as any).api.suggestionsList('proposed');
    }) as { suggestions: Array<{ id: string; status: string; budget_exceeded: number }> };

    const s = listResult.suggestions.find((row) => row.id === id);
    expect(s, 'Budget-exceeded suggestion must still appear in the proposed list').toBeDefined();
    expect(s!.status).toBe('proposed'); // not auto-applied
    expect(s!.budget_exceeded).toBe(1); // throttled — marked for review

    // Vault file must NOT have been written (auto-apply was blocked).
    const targetFullPath = path.join(vaultDir, targetPath);
    expect(
      fs.existsSync(targetFullPath),
      'Vault file must not be written when suggestion is over budget',
    ).toBe(false);
  });
});
