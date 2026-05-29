import { render, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import SceneEditor from './SceneEditor';

const mockSnapshotSave = vi.fn();
const mockSnapshotSaveSync = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mockSnapshotSave.mockResolvedValue({ id: 'snap-1', contentHash: 'abc', wordCount: 3, sceneId: 's1', createdAt: '' });
  (window as unknown as { api: Partial<Window['api']> }).api = {
    snapshotSave: mockSnapshotSave,
    snapshotSaveSync: mockSnapshotSaveSync,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SceneEditor debounce', () => {
  it('does not save immediately on each keystroke', () => {
    const { getByPlaceholderText } = render(
      <SceneEditor sceneId="s1" scenePath="/ch1/scene1.md" />
    );
    const textarea = getByPlaceholderText(/start writing/i);

    fireEvent.change(textarea, { target: { value: 'H' } });
    fireEvent.change(textarea, { target: { value: 'He' } });
    fireEvent.change(textarea, { target: { value: 'Hel' } });

    expect(mockSnapshotSave).not.toHaveBeenCalled();
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
  it('calls snapshotSaveSync on beforeunload when content is dirty', () => {
    const { getByPlaceholderText } = render(
      <SceneEditor sceneId="s1" scenePath="/ch1/scene1.md" />
    );
    const textarea = getByPlaceholderText(/start writing/i);

    fireEvent.change(textarea, { target: { value: 'Unsaved content' } });
    // Debounce has NOT fired yet — simulate sudden close
    fireEvent(window, new Event('beforeunload'));

    expect(mockSnapshotSaveSync).toHaveBeenCalledWith('s1', 'Unsaved content');
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

  it('calls snapshotSaveSync with content typed mid-debounce', () => {
    const { getByPlaceholderText } = render(
      <SceneEditor sceneId="s1" scenePath="/ch1/scene1.md" initialContent="start" />
    );
    const textarea = getByPlaceholderText(/start writing/i);

    fireEvent.change(textarea, { target: { value: 'start typing fast' } });
    fireEvent.change(textarea, { target: { value: 'start typing fast enough' } });
    // Window closes before the 500ms debounce fires
    fireEvent(window, new Event('beforeunload'));

    expect(mockSnapshotSaveSync).toHaveBeenCalledWith('s1', 'start typing fast enough');
  });
});
