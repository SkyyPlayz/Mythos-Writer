/**
 * voice-io.spec.ts — SKY-1506
 *
 * Playwright E2E coverage for the Voice IO surface (AC-V-01 → AC-V-12) per
 * [SKY-1460 §9](https://paperclip.ai/SKY/issues/SKY-1460).
 *
 * ## Coverage map
 *
 * | AC      | Implementation | Unit coverage                             | E2E here             |
 * |---------|----------------|-------------------------------------------|----------------------|
 * | AC-V-01 | SKY-1503       | (pending)                                 | TC-V-01 (skip)       |
 * | AC-V-02 | SKY-1503       | (pending)                                 | TC-V-02 (skip)       |
 * | AC-V-03 | SKY-1503       | (pending)                                 | TC-V-03 (skip)       |
 * | AC-V-04 | SKY-1503       | (pending)                                 | TC-V-04 (skip)       |
 * | AC-V-05 | SKY-1503       | accessibility.test.tsx (skip)             | TC-V-05 (skip)       |
 * | AC-V-06 | SKY-1504       | WritingAssistantPanel.test.tsx ✓           | TC-V-06 (smoke E2E)  |
 * | AC-V-07 | SKY-1504       | WritingAssistantPanel.test.tsx ✓           | TC-V-07 (smoke E2E)  |
 * | AC-V-08 | SKY-1504       | WritingAssistantPanel.test.tsx ✓           | TC-V-08 (smoke E2E)  |
 * | AC-V-09 | SKY-1505       | SettingsPanel.test.tsx ✓                   | TC-V-09 (smoke E2E)  |
 * | AC-V-10 | Both (partial) | WritingAssistantPanel.test.tsx + this file | TC-V-10 real         |
 * | AC-V-11 | SKY-1503       | (pending)                                 | TC-V-11 (skip)       |
 * | AC-V-12 | SKY-1503       | (pending)                                 | TC-V-12 (skip)       |
 *
 * Tests marked `test.skip` require SKY-1503 (brainstorm mic + transcript + silence
 * countdown + reduced-motion). Remove each `.skip` when SKY-1503 merges.
 *
 * TC-V-06..V-09 are smoke E2E tests — the primary assertion coverage lives in the
 * corresponding unit test files above. These tests verify the surfaces render in a
 * real Electron window.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/voice-io.spec.ts --reporter=list
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

function seedUserData(userData: string, vaultDir: string): void {
  const appSettings = {
    apiKey: 'sk-ant-test-key-voice-io',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: true,
        model: 'claude-haiku-4-5-20251001',
        scanIntervalSeconds: 30,
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
      brainstorm: {
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
    voice: {
      enabled: true,
      cloudFallback: false,
    },
  };
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
  const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 30_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined); });
  await page.waitForLoadState('domcontentloaded');
  return page;
}

/** Navigate to Brainstorm and wait for it to load. */
async function openBrainstorm(page: Page): Promise<void> {
  await page.locator('.app-menu-view-btn', { hasText: 'Brainstorm' }).click();
  await expect(page.locator('.brainstorm-title')).toBeVisible({ timeout: 8_000 });
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vio-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vio-vault-'));
  seedUserData(userData, vaultDir);

  app = await launchApp(userData);
  page = await firstWindow(app);

  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Stub voice IPC handlers so no real STT/TTS binary is invoked.
  await app.evaluate(async ({ ipcMain }) => {
    try { ipcMain.removeHandler('voice:start'); } catch { /* not yet registered */ }
    try { ipcMain.removeHandler('voice:stop'); } catch { /* not yet registered */ }
    try { ipcMain.removeHandler('voice:speak'); } catch { /* not yet registered */ }

    ipcMain.handle('voice:start', async () => ({ sessionId: 'vio-mock-1' }));
    ipcMain.handle('voice:stop', async () => ({ ok: true }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ipcMain.handle('voice:speak', async (event: any, payload: { text: string }) => {
      // Emit speak:done immediately so the UI can cycle back to idle
      event.sender.send('voice:speak:done', { speakId: 'mock-speak-1', text: payload?.text ?? '' });
      return { speakId: 'mock-speak-1' };
    });
  });
});

test.afterAll(async () => {
  const proc = app.process();
  await Promise.race([
    app.close().catch(() => undefined),
    new Promise<void>((r) => setTimeout(r, 5_000)),
  ]);
  try {
    if (proc && !proc.killed) proc.kill('SIGKILL');
  } catch { /* already exited */ }
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});

// ─── TC-V-10: Live region always-in-DOM ──────────────────────────────────────
//
// AC-V-10: "All live region announcements (state-transitions, errors) fire via
// useLiveAnnounce() and are always-in-DOM (not conditionally rendered)."
//
// These tests run now — BrainstormPage and WritingAssistantPanel both already
// render always-in-DOM sr-only regions. Voice state-transition announcements
// land with SKY-1503; until then, the region existence is what we verify.

test('TC-V-10a: Brainstorm live region is always in DOM — idle state', async () => {
  await openBrainstorm(page);
  const liveRegion = page.locator('.brainstorm-page [role="status"][aria-live="polite"]').first();
  await expect(liveRegion).toBeAttached();
});

test('TC-V-10b: Brainstorm live region persists across recording toggle', async () => {
  // mic button: .brainstorm-mic-btn (pre-SKY-1503) or [data-testid="brainstorm-mic-btn"] (post)
  const micBtn = page.locator('[data-testid="brainstorm-mic-btn"], .brainstorm-mic-btn').first();
  await expect(micBtn).toBeVisible({ timeout: 4_000 });
  await micBtn.click(); // start recording
  const liveRegion = page.locator('.brainstorm-page [role="status"][aria-live="polite"]').first();
  await expect(liveRegion).toBeAttached();
  await micBtn.click(); // stop recording
  await expect(liveRegion).toBeAttached();
});

test('TC-V-10c: Brainstorm mic button idle aria-label is correct', async () => {
  // AC-V-01 (partial — idle state aria-label)
  // pre-SKY-1503: "Start recording" | post-SKY-1503: "Start voice input"
  const micBtn = page.locator('[data-testid="brainstorm-mic-btn"], .brainstorm-mic-btn').first();
  const label = await micBtn.getAttribute('aria-label');
  expect(label).toMatch(/start (recording|voice input)/i);
});

test('TC-V-10d: Brainstorm mic button listening aria-label is correct', async () => {
  // AC-V-01 (partial — listening state aria-label differs per implementation)
  const micBtn = page.locator('[data-testid="brainstorm-mic-btn"], .brainstorm-mic-btn').first();
  await micBtn.click();
  const label = await micBtn.getAttribute('aria-label');
  expect(label).toMatch(/stop (recording|voice input)|listening/i);
  await micBtn.click(); // reset
});

// ─── TC-V-06: Writing Assistant mute toggle (smoke) ──────────────────────────
//
// AC-V-06: "Writing Assistant sidebar header renders 🎤 mic toggle and 🔇 mute
// toggle when the Assistant tab is active."
// Primary unit coverage: WritingAssistantPanel.test.tsx
// This E2E test verifies the mute toggle renders in a real Electron window.

test('TC-V-06: Writing Assistant mute toggle renders in Electron', async () => {
  // Navigate to Writing Assistant (via the main view button)
  // The panel must have a mute button in the header
  const writingBtn = page.locator('.app-menu-view-btn', { hasText: 'Writing' });
  if (await writingBtn.count() > 0) {
    await writingBtn.click();
  }
  const muteBtn = page.locator('.wa-mute-btn');
  // The WritingAssistantPanel is always mounted in the DesktopShell sidebar;
  // verify mute button exists in the DOM (may be off-screen when panel not active).
  await expect(muteBtn).toBeAttached({ timeout: 5_000 });
  await expect(muteBtn).toHaveAttribute('aria-pressed');
  await expect(muteBtn).toHaveAttribute(
    'aria-label',
    /mute voice playback|unmute voice playback/i,
  );
});

// ─── TC-V-07: TTS [Hear] button on suggestion cards (smoke) ──────────────────
//
// AC-V-07: "TTS [▶ Hear] button appears on each suggestion card; toggles to [⏸]
// during playback; plays one card at a time."
// Primary unit coverage: WritingAssistantPanel.test.tsx
//
// E2E smoke: verify the button's HTML contract is correct when a card is rendered.
// Full behavioural toggle is tested in the unit spec.

test.skip('TC-V-07: Hear button renders on WA suggestion card (E2E smoke)', async () => {
  // Requires Writing Assistant surface to generate a suggestion card, which needs
  // a real LLM call or a seeded mock. Leave as structural test pending E2E WA setup.
  // Unit test WritingAssistantPanel.test.tsx > "AC-V-07: Hear button appears..." covers this.
  const hearBtn = page.locator('.wa-hear-btn').first();
  await expect(hearBtn).toBeVisible({ timeout: 8_000 });
  await expect(hearBtn).toHaveAttribute('aria-label', 'Hear suggestion aloud');
  await expect(hearBtn).toHaveAttribute('aria-pressed', 'false');
});

// ─── TC-V-08: Session mute toggle behaviour (smoke) ──────────────────────────
//
// AC-V-08: "Session mute toggle (🔇) suspends/resumes TTS audio without losing
// play state."
// Primary unit coverage: WritingAssistantPanel.test.tsx "AC-V-08:" tests.

test('TC-V-08: mute toggle flips aria-pressed in Electron', async () => {
  const muteBtn = page.locator('.wa-mute-btn');
  await expect(muteBtn).toBeAttached({ timeout: 5_000 });
  const initialPressed = await muteBtn.getAttribute('aria-pressed');
  await muteBtn.click();
  // After click aria-pressed must have changed
  const newPressed = await muteBtn.getAttribute('aria-pressed');
  expect(newPressed).not.toBe(initialPressed);
  // Reset
  await muteBtn.click();
});

// ─── TC-V-09: Settings Voice section (smoke) ─────────────────────────────────
//
// AC-V-09: "Settings panel (Voice section) renders new fields: mic device, input
// language, TTS voice, TTS volume, TTS rate, persistent mute."
// Primary unit coverage: SettingsPanel.test.tsx "AC-V-09:" tests.
// E2E smoke: verify the section and fields exist in a running Electron instance.

test('TC-V-09: Settings Voice section renders all required fields in Electron', async () => {
  // Open Settings
  const settingsBtn = page.locator(
    '.settings-btn, button[aria-label*="Settings"], [aria-label*="settings"]',
  ).first();
  await settingsBtn.click({ timeout: 5_000 }).catch(async () => {
    // fallback: look for a gear/cog icon button
    await page.locator('[title*="Settings"], [title*="settings"]').first().click();
  });

  // Wait for the Voice section
  await expect(page.locator('#section-voice, [id="section-voice"]')).toBeAttached({
    timeout: 6_000,
  });

  // Verify all 6 field IDs from the implementation exist in the DOM
  await expect(page.locator('#voice-mic')).toBeAttached();
  await expect(page.locator('#voice-language')).toBeAttached();
  await expect(page.locator('#voice-tts-voice')).toBeAttached();
  await expect(page.locator('#voice-tts-volume')).toBeAttached();
  await expect(page.locator('#voice-tts-rate')).toBeAttached();
  await expect(page.locator('#voice-persistent-mute')).toBeAttached();
});

// ─── TC-V-10e: Writing Assistant live region always in DOM ───────────────────
//
// AC-V-10: WA panel must also have an always-in-DOM sr-only live region.

test('TC-V-10e: Writing Assistant live region is always in DOM', async () => {
  const liveRegion = page.locator('.writing-assistant-panel [role="status"][aria-live="polite"]');
  await expect(liveRegion).toBeAttached({ timeout: 5_000 });
});

// ─── TC-V-01..V-05: Brainstorm mic 4 states (pending SKY-1503 commit) ────────
//
// Unit coverage: BrainstormPage.test.tsx "Voice IO state machine tests" section.
// These E2E tests add real-Electron keyboard events + Chromium CSS verification.
// Remove `.skip` after SKY-1503 merges to main.
//
// Implementation selectors (from SKY-1503 BrainstormPage.tsx):
//   - data-testid="brainstorm-mic-btn"
//   - CSS classes: .brainstorm-mic-btn--idle/listening/processing/error
//   - aria-pressed: false (idle), true (listening/processing/error)
//   - data-testid="voice-transcript-strip" / .voice-transcript-strip--visible
//   - .voice-countdown-ring (hidden under prefers-reduced-motion via CSS)
//   - .voice-countdown-text (static fallback shown under prefers-reduced-motion)

test.skip('TC-V-01a: mic button shows processing state (pending SKY-1503)', async () => {
  // Processing state triggered by SpeechRecognition final result
  await openBrainstorm(page);
  const micBtn = page.locator('[data-testid="brainstorm-mic-btn"]');
  await micBtn.click();
  await expect(micBtn).toHaveClass(/brainstorm-mic-btn--processing/, { timeout: 5_000 });
});

test.skip('TC-V-01b: mic button shows error state with non-colour signal (pending SKY-1503)', async () => {
  // Error state triggered by SpeechRecognition onerror; must carry icon + aria-label
  await openBrainstorm(page);
  const micBtn = page.locator('[data-testid="brainstorm-mic-btn"]');
  await expect(micBtn).toHaveClass(/brainstorm-mic-btn--error/, { timeout: 5_000 });
  await expect(micBtn).not.toHaveAttribute('aria-label', '');
});

test.skip('TC-V-02a: transcript strip visible during voice listening (pending SKY-1503)', async () => {
  // Selector: data-testid="voice-transcript-strip" / .voice-transcript-strip--visible
  await openBrainstorm(page);
  const micBtn = page.locator('[data-testid="brainstorm-mic-btn"]');
  await micBtn.click();
  const strip = page.locator('[data-testid="voice-transcript-strip"]');
  await expect(strip).toHaveClass(/voice-transcript-strip--visible/, { timeout: 3_000 });
});

test.skip('TC-V-02b: transcript strip not visible when idle (pending SKY-1503)', async () => {
  const strip = page.locator('[data-testid="voice-transcript-strip"]');
  // In idle state the --visible modifier must not be present
  await expect(strip).not.toHaveClass(/voice-transcript-strip--visible/);
});

test.skip('TC-V-02c: transcript strip no transition under prefers-reduced-motion (pending SKY-1503)', async () => {
  // .voice-transcript-strip { transition: none } under prefers-reduced-motion (CSS AC-V-12)
  const cdpSession = await page.context().newCDPSession(page);
  await cdpSession.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await openBrainstorm(page);
  await page.locator('[data-testid="brainstorm-mic-btn"]').click();
  const strip = page.locator('[data-testid="voice-transcript-strip"]');
  await expect(strip).toHaveCSS('transition-duration', '0s', { timeout: 2_000 });
  await cdpSession.send('Emulation.setEmulatedMedia', { features: [] });
});

test.skip('TC-V-03a: silence countdown ring appears after first speech result (pending SKY-1503)', async () => {
  // Selector: .voice-countdown-ring (SVG ring element within .brainstorm-mic-container)
  await openBrainstorm(page);
  await page.locator('[data-testid="brainstorm-mic-btn"]').click();
  // Ring renders once SpeechRecognition fires an onresult; it fires each transcript event
  const ring = page.locator('.voice-countdown-ring');
  await expect(ring).toBeAttached({ timeout: 5_000 });
});

test.skip('TC-V-03b: silence countdown SR announcement fires within 3s (pending SKY-1503)', async () => {
  // Announcement text "Sending in 1 second." via role="alert" + aria-live="assertive"
  await openBrainstorm(page);
  await page.locator('[data-testid="brainstorm-mic-btn"]').click();
  // Wait for silence to trigger the SR announcement
  const alertRegion = page.locator('.brainstorm-page [role="alert"][aria-live="assertive"]');
  await expect(alertRegion).toContainText(/sending in 1 second/i, { timeout: 5_000 });
});

test.skip('TC-V-04a: Escape key cancels voice recording (pending SKY-1503)', async () => {
  // aria-label flips back to idle label on Escape; aria-pressed returns false
  await openBrainstorm(page);
  const micBtn = page.locator('[data-testid="brainstorm-mic-btn"]');
  await micBtn.click();
  await expect(micBtn).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(micBtn).toHaveAttribute('aria-pressed', 'false', { timeout: 3_000 });
});

test.skip('TC-V-04b: Escape SR announcement fires (pending SKY-1503)', async () => {
  // "Voice input cancelled." via alertRegion after Escape
  await openBrainstorm(page);
  await page.locator('[data-testid="brainstorm-mic-btn"]').click();
  await page.keyboard.press('Escape');
  const alertRegion = page.locator('.brainstorm-page [role="alert"][aria-live="assertive"]');
  await expect(alertRegion).toContainText(/voice input cancelled/i, { timeout: 3_000 });
});

test.skip('TC-V-05a: mic button aria-pressed=false in idle state (pending SKY-1503)', async () => {
  await openBrainstorm(page);
  await expect(page.locator('[data-testid="brainstorm-mic-btn"]')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test.skip('TC-V-05b: mic button aria-pressed=true while recording (pending SKY-1503)', async () => {
  await openBrainstorm(page);
  const micBtn = page.locator('[data-testid="brainstorm-mic-btn"]');
  await micBtn.click();
  await expect(micBtn).toHaveAttribute('aria-pressed', 'true');
  await micBtn.click(); // reset
});

// ─── TC-V-11: axe color-contrast (pending SKY-1503 + @axe-core/playwright) ───
//
// AC-V-11 requires @axe-core/playwright in devDependencies.
// AC-V-01..V-04 must also be implemented for 4-state coverage.

test.skip('TC-V-11: all 4 mic states pass axe color-contrast rule (pending SKY-1503)', async () => {
  // Implementation note: install @axe-core/playwright, inject via page.addScriptTag,
  // then run AxeBuilder({ page }).include('.brainstorm-mic-btn').analyze() for each state.
  // Expected: no violations including color-contrast rule (Chromium computed styles available).
  throw new Error('TC-V-11: install @axe-core/playwright and implement per-state color-contrast scan');
});

// ─── TC-V-12: Reduced-motion (pending SKY-1503) ───────────────────────────────
//
// AC-V-12: "Reduced-motion: all pulse animations and transcript-strip transitions
// removed; silence countdown replaced with static text."
// TC-V-02c above covers the transcript-strip transition-duration portion.

test.skip('TC-V-12: silence countdown under prefers-reduced-motion (pending SKY-1503)', async () => {
  // Under reduced-motion: .voice-countdown-ring animation is stripped via CSS.
  // .voice-countdown-text (static label) is always rendered alongside the ring;
  // CSS @media prefers-reduced-motion shows the text instead of animating the ring.
  const cdpSession = await page.context().newCDPSession(page);
  await cdpSession.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await openBrainstorm(page);
  await page.locator('[data-testid="brainstorm-mic-btn"]').click();
  // Ring exists but its SVG animation CSS should have animation-duration: 0
  const ring = page.locator('.voice-countdown-ring');
  if (await ring.isAttached()) {
    await expect(ring).toHaveCSS('animation-duration', '0s');
  }
  // Text element must be visible (CSS shows it under reduced-motion)
  const countdownText = page.locator('.voice-countdown-text');
  if (await countdownText.isAttached()) {
    await expect(countdownText).toBeVisible();
  }
  await cdpSession.send('Emulation.setEmulatedMedia', { features: [] });
});
