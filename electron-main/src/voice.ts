// Voice IO subsystem — local-first STT with optional cloud fallback.
//
// Local path:  renderer runs Web Speech API and relays partials/finals via
//              fire-and-forget `voice:local-transcript`; main re-broadcasts
//              them as `voice:transcript` push events.
//
// Cloud path:  renderer sends raw audio via `voice:audio-chunk`; when the
//              session stops, main POSTs accumulated audio to OpenAI Whisper
//              and pushes the final transcript via `voice:transcript`.
//
// Cloud fallback is off by default and must be explicitly enabled in
// AppSettings (settings.voice.cloudFallback = true).

import { ipcMain } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import type { AppSettings, SttSettings, TtsSettings, VoiceTranscribePayload, VoiceTranscribeResponse } from './ipc.js';
import { isFromTopFrame, UNTRUSTED_FRAME_REJECTION } from './ipc.js';

// ─── Channel names ──────────────────────────────────────────────────────────

export const VOICE_START = 'voice:start' as const;
export const VOICE_STOP = 'voice:stop' as const;
export const VOICE_TRANSCRIPT_STREAM = 'voice:transcript' as const;
export const VOICE_TRANSCRIBE = 'voice:transcribe' as const;
export const VOICE_SPEAK = 'voice:speak' as const;

const VOICE_AUDIO_CHUNK = 'voice:audio-chunk' as const;
const VOICE_LOCAL_TRANSCRIPT = 'voice:local-transcript' as const;
const VOICE_ERROR = 'voice:error' as const;
const VOICE_SPEAK_CHUNK = 'voice:speak:chunk' as const;
const VOICE_SPEAK_DONE = 'voice:speak:done' as const;
const VOICE_SPEAK_ERROR = 'voice:speak:error' as const;
const VOICE_SPEAK_CANCEL = 'voice:speak:cancel' as const;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VoiceSession {
  id: string;
  startedAt: string;
  micDeviceId?: string;
  audioChunks: Buffer[];
}

export interface VoiceStartPayload {
  micDeviceId?: string;
}

export interface VoiceStartResponse {
  sessionId: string;
}

export interface VoiceStopPayload {
  sessionId: string;
}

export interface VoiceStopResponse {
  ok: boolean;
  error?: string;
}

export interface VoiceTranscriptEvent {
  sessionId: string;
  text: string;
  isFinal: boolean;
}

export interface VoiceErrorEvent {
  sessionId: string;
  error: string;
}

// ─── TTS types (MYT-339) ─────────────────────────────────────────────────────

export interface VoiceSpeakPayload {
  text: string;
  voiceId?: string;
}

export interface VoiceSpeakResponse {
  speakId: string;
}

export interface VoiceSpeakChunkEvent {
  speakId: string;
  chunk: Buffer;
}

export interface VoiceSpeakDoneEvent {
  speakId: string;
}

export interface VoiceSpeakErrorEvent {
  speakId: string;
  error: string;
}

// ─── Session registry ────────────────────────────────────────────────────────

export class VoiceRegistry {
  private sessions = new Map<string, VoiceSession>();

  start(micDeviceId?: string): VoiceSession {
    const session: VoiceSession = {
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      micDeviceId,
      audioChunks: [],
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): VoiceSession | undefined {
    return this.sessions.get(id);
  }

  addChunk(id: string, chunk: Buffer): void {
    this.sessions.get(id)?.audioChunks.push(chunk);
  }

  stop(id: string): VoiceSession | undefined {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    return session;
  }

  remove(id: string): void {
    this.sessions.delete(id);
  }

  size(): number {
    return this.sessions.size;
  }
}

// ─── Handler registration ────────────────────────────────────────────────────

export type GetSender = () => { send(channel: string, data: unknown): void; isDestroyed(): boolean } | null;
export type GetSettings = () => AppSettings;

export function registerVoiceHandlers(
  getSender: GetSender,
  getSettings: GetSettings,
  registry?: VoiceRegistry,
): void {
  const reg = registry ?? new VoiceRegistry();

  // voice:start → returns unique sessionId
  ipcMain.handle(VOICE_START, (event, payload: VoiceStartPayload) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
    const session = reg.start(payload?.micDeviceId);
    return { sessionId: session.id } satisfies VoiceStartResponse;
  });

