import { renderHook, act } from '@testing-library/react';
import { useTtsPlayer, type TtsEngineSettings } from './useTtsPlayer';

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
  onend: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(text: string) { this.text = text; }
}

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    voiceSpeak: mockVoiceSpeak,
    voiceSpeakCancel: mockVoiceSpeakCancel,
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

beforeEach(() => {
  vi.resetAllMocks();
  mockVoiceSpeak.mockResolvedValue({ speakId: 'speak-1' });
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

  it('onVoiceSpeakDone: resets playingCardId when the matching speak finishes', async () => {
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
