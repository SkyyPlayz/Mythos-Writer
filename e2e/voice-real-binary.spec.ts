/**
 * voice-real-binary.spec.ts — SKY-3191
 *
 * Real-binary, in-app verification of the local whisper.cpp/Piper spawn path.
 * This is the "running, packaged app" check the ticket's Definition of
 * Excellent requires (not just green CI, not just an isolated Node repro
 * script) — every other automated check for this feature stops short of it:
 *   - `electron-main/src/voice.test.ts` / `voiceGate.test.ts` mock
 *     `child_process.spawn` entirely.
 *   - `e2e/voice-io.spec.ts` stubs `voice:transcribe`/`voice:speak` at the IPC
 *     layer (`setVoiceTranscribeMock`) to drive UI-state tests.
 *   - Prior QA passes (see SKY-3191 issue comments) downloaded real binaries
 *     and reproduced the app's exact spawn args in standalone Node scripts —
 *     real binaries, but not through the running app.
 *
 * This spec closes that gap: it launches the real packaged Electron app,
 * seeds real settings so the app trusts real downloaded whisper.cpp/Piper
 * binaries (bypassing only the native OS file-picker dialog — everything
 * downstream of that, including the MYT-788 trusted-set gate, is exercised
 * for real), and round-trips real audio through the unmocked
 * `window.api.voiceSpeak` → `window.api.voiceTranscribe` IPC handlers.
 *
 * NOT wired into required CI: downloads ~150MB of binaries/models from
 * GitHub/HuggingFace on first run, which is too slow/network-fragile for a
 * required PR gate. Run on demand: `npm run test:e2e:voice-real-binary`.
 * Fixtures cache under os.tmpdir() across runs (keyed by a fixed dir name)
 * so repeat local runs skip the download.
 *
 * Fixture URLs are keyed on process.platform + process.arch (SKY-8121); on
 * hosts with no published fixture binaries (e.g. macOS — whisper.cpp ships no
 * macOS CLI build) the suite skips with an explicit reason instead of failing.
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { execFileSync } from 'child_process';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const FIXTURE_DIR = path.join(os.tmpdir(), 'mythos-voice-real-binary-fixtures');

/**
 * Fixture binaries keyed by `${process.platform}-${process.arch}`. Combos with
 * no entry skip the suite with an explicit reason instead of failing on a
 * wrong-arch download (SKY-8121 / GH#1050).
 *
 * darwin has no entry: whisper.cpp v1.9.1 publishes no macOS CLI binary
 * (only an xcframework), so there is no fixture to download — Piper does ship
 * macos_aarch64/macos_x64 tarballs, but STT alone can't run the round-trip.
 */
interface PlatformFixtures {
  whisperReleaseUrl: string;
  /** Top-level directory the whisper tarball extracts to. */
  whisperDirName: string;
  piperReleaseUrl: string;
}
const PLATFORM_FIXTURES: Record<string, PlatformFixtures> = {
  'linux-x64': {
    whisperReleaseUrl:
      'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-ubuntu-x64.tar.gz',
    whisperDirName: 'whisper-bin-ubuntu-x64',
    piperReleaseUrl:
      'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz',
  },
  'linux-arm64': {
    whisperReleaseUrl:
      'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-ubuntu-arm64.tar.gz',
    whisperDirName: 'whisper-bin-ubuntu-arm64',
    piperReleaseUrl:
      'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_aarch64.tar.gz',
  },
};
const HOST_KEY = `${process.platform}-${process.arch}`;
const HOST_FIXTURES: PlatformFixtures | undefined = PLATFORM_FIXTURES[HOST_KEY];

const WHISPER_MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin';
const PIPER_VOICE_URL =
  'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx';
const PIPER_VOICE_CONFIG_URL = `${PIPER_VOICE_URL}.json`;

function download(url: string, destPath: string): Promise<void> {
  // Shells out to curl rather than hand-rolling Node's https module: curl's
  // redirect handling (-L) is battle-tested against GitHub's release-asset
  // redirects (github.com -> release-assets.githubusercontent.com), which is
  // exactly what these fixture URLs need.
  execFileSync('curl', ['-sL', '--fail', '-o', destPath, url], { stdio: 'inherit' });
}

async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  execFileSync('tar', ['xzf', archivePath, '-C', destDir]);
}

/**
 * Downloads (if not already cached) real whisper.cpp + Piper binaries and
 * models, matching the exact fixture the SKY-3191 QA history used. Returns
 * resolved paths for direct use as `stt.localBinaryPath` etc.
 */
async function ensureVoiceFixtures(): Promise<{
  whisperBin: string;
  whisperModel: string;
  piperBin: string;
  piperModel: string;
}> {
  const fixtures = HOST_FIXTURES;
  if (!fixtures) {
    throw new Error(`no fixture binaries published for ${HOST_KEY}`);
  }
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });

  const whisperDir = path.join(FIXTURE_DIR, fixtures.whisperDirName);
  const whisperBin = path.join(whisperDir, 'whisper-cli');
  const whisperModel = path.join(FIXTURE_DIR, 'ggml-tiny.en.bin');
  const piperDir = path.join(FIXTURE_DIR, 'piper');
  const piperBin = path.join(piperDir, 'piper');
  const piperModel = path.join(FIXTURE_DIR, 'en_US-lessac-medium.onnx');
  const piperModelConfig = `${piperModel}.json`;

  if (!fs.existsSync(whisperBin)) {
    const archive = path.join(FIXTURE_DIR, 'whisper-bin.tar.gz');
    await download(fixtures.whisperReleaseUrl, archive);
    await extractTarGz(archive, FIXTURE_DIR);
    fs.chmodSync(whisperBin, 0o755);
  }
  if (!fs.existsSync(whisperModel)) {
    await download(WHISPER_MODEL_URL, whisperModel);
  }
  if (!fs.existsSync(piperBin)) {
    const archive = path.join(FIXTURE_DIR, 'piper.tar.gz');
    await download(fixtures.piperReleaseUrl, archive);
    await extractTarGz(archive, FIXTURE_DIR);
    fs.chmodSync(piperBin, 0o755);
  }
  if (!fs.existsSync(piperModel)) {
    await download(PIPER_VOICE_URL, piperModel);
  }
  if (!fs.existsSync(piperModelConfig)) {
    await download(PIPER_VOICE_CONFIG_URL, piperModelConfig);
  }

  return { whisperBin, whisperModel, piperBin, piperModel };
}