  // voice:stop → ends session; triggers cloud transcription when opted in
  ipcMain.handle(VOICE_STOP, async (event, payload: VoiceStopPayload) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
    const session = reg.stop(payload?.sessionId);
    if (!session) {
      return { ok: false, error: 'session not found' } satisfies VoiceStopResponse;
    }

    const voiceSettings = getSettings().voice;
    const cloudEnabled = voiceSettings?.cloudFallback === true;

    if (cloudEnabled && session.audioChunks.length > 0) {
      const openaiKey = voiceSettings?.openaiApiKey || process.env.OPENAI_API_KEY;
      if (openaiKey) {
        try {
          const text = await transcribeWithWhisper(openaiKey, session.audioChunks);
          pushTranscript(getSender, { sessionId: session.id, text, isFinal: true });
        } catch (err) {
          pushError(getSender, { sessionId: session.id, error: (err as Error).message ?? 'cloud STT error' });
        }
      }
    }

    return { ok: true } satisfies VoiceStopResponse;
  });

  // voice:audio-chunk — fire-and-forget; renderer sends raw audio for cloud path
  ipcMain.on(VOICE_AUDIO_CHUNK, (event, payload: { sessionId: string; chunk: Buffer | ArrayBuffer }) => {
    if (!isFromTopFrame(event)) return;
    if (!payload?.sessionId) return;
    const buf =
      payload.chunk instanceof ArrayBuffer
        ? Buffer.from(payload.chunk)
        : Buffer.isBuffer(payload.chunk)
          ? payload.chunk
          : Buffer.alloc(0);
    if (buf.length > 0) reg.addChunk(payload.sessionId, buf);
  });

  // voice:local-transcript — fire-and-forget; renderer relays Web Speech API text
  // Main re-broadcasts as voice:transcript so the UI layer has a single event source.
  ipcMain.on(
    VOICE_LOCAL_TRANSCRIPT,
    (event, payload: { sessionId: string; text: string; isFinal: boolean }) => {
      if (!isFromTopFrame(event)) return;
      if (!payload?.sessionId) return;
      pushTranscript(getSender, {
        sessionId: payload.sessionId,
        text: payload.text ?? '',
        isFinal: payload.isFinal === true,
      });
    },
  );

  // voice:transcribe — single-shot transcription; local-first, cloud fallback.
  // Off by default: requires stt.enabled = true in settings.
  ipcMain.handle(VOICE_TRANSCRIBE, async (event, payload: VoiceTranscribePayload) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
    const sttSettings = getSettings().stt;
    if (!sttSettings?.enabled) {
      return { error: 'STT is not enabled in settings (stt.enabled = false)' };
    }

    const audioBuf =
      payload?.audio instanceof ArrayBuffer
        ? Buffer.from(payload.audio)
        : Buffer.isBuffer(payload?.audio)
          ? (payload.audio as Buffer)
          : null;

    if (!audioBuf || audioBuf.length === 0) {
      return { error: 'voice:transcribe requires non-empty audio data' };
    }

    try {
      return await transcribeAudio(audioBuf, payload.mimeType ?? 'audio/webm', sttSettings);
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  // ─── TTS handlers (MYT-339) ──────────────────────────────────────────────────

  // Active TTS sessions — speakId → AbortController for mid-stream cancellation.
  const activeSpeakSessions = new Map<string, AbortController>();

  // voice:speak — kicks off TTS; audio chunks pushed as voice:speak:chunk push events.
  // Returns { speakId } immediately; caller subscribes to push events to receive audio.
  ipcMain.handle(VOICE_SPEAK, (event, payload: VoiceSpeakPayload) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
    const ttsSettings = getSettings().tts;
    if (!ttsSettings?.enabled) {
      return { error: 'TTS is not enabled in settings (tts.enabled = false)' };
    }

    const speakId = crypto.randomUUID();
    const abortController = new AbortController();
    activeSpeakSessions.set(speakId, abortController);

    const voiceId = payload?.voiceId ?? ttsSettings.voiceId;
    speakAsync(speakId, payload?.text ?? '', voiceId, ttsSettings, getSender, abortController.signal)
      .finally(() => activeSpeakSessions.delete(speakId));

    return { speakId } satisfies VoiceSpeakResponse;
  });

  // voice:speak:cancel — fire-and-forget; aborts an active synthesis session.
  ipcMain.on(VOICE_SPEAK_CANCEL, (event, payload: { speakId: string }) => {
    if (!isFromTopFrame(event)) return;
    const controller = activeSpeakSessions.get(payload?.speakId);
    if (controller) {
      controller.abort();
      activeSpeakSessions.delete(payload.speakId);
    }
  });
}

