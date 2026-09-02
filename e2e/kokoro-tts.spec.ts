/**
 * kokoro-tts.spec.ts — SKY-11243 (SKY-11230 Part 2)
 *
 * Real, in-app verification that the bundled Kokoro offline neural voice
 * actually synthesizes through the running Electron app — the "packaged app"
 * check the ticket requires, not just a Node repro or mocked IPC.
 *
 * It launches the real main process, points it at the bundled Kokoro assets via
 * MYTHOS_KOKORO_DIR, and round-trips `window.api.voiceSpeak(text, 'kokoro:sky')`
 * through the UNMOCKED voice:speak handler → the onnxruntime-web WASM engine →
 * PCM chunks, asserting the audio is real (24 kHz, clearly non-silent) with NO
 * system-voice fallback (SKY-11230/11242 acceptance).
 *
 * NOT wired into required CI: the model weights (~86 MB) are fetched at build
 * time (`npm run kokoro:fetch`) and are absent on a lean checkout, so the suite
 * skips itself when they are missing. Run on demand:
 *   npm run kokoro:fetch && npm run test:e2e:kokoro
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

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const KOKORO_DIR = path.resolve(__dirname, '../electron-main/resources/kokoro');
const MODEL_PATH = path.join(KOKORO_DIR, 'model_q8f16.onnx');
const HAS_MODEL = fs.existsSync(MODEL_PATH);

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {},
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    // No tts binary/key configured on purpose: Kokoro is a bundled built-in
    // engine that must work with zero setup, selected by the voice id alone.
  };
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: notesVaultDir };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', '--force-prefers-reduced-motion', ...extraArgs],
    env: { ...process.env, MYTHOS_KOKORO_DIR: KOKORO_DIR },
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  await pg.waitForFunction(() => Boolean((window as unknown as { api?: unknown }).api), null, { timeout: 20_000 });
  return pg;
}

test.describe('SKY-11243 — bundled Kokoro offline voice through the running app', () => {
  let userData: string;
  let vaultDir: string;
  let notesVaultDir: string;
  let app: ElectronApplication | undefined;
  let page: Page;

  test.beforeAll(async () => {
    test.skip(
      !HAS_MODEL,
      `bundled Kokoro model not present at ${MODEL_PATH} — run \`npm run kokoro:fetch\` first`,
    );
    test.setTimeout(120_000);
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-kokoro-user-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-kokoro-vault-'));
    notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-kokoro-notes-'));
    seedUserData(userData, vaultDir, notesVaultDir);
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
    for (const dir of [userData, vaultDir, notesVaultDir]) {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('kokoro:sky synthesizes real, non-silent 24kHz PCM (no system fallback)', async () => {
    test.setTimeout(90_000);
    const result = await page.evaluate(async () => {
      const api = (window as unknown as {
        api: {
          voiceSpeak: (t: string, voiceId?: string) => Promise<{ speakId?: string; error?: string }>;
          onVoiceSpeakChunk: (cb: (e: { speakId: string; chunk: Uint8Array }) => void) => () => void;
          onVoiceSpeakDone: (cb: (e: { speakId: string; format?: string; sampleRate?: number }) => void) => () => void;
          onVoiceSpeakError: (cb: (e: { speakId: string; error: string }) => void) => () => void;
        };
      }).api;

      const chunks: number[][] = [];
      let done: { format?: string; sampleRate?: number } | null = null;
      let speakError: string | null = null;

      const offChunk = api.onVoiceSpeakChunk((e) => chunks.push(Array.from(e.chunk)));
      const offDone = api.onVoiceSpeakDone((e) => { done = { format: e.format, sampleRate: e.sampleRate }; });
      const offError = api.onVoiceSpeakError((e) => { speakError = e.error; });

      const started = await api.voiceSpeak('Sky reads your story aloud, fully offline.', 'kokoro:sky');
      if (started.error) {
        offChunk(); offDone(); offError();
        return { error: started.error };
      }

      const deadline = Date.now() + 75_000;
      while (!done && !speakError && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      offChunk(); offDone(); offError();

      if (speakError) return { error: speakError };
      if (!done) return { error: 'voice:speak:done never fired within timeout' };
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { merged.set(c, off); off += c.length; }
      return {
        format: (done as { format?: string }).format,
        sampleRate: (done as { sampleRate?: number }).sampleRate,
        pcm: Array.from(merged),
      };
    });

    expect(result.error, `kokoro voice:speak failed: ${result.error}`).toBeUndefined();
    expect(result.format).toBe('pcm');
    expect(result.sampleRate).toBe(24000);
    const pcm = Buffer.from(result.pcm as number[]);
    expect(pcm.length).toBeGreaterThan(4000);

    // Clearly non-silent: RMS well above the ~0.005 silence floor.
    const samples = pcm.length / 2;
    let sum = 0;
    for (let i = 0; i < samples; i++) sum += (pcm.readInt16LE(i * 2) / 32768) ** 2;
    const rms = Math.sqrt(sum / samples);
    expect(rms).toBeGreaterThan(0.01);
  });
});
