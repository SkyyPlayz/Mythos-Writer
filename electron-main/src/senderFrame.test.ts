// senderFrame.test.ts (MYT-791)
//
// Defense-in-depth: ipcMain.handle / ipcMain.on handlers must reject messages
// whose sender frame is not the top-level renderer. Without this, a future
// preview iframe or embedded help pane could invoke privileged IPC channels.
//
// This file covers:
//   1. isFromTopFrame() helper logic (top frame, nested frame, null frame).
//   2. setupIpcMain() wrapper rejects nested-frame invocations.
//   3. Manually-registered voice + streaming handlers reject nested-frame
//      invocations.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock for electron — every test in this file shares one handler map.
type Handler = (...args: unknown[]) => unknown;
const handleMap = new Map<string, Handler>();
const onMap = new Map<string, Handler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => { handleMap.set(channel, fn); },
    on: (channel: string, fn: Handler) => { onMap.set(channel, fn); },
    off: vi.fn(),
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn() }));

import {
  isFromTopFrame,
  UNTRUSTED_FRAME_REJECTION,
  setupIpcMain,
  IPC_CHANNELS,
  type IpcHandlers,
} from './ipc.js';
import { registerVoiceHandlers, VoiceRegistry } from './voice.js';
import { registerStreamingHandlers, STREAM_CHANNELS } from './streaming.js';
import type { IpcMainInvokeEvent, IpcMainEvent } from 'electron';

// ─── Frame helpers ───────────────────────────────────────────────────────────

function makeTopFrame(): unknown {
  const frame: { top: unknown } = { top: null };
  frame.top = frame; // self-reference: frame === frame.top
  return frame;
}

function makeNestedFrame(): { frame: unknown; top: unknown } {
  const top: { top: unknown } = { top: null };
  top.top = top;
  const child = { top };
  return { frame: child, top };
}

function topEvent(extra: Record<string, unknown> = {}): IpcMainInvokeEvent {
  return { senderFrame: makeTopFrame(), ...extra } as unknown as IpcMainInvokeEvent;
}

function nestedEvent(extra: Record<string, unknown> = {}): IpcMainInvokeEvent {
  const { frame } = makeNestedFrame();
  return { senderFrame: frame, ...extra } as unknown as IpcMainInvokeEvent;
}

function nullFrameEvent(extra: Record<string, unknown> = {}): IpcMainInvokeEvent {
  return { senderFrame: null, ...extra } as unknown as IpcMainInvokeEvent;
}

// ─── 1. isFromTopFrame() helper ──────────────────────────────────────────────

describe('isFromTopFrame', () => {
  it('returns true when senderFrame is the top frame (self-reference)', () => {
    expect(isFromTopFrame(topEvent())).toBe(true);
  });

  it('returns false when senderFrame points at a nested frame', () => {
    expect(isFromTopFrame(nestedEvent())).toBe(false);
  });

  it('returns false when senderFrame is null (frame destroyed)', () => {
    expect(isFromTopFrame(nullFrameEvent())).toBe(false);
  });

  it('returns false when senderFrame is undefined', () => {
    expect(isFromTopFrame({} as unknown as IpcMainInvokeEvent)).toBe(false);
  });

  it('works for IpcMainEvent shape (ipcMain.on listeners)', () => {
    const evt = topEvent() as unknown as IpcMainEvent;
    expect(isFromTopFrame(evt)).toBe(true);
  });
});

// ─── 2. setupIpcMain rejects nested-frame invocations ────────────────────────

describe('setupIpcMain senderFrame guard', () => {
  beforeEach(() => { handleMap.clear(); onMap.clear(); });

  it('registers the handler under the channel name', () => {
    const stub = vi.fn().mockReturnValue({ items: [] });
    const handlers = { [IPC_CHANNELS.VAULT_LIST]: stub } as unknown as IpcHandlers;
    setupIpcMain(handlers);
    expect(handleMap.has(IPC_CHANNELS.VAULT_LIST)).toBe(true);
  });

  it('forwards to the inner handler when senderFrame is the top frame', async () => {
    const stub = vi.fn().mockReturnValue({ items: ['a'] });
    setupIpcMain({ [IPC_CHANNELS.VAULT_LIST]: stub } as unknown as IpcHandlers);
    const fn = handleMap.get(IPC_CHANNELS.VAULT_LIST)!;

    const result = (await fn(topEvent(), { root: '/x' })) as { items: string[] };

    expect(result).toEqual({ items: ['a'] });
    expect(stub).toHaveBeenCalledOnce();
    expect(stub).toHaveBeenCalledWith({ root: '/x' });
  });

  it('rejects without invoking the inner handler when senderFrame is nested', async () => {
    const stub = vi.fn();
    setupIpcMain({ [IPC_CHANNELS.VAULT_LIST]: stub } as unknown as IpcHandlers);
    const fn = handleMap.get(IPC_CHANNELS.VAULT_LIST)!;

    const result = await fn(nestedEvent(), { root: '/x' });

    expect(result).toBe(UNTRUSTED_FRAME_REJECTION);
    expect(stub).not.toHaveBeenCalled();
  });

  it('rejects when senderFrame is null (frame already destroyed)', async () => {
    const stub = vi.fn();
    setupIpcMain({ [IPC_CHANNELS.VAULT_LIST]: stub } as unknown as IpcHandlers);
    const fn = handleMap.get(IPC_CHANNELS.VAULT_LIST)!;

    const result = await fn(nullFrameEvent(), { root: '/x' });

    expect(result).toBe(UNTRUSTED_FRAME_REJECTION);
    expect(stub).not.toHaveBeenCalled();
  });

  it('rejection payload is a typed object with category=untrusted_frame', () => {
    expect(UNTRUSTED_FRAME_REJECTION.category).toBe('untrusted_frame');
    // User-facing message must not leak frame URLs or origins.
    expect(UNTRUSTED_FRAME_REJECTION.error).toMatch(/top-level renderer frame/i);
    expect(UNTRUSTED_FRAME_REJECTION.error).not.toMatch(/http|file:|chrome-/i);
  });
});