// ─── Push helpers ────────────────────────────────────────────────────────────

function pushTranscript(getSender: GetSender, event: VoiceTranscriptEvent): void {
  const sender = getSender();
  if (sender && !sender.isDestroyed()) {
    sender.send(VOICE_TRANSCRIPT_STREAM, event);
  }
}

function pushError(getSender: GetSender, event: VoiceErrorEvent): void {
  const sender = getSender();
  if (sender && !sender.isDestroyed()) {
    sender.send(VOICE_ERROR, event);
  }
}

// ─── STT adapter (MYT-338) ────────────────────────────────────────────────────

/**
 * Selects local or cloud STT based on `settings.provider` and runs transcription.
 * Exported for unit testing of adapter selection logic.
 */
export async function transcribeAudio(
  audio: Buffer,
  mimeType: string,
  settings: SttSettings,
): Promise<VoiceTranscribeResponse> {
  if (!settings.enabled) {
    throw new Error('STT is disabled in settings (stt.enabled = false)');
  }

  const provider = settings.provider ?? 'auto';

  if (provider === 'local' || provider === 'auto') {
    const binPath = settings.localBinaryPath;
    if (binPath && fs.existsSync(binPath)) {
      return transcribeLocal(binPath, audio, mimeType);
    }
    if (provider === 'local') {
      throw new Error(
        `Local STT binary not found at path: ${binPath ?? '(stt.localBinaryPath not configured)'}`,
      );
    }
  }

  // Cloud path — 'cloud' provider, or 'auto' when local binary is unavailable.
  const endpoint =
    settings.cloudEndpoint ?? 'https://api.openai.com/v1/audio/transcriptions';
  const apiKey = settings.cloudApiKey ?? process.env.OPENAI_API_KEY ?? '';

  if (!settings.cloudEndpoint && !apiKey) {
    throw new Error(
      'No STT provider available. Configure stt.localBinaryPath or stt.cloudEndpoint in settings.',
    );
  }

  return transcribeCloud(endpoint, apiKey, audio, mimeType);
}

