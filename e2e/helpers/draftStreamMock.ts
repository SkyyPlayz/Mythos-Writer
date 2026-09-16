import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';

/**
 * Deterministic, no-network stand-in for the Scene Crafter first-pass draft
 * stream. Only the provider call (`stream:start`) is stubbed — the preload
 * bridge, `stream:token` / `stream:end` delivery and `useIpcStream` stay real
 * (SKY-7994).
 *
 * SKY-11514: the previous spec-local mocks emitted token + end on a fixed
 * 30 ms timer inside the `stream:start` handler. The renderer only subscribes
 * in `useIpcStream`'s passive effect — after the `streamId` state commits and
 * paints — so a paint slower than 30 ms (the GitHub runner's software
 * rasterizer under Scene Crafter's Liquid Neon blur) lost `stream:end`, the
 * card never rendered, and `e2e-shard-4` went red 9/9. The mock now records
 * who asked and emits nothing on its own; `emitMockDraft` delivers the text
 * only once the test has observed the renderer in its streaming state.
 */

const MOCK_STREAM_ID = 'mock-draft-stream';

interface DraftStreamMockState {
  streamId: string;
  text: string;
  /** The `stream:start` requester's WebContents — null until Generate is clicked. */
  sender: { send: (channel: string, payload: unknown) => void } | null;
}

type MainGlobal = typeof globalThis & { __draftStreamMock?: DraftStreamMockState };

/** Replace the `stream:start` handler with one that records the requester. */
export async function installDraftStreamMock(app: ElectronApplication, text: string): Promise<void> {
  await app.evaluate(({ ipcMain }, args) => {
    const g = globalThis as MainGlobal;
    g.__draftStreamMock = { streamId: args.streamId, text: args.text, sender: null };
    try { ipcMain.removeHandler('stream:start'); } catch { /* not registered */ }
    ipcMain.handle('stream:start', (event) => {
      g.__draftStreamMock!.sender = event.sender;
      return { streamId: args.streamId };
    });
  }, { text, streamId: MOCK_STREAM_ID });
}

/** Deliver the mocked draft (one token, then end) to whoever called `stream:start`. */
export async function emitMockDraft(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const mock = (globalThis as MainGlobal).__draftStreamMock;
    if (!mock?.sender) throw new Error('draftStreamMock: stream:start was never invoked — install the mock and click Generate first');
    mock.sender.send('stream:token', { streamId: mock.streamId, token: mock.text });
    mock.sender.send('stream:end', { streamId: mock.streamId });
  });
}

/**
 * Click Generate, wait until the renderer is visibly streaming (the
 * `streamId` commit that also arms `useIpcStream`'s listeners), then emit the
 * mocked draft and return the rendered card.
 */
export async function generateMockDraft(app: ElectronApplication, page: Page): Promise<Locator> {
  await page.locator('.sc-draft-btn', { hasText: 'Generate' }).click();
  await expect(page.getByTestId('sc-draft-generating')).toBeVisible({ timeout: 8_000 });
  await emitMockDraft(app);
  const card = page.locator('[data-testid="sc-draft-card"]');
  await expect(card).toBeVisible({ timeout: 8_000 });
  return card;
}