// ─── 3. Manually-registered handlers reject nested frames ────────────────────

describe('voice handlers reject nested-frame invocations', () => {
  beforeEach(() => { handleMap.clear(); onMap.clear(); });

  function makeSettings(): import('./ipc.js').AppSettings {
    return {
      apiKey: '',
      agents: {
        writingAssistant: { enabled: true, model: 'm', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 1000, maxSuggestionsPerHour: 10, heartbeatIntervalMinutes: 5, maxTokensPerDay: 10000 },
        brainstorm: { enabled: true, model: 'm', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 1000, maxSuggestionsPerHour: 10, heartbeatIntervalMinutes: 5, maxTokensPerDay: 10000 },
        archive: { enabled: true, model: 'm', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 1000, maxSuggestionsPerHour: 10, heartbeatIntervalMinutes: 5, maxTokensPerDay: 10000 },
      },
      theme: 'dark',
      stt: { enabled: true, provider: 'cloud', cloudEndpoint: 'http://e', cloudApiKey: 'k' },
      tts: { enabled: true, provider: 'cloud' },
    };
  }

  it('voice:start rejects nested-frame invocation', async () => {
    const reg = new VoiceRegistry();
    registerVoiceHandlers(() => null, makeSettings, reg);
    const fn = handleMap.get('voice:start')!;

    const result = await fn(nestedEvent(), { micDeviceId: 'mic' });

    expect(result).toBe(UNTRUSTED_FRAME_REJECTION);
    // Side-effect check: no session was created.
    expect(reg.size()).toBe(0);
  });

  it('voice:stop rejects nested-frame invocation', async () => {
    const reg = new VoiceRegistry();
    registerVoiceHandlers(() => null, makeSettings, reg);
    const fn = handleMap.get('voice:stop')!;

    const result = await fn(nestedEvent(), { sessionId: 'x' });

    expect(result).toBe(UNTRUSTED_FRAME_REJECTION);
  });

  it('voice:transcribe rejects nested-frame invocation (no STT call)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    registerVoiceHandlers(() => null, makeSettings, new VoiceRegistry());
    const fn = handleMap.get('voice:transcribe')!;

    const result = await fn(nestedEvent(), { audio: Buffer.from('x'), mimeType: 'audio/wav' });

    expect(result).toBe(UNTRUSTED_FRAME_REJECTION);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('voice:speak rejects nested-frame invocation (no TTS call)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    registerVoiceHandlers(() => null, makeSettings, new VoiceRegistry());
    const fn = handleMap.get('voice:speak')!;

    const result = await fn(nestedEvent(), { text: 'hello' });

    expect(result).toBe(UNTRUSTED_FRAME_REJECTION);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('voice:local-transcript (ipcMain.on) drops nested-frame messages without re-broadcast', () => {
    const sent: unknown[] = [];
    const sender = {
      send: (_ch: string, data: unknown) => sent.push(data),
      isDestroyed: () => false,
    };
    registerVoiceHandlers(() => sender, makeSettings, new VoiceRegistry());
    const fn = onMap.get('voice:local-transcript')!;

    fn(nestedEvent(), { sessionId: 'x', text: 'hi', isFinal: false });

    expect(sent).toEqual([]); // never reached pushTranscript
  });

  it('voice:audio-chunk (ipcMain.on) drops nested-frame chunks', () => {
    const reg = new VoiceRegistry();
    registerVoiceHandlers(() => null, makeSettings, reg);
    const session = reg.start();
    const fn = onMap.get('voice:audio-chunk')!;

    fn(nestedEvent(), { sessionId: session.id, chunk: Buffer.from('abc') });

    expect(reg.get(session.id)?.audioChunks ?? []).toHaveLength(0);
  });
});

describe('streaming handlers reject nested-frame invocations', () => {
  beforeEach(() => { handleMap.clear(); onMap.clear(); });

  it('stream:start rejects nested-frame invocation without consuming a slot', async () => {
    registerStreamingHandlers(() => ({ kind: 'anthropic' as const, apiKey: 'sk-ant-test', model: 'claude-haiku-4-5-20251001' }));
    const fn = handleMap.get(STREAM_CHANNELS.STREAM_START)!;

    const result = await fn(nestedEvent({ sender: { id: 9, once: vi.fn(), off: vi.fn(), isDestroyed: () => false } }), {
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result).toBe(UNTRUSTED_FRAME_REJECTION);
  });

  it('stream:cancel rejects nested-frame invocation', async () => {
    registerStreamingHandlers(() => ({ kind: 'anthropic' as const, apiKey: 'sk-ant-test', model: 'claude-haiku-4-5-20251001' }));
    const fn = handleMap.get(STREAM_CHANNELS.STREAM_CANCEL)!;

    const result = await fn(nestedEvent({ sender: { id: 9 } }), { streamId: 'whatever' });

    expect(result).toBe(UNTRUSTED_FRAME_REJECTION);
  });

  it('stream:ack (ipcMain.on) drops nested-frame acks without applying them', () => {
    registerStreamingHandlers(() => ({ kind: 'anthropic' as const, apiKey: 'sk-ant-test', model: 'claude-haiku-4-5-20251001' }));
    const fn = onMap.get(STREAM_CHANNELS.STREAM_ACK)!;

    expect(() =>
      fn(nestedEvent({ sender: { id: 9 } }), { streamId: 's', count: 1 }),
    ).not.toThrow();
  });
});
