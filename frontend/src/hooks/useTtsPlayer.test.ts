import { renderHook, act } from '@testing-library/react';
import { useTtsPlayer } from './useTtsPlayer';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOnVoiceSpeakDone = vi.fn<any>(() => vi.fn());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOnVoiceSpeakError = vi.fn<any>(() => vi.fn());
const mockVoiceSpeak = vi.fn();
const mockVoiceSpeakCancel = vi.fn();

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    voiceSpeak: mockVoiceSpeak,
    voiceSpeakCancel: mockVoiceSpeakCancel,
    onVoiceSpeakDone: mockOnVoiceSpeakDone,
    onVoiceSpeakError: mockOnVoiceSpeakError,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockVoiceSpeak.mockResolvedValue({ speakId: 'speak-1' });
  (window as unknown as { api: unknown }).api = makeApi();
});

describe('useTtsPlayer', () => {
  it('speakCard: play triggers voiceSpeak with the card text', async () => {
    const { result } = renderHook(() => useTtsPlayer());
    const announce = vi.fn();

    act(() => { result.current.speakCard('Hello world', 'card-1', announce); });

    expect(mockVoiceSpeak).toHaveBeenCalledWith('Hello world');
    // Optimistic state update fires before the promise resolves
    expect(result.current.playingCardId).toBe('card-1');
    expect(announce).toHaveBeenCalledWith('Playing suggestion…');
  });

  it('speakCard: mute blocks play — voiceSpeak never called', async () => {
    const { result } = renderHook(() => useTtsPlayer());
    const announce = vi.fn();

    // Mute first
    act(() => { result.current.toggleMute(announce); });
    expect(result.current.sessionMuted).toBe(true);

    // Attempt to speak — should be a no-op
    act(() => { result.current.speakCard('Hello', 'card-1', announce); });

    expect(mockVoiceSpeak).not.toHaveBeenCalled();
    expect(result.current.playingCardId).toBeNull();
  });

  it('cancelCurrent: stops active playback via voiceSpeakCancel', async () => {
    const { result } = renderHook(() => useTtsPlayer());
    const announce = vi.fn();

    // Start playing and let voiceSpeak resolve so activeSpeakIdRef is populated
    act(() => { result.current.speakCard('Hello', 'card-1', announce); });
    await act(async () => {}); // drain microtask — .then() runs, activeSpeakIdRef = 'speak-1'

    act(() => { result.current.cancelCurrent(announce); });

    expect(mockVoiceSpeakCancel).toHaveBeenCalledWith('speak-1');
    expect(result.current.playingCardId).toBeNull();
    expect(announce).toHaveBeenCalledWith('Playback stopped.');
  });

  it('speakCard: starting second card cancels the first (one-at-a-time)', async () => {
    const { result } = renderHook(() => useTtsPlayer());
    const announce = vi.fn();

    // Start first card
    act(() => { result.current.speakCard('First', 'card-1', announce); });
    await act(async () => {}); // resolve → activeSpeakIdRef = 'speak-1'

    mockVoiceSpeak.mockResolvedValue({ speakId: 'speak-2' });

    // Start second card — should cancel the first
    act(() => { result.current.speakCard('Second', 'card-2', announce); });

    expect(mockVoiceSpeakCancel).toHaveBeenCalledWith('speak-1');
    expect(result.current.playingCardId).toBe('card-2');
    expect(mockVoiceSpeak).toHaveBeenCalledTimes(2);
  });

  it('toggleMute: stops active playback when muting', async () => {
    const { result } = renderHook(() => useTtsPlayer());
    const announce = vi.fn();

    // Start playing
    act(() => { result.current.speakCard('Hello', 'card-1', announce); });
    await act(async () => {}); // resolve → activeSpeakIdRef = 'speak-1'

    // Mute while playing
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

    const { result } = renderHook(() => useTtsPlayer());
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

    const { result } = renderHook(() => useTtsPlayer());
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

    const { result } = renderHook(() => useTtsPlayer());
    const announce = vi.fn();

    // Start, wait for resolve, then cancel
    act(() => { result.current.speakCard('Hello', 'card-1', announce); });
    await act(async () => {});
    act(() => { result.current.cancelCurrent(); });

    expect(result.current.playingCardId).toBeNull();

    // Stale done event for already-cancelled speak should be a no-op
    await act(async () => { fireDone({ speakId: 'speak-1' }); });

    expect(result.current.playingCardId).toBeNull();
  });
});
