import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useVoiceDictation } from './useVoiceDictation';

// ---------------------------------------------------------------------------
// Minimal MediaRecorder + MediaStream stubs
// ---------------------------------------------------------------------------

class FakeMediaStream {
  getTracks() {
    return [{ stop: vi.fn() }];
  }
}

class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => false);
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    // Fire ondataavailable first (provides audio data), then onstop.
    this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

function stubMediaDevices(stream: FakeMediaStream | null, error?: Error) {
  Object.defineProperty(global.navigator, 'mediaDevices', {
    value: {
      getUserMedia: error
        ? vi.fn().mockRejectedValue(error)
        : vi.fn().mockResolvedValue(stream),
    },
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  (global as unknown as Record<string, unknown>).MediaRecorder = FakeMediaRecorder;
  stubMediaDevices(new FakeMediaStream());
  window.api = {
    ...window.api,
    voiceTranscribe: vi.fn().mockResolvedValue({ text: 'hello world', confidence: 0.95 }),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useVoiceDictation', () => {
  it('starts idle', () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceDictation({ onTranscript }));
    expect(result.current.state).toBe('idle');
  });

  it('transitions idle → listening → idle on start + stop, calls onTranscript', async () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceDictation({ onTranscript }));

    await act(async () => { await result.current.start(); });
    expect(result.current.state).toBe('listening');

    act(() => { result.current.stop(); });

    await waitFor(() => expect(result.current.state).toBe('idle'));
    expect(onTranscript).toHaveBeenCalledWith('hello world');
  });

  it('transitions to error when getUserMedia is denied', async () => {
    const onError = vi.fn();
    stubMediaDevices(null, new Error('NotAllowedError'));
    const { result } = renderHook(() =>
      useVoiceDictation({ onTranscript: vi.fn(), onError }),
    );

    await act(async () => { await result.current.start(); });
    expect(result.current.state).toBe('error');
    expect(onError).toHaveBeenCalled();
  });

  it('cancel discards audio and returns to idle without calling onTranscript', async () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceDictation({ onTranscript }));

    await act(async () => { await result.current.start(); });
    act(() => { result.current.cancel(); });

    await waitFor(() => expect(result.current.state).toBe('idle'));
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('transitions to error when voiceTranscribe returns error', async () => {
    window.api.voiceTranscribe = vi.fn().mockResolvedValue({ error: 'STT is not enabled' }) as typeof window.api.voiceTranscribe;
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useVoiceDictation({ onTranscript: vi.fn(), onError }),
    );

    await act(async () => { await result.current.start(); });
    act(() => { result.current.stop(); });

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.errorMessage).toBe('STT is not enabled');
    expect(onError).toHaveBeenCalledWith('STT is not enabled');
  });

  it('no-op when start called while already listening', async () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceDictation({ onTranscript }));

    await act(async () => { await result.current.start(); });
    expect(result.current.state).toBe('listening');
    // second start should be a no-op
    await act(async () => { await result.current.start(); });
    expect(result.current.state).toBe('listening');
  });

  it('requests the configured micDeviceId as an exact constraint', async () => {
    const getUserMedia = vi.fn().mockResolvedValue(new FakeMediaStream());
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getUserMedia },
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() =>
      useVoiceDictation({ onTranscript: vi.fn(), micDeviceId: 'mic-42' }),
    );

    await act(async () => { await result.current.start(); });

    expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'mic-42' } } });
    expect(result.current.state).toBe('listening');
  });

  it('falls back to the default mic when the stored device is unavailable', async () => {
    const overconstrained = Object.assign(new Error('no such device'), {
      name: 'OverconstrainedError',
    });
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(overconstrained)
      .mockResolvedValueOnce(new FakeMediaStream());
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getUserMedia },
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() =>
      useVoiceDictation({ onTranscript: vi.fn(), micDeviceId: 'unplugged-mic' }),
    );

    await act(async () => { await result.current.start(); });

    expect(getUserMedia).toHaveBeenNthCalledWith(1, { audio: { deviceId: { exact: 'unplugged-mic' } } });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: true });
    expect(result.current.state).toBe('listening');
  });

  it('does not retry the default mic on permission errors', async () => {
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    const getUserMedia = vi.fn().mockRejectedValue(denied);
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getUserMedia },
      writable: true,
      configurable: true,
    });
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useVoiceDictation({ onTranscript: vi.fn(), onError, micDeviceId: 'mic-42' }),
    );

    await act(async () => { await result.current.start(); });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('error');
    expect(onError).toHaveBeenCalled();
  });

  it('threads inputLanguage into the voiceTranscribe payload', async () => {
    const transcribe = vi.fn().mockResolvedValue({ text: 'bonjour', confidence: 0.9 });
    window.api = { ...window.api, voiceTranscribe: transcribe };
    const onTranscript = vi.fn();
    const { result } = renderHook(() =>
      useVoiceDictation({ onTranscript, inputLanguage: 'fr-FR' }),
    );

    await act(async () => { await result.current.start(); });
    act(() => { result.current.stop(); });

    await waitFor(() => expect(result.current.state).toBe('idle'));
    expect(transcribe).toHaveBeenCalledWith(expect.any(ArrayBuffer), undefined, 'fr-FR');
    expect(onTranscript).toHaveBeenCalledWith('bonjour');
  });
});
