import { renderHook, act } from '@testing-library/react';
import { useTtsPlayer, type TtsEngineSettings, type TtsVoicePrefs } from './useTtsPlayer';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOnVoiceSpeakChunk = vi.fn<any>(() => vi.fn());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOnVoiceSpeakDone = vi.fn<any>(() => vi.fn());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOnVoiceSpeakError = vi.fn<any>(() => vi.fn());
const mockVoiceSpeak = vi.fn();
const mockVoiceSpeakCancel = vi.fn();

const mockSpeechSynthesisSpeak = vi.fn();
const mockSpeechSynthesisCancel = vi.fn();

/** Minimal SpeechSynthesisUtterance stub for jsdom (not provided by default). */
class MockSpeechSynthesisUtterance {
  text: string;
  volume = 1;
  rate = 1;
  voice: unknown = null;
  onend: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(text: string) { this.text = text; }
}

// ── Web Audio stubs (jsdom lacks AudioContext) ──────────────────────────────

interface MockSourceNode {
  buffer: unknown;
  playbackRate: { value: number };
  onended: (() => void) | null;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}
interface MockGainNode {
  gain: { value: number };
  connect: ReturnType<typeof vi.fn>;
}
interface MockCreatedBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  data: Float32Array;
}

const createdSources: MockSourceNode[] = [];
const createdGains: MockGainNode[] = [];
const createdBuffers: MockCreatedBuffer[] = [];
const mockDecodeAudioData = vi.fn();

class MockAudioContext {
  state = 'running';
  destination = { node: 'destination' };
  resume = vi.fn();
  close = vi.fn(() => Promise.resolve());
  decodeAudioData = mockDecodeAudioData;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
    const buf: MockCreatedBuffer = {
      numberOfChannels,
      length,
      sampleRate,
      data: new Float32Array(length),
    };
    createdBuffers.push(buf);
    return { ...buf, getChannelData: () => buf.data };
  }
  createBufferSource(): MockSourceNode {
    const source: MockSourceNode = {
      buffer: null,
      playbackRate: { value: 1 },
      onended: null,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    createdSources.push(source);
    return source;
  }
  createGain(): MockGainNode {
    const gain: MockGainNode = { gain: { value: 1 }, connect: vi.fn() };
    createdGains.push(gain);
    return gain;
  }
}

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    voiceSpeak: mockVoiceSpeak,
    voiceSpeakCancel: mockVoiceSpeakCancel,
    onVoiceSpeakChunk: mockOnVoiceSpeakChunk,
    onVoiceSpeakDone: mockOnVoiceSpeakDone,
    onVoiceSpeakError: mockOnVoiceSpeakError,
    ...overrides,
  };
}

/** TTS settings that activate the IPC/Piper path. */
const PIPER_SETTINGS: TtsEngineSettings = {
  enabled: true,
  provider: 'local',
  localBinaryPath: '/usr/local/bin/piper',
};

/**
 * Captures the chunk + done push callbacks the hook subscribes with, so tests
 * can simulate main-process voice:speak:chunk / voice:speak:done events.
 */
function capturePushCallbacks() {
  let fireChunk!: (evt: { speakId: string; chunk: Uint8Array }) => void;
  let fireDone!: (evt: { speakId: string; format?: 'pcm' | 'mp3'; sampleRate?: number }) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockOnVoiceSpeakChunk as any).mockImplementationOnce((cb: typeof fireChunk) => {
    fireChunk = cb;
    return () => {};
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockOnVoiceSpeakDone as any).mockImplementationOnce((cb: typeof fireDone) => {
    fireDone = cb;
    return () => {};
  });
  return { fireChunk: (evt: { speakId: string; chunk: Uint8Array }) => fireChunk(evt), fireDone: (evt: { speakId: string; format?: 'pcm' | 'mp3'; sampleRate?: number }) => fireDone(evt) };
}

