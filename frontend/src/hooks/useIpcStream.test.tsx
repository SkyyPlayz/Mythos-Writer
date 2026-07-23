import { renderHook, act } from '@testing-library/react';
import { useIpcStream } from './useIpcStream';

type TokenHandler = (data: { streamId: string; token: string }) => void;
type EndHandler = (data: { streamId: string }) => void;
type ErrorHandler = (data: { streamId: string; category: string; message: string }) => void;

let tokenCb: TokenHandler | null = null;
let endCb: EndHandler | null = null;
let errorCb: ErrorHandler | null = null;

const mockStreamCancel = vi.fn().mockResolvedValue({ cancelled: true });
const mockStreamAck = vi.fn();

function buildApi() {
  return {
    onStreamToken: (cb: TokenHandler) => {
      tokenCb = cb;
      return () => {
        tokenCb = null;
      };
    },
    onStreamEnd: (cb: EndHandler) => {
      endCb = cb;
      return () => {
        endCb = null;
      };
    },
    onStreamError: (cb: ErrorHandler) => {
      errorCb = cb;
      return () => {
        errorCb = null;
      };
    },
    streamCancel: mockStreamCancel,
    streamAck: mockStreamAck,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockStreamCancel.mockResolvedValue({ cancelled: true });
  tokenCb = null;
  endCb = null;
  errorCb = null;
  (window as unknown as { api: unknown }).api = buildApi();
});

