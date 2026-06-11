import { render, screen, fireEvent, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useSaveStatus } from './hooks/useSaveStatus';
import SceneEditor from './SceneEditor';

// ---------------------------------------------------------------------------
// useSaveStatus — state machine unit tests
// ---------------------------------------------------------------------------

describe('useSaveStatus state machine', () => {
  it('starts in saved state', () => {
    const { result } = renderHook(() => useSaveStatus());
    expect(result.current.saveStatus).toBe('saved');
  });

  it('starts with a savedAt timestamp when initial state is saved', () => {
    const { result } = renderHook(() => useSaveStatus('saved'));
    expect(result.current.savedAt).toBeInstanceOf(Date);
  });

  it('starts with null savedAt when initial state is unsaved', () => {
    const { result } = renderHook(() => useSaveStatus('unsaved'));
    expect(result.current.savedAt).toBeNull();
  });

  it('markDirty transitions to unsaved', () => {
    const { result } = renderHook(() => useSaveStatus());
    act(() => result.current.markDirty());
    expect(result.current.saveStatus).toBe('unsaved');
  });

  it('markSaving transitions to saving', () => {
    const { result } = renderHook(() => useSaveStatus());
    act(() => result.current.markSaving());
    expect(result.current.saveStatus).toBe('saving');
  });

  it('markSaved from saving → saved', () => {
    const { result } = renderHook(() => useSaveStatus());
    act(() => result.current.markSaving());
    act(() => result.current.markSaved());
    expect(result.current.saveStatus).toBe('saved');
  });

  it('markSaved records savedAt timestamp', () => {
    const { result } = renderHook(() => useSaveStatus('unsaved'));
    act(() => result.current.markSaving());
    act(() => result.current.markSaved());
    expect(result.current.savedAt).toBeInstanceOf(Date);
  });

  it('markSaved does not overwrite unsaved (typing mid-save guard)', () => {
    const { result } = renderHook(() => useSaveStatus());
    act(() => result.current.markSaving());
    act(() => result.current.markDirty()); // user typed while saving
    act(() => result.current.markSaved()); // save completed — should not override
    expect(result.current.saveStatus).toBe('unsaved');
  });

  it('markError from saving → error', () => {
    const { result } = renderHook(() => useSaveStatus());
    act(() => result.current.markSaving());
    act(() => result.current.markError());
    expect(result.current.saveStatus).toBe('error');
  });

  it('markError does not change saved state', () => {
    const { result } = renderHook(() => useSaveStatus());
    act(() => result.current.markError()); // saved → still saved
    expect(result.current.saveStatus).toBe('saved');
  });

  it('full save cycle: dirty → saving → saved', () => {
    const { result } = renderHook(() => useSaveStatus());
    act(() => result.current.markDirty());
    expect(result.current.saveStatus).toBe('unsaved');
    act(() => result.current.markSaving());
    expect(result.current.saveStatus).toBe('saving');
    act(() => result.current.markSaved());
    expect(result.current.saveStatus).toBe('saved');
  });
});

// ---------------------------------------------------------------------------
// SceneEditor — UI integration tests
// ---------------------------------------------------------------------------