beforeEach(() => {
  vi.resetAllMocks();
  createdSources.length = 0;
  createdGains.length = 0;
  createdBuffers.length = 0;
  mockVoiceSpeak.mockResolvedValue({ speakId: 'speak-1' });
  mockDecodeAudioData.mockResolvedValue({ duration: 1 });
  (window as unknown as { api: unknown }).api = makeApi();
  (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
    speak: mockSpeechSynthesisSpeak,
    cancel: mockSpeechSynthesisCancel,
  };
  // jsdom doesn't provide SpeechSynthesisUtterance — stub it globally.
  (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
    MockSpeechSynthesisUtterance;
  (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
    MockSpeechSynthesisUtterance;
  // jsdom doesn't provide AudioContext — stub it globally.
  (window as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;
});

// ── IPC path (Piper / cloud) ────────────────────────────────────────────────

describe('useTtsPlayer — IPC path (Piper/cloud configured)', () => {
  it('speakCard: play triggers voiceSpeak with the card text', async () => {
    const { result } = renderHook(() => useTtsPlayer(PIPER_SETTINGS));
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello world', 'card-1', announce); });

    expect(mockVoiceSpeak).toHaveBeenCalledWith('Hello world');
    expect(result.current.playingCardId).toBe('card-1');
    expect(announce).toHaveBeenCalledWith('Playing suggestion…');
  });

  it('speakCard: mute blocks play — voiceSpeak never called', async () => {
    const { result } = renderHook(() => useTtsPlayer(PIPER_SETTINGS));
    const announce = vi.fn();

    act(() => { result.current.toggleMute(announce); });
    expect(result.current.sessionMuted).toBe(true);

    act(() => { result.current.speakCard('Hello', 'card-1', announce); });

    expect(mockVoiceSpeak).not.toHaveBeenCalled();
    expect(result.current.playingCardId).toBeNull();
  });

  it('cancelCurrent: stops active playback via voiceSpeakCancel', async () => {
    const { result } = renderHook(() => useTtsPlayer(PIPER_SETTINGS));
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello', 'card-1', announce); });
    await act(async () => {}); // drain microtask — .then() runs, activeSpeakIdRef = 'speak-1'

    act(() => { result.current.cancelCurrent(announce); });

    expect(mockVoiceSpeakCancel).toHaveBeenCalledWith('speak-1');
    expect(result.current.playingCardId).toBeNull();
    expect(announce).toHaveBeenCalledWith('Playback stopped.');
  });

  it('speakCard: starting second card cancels the first (one-at-a-time)', async () => {
    const { result } = renderHook(() => useTtsPlayer(PIPER_SETTINGS));
    const announce = vi.fn();

    act(() => { result.current.speakCard('First', 'card-1', announce); });
    await act(async () => {}); // resolve → activeSpeakIdRef = 'speak-1'

    mockVoiceSpeak.mockResolvedValue({ speakId: 'speak-2' });

    act(() => { result.current.speakCard('Second', 'card-2', announce); });

    expect(mockVoiceSpeakCancel).toHaveBeenCalledWith('speak-1');
    expect(result.current.playingCardId).toBe('card-2');
    expect(mockVoiceSpeak).toHaveBeenCalledTimes(2);
  });

  it('toggleMute: stops active playback when muting', async () => {
    const { result } = renderHook(() => useTtsPlayer(PIPER_SETTINGS));
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello', 'card-1', announce); });
    await act(async () => {}); // resolve → activeSpeakIdRef = 'speak-1'

    act(() => { result.current.toggleMute(announce); });

    expect(mockVoiceSpeakCancel).toHaveBeenCalledWith('speak-1');
    expect(result.current.playingCardId).toBeNull();
    expect(result.current.sessionMuted).toBe(true);
    expect(announce).toHaveBeenCalledWith('Voice muted.');
  });

  it('onVoiceSpeakDone: resets playingCardId when the speak finishes with no audio', async () => {
    let fireDone!: (evt: { speakId: string }) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockOnVoiceSpeakDone as any).mockImplementationOnce((cb: (evt: { speakId: string }) => void) => {
      fireDone = cb;
      return () => {};
    });

    const { result } = renderHook(() => useTtsPlayer(PIPER_SETTINGS));
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello', 'card-1', announce); });
    await act(async () => {}); // resolve → activeSpeakIdRef = 'speak-1'

    expect(result.current.playingCardId).toBe('card-1');

    await act(async () => { fireDone({ speakId: 'speak-1' }); });

    expect(result.current.playingCardId).toBeNull();
  });

  it('onVoiceSpeakError: resets playingCardId on error', async () => {
    let fireError!: (evt: { speakId: string }) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockOnVoiceSpeakError as any).mockImplementationOnce((cb: (evt: { speakId: string }) => void) => {
      fireError = cb;
      return () => {};
    });

    const { result } = renderHook(() => useTtsPlayer(PIPER_SETTINGS));
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello', 'card-1', announce); });
    await act(async () => {}); // resolve → activeSpeakIdRef = 'speak-1'

    expect(result.current.playingCardId).toBe('card-1');

    await act(async () => { fireError({ speakId: 'speak-1' }); });

    expect(result.current.playingCardId).toBeNull();
  });

  it('onVoiceSpeakDone: ignores stale speakId from a cancelled session', async () => {
    let fireDone!: (evt: { speakId: string }) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockOnVoiceSpeakDone as any).mockImplementationOnce((cb: (evt: { speakId: string }) => void) => {
      fireDone = cb;
      return () => {};
    });

    const { result } = renderHook(() => useTtsPlayer(PIPER_SETTINGS));
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello', 'card-1', announce); });
    await act(async () => {});
    act(() => { result.current.cancelCurrent(); });

    expect(result.current.playingCardId).toBeNull();

    await act(async () => { fireDone({ speakId: 'speak-1' }); });

    expect(result.current.playingCardId).toBeNull();
  });
});

