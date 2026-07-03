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

import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  VoiceRegistry,
  registerVoiceHandlers,
  transcribeAudio,
  normalizeLanguage,
  readPiperSampleRate,
  PIPER_DEFAULT_SAMPLE_RATE,
  categorizeVoiceError,
  voiceErrorUserMessage,
  VOICE_ERROR_CATEGORIES,
  LocalBinaryError,
  CloudProviderError,
  InvalidVoiceInputError,
} from './voice.js';
import type { VoiceTranscriptEvent, VoiceErrorEvent, VoiceErrorCategory } from './voice.js';
import type { AppSettings, SttSettings, TtsSettings } from './ipc.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSettings(
  voice?: Partial<AppSettings['voice']>,
  stt?: Partial<SttSettings>,
  tts?: Partial<TtsSettings>,
  provider?: AppSettings['provider'],
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
    provider,
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
      category: VOICE_ERROR_CATEGORIES.UNKNOWN,
      error: 'microphone access denied',
    };
    expect(event.sessionId).toBe('abc-123');
    expect(event.category).toBe('unknown');
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

  it('returns sanitized error when cloud endpoint returns non-ok status (MYT-793)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized: sk_live_LEAKED_SECRET',
    } as Response);

    registerVoiceHandlers(
      () => null,
      () => makeSettings(undefined, { enabled: true, provider: 'cloud', cloudEndpoint: 'http://e', cloudApiKey: 'k' }),
    );
    const result = (await invokeHandle('voice:transcribe', { audio: Buffer.from('x'), mimeType: 'audio/wav' })) as {
      error: string;
      category: VoiceErrorCategory;
    };
    // Acceptance: status code and response body must not leak to the renderer.
    expect(result.error).not.toMatch(/401/);
    expect(result.error).not.toMatch(/Unauthorized/);
    expect(result.error).not.toMatch(/LEAKED_SECRET/);
    expect(result.category).toBe(VOICE_ERROR_CATEGORIES.CLOUD_PROVIDER);
    expect(result.error).toBe(voiceErrorUserMessage(VOICE_ERROR_CATEGORIES.CLOUD_PROVIDER));
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

  // ─── getVoiceProvider integration (SKY-817) ────────────────────────────────

  it('STT: provider-resolved key wins over legacy cloudApiKey', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'provider result' }),
    } as Response);

    const settings: SttSettings = {
      enabled: true,
      provider: 'cloud',
      cloudEndpoint: 'http://localhost/stt',
      cloudApiKey: 'legacy-key',
    };
    const appSettings = {
      provider: { kind: 'openai' as const, model: 'whisper-1', apiKey: 'provider-key-123' },
    };
    const result = await transcribeAudio(Buffer.from('audio'), 'audio/wav', settings, appSettings);
    expect(result.text).toBe('provider result');
    const [, opts] = fetchSpy.mock.calls[0];
    expect((opts as RequestInit).headers).toMatchObject({ Authorization: 'Bearer provider-key-123' });
    fetchSpy.mockRestore();
  });

  it('STT: falls back to legacy cloudApiKey when getVoiceProvider returns null', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'legacy result' }),
    } as Response);

    const settings: SttSettings = {
      enabled: true,
      provider: 'cloud',
      cloudEndpoint: 'http://localhost/stt',
      cloudApiKey: 'legacy-key-only',
    };
    // Anthropic is not voice-capable → getVoiceProvider returns null → legacy key used
    const appSettings = {
      provider: { kind: 'anthropic' as const, model: 'claude-haiku-4-5-20251001', apiKey: 'llm-key' },
    };
    const result = await transcribeAudio(Buffer.from('audio'), 'audio/wav', settings, appSettings);
    expect(result.text).toBe('legacy result');
    const [, opts] = fetchSpy.mock.calls[0];
    expect((opts as RequestInit).headers).toMatchObject({ Authorization: 'Bearer legacy-key-only' });
    fetchSpy.mockRestore();
  });

  it('STT: null provider + no legacy key + no env key throws clear error', async () => {
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const settings: SttSettings = { enabled: true, provider: 'cloud' };
    // Anthropic is not voice-capable, no cloudApiKey, no env var
    const appSettings = {
      provider: { kind: 'anthropic' as const, model: 'claude-haiku-4-5-20251001', apiKey: 'llm-key' },
    };
    await expect(
      transcribeAudio(Buffer.from('audio'), 'audio/wav', settings, appSettings),
    ).rejects.toThrow(/No STT provider/i);
    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  });
});

