// Voice IO unit tests — VoiceRegistry lifecycle + IPC handler behavior.
// ipcMain is mocked; no Electron runtime required.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock electron ────────────────────────────────────────────────────────────

type Handler = (...args: unknown[]) => unknown;
const handleMap = new Map<string, Handler>();
const onMap = new Map<string, Handler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => { handleMap.set(channel, fn); },
    on: (channel: string, fn: Handler) => { onMap.set(channel, fn); },
  },
}));

import { VoiceRegistry, registerVoiceHandlers, transcribeAudio } from './voice.js';
import type { VoiceTranscriptEvent, VoiceErrorEvent } from './voice.js';
import type { AppSettings, SttSettings, TtsSettings } from './ipc.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSettings(
  voice?: Partial<AppSettings['voice']>,
  stt?: Partial<SttSettings>,
  tts?: Partial<TtsSettings>,
): AppSettings {
  return {
    apiKey: '',
    agents: {
      writingAssistant: { enabled: true, model: 'm', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 1000, maxSuggestionsPerHour: 10, heartbeatIntervalMinutes: 5, maxTokensPerDay: 10000 },
      brainstorm: { enabled: true, model: 'm', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 1000, maxSuggestionsPerHour: 10, heartbeatIntervalMinutes: 5, maxTokensPerDay: 10000 },
      archive: { enabled: true, model: 'm', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 1000, maxSuggestionsPerHour: 10, heartbeatIntervalMinutes: 5, maxTokensPerDay: 10000 },
    },
    theme: 'dark',
    voice: voice ? { enabled: false, cloudFallback: false, ...voice } : undefined,
    stt: stt ? { enabled: false, provider: 'auto', ...stt } : undefined,
    tts: tts ? { enabled: false, provider: 'auto', ...tts } : undefined,
  };
}

// Mock IpcMain event whose senderFrame self-references as `top` so the
// isFromTopFrame() guard introduced in MYT-791 passes for normal tests.
function makeTopFrameEvent(): { senderFrame: unknown } {
  const frame: { top: unknown } = { top: null };
  frame.top = frame;
  return { senderFrame: frame };
}

async function invokeHandle(channel: string, payload: unknown): Promise<unknown> {
  const fn = handleMap.get(channel);
  if (!fn) throw new Error(`No handle registered for ${channel}`);
  return fn(makeTopFrameEvent(), payload);
}

function fireOn(channel: string, payload: unknown): void {
  const fn = onMap.get(channel);
  if (!fn) throw new Error(`No on handler registered for ${channel}`);
  fn(makeTopFrameEvent(), payload);
}

// ─── VoiceRegistry ───────────────────────────────────────────────────────────

describe('VoiceRegistry', () => {
  it('start returns a session with unique id', () => {
    const reg = new VoiceRegistry();
    const a = reg.start();
    const b = reg.start();
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });

  it('start stores micDeviceId when provided', () => {
    const reg = new VoiceRegistry();
    const s = reg.start('mic-1');
    expect(s.micDeviceId).toBe('mic-1');
  });

  it('get returns the session after start', () => {
    const reg = new VoiceRegistry();
    const s = reg.start();
    expect(reg.get(s.id)).toBe(s);
  });

  it('get returns undefined for unknown id', () => {
    const reg = new VoiceRegistry();
    expect(reg.get('no-such-id')).toBeUndefined();
  });

  it('addChunk appends to audioChunks', () => {
    const reg = new VoiceRegistry();
    const s = reg.start();
    reg.addChunk(s.id, Buffer.from('hello'));
    reg.addChunk(s.id, Buffer.from(' world'));
    expect(reg.get(s.id)!.audioChunks).toHaveLength(2);
    expect(Buffer.concat(reg.get(s.id)!.audioChunks).toString()).toBe('hello world');
  });

  it('stop returns the session and removes it', () => {
    const reg = new VoiceRegistry();
    const s = reg.start();
    const stopped = reg.stop(s.id);
    expect(stopped).toBe(s);
    expect(reg.get(s.id)).toBeUndefined();
    expect(reg.size()).toBe(0);
  });

  it('stop returns undefined for unknown id', () => {
    const reg = new VoiceRegistry();
    expect(reg.stop('ghost')).toBeUndefined();
  });

  it('remove deletes without returning the session', () => {
    const reg = new VoiceRegistry();
    const s = reg.start();
    reg.remove(s.id);
    expect(reg.get(s.id)).toBeUndefined();
  });
});

// ─── IPC handlers ────────────────────────────────────────────────────────────