async function transcribeLocal(
  binaryPath: string,
  audio: Buffer,
  mimeType: string,
): Promise<VoiceTranscribeResponse> {
  const ext = mimeType.includes('wav') ? 'wav' : mimeType.includes('mp3') ? 'mp3' : 'webm';
  const tmpFile = path.join(os.tmpdir(), `mythos-stt-${crypto.randomUUID()}.${ext}`);

  try {
    fs.writeFileSync(tmpFile, audio);
    const text = await new Promise<string>((resolve, reject) => {
      const proc = spawn(binaryPath, [tmpFile, '--no-prints', '--no-timestamps'], {
        timeout: 30_000,
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      proc.stdout.on('data', (d: Buffer) => stdoutChunks.push(d));
      proc.stderr.on('data', (d: Buffer) => stderrChunks.push(d));
      proc.on('close', (code) => {
        if (code !== 0) {
          const errMsg = Buffer.concat(stderrChunks).toString().trim();
          reject(new Error(`whisper.cpp exited ${code}: ${errMsg || '(no stderr)'}`));
        } else {
          resolve(Buffer.concat(stdoutChunks).toString().trim());
        }
      });
      proc.on('error', reject);
    });
    return { text, confidence: 0.9 };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* non-fatal temp-file cleanup */ }
  }
}

async function transcribeCloud(
  endpoint: string,
  apiKey: string,
  audio: Buffer,
  mimeType: string,
): Promise<VoiceTranscribeResponse> {
  const boundary = `----VoiceBoundary${crypto.randomBytes(8).toString('hex')}`;
  const filename =
    mimeType.includes('wav') ? 'recording.wav' :
    mimeType.includes('mp3') ? 'recording.mp3' : 'recording.webm';

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType || 'audio/webm'}\r\n\r\n`,
      'utf-8',
    ),
    audio,
    Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--${boundary}--\r\n`,
      'utf-8',
    ),
  ]);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Cloud STT request failed (${response.status}): ${errText}`);
  }

  const json = (await response.json()) as { text?: string; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return { text: json.text ?? '', confidence: 0.95 };
}

// ─── TTS adapter (MYT-339) ───────────────────────────────────────────────────

async function speakAsync(
  speakId: string,
  text: string,
  voiceId: string | undefined,
  settings: TtsSettings,
  getSender: GetSender,
  signal: AbortSignal,
): Promise<void> {
  const sendChunk = (chunk: Buffer) => {
    const sender = getSender();
    if (sender && !sender.isDestroyed()) {
      sender.send(VOICE_SPEAK_CHUNK, { speakId, chunk } satisfies VoiceSpeakChunkEvent);
    }
  };

  try {
    const provider = settings.provider ?? 'auto';

    if (provider === 'local' || provider === 'auto') {
      const binPath = settings.localBinaryPath;
      const modelPath = settings.localModelPath;
      if (binPath && modelPath && fs.existsSync(binPath)) {
        await speakWithPiper(binPath, modelPath, text, signal, sendChunk);
        pushSpeakDone(getSender, speakId);
        return;
      }
      if (provider === 'local') {
        throw new Error(
          `Local TTS binary not found at path: ${binPath ?? '(tts.localBinaryPath not configured)'}`,
        );
      }
    }

    // Cloud path — 'cloud' provider, or 'auto' when local binary is unavailable.
    const endpoint = settings.cloudEndpoint ?? 'https://api.openai.com/v1/audio/speech';
    const apiKey = settings.cloudApiKey ?? process.env.OPENAI_API_KEY ?? '';
    if (!settings.cloudEndpoint && !apiKey) {
      throw new Error(
        'No TTS provider available. Configure tts.localBinaryPath+tts.localModelPath or tts.cloudEndpoint in settings.',
      );
    }
    await speakWithCloud(endpoint, apiKey, text, voiceId, signal, sendChunk);
    pushSpeakDone(getSender, speakId);
  } catch (err) {
    if (signal.aborted) return; // clean cancellation — no error event
    const sender = getSender();
    if (sender && !sender.isDestroyed()) {
      sender.send(VOICE_SPEAK_ERROR, {
        speakId,
        error: (err as Error).message ?? 'TTS error',
      } satisfies VoiceSpeakErrorEvent);
    }
  }
}

function pushSpeakDone(getSender: GetSender, speakId: string): void {
  const sender = getSender();
  if (sender && !sender.isDestroyed()) {
    sender.send(VOICE_SPEAK_DONE, { speakId } satisfies VoiceSpeakDoneEvent);
  }
}

async function speakWithPiper(
  binaryPath: string,
  modelPath: string,
  text: string,
  signal: AbortSignal,
  onChunk: (chunk: Buffer) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(binaryPath, ['--model', modelPath, '--output-raw'], {
      timeout: 60_000,
    });

    const onAbort = () => { proc.kill(); };
    signal.addEventListener('abort', onAbort, { once: true });

    proc.stdout.on('data', (d: Buffer) => onChunk(d));
    proc.stdin.write(text, 'utf-8');
    proc.stdin.end();

    proc.on('close', (code) => {
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) {
        reject(new Error('cancelled'));
      } else if (code !== 0) {
        reject(new Error(`piper exited ${code}`));
      } else {
        resolve();
      }
    });
    proc.on('error', (err) => {
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });
  });
}

async function speakWithCloud(
  endpoint: string,
  apiKey: string,
  text: string,
  voiceId: string | undefined,
  signal: AbortSignal,
  onChunk: (chunk: Buffer) => void,
): Promise<void> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'tts-1', input: text, voice: voiceId ?? 'alloy' }),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Cloud TTS request failed (${response.status}): ${errText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body from cloud TTS endpoint');

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) onChunk(Buffer.from(value));
  }
}

// ─── Cloud STT (OpenAI Whisper) — session-based voice:stop path ───────────────

async function transcribeWithWhisper(apiKey: string, chunks: Buffer[]): Promise<string> {
  const audio = Buffer.concat(chunks);
  const boundary = `----VoiceBoundary${crypto.randomBytes(8).toString('hex')}`;
  const filename = 'recording.webm';

  const formParts: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/webm\r\n\r\n`,
      'utf-8',
    ),
    audio,
    Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--${boundary}--\r\n`,
      'utf-8',
    ),
  ];
  const body = Buffer.concat(formParts);

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  const json = (await response.json()) as { text?: string; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.text ?? '';
}