// ─── SSRF guard on STT cloudEndpoint (SKY-847) ───────────────────────────────
//
// `stt.cloudEndpoint` is renderer-configurable; a compromised renderer could
// point it at internal services. transcribeAudio() must reject before any
// outbound fetch so the main process never reaches an internal target. Reuses
// the validateBaseUrl() policy proven out by SKY-739 / SKY-752.

describe('transcribeAudio SSRF guard (SKY-847)', () => {
  const sttBase: SttSettings = { enabled: true, provider: 'cloud', cloudApiKey: 'k' };

  async function expectBlocked(endpoint: string): Promise<void> {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(
      transcribeAudio(Buffer.from('a'), 'audio/wav', { ...sttBase, cloudEndpoint: endpoint }),
    ).rejects.toBeInstanceOf(InvalidVoiceInputError);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  }

  it('blocks 192.168.x.x (RFC-1918 /16)', async () => {
    await expectBlocked('http://192.168.1.1/stt');
  });

  it('blocks 10.x.x.x (RFC-1918 /8)', async () => {
    await expectBlocked('http://10.0.0.1/stt');
  });

  it('blocks 172.16.x.x (RFC-1918 /12 lower edge)', async () => {
    await expectBlocked('http://172.16.0.1/stt');
  });

  it('blocks 172.31.x.x (RFC-1918 /12 upper edge)', async () => {
    await expectBlocked('http://172.31.255.254/stt');
  });

  it('blocks 169.254.169.254 (cloud IMDS)', async () => {
    await expectBlocked('http://169.254.169.254/latest/meta-data/');
  });

  it('blocks 0.0.0.0', async () => {
    await expectBlocked('http://0.0.0.0/stt');
  });

  it('blocks IPv4-mapped IPv6 bypass (::ffff:192.168.x.x)', async () => {
    await expectBlocked('http://[::ffff:192.168.1.1]/stt');
  });

  it('blocks IPv6 link-local (fe80::)', async () => {
    await expectBlocked('http://[fe80::1]/stt');
  });

  it('blocks file: scheme', async () => {
    await expectBlocked('file:///etc/passwd');
  });

  it('does not leak the rejected URL through the voice:transcribe IPC reply', async () => {
    handleMap.clear();
    onMap.clear();
    registerVoiceHandlers(
      () => null,
      () => makeSettings(undefined, { ...sttBase, cloudEndpoint: 'http://169.254.169.254/' }),
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = (await invokeHandle('voice:transcribe', {
      audio: Buffer.from('audio'),
      mimeType: 'audio/wav',
    })) as { error: string; category: VoiceErrorCategory };
    expect(result.category).toBe(VOICE_ERROR_CATEGORIES.INVALID_INPUT);
    expect(result.error).not.toMatch(/169\.254/);
    expect(result.error).not.toMatch(/cloudEndpoint/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('allows the default https://api.openai.com endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'ok' }),
    } as Response);
    const settings: SttSettings = { enabled: true, provider: 'cloud', cloudApiKey: 'k' };
    const result = await transcribeAudio(Buffer.from('a'), 'audio/wav', settings);
    expect(result.text).toBe('ok');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      expect.objectContaining({ method: 'POST' }),
    );
    fetchSpy.mockRestore();
  });

  it('allows loopback (127.0.0.1) for self-hosted whisper servers', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'ok' }),
    } as Response);
    const settings: SttSettings = {
      enabled: true,
      provider: 'cloud',
      cloudEndpoint: 'http://127.0.0.1:9000/transcribe',
      cloudApiKey: 'k',
    };
    await transcribeAudio(Buffer.from('a'), 'audio/wav', settings);
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:9000/transcribe',
      expect.anything(),
    );
    fetchSpy.mockRestore();
  });

  it('allows IPv4-mapped loopback (::ffff:127.0.0.1)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'ok' }),
    } as Response);
    const settings: SttSettings = {
      enabled: true,
      provider: 'cloud',
      cloudEndpoint: 'http://[::ffff:127.0.0.1]/transcribe',
      cloudApiKey: 'k',
    };
    await transcribeAudio(Buffer.from('a'), 'audio/wav', settings);
    expect(fetchSpy).toHaveBeenCalled();
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

  it('pushes sanitized error event when cloud TTS returns non-ok status (MYT-793)', async () => {
    const errors: Array<{ speakId: string; category: VoiceErrorCategory; error: string }> = [];
    const mockSender = {
      send: (ch: string, data: unknown) => {
        if (ch === 'voice:speak:error') errors.push(data as { speakId: string; category: VoiceErrorCategory; error: string });
      },
      isDestroyed: () => false,
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad request body: missing voice_id at /home/secret/path',
    } as Response);

    registerVoiceHandlers(
      () => mockSender,
      () => makeSettings(undefined, undefined, { enabled: true, provider: 'cloud', cloudEndpoint: 'http://tts.local', cloudApiKey: 'k' }),
    );
    const { speakId } = (await invokeHandle('voice:speak', { text: 'hi' })) as { speakId: string };
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(errors).toHaveLength(1);
    expect(errors[0].speakId).toBe(speakId);
    // Acceptance: cloud response body and status must not be forwarded to renderer.
    expect(errors[0].error).not.toMatch(/400/);
    expect(errors[0].error).not.toMatch(/Bad request/i);
    expect(errors[0].error).not.toMatch(/\/home\/secret\/path/);
    expect(errors[0].category).toBe(VOICE_ERROR_CATEGORIES.CLOUD_PROVIDER);
    expect(errors[0].error).toBe(voiceErrorUserMessage(VOICE_ERROR_CATEGORIES.CLOUD_PROVIDER));
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

  // ─── getVoiceProvider integration (SKY-817) ──────────────────────────────────

  it('TTS: uses provider-resolved API key when voice provider is configured', async () => {
    const mockReader = {
      read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    } as unknown as Response);

    registerVoiceHandlers(
      () => null,
      () => makeSettings(
        undefined,
        undefined,
        { enabled: true, provider: 'cloud', cloudEndpoint: 'http://tts.local' },
        { kind: 'openai', model: 'tts-1', apiKey: 'provider-tts-key' },
      ),
    );
    await invokeHandle('voice:speak', { text: 'Hello' });
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://tts.local',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer provider-tts-key' }),
      }),
    );
    fetchSpy.mockRestore();
  });

  it('TTS: falls back to legacy cloudApiKey when getVoiceProvider returns null', async () => {
    const mockReader = {
      read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    } as unknown as Response);

    // Anthropic is not voice-capable → getVoiceProvider returns null → legacy key used
    registerVoiceHandlers(
      () => null,
      () => makeSettings(
        undefined,
        undefined,
        { enabled: true, provider: 'cloud', cloudEndpoint: 'http://tts.local', cloudApiKey: 'legacy-tts-key' },
        { kind: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: 'llm-key' },
      ),
    );
    await invokeHandle('voice:speak', { text: 'Hello' });
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://tts.local',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer legacy-tts-key' }),
      }),
    );
    fetchSpy.mockRestore();
  });

  it('TTS: pushes invalid_input error event when null provider and no legacy key', async () => {
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const errors: Array<{ speakId: string; category: VoiceErrorCategory; error: string }> = [];
    const mockSender = {
      send: (ch: string, data: unknown) => {
        if (ch === 'voice:speak:error') errors.push(data as { speakId: string; category: VoiceErrorCategory; error: string });
      },
      isDestroyed: () => false,
    };

    // Anthropic is not voice-capable, no cloudApiKey, no env var → InvalidVoiceInputError
    registerVoiceHandlers(
      () => mockSender,
      () => makeSettings(
        undefined,
        undefined,
        { enabled: true, provider: 'cloud' },
        { kind: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: 'llm-key' },
      ),
    );
    await invokeHandle('voice:speak', { text: 'Hello' });
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(errors).toHaveLength(1);
    expect(errors[0].category).toBe(VOICE_ERROR_CATEGORIES.INVALID_INPUT);

    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  });
});