describe('voice:start handler', () => {
  beforeEach(() => { handleMap.clear(); onMap.clear(); });

  it('returns a sessionId string', async () => {
    const reg = new VoiceRegistry();
    registerVoiceHandlers(() => null, () => makeSettings(), reg);
    const result = (await invokeHandle('voice:start', {})) as { sessionId: string };
    expect(typeof result.sessionId).toBe('string');
    expect(result.sessionId.length).toBeGreaterThan(0);
  });

  it('returns unique sessionId per call', async () => {
    const reg = new VoiceRegistry();
    registerVoiceHandlers(() => null, () => makeSettings(), reg);
    const a = (await invokeHandle('voice:start', {})) as { sessionId: string };
    const b = (await invokeHandle('voice:start', {})) as { sessionId: string };
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it('stores micDeviceId in session', async () => {
    const reg = new VoiceRegistry();
    registerVoiceHandlers(() => null, () => makeSettings(), reg);
    const result = (await invokeHandle('voice:start', { micDeviceId: 'usb-mic' })) as { sessionId: string };
    expect(reg.get(result.sessionId)?.micDeviceId).toBe('usb-mic');
  });
});

describe('voice:stop handler', () => {
  beforeEach(() => { handleMap.clear(); onMap.clear(); });

  it('returns ok:true for a known session', async () => {
    const reg = new VoiceRegistry();
    registerVoiceHandlers(() => null, () => makeSettings(), reg);
    const { sessionId } = (await invokeHandle('voice:start', {})) as { sessionId: string };
    const result = (await invokeHandle('voice:stop', { sessionId })) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it('removes session from registry after stop', async () => {
    const reg = new VoiceRegistry();
    registerVoiceHandlers(() => null, () => makeSettings(), reg);
    const { sessionId } = (await invokeHandle('voice:start', {})) as { sessionId: string };
    await invokeHandle('voice:stop', { sessionId });
    expect(reg.get(sessionId)).toBeUndefined();
  });

  it('returns ok:false with error for unknown sessionId', async () => {
    const reg = new VoiceRegistry();
    registerVoiceHandlers(() => null, () => makeSettings(), reg);
    const result = (await invokeHandle('voice:stop', { sessionId: 'no-such' })) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('does not attempt cloud transcription when cloudFallback is false', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const reg = new VoiceRegistry();
    registerVoiceHandlers(() => null, () => makeSettings({ cloudFallback: false }), reg);
    const { sessionId } = (await invokeHandle('voice:start', {})) as { sessionId: string };
    reg.addChunk(sessionId, Buffer.from('audio'));
    await invokeHandle('voice:stop', { sessionId });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('voice:local-transcript handler', () => {
  beforeEach(() => { handleMap.clear(); onMap.clear(); });

  it('re-broadcasts text as voice:transcript push event', () => {
    const sent: VoiceTranscriptEvent[] = [];
    const mockSender = {
      send: (_ch: string, data: unknown) => sent.push(data as VoiceTranscriptEvent),
      isDestroyed: () => false,
    };
    const reg = new VoiceRegistry();
    registerVoiceHandlers(() => mockSender, () => makeSettings(), reg);
    fireOn('voice:local-transcript', { sessionId: 'sess-1', text: 'Hello world', isFinal: false });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ sessionId: 'sess-1', text: 'Hello world', isFinal: false });
  });

  it('sets isFinal:true when relayed as final', () => {
    const sent: VoiceTranscriptEvent[] = [];
    const mockSender = {
      send: (_ch: string, data: unknown) => sent.push(data as VoiceTranscriptEvent),
      isDestroyed: () => false,
    };
    registerVoiceHandlers(() => mockSender, () => makeSettings());
    fireOn('voice:local-transcript', { sessionId: 's', text: 'Done', isFinal: true });
    expect(sent[0].isFinal).toBe(true);
  });

  it('does not throw when sender is null', () => {
    registerVoiceHandlers(() => null, () => makeSettings());
    expect(() => fireOn('voice:local-transcript', { sessionId: 's', text: 'ok', isFinal: false })).not.toThrow();
  });
});

describe('VoiceTranscriptEvent shape', () => {
  it('conforms to expected contract', () => {
    const event: VoiceTranscriptEvent = {
      sessionId: 'abc-123',
      text: 'Once upon a time',
      isFinal: true,
    };
    expect(event.sessionId).toBe('abc-123');
    expect(event.text).toBe('Once upon a time');
    expect(event.isFinal).toBe(true);
  });
});

describe('VoiceErrorEvent shape', () => {
  it('conforms to expected contract', () => {
    const event: VoiceErrorEvent = {
      sessionId: 'abc-123',
      error: 'microphone access denied',
    };
    expect(event.sessionId).toBe('abc-123');
    expect(event.error).toBe('microphone access denied');
  });
});

// ─── voice:transcribe IPC handler ────────────────────────────────────────────

describe('voice:transcribe handler', () => {
  beforeEach(() => { handleMap.clear(); onMap.clear(); });

  it('returns error when stt is absent from settings', async () => {
    registerVoiceHandlers(() => null, () => makeSettings());
    const result = (await invokeHandle('voice:transcribe', { audio: Buffer.from('x'), mimeType: 'audio/wav' })) as { error: string };
    expect(result.error).toMatch(/not enabled/i);
  });

  it('returns error when stt.enabled is false', async () => {
    registerVoiceHandlers(() => null, () => makeSettings(undefined, { enabled: false }));
    const result = (await invokeHandle('voice:transcribe', { audio: Buffer.from('x'), mimeType: 'audio/wav' })) as { error: string };
    expect(result.error).toMatch(/not enabled/i);
  });

  it('returns error for empty audio buffer', async () => {
    registerVoiceHandlers(() => null, () => makeSettings(undefined, { enabled: true, provider: 'cloud', cloudEndpoint: 'http://e', cloudApiKey: 'k' }));
    const result = (await invokeHandle('voice:transcribe', { audio: Buffer.alloc(0) })) as { error: string };
    expect(result.error).toMatch(/non-empty audio/i);
  });

  it('calls cloud endpoint and returns text + confidence', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'hello world' }),
    } as Response);

    registerVoiceHandlers(
      () => null,
      () => makeSettings(undefined, { enabled: true, provider: 'cloud', cloudEndpoint: 'http://stt.local/v1/audio/transcriptions', cloudApiKey: 'test-key' }),
    );
    const result = (await invokeHandle('voice:transcribe', { audio: Buffer.from('audio-data'), mimeType: 'audio/wav' })) as { text: string; confidence: number };

    expect(result.text).toBe('hello world');
    expect(result.confidence).toBeCloseTo(0.95, 1);
    expect(fetchSpy).toHaveBeenCalledWith('http://stt.local/v1/audio/transcriptions', expect.objectContaining({ method: 'POST' }));
    fetchSpy.mockRestore();
  });

  it('accepts ArrayBuffer as audio input', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'array buffer test' }),
    } as Response);

    registerVoiceHandlers(
      () => null,
      () => makeSettings(undefined, { enabled: true, provider: 'cloud', cloudEndpoint: 'http://e', cloudApiKey: 'k' }),
    );
    const ab = new ArrayBuffer(8);
    const result = (await invokeHandle('voice:transcribe', { audio: ab, mimeType: 'audio/webm' })) as { text: string };
    expect(result.text).toBe('array buffer test');
    fetchSpy.mockRestore();
  });

  it('returns error when cloud endpoint returns non-ok status', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    } as Response);

    registerVoiceHandlers(
      () => null,
      () => makeSettings(undefined, { enabled: true, provider: 'cloud', cloudEndpoint: 'http://e', cloudApiKey: 'k' }),
    );
    const result = (await invokeHandle('voice:transcribe', { audio: Buffer.from('x'), mimeType: 'audio/wav' })) as { error: string };
    expect(result.error).toMatch(/401/);
    fetchSpy.mockRestore();
  });
});

