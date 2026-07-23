/**
 * streamingFrames.ts — SKY-8217 metric 4 support: "No dropped frames with
 * agents live."
 *
 * Drives a REAL Writing Coach chat streaming session — the only thing mocked
 * is the `agent:writing-assistant` IPC handler in the Electron main process
 * (the Anthropic network boundary), exactly like e2e/writing-assistant.spec.ts
 * already does via its `installIpcMocks`. This module reuses that same
 * `agent:writing-assistant` / `agent:writing-assistant:chunk` channel
 * contract verbatim — it does not invent a new mock shape or IPC channel.
 *
 * This file only installs the mock, opens the chat panel, and sends a
 * prompt — it does NOT sample frames. The integration spec is expected to
 * call `sampleFrameDeltas`/`summarizeFrames` (animationFps.ts) concurrently
 * with `sendPromptAndWaitForStreamStart`'s returned promise, e.g. via
 * `Promise.all`, so frame-drop can be measured while the stream is live and
 * compared against the metric-3 idle baseline.
 */
import type { ElectronApplication, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Small, deterministic word bank for generating lorem-ipsum-style stream
 * tokens. Not meant to be prose — just short, distinct chunks that exercise
 * the renderer's per-chunk append path the same way a real streamed
 * completion would.
 */
const LOREM_WORDS = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
  'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et',
  'dolore', 'magna', 'aliqua', 'enim', 'minim', 'veniam', 'quis', 'nostrud',
  'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex',
];

/** Generates `count` short word tokens (each with a trailing space) cycling through LOREM_WORDS. */
function generateLoremTokens(count: number): string[] {
  const tokens: string[] = [];
  for (let i = 0; i < count; i++) {
    tokens.push(`${LOREM_WORDS[i % LOREM_WORDS.length]} `);
  }
  return tokens;
}

export interface StreamingMockOptions {
  /** Number of streamed chunks to emit. Default 30. */
  tokenCount?: number;
  /** Delay in ms between chunks. Default 100. */
  chatDelayMs?: number;
}

/**
 * Installs ONLY the `agent:writing-assistant` chat-stream IPC mock in the
 * Electron main process — not the full Writing Assistant mock surface
 * (tips/beta-read/voice) that e2e/writing-assistant.spec.ts's
 * `installIpcMocks` sets up, since this harness only needs the chat stream.
 *
 * Defaults (tokenCount=30, chatDelayMs=100) keep a streaming window open for
 * ~3 seconds, giving `sampleFrameDeltas` (animationFps.ts) room to capture a
 * meaningful number of frames concurrently while the stream is in flight.
 */
export async function installMockChatStream(
  app: ElectronApplication,
  opts: StreamingMockOptions = {},
): Promise<void> {
  const { tokenCount = 30, chatDelayMs = 100 } = opts;
  const chatTokens = generateLoremTokens(tokenCount);
  const chatResponse = chatTokens.join('');

  await app.evaluate(
    async (
      { ipcMain },
      args: { chatTokens: string[]; chatResponse: string; chatDelayMs: number },
    ) => {
      try {
        ipcMain.removeHandler('agent:writing-assistant');
      } catch {
        /* not yet registered */
      }
      ipcMain.handle('agent:writing-assistant', async (event) => {
        for (const token of args.chatTokens) {
          await new Promise<void>((r) => setTimeout(r, args.chatDelayMs));
          if (!event.sender.isDestroyed()) {
            event.sender.send('agent:writing-assistant:chunk', { chunk: token });
          }
        }
        return { text: args.chatResponse };
      });
    },
    { chatTokens, chatResponse, chatDelayMs },
  );
}

/**
 * Opens the Writing Coach chat view in the agent hub panel.
 *
 * Assumes the caller already navigated to the editor and opened a scene
 * (e.g. via `openSeededScene` in launch.ts) so the panel has scene context —
 * this only expands the panel and drills into the chat row, mirroring
 * `openAssistantTab` in e2e/writing-assistant.spec.ts.
 */
export async function openWritingCoachChat(page: Page): Promise<void> {
  const waHeader = page.getByRole('button', { name: 'Writing Coach panel' });
  if ((await waHeader.getAttribute('aria-expanded')) !== 'true') {
    await waHeader.click();
  }
  const hubPanel = page.locator('[data-testid="agent-hub-panel"]');
  await expect(hubPanel).toBeVisible({ timeout: 4_000 });
  const agentRow = page.locator('[aria-label="Open Writing Coach chat"]');
  if (await agentRow.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await agentRow.click();
  }
  await expect(page.locator('.writing-assistant-panel')).toBeAttached({ timeout: 8_000 });
}

/**
 * Fills the Writing Coach prompt box, clicks Ask, and returns as soon as the
 * FIRST streamed chunk has visibly landed — not once the whole response has
 * finished. Callers want to sample frames WHILE the stream is still going,
 * so this deliberately does not wait for stream completion.
 *
 * "Stream has started" reuses the same signal e2e/writing-assistant.spec.ts's
 * TC-WA-10 uses to detect an in-progress assistant message: the `.wa-cursor`
 * streaming-cursor glyph becoming visible (rendered only while a response is
 * actively streaming in).
 */
export async function sendPromptAndWaitForStreamStart(page: Page, prompt: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Writing coach prompt' });
  await expect(input).toBeVisible({ timeout: 5_000 });
  await expect(input).toBeEnabled({ timeout: 5_000 });
  await input.fill(prompt);

  const askBtn = page.getByRole('button', { name: 'Ask' });
  await expect(askBtn).toBeEnabled({ timeout: 5_000 });
  await askBtn.click();

  await expect(page.locator('.wa-cursor')).toBeVisible({ timeout: 6_000 });
}
