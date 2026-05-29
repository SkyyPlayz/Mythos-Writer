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

  it('markSaved does not overwrite unsaved (typing mid-save guard)', () => {
    const { result } = renderHook(() => useSaveStatus());
    act(() => result.current.markSaving());
    act(() => result.current.markDirty()); // user typed while saving
    act(() => result.current.markSaved()); // save completed — should not override
    expect(result.current.saveStatus).toBe('unsaved');
  });

  it('markError from saving → unsaved', () => {
    const { result } = renderHook(() => useSaveStatus());
    act(() => result.current.markSaving());
    act(() => result.current.markError());
    expect(result.current.saveStatus).toBe('unsaved');
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
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SceneEditor save status indicator', () => {
  it('shows Saved on initial render (no unsaved changes)', () => {
    render(<SceneEditor sceneId="scene-1" scenePath="story/ch1/scene1.md" initialContent="" />);
    expect(screen.getByText('✓ Saved')).toBeInTheDocument();
  });

  it('shows Unsaved changes immediately after typing', () => {
    render(<SceneEditor sceneId="scene-1" scenePath="story/ch1/scene1.md" />);
    fireEvent.change(screen.getByPlaceholderText('Start writing your scene…'), {
      target: { value: 'Hello' },
    });
    expect(screen.getByText('• Unsaved changes')).toBeInTheDocument();
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
    expect(screen.getByText('✓ Saved')).toBeInTheDocument();
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
});