// ─── SSRF guard on TTS cloudEndpoint (SKY-847) ───────────────────────────────
//
// Mirrors the STT block above for the speakAsync() cloud path. voice:speak is
// fire-and-forget, so errors surface as a voice:speak:error push event rather
// than the IPC return value — assert via captured sender events.

describe('voice:speak SSRF guard (SKY-847)', () => {
  beforeEach(() => { handleMap.clear(); onMap.clear(); });

  const runBlocked = async (endpoint: string) => {
    const errors: Array<{ category: VoiceErrorCategory; error: string }> = [];
    const mockSender = {
      send: (ch: string, data: unknown) => {
        if (ch === 'voice:speak:error') errors.push(data as { category: VoiceErrorCategory; error: string });
      },
      isDestroyed: () => false,
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    registerVoiceHandlers(
      () => mockSender,
      () => makeSettings(undefined, undefined, {
        enabled: true,
        provider: 'cloud',
        cloudEndpoint: endpoint,
        cloudApiKey: 'k',
      }),
    );
    await invokeHandle('voice:speak', { text: 'hi' });
    await new Promise(resolve => setTimeout(resolve, 20));
    return { errors, fetchSpy };
  };

  it('blocks 192.168.x.x (RFC-1918 /16)', async () => {
    const { errors, fetchSpy } = await runBlocked('http://192.168.1.1/speak');
    expect(errors).toHaveLength(1);
    expect(errors[0].category).toBe(VOICE_ERROR_CATEGORIES.INVALID_INPUT);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('blocks 10.x.x.x (RFC-1918 /8)', async () => {
    const { errors, fetchSpy } = await runBlocked('http://10.1.2.3/speak');
    expect(errors).toHaveLength(1);
    expect(errors[0].category).toBe(VOICE_ERROR_CATEGORIES.INVALID_INPUT);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('blocks 172.16.x.x (RFC-1918 /12)', async () => {
    const { errors, fetchSpy } = await runBlocked('http://172.20.0.1/speak');
    expect(errors).toHaveLength(1);
    expect(errors[0].category).toBe(VOICE_ERROR_CATEGORIES.INVALID_INPUT);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('blocks 169.254.169.254 (cloud IMDS)', async () => {
    const { errors, fetchSpy } = await runBlocked('http://169.254.169.254/latest/');
    expect(errors).toHaveLength(1);
    expect(errors[0].category).toBe(VOICE_ERROR_CATEGORIES.INVALID_INPUT);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('blocks 0.0.0.0', async () => {
    const { errors, fetchSpy } = await runBlocked('http://0.0.0.0/speak');
    expect(errors).toHaveLength(1);
    expect(errors[0].category).toBe(VOICE_ERROR_CATEGORIES.INVALID_INPUT);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('blocks IPv4-mapped IPv6 bypass (::ffff:192.168.x.x)', async () => {
    const { errors, fetchSpy } = await runBlocked('http://[::ffff:192.168.1.1]/speak');
    expect(errors).toHaveLength(1);
    expect(errors[0].category).toBe(VOICE_ERROR_CATEGORIES.INVALID_INPUT);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('blocks IPv6 link-local (fe80::)', async () => {
    const { errors, fetchSpy } = await runBlocked('http://[fe80::1]/speak');
    expect(errors).toHaveLength(1);
    expect(errors[0].category).toBe(VOICE_ERROR_CATEGORIES.INVALID_INPUT);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('blocks file: scheme', async () => {
    const { errors, fetchSpy } = await runBlocked('file:///etc/passwd');
    expect(errors).toHaveLength(1);
    expect(errors[0].category).toBe(VOICE_ERROR_CATEGORIES.INVALID_INPUT);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('does not leak the rejected URL in the push error event', async () => {
    const { errors, fetchSpy } = await runBlocked('http://169.254.169.254/imds');
    expect(errors).toHaveLength(1);
    expect(errors[0].error).not.toMatch(/169\.254/);
    expect(errors[0].error).not.toMatch(/imds/i);
    expect(errors[0].error).toBe(voiceErrorUserMessage(VOICE_ERROR_CATEGORIES.INVALID_INPUT));
    fetchSpy.mockRestore();
  });

  it('allows the default https://api.openai.com endpoint', async () => {
    const mockReader = {
      read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    } as unknown as Response);
    registerVoiceHandlers(
      () => ({ send: () => {}, isDestroyed: () => false }),
      // No cloudEndpoint set → falls back to default OpenAI URL.
      () => makeSettings(undefined, undefined, { enabled: true, provider: 'cloud', cloudApiKey: 'k' }),
    );
    await invokeHandle('voice:speak', { text: 'hi' });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/speech',
      expect.objectContaining({ method: 'POST' }),
    );
    fetchSpy.mockRestore();
  });

  it('allows loopback (127.0.0.1) for self-hosted TTS servers', async () => {
    const mockReader = {
      read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    } as unknown as Response);
    registerVoiceHandlers(
      () => ({ send: () => {}, isDestroyed: () => false }),
      () => makeSettings(undefined, undefined, {
        enabled: true,
        provider: 'cloud',
        cloudEndpoint: 'http://127.0.0.1:9001/v1/audio/speech',
        cloudApiKey: 'k',
      }),
    );
    await invokeHandle('voice:speak', { text: 'hi' });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// ─── Voice spawn gate integration (MYT-788) ──────────────────────────────────
//
// Acceptance criterion: a renderer that gets an arbitrary local binary path
// into the settings file (bypassing the settings:set gate) must still not be
// able to trigger spawn. The transcribeAudio / speakAsync helpers consult the
// trusted-set before reaching spawn.

describe('voice spawn gate (MYT-788)', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    handleMap.clear();
    onMap.clear();
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-voice-spawn-'));
    const { __resetVoiceGate } = await import('./voiceGate.js');
    __resetVoiceGate();
  });

  it('voice:transcribe refuses to spawn when binary exists but is not trusted', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const bin = path.join(tmpRoot, 'attacker-shell');
    fs.writeFileSync(bin, '#!/bin/sh\necho pwned\n', { mode: 0o755 });

    registerVoiceHandlers(
      () => null,
      () => makeSettings(undefined, { enabled: true, provider: 'local', localBinaryPath: bin }),
    );
    const result = (await invokeHandle('voice:transcribe', { audio: Buffer.from('x'), mimeType: 'audio/wav' })) as { error: string };
    expect(result.error).toBe('Voice request was invalid — check the input and settings.');
  });

  it('voice:speak refuses to spawn when binary exists but is not trusted', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const bin = path.join(tmpRoot, 'attacker-shell');
    const model = path.join(tmpRoot, 'voice.onnx');
    fs.writeFileSync(bin, '#!/bin/sh\necho pwned\n', { mode: 0o755 });
    fs.writeFileSync(model, '');

    const errors: Array<{ speakId: string; error: string }> = [];
    const mockSender = {
      send: (ch: string, data: unknown) => {
        if (ch === 'voice:speak:error') errors.push(data as { speakId: string; error: string });
      },
      isDestroyed: () => false,
    };

    registerVoiceHandlers(
      () => mockSender,
      () => makeSettings(undefined, undefined, { enabled: true, provider: 'local', localBinaryPath: bin, localModelPath: model }),
    );
    const { speakId } = (await invokeHandle('voice:speak', { text: 'hi' })) as { speakId: string };
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(errors).toHaveLength(1);
    expect(errors[0].speakId).toBe(speakId);
    expect(errors[0].error).toBe('Voice request was invalid — check the input and settings.');
  });

  it('voice:speak rejects text exceeding the size cap before spawn', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { MAX_TTS_TEXT_BYTES } = await import('./voiceGate.js');
    registerVoiceHandlers(
      () => null,
      () => makeSettings(undefined, undefined, { enabled: true, provider: 'cloud', cloudEndpoint: 'http://tts', cloudApiKey: 'k' }),
    );
    const giant = 'a'.repeat(MAX_TTS_TEXT_BYTES + 1);
    const result = (await invokeHandle('voice:speak', { text: giant })) as { error: string };
    expect(result.error).toMatch(/exceeds limit/i);
    // Did not reach the cloud path either.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('voice:transcribe rejects audio exceeding the size cap', async () => {
    const { MAX_STT_AUDIO_BYTES } = await import('./voiceGate.js');
    registerVoiceHandlers(
      () => null,
      () => makeSettings(undefined, { enabled: true, provider: 'cloud', cloudEndpoint: 'http://e', cloudApiKey: 'k' }),
    );
    // Use a Buffer just past the cap. allocUnsafe is cheap and we never read.
    const giant = Buffer.allocUnsafe(MAX_STT_AUDIO_BYTES + 1);
    const result = (await invokeHandle('voice:transcribe', { audio: giant, mimeType: 'audio/wav' })) as { error: string };
    expect(result.error).toMatch(/exceeds limit/i);
  });

  it('voice:transcribe falls through to cloud when local binary refuses gate (provider=auto)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const bin = path.join(tmpRoot, 'attacker-shell');
    fs.writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'cloud-fallback' }),
    } as Response);
    registerVoiceHandlers(
      () => null,
      () => makeSettings(undefined, {
        enabled: true,
        provider: 'auto',
        localBinaryPath: bin,
        cloudEndpoint: 'http://cloud',
        cloudApiKey: 'k',
      }),
    );
    const result = (await invokeHandle('voice:transcribe', { audio: Buffer.from('x'), mimeType: 'audio/wav' })) as { text: string };
    expect(result.text).toBe('cloud-fallback');
    fetchSpy.mockRestore();
  });
});

// ─── MYT-793: error categorization unit tests ────────────────────────────────

describe('categorizeVoiceError', () => {
  it('maps LocalBinaryError to LOCAL_BINARY', () => {
    expect(categorizeVoiceError(new LocalBinaryError('whisper.cpp exited 1: /tmp/path stack trace'))).toBe(
      VOICE_ERROR_CATEGORIES.LOCAL_BINARY,
    );
  });

  it('maps CloudProviderError to CLOUD_PROVIDER', () => {
    expect(categorizeVoiceError(new CloudProviderError('Cloud STT failed (429): rate limited'))).toBe(
      VOICE_ERROR_CATEGORIES.CLOUD_PROVIDER,
    );
  });

  it('maps CloudProviderError with status to CLOUD_PROVIDER', () => {
    expect(categorizeVoiceError(new CloudProviderError('boom', 503))).toBe(
      VOICE_ERROR_CATEGORIES.CLOUD_PROVIDER,
    );
  });

  it('maps InvalidVoiceInputError to INVALID_INPUT', () => {
    expect(categorizeVoiceError(new InvalidVoiceInputError('STT disabled'))).toBe(
      VOICE_ERROR_CATEGORIES.INVALID_INPUT,
    );
  });

  it('maps AbortError to NETWORK', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(categorizeVoiceError(err)).toBe(VOICE_ERROR_CATEGORIES.NETWORK);
  });

  it('maps untyped error with HTTP-style status to CLOUD_PROVIDER', () => {
    const err = Object.assign(new Error('boom'), { status: 401 });
    expect(categorizeVoiceError(err)).toBe(VOICE_ERROR_CATEGORIES.CLOUD_PROVIDER);
  });

  it('maps TypeError (fetch failure) to NETWORK', () => {
    expect(categorizeVoiceError(new TypeError('fetch failed'))).toBe(VOICE_ERROR_CATEGORIES.NETWORK);
  });

  it('maps "network" message to NETWORK', () => {
    expect(categorizeVoiceError(new Error('network unreachable'))).toBe(VOICE_ERROR_CATEGORIES.NETWORK);
  });

  it('maps "timeout" message to NETWORK', () => {
    expect(categorizeVoiceError(new Error('request timeout after 30s'))).toBe(
      VOICE_ERROR_CATEGORIES.NETWORK,
    );
  });

  it('maps ECONNREFUSED provider failures to NETWORK', () => {
    expect(categorizeVoiceError(new Error('connect ECONNREFUSED 127.0.0.1:8080'))).toBe(
      VOICE_ERROR_CATEGORIES.NETWORK,
    );
    expect(categorizeVoiceError(new Error('ECONNREFUSED'))).toBe(VOICE_ERROR_CATEGORIES.NETWORK);
  });

  it('maps unrecognised error to UNKNOWN', () => {
    expect(categorizeVoiceError(new Error('something weird happened'))).toBe(
      VOICE_ERROR_CATEGORIES.UNKNOWN,
    );
  });

  it('returns UNKNOWN for a non-Error value (no throw)', () => {
    expect(categorizeVoiceError({})).toBe(VOICE_ERROR_CATEGORIES.UNKNOWN);
    expect(categorizeVoiceError(undefined)).toBe(VOICE_ERROR_CATEGORIES.UNKNOWN);
    expect(categorizeVoiceError('plain string')).toBe(VOICE_ERROR_CATEGORIES.UNKNOWN);
  });
});

describe('voiceErrorUserMessage', () => {
  it('returns a fixed string per category that contains no raw error detail', () => {
    for (const cat of Object.values(VOICE_ERROR_CATEGORIES) as VoiceErrorCategory[]) {
      const msg = voiceErrorUserMessage(cat);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
      // No status codes, file paths, or stderr substrings should appear in the
      // canned user messages.
      expect(msg).not.toMatch(/\b\d{3}\b/);
      expect(msg).not.toMatch(/\/(tmp|home|var)\//);
      expect(msg).not.toMatch(/stderr/i);
    }
  });

  it('returns the LOCAL_BINARY message for that category', () => {
    expect(voiceErrorUserMessage(VOICE_ERROR_CATEGORIES.LOCAL_BINARY)).toMatch(/local voice engine/i);
  });

  it('returns the CLOUD_PROVIDER message for that category', () => {
    expect(voiceErrorUserMessage(VOICE_ERROR_CATEGORIES.CLOUD_PROVIDER)).toMatch(/cloud voice provider/i);
  });
});

describe('voice:stop cloud STT error (MYT-793)', () => {
  beforeEach(() => { handleMap.clear(); onMap.clear(); });

  it('emits sanitized voice:error event when cloud Whisper rejects (no body / status leak)', async () => {
    const errors: Array<{ sessionId: string; category: VoiceErrorCategory; error: string }> = [];
    const mockSender = {
      send: (ch: string, data: unknown) => {
        if (ch === 'voice:error') errors.push(data as { sessionId: string; category: VoiceErrorCategory; error: string });
      },
      isDestroyed: () => false,
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'INVALID_API_KEY sk_test_LEAK',
      json: async () => ({ error: { message: 'INVALID_API_KEY sk_test_LEAK' } }),
    } as unknown as Response);

    const reg = new VoiceRegistry();
    registerVoiceHandlers(
      () => mockSender,
      () => makeSettings({ cloudFallback: true, openaiApiKey: 'k' }),
      reg,
    );
    const { sessionId } = (await invokeHandle('voice:start', {})) as { sessionId: string };
    reg.addChunk(sessionId, Buffer.from('audio'));
    await invokeHandle('voice:stop', { sessionId });

    expect(errors).toHaveLength(1);
    expect(errors[0].sessionId).toBe(sessionId);
    expect(errors[0].category).toBe(VOICE_ERROR_CATEGORIES.CLOUD_PROVIDER);
    expect(errors[0].error).toBe(voiceErrorUserMessage(VOICE_ERROR_CATEGORIES.CLOUD_PROVIDER));
    // Acceptance: no raw API-key fragment or status code reaches the renderer.
    expect(errors[0].error).not.toMatch(/sk_test_LEAK/);
    expect(errors[0].error).not.toMatch(/INVALID_API_KEY/);
    expect(errors[0].error).not.toMatch(/401/);
    fetchSpy.mockRestore();
  });
});

// ─── MYT-793: local STT stderr scrubbing (compositional) ─────────────────────
//
// ESM prevents `vi.spyOn(childProc, 'spawn')` from re-binding the export, so we
// can't easily intercept the spawn-and-emit-stderr path in isolation. Instead,
// prove the property by construction: voice handlers route every caught error
// through `categorizeVoiceError` → `voiceErrorUserMessage`, which returns a
// fixed canned message that cannot contain stderr / response-body content.

describe('voice error scrubbing (MYT-793 acceptance)', () => {
  it('LocalBinaryError carrying raw whisper.cpp stderr is never echoed to the renderer', () => {
    const stderrPath = '/home/secret/models/ggml.bin';
    const err = new LocalBinaryError(
      `whisper.cpp exited 1: failed to load ${stderrPath} (api_key=sk_LEAK)`,
    );
    const cat = categorizeVoiceError(err);
    const userMsg = voiceErrorUserMessage(cat);
    expect(cat).toBe(VOICE_ERROR_CATEGORIES.LOCAL_BINARY);
    expect(userMsg).not.toMatch(/whisper\.cpp/);
    expect(userMsg).not.toMatch(/exited/);
    expect(userMsg).not.toMatch(/\/home\/secret/);
    expect(userMsg).not.toMatch(/ggml/);
    expect(userMsg).not.toMatch(/sk_LEAK/);
  });

  it('CloudProviderError carrying raw response body is never echoed to the renderer', () => {
    const err = new CloudProviderError(
      'Cloud TTS request failed (400): {"error":{"message":"bad input","trace_id":"tr_xyz"}}',
      400,
    );
    const cat = categorizeVoiceError(err);
    const userMsg = voiceErrorUserMessage(cat);
    expect(cat).toBe(VOICE_ERROR_CATEGORIES.CLOUD_PROVIDER);
    expect(userMsg).not.toMatch(/400/);
    expect(userMsg).not.toMatch(/bad input/);
    expect(userMsg).not.toMatch(/tr_xyz/);
    expect(userMsg).not.toMatch(/trace_id/);
  });
});


// ─── STT language hint (voice pipeline Part G) ───────────────────────────────

describe('normalizeLanguage', () => {
  it('normalizes a BCP-47 tag to its primary subtag', () => {
    expect(normalizeLanguage('en-US')).toBe('en');
    expect(normalizeLanguage('zh-Hans-CN')).toBe('zh');
  });

  it('lowercases and passes through plain ISO codes', () => {
    expect(normalizeLanguage('EN')).toBe('en');
    expect(normalizeLanguage('fr')).toBe('fr');
    expect(normalizeLanguage('auto')).toBe('auto');
  });

  it('returns undefined for absent or empty input', () => {
    expect(normalizeLanguage(undefined)).toBeUndefined();
    expect(normalizeLanguage('')).toBeUndefined();
  });

  it('rejects values that are not plain letter codes (injection guard)', () => {
    expect(normalizeLanguage('en\r\nContent-Disposition: form-data')).toBeUndefined();
    expect(normalizeLanguage('e')).toBeUndefined();
    expect(normalizeLanguage('12')).toBeUndefined();
    expect(normalizeLanguage('../etc')).toBeUndefined();
  });
});

describe('voice:transcribe language plumbing', () => {
  beforeEach(() => { handleMap.clear(); onMap.clear(); });

  function cloudSttSettings(): AppSettings {
    return makeSettings(undefined, {
      enabled: true,
      provider: 'cloud',
      cloudEndpoint: 'http://stt.local/v1/audio/transcriptions',
      cloudApiKey: 'k',
    });
  }

  it('adds a normalized language field to the cloud multipart body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'bonjour' }),
    } as Response);

    registerVoiceHandlers(() => null, cloudSttSettings);
    await invokeHandle('voice:transcribe', { audio: Buffer.from('x'), mimeType: 'audio/wav', language: 'fr-FR' });

    const body = (fetchSpy.mock.calls[0][1] as RequestInit).body as Buffer;
    const bodyStr = body.toString('utf-8');
    expect(bodyStr).toContain('name="language"');
    expect(bodyStr).toContain('\r\nfr\r\n');
    fetchSpy.mockRestore();
  });

  it('omits the language field when no language is provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'hi' }),
    } as Response);

    registerVoiceHandlers(() => null, cloudSttSettings);
    await invokeHandle('voice:transcribe', { audio: Buffer.from('x'), mimeType: 'audio/wav' });

    const body = (fetchSpy.mock.calls[0][1] as RequestInit).body as Buffer;
    expect(body.toString('utf-8')).not.toContain('name="language"');
    fetchSpy.mockRestore();
  });

  it('drops renderer-supplied language values that fail validation', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'hi' }),
    } as Response);

    registerVoiceHandlers(() => null, cloudSttSettings);
    await invokeHandle('voice:transcribe', {
      audio: Buffer.from('x'),
      mimeType: 'audio/wav',
      language: 'en"\r\ninjected: header',
    });

    const body = (fetchSpy.mock.calls[0][1] as RequestInit).body as Buffer;
    expect(body.toString('utf-8')).not.toContain('name="language"');
    expect(body.toString('utf-8')).not.toContain('injected');
    fetchSpy.mockRestore();
  });
});