function seedUserData(
  userData: string,
  vaultDir: string,
  notesVaultDir: string,
  fixtures: { whisperBin: string; whisperModel: string; piperBin: string; piperModel: string },
): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {},
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    // Seeded directly on disk (bypassing the native file-picker dialog) —
    // seedTrustedBinariesFromSettings() trusts these at app boot from
    // persisted settings, same as a real prior gated voice:pickBinary write
    // would have. Everything downstream (checkSpawnPath, transcribeLocal,
    // speakWithPiper) is exercised exactly as a real user's app would.
    stt: {
      enabled: true,
      provider: 'local',
      localBinaryPath: fixtures.whisperBin,
      localModelPath: fixtures.whisperModel,
    },
    tts: {
      enabled: true,
      provider: 'local',
      localBinaryPath: fixtures.piperBin,
      localModelPath: fixtures.piperModel,
      voiceId: 'en_US-lessac-medium',
    },
  };
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: notesVaultDir };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', '--force-prefers-reduced-motion', ...extraArgs],
    timeout: 60_000,
  });
  return app;
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  await pg.waitForFunction(() => Boolean((window as unknown as { api?: unknown }).api), null, { timeout: 20_000 });
  return pg;
}

function pcmToWavBuffer(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate (16-bit mono)
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

test.describe('SKY-3191 — real whisper.cpp/Piper spawn through the running app', () => {
  let userData: string;
  let vaultDir: string;
  let notesVaultDir: string;
  let app: ElectronApplication | undefined;
  let page: Page;

  test.beforeAll(async () => {
    test.skip(
      !HOST_FIXTURES,
      `no published whisper.cpp/Piper fixture binaries for ${HOST_KEY} — ` +
        'whisper.cpp v1.9.1 ships CLI builds for linux x64/arm64 (and Windows) only',
    );
    test.setTimeout(180_000);
    const fixtures = await ensureVoiceFixtures();

    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-voice-real-user-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-voice-real-vault-'));
    notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-voice-real-notes-'));
    seedUserData(userData, vaultDir, notesVaultDir, fixtures);

    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
    // Undefined when beforeAll skipped before mkdtemp (unsupported platform).
    for (const dir of [userData, vaultDir, notesVaultDir]) {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('real Piper synthesis -> real whisper.cpp transcription round-trip', async () => {
    test.setTimeout(60_000);
    const spokenText = 'The quick brown fox jumps over the lazy dog.';

    // Real TTS: window.api.voiceSpeak drives the actual `speakWithPiper` spawn
    // (real `piper` binary, real .onnx voice) through the unmocked IPC path.
    const speakResult = await page.evaluate(async (text) => {
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

      const started = await api.voiceSpeak(text);
      if (started.error) {
        offChunk(); offDone(); offError();
        return { error: started.error };
      }

      const deadline = Date.now() + 30_000;
      while (!done && !speakError && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      offChunk(); offDone(); offError();

      if (speakError) return { error: speakError };
      if (!done) return { error: 'voice:speak:done never fired within timeout' };
      const totalLen = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) { merged.set(c, offset); offset += c.length; }
      return { format: (done as { format?: string }).format, sampleRate: (done as { sampleRate?: number }).sampleRate, pcm: Array.from(merged) };
    }, spokenText);

    expect(speakResult.error, `voice:speak failed: ${speakResult.error}`).toBeUndefined();
    expect(speakResult.format).toBe('pcm');
    expect(speakResult.sampleRate).toBeGreaterThan(0);
    expect(speakResult.pcm!.length).toBeGreaterThan(1000);

    const pcmBuffer = Buffer.from(speakResult.pcm as number[]);
    const wavBuffer = pcmToWavBuffer(pcmBuffer, speakResult.sampleRate as number);

    // Real STT: window.api.voiceTranscribe drives the actual `transcribeLocal`
    // spawn (real `whisper-cli`, real ggml model) on the real Piper-generated
    // audio — a full real-binary round trip through the unmocked app.
    const wavArray = Array.from(wavBuffer);
    const transcribeResult = await page.evaluate(async (bytes) => {
      const api = (window as unknown as {
        api: { voiceTranscribe: (audio: ArrayBuffer, mimeType?: string, language?: string) => Promise<{ text?: string; error?: string }> };
      }).api;
      const buf = new Uint8Array(bytes).buffer;
      return api.voiceTranscribe(buf, 'audio/wav', 'en');
    }, wavArray);

    expect(transcribeResult.error, `voice:transcribe failed: ${transcribeResult.error}`).toBeUndefined();
    // Whisper tiny.en is not perfect, so assert on a distinctive, unlikely-to-
    // hallucinate substring rather than an exact match.
    expect(transcribeResult.text?.toLowerCase()).toContain('fox');
  });
});