// ── IPC audio playback (SKY voice pipeline) ─────────────────────────────────

describe('useTtsPlayer — IPC chunk buffering + Web Audio playback', () => {
  const PREFS: TtsVoicePrefs = { ttsVolume: 0.4, ttsRate: 1.5 };

  it('buffers mp3 chunks and plays them via decodeAudioData on done', async () => {
    const { fireChunk, fireDone } = capturePushCallbacks();
    const { result } = renderHook(() => useTtsPlayer(PIPER_SETTINGS, PREFS));
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello', 'card-1', announce); });
    await act(async () => {}); // resolve → activeSpeakIdRef = 'speak-1'

    act(() => {
      fireChunk({ speakId: 'speak-1', chunk: new Uint8Array([1, 2]) });
      fireChunk({ speakId: 'speak-1', chunk: new Uint8Array([3]) });
    });
    await act(async () => { fireDone({ speakId: 'speak-1', format: 'mp3' }); });

    // Chunks concatenated into one buffer and decoded.
    expect(mockDecodeAudioData).toHaveBeenCalledTimes(1);
    const decoded = new Uint8Array(mockDecodeAudioData.mock.calls[0][0] as ArrayBuffer);
    expect(Array.from(decoded)).toEqual([1, 2, 3]);

    // Volume via GainNode, rate via playbackRate, wired source → gain → destination.
    expect(createdSources).toHaveLength(1);
    expect(createdGains).toHaveLength(1);
    expect(createdGains[0].gain.value).toBe(0.4);
    expect(createdSources[0].playbackRate.value).toBe(1.5);
    expect(createdSources[0].connect).toHaveBeenCalledWith(createdGains[0]);
    expect(createdSources[0].start).toHaveBeenCalledTimes(1);

    // Still playing until the source ends.
    expect(result.current.playingCardId).toBe('card-1');
    act(() => { createdSources[0].onended?.(); });
    expect(result.current.playingCardId).toBeNull();
  });

  it('builds an AudioBuffer manually for raw PCM using the pushed sampleRate', async () => {
    const { fireChunk, fireDone } = capturePushCallbacks();
    const { result } = renderHook(() => useTtsPlayer(PIPER_SETTINGS, PREFS));
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello', 'card-1', announce); });
    await act(async () => {});

    // Two 16-bit LE samples: 16384 → 0.5, -16384 → -0.5.
    const pcmBytes = new Uint8Array(new Int16Array([16384, -16384]).buffer);
    act(() => { fireChunk({ speakId: 'speak-1', chunk: pcmBytes }); });
    await act(async () => { fireDone({ speakId: 'speak-1', format: 'pcm', sampleRate: 16000 }); });

    expect(mockDecodeAudioData).not.toHaveBeenCalled();
    expect(createdBuffers).toHaveLength(1);
    expect(createdBuffers[0].numberOfChannels).toBe(1);
    expect(createdBuffers[0].length).toBe(2);
    expect(createdBuffers[0].sampleRate).toBe(16000);
    expect(createdBuffers[0].data[0]).toBeCloseTo(0.5, 5);
    expect(createdBuffers[0].data[1]).toBeCloseTo(-0.5, 5);
    expect(createdSources[0].start).toHaveBeenCalledTimes(1);
  });

  it('defaults volume/rate to 1 when no voice prefs are given', async () => {
    const { fireChunk, fireDone } = capturePushCallbacks();
    const { result } = renderHook(() => useTtsPlayer(PIPER_SETTINGS));
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello', 'card-1', announce); });
    await act(async () => {});
    act(() => { fireChunk({ speakId: 'speak-1', chunk: new Uint8Array([9]) }); });
    await act(async () => { fireDone({ speakId: 'speak-1', format: 'mp3' }); });

    expect(createdGains[0].gain.value).toBe(1);
    expect(createdSources[0].playbackRate.value).toBe(1);
  });

  it('clamps out-of-range volume and rate prefs', async () => {
    const { fireChunk, fireDone } = capturePushCallbacks();
    const { result } = renderHook(() =>
      useTtsPlayer(PIPER_SETTINGS, { ttsVolume: 4, ttsRate: 9 }),
    );
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello', 'card-1', announce); });
    await act(async () => {});
    act(() => { fireChunk({ speakId: 'speak-1', chunk: new Uint8Array([9]) }); });
    await act(async () => { fireDone({ speakId: 'speak-1', format: 'mp3' }); });

    expect(createdGains[0].gain.value).toBe(1);
    expect(createdSources[0].playbackRate.value).toBe(2);
  });

  it('cancelCurrent during playback stops the Web Audio source', async () => {
    const { fireChunk, fireDone } = capturePushCallbacks();
    const { result } = renderHook(() => useTtsPlayer(PIPER_SETTINGS, PREFS));
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello', 'card-1', announce); });
    await act(async () => {});
    act(() => { fireChunk({ speakId: 'speak-1', chunk: new Uint8Array([9]) }); });
    await act(async () => { fireDone({ speakId: 'speak-1', format: 'mp3' }); });

    expect(createdSources[0].start).toHaveBeenCalledTimes(1);

    act(() => { result.current.cancelCurrent(announce); });

    expect(createdSources[0].stop).toHaveBeenCalledTimes(1);
    expect(result.current.playingCardId).toBeNull();
  });

  it('ignores chunks/done for a speakId cancelled before done arrives', async () => {
    const { fireChunk, fireDone } = capturePushCallbacks();
    const { result } = renderHook(() => useTtsPlayer(PIPER_SETTINGS, PREFS));
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello', 'card-1', announce); });
    await act(async () => {});
    act(() => { fireChunk({ speakId: 'speak-1', chunk: new Uint8Array([9]) }); });
    act(() => { result.current.cancelCurrent(); });

    await act(async () => { fireDone({ speakId: 'speak-1', format: 'mp3' }); });

    expect(mockDecodeAudioData).not.toHaveBeenCalled();
    expect(createdSources).toHaveLength(0);
    expect(result.current.playingCardId).toBeNull();
  });

  it('resets playingCardId when decodeAudioData fails', async () => {
    mockDecodeAudioData.mockRejectedValue(new Error('bad mp3'));
    const { fireChunk, fireDone } = capturePushCallbacks();
    const { result } = renderHook(() => useTtsPlayer(PIPER_SETTINGS, PREFS));
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello', 'card-1', announce); });
    await act(async () => {});
    act(() => { fireChunk({ speakId: 'speak-1', chunk: new Uint8Array([9]) }); });
    await act(async () => { fireDone({ speakId: 'speak-1', format: 'mp3' }); });

    expect(result.current.playingCardId).toBeNull();
    expect(createdSources).toHaveLength(0);
  });
});