// ─── Piper sample-rate config (voice pipeline Part G) ────────────────────────

describe('readPiperSampleRate', () => {
  it('reads audio.sample_rate from the model sidecar config', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-piper-test-'));
    const modelPath = path.join(dir, 'voice.onnx');
    try {
      fs.writeFileSync(`${modelPath}.json`, JSON.stringify({ audio: { sample_rate: 16000 } }));
      expect(readPiperSampleRate(modelPath)).toBe(16000);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the default rate when the config is missing', () => {
    expect(readPiperSampleRate('/no/such/model.onnx')).toBe(PIPER_DEFAULT_SAMPLE_RATE);
  });

  it('falls back to the default rate when the config is malformed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-piper-test-'));
    const modelPath = path.join(dir, 'voice.onnx');
    try {
      fs.writeFileSync(`${modelPath}.json`, 'not-json{');
      expect(readPiperSampleRate(modelPath)).toBe(PIPER_DEFAULT_SAMPLE_RATE);
      fs.writeFileSync(`${modelPath}.json`, JSON.stringify({ audio: { sample_rate: 'fast' } }));
      expect(readPiperSampleRate(modelPath)).toBe(PIPER_DEFAULT_SAMPLE_RATE);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── voice:speak done-event audio metadata (voice pipeline Part G) ───────────

describe('voice:speak done event metadata', () => {
  beforeEach(() => { handleMap.clear(); onMap.clear(); });

  it('cloud TTS done event carries format mp3 so the renderer can decode it', async () => {
    const doneEvents: Array<{ speakId: string; format?: string; sampleRate?: number }> = [];
    const mockSender = {
      send: (ch: string, data: unknown) => {
        if (ch === 'voice:speak:done') doneEvents.push(data as { speakId: string; format?: string });
      },
      isDestroyed: () => false,
    };
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: new Uint8Array([1]) })
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
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].speakId).toBe(speakId);
    expect(doneEvents[0].format).toBe('mp3');
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