// ─── transcribeAudio adapter selection ───────────────────────────────────────

describe('transcribeAudio adapter selection', () => {
  it('throws when STT disabled', async () => {
    const settings: SttSettings = { enabled: false, provider: 'auto' };
    await expect(transcribeAudio(Buffer.from('x'), 'audio/wav', settings)).rejects.toThrow(/disabled/i);
  });

  it('throws when provider=local and no binary path configured', async () => {
    const settings: SttSettings = { enabled: true, provider: 'local' };
    await expect(transcribeAudio(Buffer.from('x'), 'audio/wav', settings)).rejects.toThrow(/not found/i);
  });

  it('throws when provider=local and binary path does not exist', async () => {
    const settings: SttSettings = { enabled: true, provider: 'local', localBinaryPath: '/no/such/binary' };
    await expect(transcribeAudio(Buffer.from('x'), 'audio/wav', settings)).rejects.toThrow(/not found/i);
  });

  it('throws when provider=auto and no cloud config and no env key', async () => {
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const settings: SttSettings = { enabled: true, provider: 'auto' };
    await expect(transcribeAudio(Buffer.from('x'), 'audio/wav', settings)).rejects.toThrow(/No STT provider/i);
    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  });

  it('uses cloud when provider=cloud and cloudApiKey is set', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'cloud result' }),
    } as Response);

    const settings: SttSettings = {
      enabled: true,
      provider: 'cloud',
      cloudEndpoint: 'http://localhost/stt',
      cloudApiKey: 'key-123',
    };
    const result = await transcribeAudio(Buffer.from('audio'), 'audio/wav', settings);
    expect(result.text).toBe('cloud result');
    expect(result.confidence).toBeCloseTo(0.95, 1);
    fetchSpy.mockRestore();
  });

  it('falls through to cloud when provider=auto and local binary missing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'fallback' }),
    } as Response);

    const settings: SttSettings = {
      enabled: true,
      provider: 'auto',
      localBinaryPath: '/no/such/binary',
      cloudEndpoint: 'http://localhost/stt',
      cloudApiKey: 'k',
    };
    const result = await transcribeAudio(Buffer.from('audio'), 'audio/wav', settings);
    expect(result.text).toBe('fallback');
    fetchSpy.mockRestore();
  });
});

