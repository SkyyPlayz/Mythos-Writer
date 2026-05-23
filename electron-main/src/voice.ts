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
import type { AppSettings } from './ipc.js';

// ─── Channel names ──────────────────────────────────────────────────────────

export const VOICE_START = 'voice:start' as const;
export const VOICE_STOP = 'voice:stop' as const;
export const VOICE_TRANSCRIPT_STREAM = 'voice:transcript' as const;

const VOICE_AUDIO_CHUNK = 'voice:audio-chunk' as const;
const VOICE_LOCAL_TRANSCRIPT = 'voice:local-transcript' as const;
const VOICE_ERROR = 'voice:error' as const;

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
  ipcMain.handle(VOICE_START, (_event, payload: VoiceStartPayload) => {
    const session = reg.start(payload?.micDeviceId);
    return { sessionId: session.id } satisfies VoiceStartResponse;
  });

  // voice:stop → ends session; triggers cloud transcription when opted in
  ipcMain.handle(VOICE_STOP, async (_event, payload: VoiceStopPayload) => {
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
  ipcMain.on(VOICE_AUDIO_CHUNK, (_event, payload: { sessionId: string; chunk: Buffer | ArrayBuffer }) => {
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
    (_event, payload: { sessionId: string; text: string; isFinal: boolean }) => {
      if (!payload?.sessionId) return;
      pushTranscript(getSender, {
        sessionId: payload.sessionId,
        text: payload.text ?? '',
        isFinal: payload.isFinal === true,
      });
    },
  );
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

// ─── Cloud STT (OpenAI Whisper) ───────────────────────────────────────────────

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