// ── Stored voice settings (SKY voice pipeline) ──────────────────────────────

describe('useTtsPlayer — stored voice settings', () => {
  it('forwards ttsVoiceId to voiceSpeak on the IPC path', () => {
    const { result } = renderHook(() =>
      useTtsPlayer(PIPER_SETTINGS, { ttsVoiceId: 'nova' }),
    );
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello', 'card-1', announce); });

    expect(mockVoiceSpeak).toHaveBeenCalledWith('Hello', 'nova');
  });

  it('persistentMute: starts muted and speakCard is a no-op', () => {
    const { result } = renderHook(() =>
      useTtsPlayer(PIPER_SETTINGS, { persistentMute: true }),
    );
    const announce = vi.fn();

    expect(result.current.sessionMuted).toBe(true);

    act(() => { result.current.speakCard('Hello', 'card-1', announce); });

    expect(mockVoiceSpeak).not.toHaveBeenCalled();
    expect(result.current.playingCardId).toBeNull();
  });

  it('persistentMute arriving after mount (settings load async) mutes the session', () => {
    const { result, rerender } = renderHook(
      ({ prefs }: { prefs?: TtsVoicePrefs }) => useTtsPlayer(PIPER_SETTINGS, prefs),
      { initialProps: { prefs: undefined as TtsVoicePrefs | undefined } },
    );

    expect(result.current.sessionMuted).toBe(false);

    rerender({ prefs: { persistentMute: true } });

    expect(result.current.sessionMuted).toBe(true);
  });

  it('user toggle overrides stored persistentMute', () => {
    const { result, rerender } = renderHook(
      ({ prefs }: { prefs?: TtsVoicePrefs }) => useTtsPlayer(PIPER_SETTINGS, prefs),
      { initialProps: { prefs: { persistentMute: true } as TtsVoicePrefs | undefined } },
    );
    const announce = vi.fn();

    expect(result.current.sessionMuted).toBe(true);

    act(() => { result.current.toggleMute(announce); }); // user unmutes
    expect(result.current.sessionMuted).toBe(false);

    // A later settings refresh with persistentMute still true must not re-mute.
    rerender({ prefs: { persistentMute: true, ttsVolume: 0.7 } });
    expect(result.current.sessionMuted).toBe(false);
  });

  it('OS fallback: applies volume, rate and matches the stored voice', () => {
    const voices = [
      { name: 'Daniel', voiceURI: 'urn:daniel' },
      { name: 'Samantha', voiceURI: 'urn:samantha' },
    ];
    (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
      speak: mockSpeechSynthesisSpeak,
      cancel: mockSpeechSynthesisCancel,
      getVoices: () => voices,
    };

    let captured!: MockSpeechSynthesisUtterance;
    mockSpeechSynthesisSpeak.mockImplementation((u: MockSpeechSynthesisUtterance) => {
      captured = u;
    });

    const { result } = renderHook(() =>
      useTtsPlayer(undefined, { ttsVolume: 0.3, ttsRate: 0.8, ttsVoiceId: 'Samantha' }),
    );
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello OS', 'card-1', announce); });

    expect(captured.volume).toBe(0.3);
    expect(captured.rate).toBe(0.8);
    expect(captured.voice).toBe(voices[1]);
  });

  it('OS fallback: unknown ttsVoiceId leaves utterance.voice unset', () => {
    (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
      speak: mockSpeechSynthesisSpeak,
      cancel: mockSpeechSynthesisCancel,
      getVoices: () => [{ name: 'Daniel', voiceURI: 'urn:daniel' }],
    };

    let captured!: MockSpeechSynthesisUtterance;
    mockSpeechSynthesisSpeak.mockImplementation((u: MockSpeechSynthesisUtterance) => {
      captured = u;
    });

    const { result } = renderHook(() =>
      useTtsPlayer(undefined, { ttsVoiceId: 'no-such-voice' }),
    );
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello OS', 'card-1', announce); });

    expect(captured.voice).toBeNull();
  });
});