// ─── voice:speak IPC handler (TTS — MYT-339) ─────────────────────────────────

describe('voice:speak handler', () => {
  beforeEach(() => { handleMap.clear(); onMap.clear(); });

  it('returns error when tts is absent from settings', async () => {
    registerVoiceHandlers(() => null, () => makeSettings());
    const result = (await invokeHandle('voice:speak', { text: 'hello' })) as { error: string };
    expect(result.error).toMatch(/not enabled/i);
  });

  it('returns error when tts.enabled is false', async () => {
    registerVoiceHandlers(() => null, () => makeSettings(undefined, undefined, { enabled: false }));
    const result = (await invokeHandle('voice:speak', { text: 'hello' })) as { error: string };
    expect(result.error).toMatch(/not enabled/i);
  });

  it('returns a speakId string immediately', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true, value: undefined }) }) },
    } as unknown as Response);

    registerVoiceHandlers(
      () => null,
      () => makeSettings(undefined, undefined, { enabled: true, provider: 'cloud', cloudEndpoint: 'http://tts.local', cloudApiKey: 'k' }),
    );
    const result = (await invokeHandle('voice:speak', { text: 'hello' })) as { speakId: string };
    expect(typeof result.speakId).toBe('string');
    expect(result.speakId.length).toBeGreaterThan(0);
    fetchSpy.mockRestore();
  });

  it('returns unique speakId per call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true, value: undefined }) }) },
    } as unknown as Response);

    registerVoiceHandlers(
      () => null,
      () => makeSettings(undefined, undefined, { enabled: true, provider: 'cloud', cloudEndpoint: 'http://tts.local', cloudApiKey: 'k' }),
    );
    const a = (await invokeHandle('voice:speak', { text: 'a' })) as { speakId: string };
    const b = (await invokeHandle('voice:speak', { text: 'b' })) as { speakId: string };
    expect(a.speakId).not.toBe(b.speakId);
    fetchSpy.mockRestore();
  });

  it('pushes audio chunks and done event via sender for cloud TTS', async () => {
    const chunks: Array<{ speakId: string; chunk: Buffer }> = [];
    const doneEvents: Array<{ speakId: string }> = [];
    const mockSender = {
      send: (ch: string, data: unknown) => {
        if (ch === 'voice:speak:chunk') chunks.push(data as { speakId: string; chunk: Buffer });
        if (ch === 'voice:speak:done') doneEvents.push(data as { speakId: string });
      },
      isDestroyed: () => false,
    };

    const audioPayload = new Uint8Array([0x01, 0x02, 0x03]);
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: audioPayload })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    } as unknown as Response);

    registerVoiceHandlers(
      () => mockSender,
      () => makeSettings(undefined, undefined, { enabled: true, provider: 'cloud', cloudEndpoint: 'http://tts.local', cloudApiKey: 'k' }),
    );
    const { speakId } = (await invokeHandle('voice:speak', { text: 'Hello' })) as { speakId: string };

    // Allow async TTS work to complete
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].speakId).toBe(speakId);
    expect(Buffer.from(chunks[0].chunk)).toEqual(Buffer.from(audioPayload));
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].speakId).toBe(speakId);
    fetchSpy.mockRestore();
  });

  it('sends cloud TTS request with correct body shape', async () => {
    const mockReader = {
      read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    } as unknown as Response);

    registerVoiceHandlers(
      () => null,
      () => makeSettings(undefined, undefined, { enabled: true, provider: 'cloud', cloudEndpoint: 'http://tts.local', cloudApiKey: 'test-key', voiceId: 'nova' }),
    );
    await invokeHandle('voice:speak', { text: 'Test synthesis' });
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://tts.local',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    );
    const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(callBody.input).toBe('Test synthesis');
    expect(callBody.voice).toBe('nova');
    expect(callBody.model).toBe('tts-1');
    fetchSpy.mockRestore();
  });

  it('uses voiceId override from payload over settings default', async () => {
    const mockReader = {
      read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    } as unknown as Response);

    registerVoiceHandlers(
      () => null,
      () => makeSettings(undefined, undefined, { enabled: true, provider: 'cloud', cloudEndpoint: 'http://tts.local', cloudApiKey: 'k', voiceId: 'alloy' }),
    );
    await invokeHandle('voice:speak', { text: 'hi', voiceId: 'shimmer' });
    await new Promise(resolve => setTimeout(resolve, 20));

    const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(callBody.voice).toBe('shimmer');
    fetchSpy.mockRestore();
  });

  it('pushes error event when cloud TTS returns non-ok status', async () => {
    const errors: Array<{ speakId: string; error: string }> = [];
    const mockSender = {
      send: (ch: string, data: unknown) => {
        if (ch === 'voice:speak:error') errors.push(data as { speakId: string; error: string });
      },
      isDestroyed: () => false,
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    } as Response);

    registerVoiceHandlers(
      () => mockSender,
      () => makeSettings(undefined, undefined, { enabled: true, provider: 'cloud', cloudEndpoint: 'http://tts.local', cloudApiKey: 'k' }),
    );
    const { speakId } = (await invokeHandle('voice:speak', { text: 'hi' })) as { speakId: string };
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(errors).toHaveLength(1);
    expect(errors[0].speakId).toBe(speakId);
    expect(errors[0].error).toMatch(/429/);
    fetchSpy.mockRestore();
  });

  it('does not push error event after cancel (clean abort)', async () => {
    const events: string[] = [];
    const mockSender = {
      send: (ch: string) => events.push(ch),
      isDestroyed: () => false,
    };

    // fetch that never resolves — gives us time to cancel
    let rejectFetch!: (e: Error) => void;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise<Response>((_, rej) => { rejectFetch = rej; }),
    );

    registerVoiceHandlers(
      () => mockSender,
      () => makeSettings(undefined, undefined, { enabled: true, provider: 'cloud', cloudEndpoint: 'http://tts.local', cloudApiKey: 'k' }),
    );
    const { speakId } = (await invokeHandle('voice:speak', { text: 'long text' })) as { speakId: string };

    // Cancel immediately, then reject the pending fetch with an AbortError
    fireOn('voice:speak:cancel', { speakId });
    rejectFetch(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(events).not.toContain('voice:speak:error');
    fetchSpy.mockRestore();
  });

  it('does not call fetch when sender is null and tts is disabled', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    registerVoiceHandlers(() => null, () => makeSettings());
    await invokeHandle('voice:speak', { text: 'hi' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// ─── Integration: local binary (gated on WHISPER_BIN env var) ────────────────

describe('local STT integration', () => {
  const BIN_PATH = process.env.WHISPER_BIN;
  const runTest = BIN_PATH ? it : it.skip;

  runTest('transcribes audio via local whisper.cpp binary', async () => {
    // Minimal 44-byte WAV (silence) — RIFF header + 0 data bytes is enough for
    // whisper.cpp to parse and emit empty transcript without crashing.
    const wav = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, // "RIFF" + chunk size 36
      0x57, 0x41, 0x56, 0x45, // "WAVE"
      0x66, 0x6d, 0x74, 0x20, // "fmt "
      0x10, 0x00, 0x00, 0x00, // subchunk size 16
      0x01, 0x00,             // PCM
      0x01, 0x00,             // mono
      0x80, 0x3e, 0x00, 0x00, // 16000 Hz
      0x00, 0x7d, 0x00, 0x00, // byte rate
      0x02, 0x00,             // block align
      0x10, 0x00,             // bits per sample 16
      0x64, 0x61, 0x74, 0x61, // "data"
      0x00, 0x00, 0x00, 0x00, // 0 data bytes
    ]);
    const settings: SttSettings = {
      enabled: true,
      provider: 'local',
      localBinaryPath: BIN_PATH!,
    };
    const result = await transcribeAudio(wav, 'audio/wav', settings);
    expect(typeof result.text).toBe('string');
    expect(result.confidence).toBeGreaterThan(0);
  });
});
