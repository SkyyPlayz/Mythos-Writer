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

import { VoiceRegistry, registerVoiceHandlers } from './voice.js';
import type { VoiceTranscriptEvent, VoiceErrorEvent } from './voice.js';
import type { AppSettings } from './ipc.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSettings(voice?: Partial<AppSettings['voice']>): AppSettings {
  return {
    apiKey: '',
    agents: {
      writingAssistant: { enabled: true, model: 'm', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 1000, maxSuggestionsPerHour: 10, heartbeatIntervalMinutes: 5, maxTokensPerDay: 10000 },
      brainstorm: { enabled: true, model: 'm', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 1000, maxSuggestionsPerHour: 10, heartbeatIntervalMinutes: 5, maxTokensPerDay: 10000 },
      archive: { enabled: true, model: 'm', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 1000, maxSuggestionsPerHour: 10, heartbeatIntervalMinutes: 5, maxTokensPerDay: 10000 },
    },
    theme: 'dark',
    voice: voice ? { enabled: false, cloudFallback: false, ...voice } : undefined,
  };
}

async function invokeHandle(channel: string, payload: unknown): Promise<unknown> {
  const fn = handleMap.get(channel);
  if (!fn) throw new Error(`No handle registered for ${channel}`);
  return fn({} /* event */, payload);
}

function fireOn(channel: string, payload: unknown): void {
  const fn = onMap.get(channel);
  if (!fn) throw new Error(`No on handler registered for ${channel}`);
  fn({} /* event */, payload);
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