describe('useIpcStream — initial state', () => {
  it('returns empty state when streamId is null', () => {
    const { result } = renderHook(() => useIpcStream(null));
    expect(result.current.text).toBe('');
    expect(result.current.done).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('subscribes to stream events when streamId is provided', () => {
    renderHook(() => useIpcStream('s1'));
    expect(tokenCb).not.toBeNull();
    expect(endCb).not.toBeNull();
    expect(errorCb).not.toBeNull();
  });
});

describe('useIpcStream — token accumulation', () => {
  it('accumulates tokens for matching streamId', () => {
    const { result } = renderHook(() => useIpcStream('s1'));

    act(() => {
      tokenCb?.({ streamId: 's1', token: 'Hello' });
    });
    act(() => {
      tokenCb?.({ streamId: 's1', token: ', world!' });
    });

    expect(result.current.text).toBe('Hello, world!');
    expect(result.current.done).toBe(false);
  });

  it('ignores tokens from a different streamId', () => {
    const { result } = renderHook(() => useIpcStream('s1'));

    act(() => {
      tokenCb?.({ streamId: 'other', token: 'ignored' });
    });

    expect(result.current.text).toBe('');
  });

  it('sends streamAck(streamId, 1) for each token received', () => {
    renderHook(() => useIpcStream('s1'));

    act(() => {
      tokenCb?.({ streamId: 's1', token: 'a' });
      tokenCb?.({ streamId: 's1', token: 'b' });
    });

    expect(mockStreamAck).toHaveBeenCalledTimes(2);
    expect(mockStreamAck).toHaveBeenNthCalledWith(1, 's1', 1);
    expect(mockStreamAck).toHaveBeenNthCalledWith(2, 's1', 1);
  });
});

describe('useIpcStream — done state', () => {
  it('sets done=true when STREAM_END fires for matching streamId', () => {
    const { result } = renderHook(() => useIpcStream('s1'));

    act(() => {
      tokenCb?.({ streamId: 's1', token: 'text' });
      endCb?.({ streamId: 's1' });
    });

    expect(result.current.text).toBe('text');
    expect(result.current.done).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('ignores STREAM_END from a different streamId', () => {
    const { result } = renderHook(() => useIpcStream('s1'));

    act(() => {
      tokenCb?.({ streamId: 's1', token: 'text' });
      endCb?.({ streamId: 'other' });
    });

    expect(result.current.done).toBe(false);
  });
});

describe('useIpcStream — error state', () => {
  it('sets error and done=true when STREAM_ERROR fires for matching streamId', () => {
    const { result } = renderHook(() => useIpcStream('s1'));

    act(() => {
      errorCb?.({ streamId: 's1', category: 'unknown', message: 'API failure' });
    });

    expect(result.current.error).toBe('API failure');
    expect(result.current.done).toBe(true);
    expect(result.current.text).toBe('');
  });

  it('ignores STREAM_ERROR from a different streamId', () => {
    const { result } = renderHook(() => useIpcStream('s1'));

    act(() => {
      errorCb?.({ streamId: 'other', category: 'unknown', message: 'ignored' });
    });

    expect(result.current.error).toBeNull();
    expect(result.current.done).toBe(false);
  });

  it('preserves accumulated text when error fires', () => {
    const { result } = renderHook(() => useIpcStream('s1'));

    act(() => {
      tokenCb?.({ streamId: 's1', token: 'partial' });
      errorCb?.({ streamId: 's1', category: 'unknown', message: 'mid-stream failure' });
    });

    expect(result.current.text).toBe('partial');
    expect(result.current.error).toBe('mid-stream failure');
    expect(result.current.done).toBe(true);
  });
});

describe('useIpcStream — cancel', () => {
  it('calls streamCancel with the active streamId', () => {
    const { result } = renderHook(() => useIpcStream('s1'));

    act(() => {
      result.current.cancel();
    });

    expect(mockStreamCancel).toHaveBeenCalledWith('s1');
  });

  it('clears text, done, and error immediately on cancel', () => {
    const { result } = renderHook(() => useIpcStream('s1'));

    act(() => {
      tokenCb?.({ streamId: 's1', token: 'partial text' });
    });
    expect(result.current.text).toBe('partial text');

    act(() => {
      result.current.cancel();
    });

    expect(result.current.text).toBe('');
    expect(result.current.done).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('ignores tokens that arrive after cancel', () => {
    const { result } = renderHook(() => useIpcStream('s1'));

    act(() => {
      result.current.cancel();
    });

    act(() => {
      tokenCb?.({ streamId: 's1', token: 'late token' });
    });

    expect(result.current.text).toBe('');
  });

  it('ignores STREAM_END that arrives after cancel', () => {
    const { result } = renderHook(() => useIpcStream('s1'));

    act(() => {
      result.current.cancel();
    });
    act(() => {
      endCb?.({ streamId: 's1' });
    });

    expect(result.current.done).toBe(false);
  });

  it('does not call streamCancel when streamId is null', () => {
    const { result } = renderHook(() => useIpcStream(null));

    act(() => {
      result.current.cancel();
    });

    expect(mockStreamCancel).not.toHaveBeenCalled();
  });
});

describe('useIpcStream — streamId changes', () => {
  it('resets state and re-subscribes when streamId changes to a new value', () => {
    let id: string | null = 's1';
    const { result, rerender } = renderHook(() => useIpcStream(id));

    act(() => {
      tokenCb?.({ streamId: 's1', token: 'first' });
    });
    expect(result.current.text).toBe('first');

    id = 's2';
    rerender();

    expect(result.current.text).toBe('');
    expect(result.current.done).toBe(false);
  });

  it('unsubscribes previous listeners when streamId changes', () => {
    let id: string | null = 's1';
    const { result, rerender } = renderHook(() => useIpcStream(id));

    const prevTokenCb = tokenCb;
    id = 's2';
    rerender();

    // Old callbacks are replaced; new ones for s2 are wired
    expect(tokenCb).not.toBe(prevTokenCb);

    // Firing on old s1 ID through new callback should be ignored
    act(() => {
      tokenCb?.({ streamId: 's1', token: 'stale' });
    });
    expect(result.current.text).toBe('');
  });

  it('resets and unsubscribes when streamId becomes null', () => {
    let id: string | null = 's1';
    const { rerender } = renderHook(() => useIpcStream(id));

    expect(tokenCb).not.toBeNull();

    id = null;
    rerender();

    expect(tokenCb).toBeNull();
    expect(endCb).toBeNull();
    expect(errorCb).toBeNull();
  });

  it('unsubscribes all listeners on unmount', () => {
    const { unmount } = renderHook(() => useIpcStream('s1'));
    unmount();
    expect(tokenCb).toBeNull();
    expect(endCb).toBeNull();
    expect(errorCb).toBeNull();
  });
});