// ── OS speechSynthesis path (no engine configured) ─────────────────────────

describe('useTtsPlayer — OS speechSynthesis path (no engine configured)', () => {
  it('speakCard: calls speechSynthesis.speak, not voiceSpeak, when no ttsSettings', () => {
    const { result } = renderHook(() => useTtsPlayer());
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello OS', 'card-1', announce); });

    expect(mockSpeechSynthesisSpeak).toHaveBeenCalledTimes(1);
    expect(mockVoiceSpeak).not.toHaveBeenCalled();
    expect(result.current.playingCardId).toBe('card-1');
    expect(announce).toHaveBeenCalledWith('Playing suggestion…');
  });

  it('speakCard: calls speechSynthesis.speak when ttsSettings.enabled is false', () => {
    const { result } = renderHook(() =>
      useTtsPlayer({ enabled: false, provider: 'local', localBinaryPath: '/piper' }),
    );
    const announce = vi.fn();

    act(() => { result.current.speakCard('Disabled engine', 'card-1', announce); });

    expect(mockSpeechSynthesisSpeak).toHaveBeenCalledTimes(1);
    expect(mockVoiceSpeak).not.toHaveBeenCalled();
  });

  it('speakCard: calls speechSynthesis.speak when local provider has no binary path', () => {
    const { result } = renderHook(() =>
      useTtsPlayer({ enabled: true, provider: 'local' }),
    );
    const announce = vi.fn();

    act(() => { result.current.speakCard('No binary', 'card-1', announce); });

    expect(mockSpeechSynthesisSpeak).toHaveBeenCalledTimes(1);
    expect(mockVoiceSpeak).not.toHaveBeenCalled();
  });

  it('speakCard (OS): onend resets playingCardId', async () => {
    let capturedUtterance!: SpeechSynthesisUtterance;
    mockSpeechSynthesisSpeak.mockImplementation((u: SpeechSynthesisUtterance) => {
      capturedUtterance = u;
    });

    const { result } = renderHook(() => useTtsPlayer());
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello', 'card-1', announce); });
    expect(result.current.playingCardId).toBe('card-1');

    await act(async () => { capturedUtterance.onend?.(new Event('end') as SpeechSynthesisErrorEvent); });

    expect(result.current.playingCardId).toBeNull();
  });

  it('speakCard (OS): onerror resets playingCardId and announces failure', async () => {
    let capturedUtterance!: SpeechSynthesisUtterance;
    mockSpeechSynthesisSpeak.mockImplementation((u: SpeechSynthesisUtterance) => {
      capturedUtterance = u;
    });

    const { result } = renderHook(() => useTtsPlayer());
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello', 'card-1', announce); });
    expect(result.current.playingCardId).toBe('card-1');

    await act(async () => { capturedUtterance.onerror?.(new Event('error') as SpeechSynthesisErrorEvent); });

    expect(result.current.playingCardId).toBeNull();
    expect(announce).toHaveBeenCalledWith('Voice playback failed.');
  });

  it('cancelCurrent (OS): calls speechSynthesis.cancel', () => {
    const { result } = renderHook(() => useTtsPlayer());
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello', 'card-1', announce); });
    expect(result.current.playingCardId).toBe('card-1');

    act(() => { result.current.cancelCurrent(announce); });

    expect(mockSpeechSynthesisCancel).toHaveBeenCalledTimes(1);
    expect(result.current.playingCardId).toBeNull();
    expect(announce).toHaveBeenCalledWith('Playback stopped.');
  });

  it('speakCard (OS): second card cancels the first via speechSynthesis.cancel', () => {
    const { result } = renderHook(() => useTtsPlayer());
    const announce = vi.fn();

    act(() => { result.current.speakCard('First', 'card-1', announce); });
    act(() => { result.current.speakCard('Second', 'card-2', announce); });

    expect(mockSpeechSynthesisCancel).toHaveBeenCalledTimes(1);
    expect(mockSpeechSynthesisSpeak).toHaveBeenCalledTimes(2);
    expect(result.current.playingCardId).toBe('card-2');
  });

  it('toggleMute (OS): calls speechSynthesis.cancel when muting during playback', () => {
    const { result } = renderHook(() => useTtsPlayer());
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello', 'card-1', announce); });
    act(() => { result.current.toggleMute(announce); });

    expect(mockSpeechSynthesisCancel).toHaveBeenCalledTimes(1);
    expect(result.current.playingCardId).toBeNull();
    expect(result.current.sessionMuted).toBe(true);
  });

  it('speakCard (OS): stale onend event after cancel is ignored', async () => {
    let capturedUtterance!: SpeechSynthesisUtterance;
    mockSpeechSynthesisSpeak.mockImplementation((u: SpeechSynthesisUtterance) => {
      capturedUtterance = u;
    });

    const { result } = renderHook(() => useTtsPlayer());
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello', 'card-1', announce); });
    act(() => { result.current.cancelCurrent(); });

    expect(result.current.playingCardId).toBeNull();

    // stale onend should not re-set state
    await act(async () => { capturedUtterance.onend?.(new Event('end') as SpeechSynthesisErrorEvent); });

    expect(result.current.playingCardId).toBeNull();
  });

  it('speakCard (OS): mute blocks play — speechSynthesis.speak never called', () => {
    const { result } = renderHook(() => useTtsPlayer());
    const announce = vi.fn();

    act(() => { result.current.toggleMute(announce); });
    expect(result.current.sessionMuted).toBe(true);

    act(() => { result.current.speakCard('Hello', 'card-1', announce); });

    expect(mockSpeechSynthesisSpeak).not.toHaveBeenCalled();
    expect(result.current.playingCardId).toBeNull();
  });
});