const mockSnapshotSave = vi.fn();
const mockSnapshotSaveSync = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mockSnapshotSave.mockResolvedValue({
    id: 's1',
    sceneId: 'scene-1',
    content: '',
    contentHash: 'abc',
    wordCount: 0,
    createdAt: new Date().toISOString(),
  });
  (window as unknown as { api: Partial<Window['api']> }).api = {
    snapshotSave: mockSnapshotSave,
    snapshotList: vi.fn().mockResolvedValue({ snapshots: [] }),
    snapshotGet: vi.fn().mockResolvedValue({ snapshot: null }),
    snapshotRestore: vi.fn().mockResolvedValue({}),
    snapshotSaveSync: mockSnapshotSaveSync,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SceneEditor debounce', () => {
  it('does not save immediately on each keystroke', async () => {
    const { getByPlaceholderText } = render(
      <SceneEditor sceneId="s1" scenePath="/ch1/scene1.md" />
    );
    const textarea = getByPlaceholderText(/start writing/i);

    fireEvent.change(textarea, { target: { value: 'H' } });
    fireEvent.change(textarea, { target: { value: 'He' } });
    fireEvent.change(textarea, { target: { value: 'Hel' } });

    expect(mockSnapshotSave).not.toHaveBeenCalled();
    // Flush async mount effects (snapshotList) so state updates land inside act()
    await act(async () => {});
  });

  it('saves once after the debounce interval fires', async () => {
    const { getByPlaceholderText } = render(
      <SceneEditor sceneId="s1" scenePath="/ch1/scene1.md" />
    );
    const textarea = getByPlaceholderText(/start writing/i);

    fireEvent.change(textarea, { target: { value: 'Hello' } });
    fireEvent.change(textarea, { target: { value: 'Hello world' } });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(mockSnapshotSave).toHaveBeenCalledTimes(1);
    expect(mockSnapshotSave).toHaveBeenCalledWith('s1', 'Hello world');
  });

  it('debounce interval is at most 500ms', async () => {
    const { getByPlaceholderText } = render(
      <SceneEditor sceneId="s1" scenePath="/ch1/scene1.md" />
    );
    const textarea = getByPlaceholderText(/start writing/i);

    fireEvent.change(textarea, { target: { value: 'Draft text' } });

    // Should NOT have fired at 499ms
    await act(async () => { vi.advanceTimersByTime(499); });
    expect(mockSnapshotSave).not.toHaveBeenCalled();

    // Should have fired at 500ms
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(mockSnapshotSave).toHaveBeenCalledTimes(1);
  });

  it('resets debounce on each new keystroke', async () => {
    const { getByPlaceholderText } = render(
      <SceneEditor sceneId="s1" scenePath="/ch1/scene1.md" />
    );
    const textarea = getByPlaceholderText(/start writing/i);

    fireEvent.change(textarea, { target: { value: 'A' } });
    await act(async () => { vi.advanceTimersByTime(400); });
    // Type again before debounce fires — resets the timer
    fireEvent.change(textarea, { target: { value: 'AB' } });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(mockSnapshotSave).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(100); });
    expect(mockSnapshotSave).toHaveBeenCalledTimes(1);
    expect(mockSnapshotSave).toHaveBeenCalledWith('s1', 'AB');
  });
});

describe('SceneEditor beforeunload flush', () => {
  it('calls snapshotSaveSync on beforeunload when content is dirty', async () => {
    const { getByPlaceholderText } = render(
      <SceneEditor sceneId="s1" scenePath="/ch1/scene1.md" />
    );
    const textarea = getByPlaceholderText(/start writing/i);

    fireEvent.change(textarea, { target: { value: 'Unsaved content' } });
    // Debounce has NOT fired yet — simulate sudden close
    fireEvent(window, new Event('beforeunload'));

    expect(mockSnapshotSaveSync).toHaveBeenCalledWith('s1', 'Unsaved content');
    // Flush async mount effects (snapshotList) so state updates land inside act()
    await act(async () => {});
  });

  it('does not call snapshotSaveSync when content matches last snapshot', async () => {
    const { getByPlaceholderText } = render(
      <SceneEditor sceneId="s1" scenePath="/ch1/scene1.md" />
    );
    const textarea = getByPlaceholderText(/start writing/i);

    fireEvent.change(textarea, { target: { value: 'Saved content' } });
    // Let the debounce save fire
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(mockSnapshotSave).toHaveBeenCalledTimes(1);

    // Reset the sync mock — content is now in sync with lastSnapshotRef
    mockSnapshotSaveSync.mockReset();
    fireEvent(window, new Event('beforeunload'));

    expect(mockSnapshotSaveSync).not.toHaveBeenCalled();
  });

  it('calls snapshotSaveSync with content typed mid-debounce', async () => {
    const { getByPlaceholderText } = render(
      <SceneEditor sceneId="s1" scenePath="/ch1/scene1.md" initialContent="start" />
    );
    const textarea = getByPlaceholderText(/start writing/i);

    fireEvent.change(textarea, { target: { value: 'start typing fast' } });
    fireEvent.change(textarea, { target: { value: 'start typing fast enough' } });
    // Window closes before the 500ms debounce fires
    fireEvent(window, new Event('beforeunload'));

    expect(mockSnapshotSaveSync).toHaveBeenCalledWith('s1', 'start typing fast enough');
    // Flush async mount effects (snapshotList) so state updates land inside act()
    await act(async () => {});
  });
});

describe('SceneEditor save status indicator', () => {
  it('shows Saved on initial render (no unsaved changes)', async () => {
    render(<SceneEditor sceneId="scene-1" scenePath="story/ch1/scene1.md" initialContent="" />);
    expect(screen.getByRole('status')).toHaveTextContent(/Saved/);
    // Flush async mount effects (snapshotList) so state updates land inside act()
    await act(async () => {});
  });

  it('indicator has aria-live polite region', async () => {
    render(<SceneEditor sceneId="scene-1" scenePath="story/ch1/scene1.md" />);
    const indicator = screen.getByRole('status');
    expect(indicator).toHaveAttribute('aria-live', 'polite');
    // Flush async mount effects (snapshotList) so state updates land inside act()
    await act(async () => {});
  });

  it('shows Unsaved changes immediately after typing', async () => {
    render(<SceneEditor sceneId="scene-1" scenePath="story/ch1/scene1.md" />);
    fireEvent.change(screen.getByPlaceholderText('Start writing your scene…'), {
      target: { value: 'Hello' },
    });
    expect(screen.getByText('• Unsaved changes')).toBeInTheDocument();
    // Flush async mount effects (snapshotList) so state updates land inside act()
    await act(async () => {});
  });

  it('shows Saving… when debounce fires', async () => {
    let resolveSave!: () => void;
    mockSnapshotSave.mockReturnValueOnce(new Promise<void>(res => { resolveSave = res; }));

    render(<SceneEditor sceneId="scene-1" scenePath="story/ch1/scene1.md" />);
    fireEvent.change(screen.getByPlaceholderText('Start writing your scene…'), {
      target: { value: 'Hello' },
    });

    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText('Saving…')).toBeInTheDocument();

    await act(async () => { resolveSave?.(); });
  });

  it('shows Saved after successful save', async () => {
    render(<SceneEditor sceneId="scene-1" scenePath="story/ch1/scene1.md" />);
    fireEvent.change(screen.getByPlaceholderText('Start writing your scene…'), {
      target: { value: 'Hello' },
    });

    await act(async () => { vi.advanceTimersByTime(5000); });
    await act(async () => {});
    expect(screen.getByRole('status')).toHaveTextContent(/Saved/);
  });

  it('save status indicator has aria-live="polite" wrapper', () => {
    render(<SceneEditor sceneId="scene-1" scenePath="story/ch1/scene1.md" />);
    const saved = screen.getByRole('status');
    const wrapper = saved.parentElement!;
    expect(wrapper).toHaveAttribute('aria-live', 'polite');
    expect(wrapper).toHaveAttribute('aria-atomic', 'true');
  });

  it('stays Unsaved if user types during an in-flight save', async () => {
    let resolveSave!: () => void;
    mockSnapshotSave.mockReturnValueOnce(new Promise<void>(res => { resolveSave = res; }));

    render(<SceneEditor sceneId="scene-1" scenePath="story/ch1/scene1.md" />);
    const textarea = screen.getByPlaceholderText('Start writing your scene…');

    fireEvent.change(textarea, { target: { value: 'Hello' } });
    await act(async () => { vi.advanceTimersByTime(5000); });

    fireEvent.change(textarea, { target: { value: 'Hello world' } });

    await act(async () => { resolveSave?.(); });

    expect(screen.getByText('• Unsaved changes')).toBeInTheDocument();
  });

  it('shows Save failed with retry button when snapshotSave rejects', async () => {
    mockSnapshotSave.mockRejectedValueOnce(new Error('disk full'));

    render(<SceneEditor sceneId="scene-1" scenePath="story/ch1/scene1.md" />);
    fireEvent.change(screen.getByPlaceholderText('Start writing your scene…'), {
      target: { value: 'Hello' },
    });

    await act(async () => { vi.advanceTimersByTime(5000); });
    await act(async () => {});

    expect(screen.getByRole('status')).toHaveTextContent(/Save failed/);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('retry button triggers another snapshotSave call', async () => {
    mockSnapshotSave
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({
        id: 's2', sceneId: 'scene-1', content: 'Hello', contentHash: 'xyz',
        wordCount: 1, createdAt: new Date().toISOString(),
      });

    render(<SceneEditor sceneId="scene-1" scenePath="story/ch1/scene1.md" />);
    fireEvent.change(screen.getByPlaceholderText('Start writing your scene…'), {
      target: { value: 'Hello' },
    });

    await act(async () => { vi.advanceTimersByTime(5000); });
    await act(async () => {});

    // Error state — click retry
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    await act(async () => { fireEvent.click(retryBtn); });
    await act(async () => {});

    expect(mockSnapshotSave).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent(/Saved/);
  });

  it('relative time updates after 10 s in saved state', async () => {
    render(<SceneEditor sceneId="scene-1" scenePath="story/ch1/scene1.md" />);
    fireEvent.change(screen.getByPlaceholderText('Start writing your scene…'), {
      target: { value: 'Hello' },
    });

    // Let debounce fire and save complete
    await act(async () => { vi.advanceTimersByTime(5000); });
    await act(async () => {});
    expect(screen.getByRole('status')).toHaveTextContent(/Saved/);

    // Advance 10 s — the 10 s ticker should fire and update relative time
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByRole('status')).toHaveTextContent(/Saved \d+s ago/);
  });
});
