import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useNavigationHistory, navLocationKey, type NavLocation, type NavHistoryEntry, type NavTarget } from './useNavigationHistory';
import type { ZoomLevel } from './story/manuscriptModel';

function sceneLoc(sceneId: string, view: StorySubView = 'editor', viewDepth: ZoomLevel = 'scene'): NavLocation {
  return { tab: 'story', target: { kind: 'scene', sceneId, chapterId: 'c1', storyId: 's1' }, view, viewDepth };
}
function noteLoc(notePath: string): NavLocation {
  return { tab: 'notes', target: { kind: 'note', notePath }, view: 'editor', viewDepth: 'scene' };
}

describe('useNavigationHistory', () => {
  let applyLocation: ReturnType<typeof vi.fn<(entry: NavHistoryEntry) => void | Promise<void>>>;
  let canResolveTarget: ReturnType<typeof vi.fn<(target: NavTarget) => boolean>>;
  let stepperActive: ReturnType<typeof vi.fn<() => boolean>>;

  beforeEach(() => {
    applyLocation = vi.fn<(entry: NavHistoryEntry) => void | Promise<void>>().mockResolvedValue(undefined);
    canResolveTarget = vi.fn<(target: NavTarget) => boolean>().mockReturnValue(true);
    stepperActive = vi.fn<() => boolean>().mockReturnValue(false);
  });

  it('does not push a history entry for the first-ever observed location', () => {
    const { result, rerender } = renderHook(
      ({ location }: { location: NavLocation | null }) =>
        useNavigationHistory(location, applyLocation, canResolveTarget, stepperActive),
      { initialProps: { location: sceneLoc('scene-a') } },
    );
    rerender({ location: sceneLoc('scene-a') }); // same location again — still no push
    expect(result.current.canGoBack).toBe(false);
  });

  it('pushes a new entry when the location changes and enables Back', () => {
    const { result, rerender } = renderHook(
      ({ location }: { location: NavLocation | null }) =>
        useNavigationHistory(location, applyLocation, canResolveTarget, stepperActive),
      { initialProps: { location: sceneLoc('scene-a') } },
    );
    expect(result.current.canGoBack).toBe(false);
    rerender({ location: noteLoc('notes/b.md') });
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.canGoForward).toBe(false);
  });

  it('goBack applies the previous location and re-enables Forward', () => {
    const { result, rerender } = renderHook(
      ({ location }: { location: NavLocation | null }) =>
        useNavigationHistory(location, applyLocation, canResolveTarget, stepperActive),
      { initialProps: { location: sceneLoc('scene-a') } },
    );
    rerender({ location: noteLoc('notes/b.md') });
    rerender({ location: noteLoc('notes/c.md') });

    act(() => result.current.goBack());
    expect(applyLocation).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: 'note', notePath: 'notes/b.md' } }));
    expect(result.current.canGoForward).toBe(true);
  });

  it('a genuinely new navigation after goBack truncates the forward stack', () => {
    const { result, rerender } = renderHook(
      ({ location }: { location: NavLocation | null }) =>
        useNavigationHistory(location, applyLocation, canResolveTarget, stepperActive),
      { initialProps: { location: sceneLoc('scene-a') } },
    );
    rerender({ location: noteLoc('notes/b.md') });
    rerender({ location: noteLoc('notes/c.md') });

    act(() => result.current.goBack()); // now at notes/b.md, notes/c.md still ahead
    expect(result.current.canGoForward).toBe(true);

    // User follows a fresh link from notes/b.md instead of going forward again.
    rerender({ location: noteLoc('notes/d.md') });
    expect(result.current.canGoForward).toBe(false);

    act(() => result.current.goBack());
    expect(applyLocation).toHaveBeenLastCalledWith(expect.objectContaining({ target: { kind: 'note', notePath: 'notes/b.md' } }));
  });

  it('applying our own goBack/goForward restore does not re-push a duplicate entry', () => {
    const { result, rerender } = renderHook(
      ({ location }: { location: NavLocation | null }) =>
        useNavigationHistory(location, applyLocation, canResolveTarget, stepperActive),
      { initialProps: { location: sceneLoc('scene-a') } },
    );
    rerender({ location: noteLoc('notes/b.md') });

    act(() => result.current.goBack());
    // Simulate the DesktopShell state actually landing back on scene-a, as
    // applyLocation would cause in the real component.
    rerender({ location: sceneLoc('scene-a') });

    expect(result.current.canGoForward).toBe(true); // still forward-able to notes/b.md
    expect(result.current.canGoBack).toBe(false); // did not gain a spurious extra back entry
  });

  it('skips stale entries that no longer resolve when going back', () => {
    const { result, rerender } = renderHook(
      ({ location }: { location: NavLocation | null }) =>
        useNavigationHistory(location, applyLocation, canResolveTarget, stepperActive),
      { initialProps: { location: sceneLoc('scene-a') } },
    );
    rerender({ location: sceneLoc('scene-deleted') });
    rerender({ location: sceneLoc('scene-c') });

    canResolveTarget.mockImplementation((target) => target.kind !== 'scene' || target.sceneId !== 'scene-deleted');

    act(() => result.current.goBack());
    expect(applyLocation).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: 'scene', sceneId: 'scene-a', chapterId: 'c1', storyId: 's1' } }));
  });

  it('Alt+ArrowLeft/Right prefer real history over the manuscript stepper, even while the stepper is active', () => {
    const { rerender } = renderHook(
      ({ location }: { location: NavLocation | null }) =>
        useNavigationHistory(location, applyLocation, canResolveTarget, stepperActive),
      { initialProps: { location: sceneLoc('scene-a') } },
    );
    rerender({ location: noteLoc('notes/b.md') });

    // Even with the manuscript stepper "active" (Story tab, non-book zoom),
    // Back must replay real history rather than being swallowed by the
    // stepper — this is the exact regression the owner reported.
    stepperActive.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }));
    });
    expect(applyLocation).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: 'scene', sceneId: 'scene-a', chapterId: 'c1', storyId: 's1' } }));
  });

  it('yields Alt+ArrowLeft to the manuscript stepper only once there is nothing left to replay', async () => {
    const { result, rerender } = renderHook(
      ({ location }: { location: NavLocation | null }) =>
        useNavigationHistory(location, applyLocation, canResolveTarget, stepperActive),
      { initialProps: { location: sceneLoc('scene-a') } },
    );
    rerender({ location: noteLoc('notes/b.md') });
    stepperActive.mockReturnValue(true);

    await act(async () => result.current.goBack()); // now at scene-a, nothing further back
    applyLocation.mockClear();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }));
    });
    expect(applyLocation).not.toHaveBeenCalled(); // yielded to the stepper — no history left to replay

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));
    });
    expect(applyLocation).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: 'note', notePath: 'notes/b.md' } })); // still preferred forward
  });

  it('mouse side buttons (3=back, 4=forward) trigger Back/Forward', async () => {
    const { result, rerender } = renderHook(
      ({ location }: { location: NavLocation | null }) =>
        useNavigationHistory(location, applyLocation, canResolveTarget, stepperActive),
      { initialProps: { location: sceneLoc('scene-a') } },
    );
    rerender({ location: noteLoc('notes/b.md') });

    await act(async () => {
      window.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true }));
    });
    expect(applyLocation).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: 'scene', sceneId: 'scene-a', chapterId: 'c1', storyId: 's1' } }));

    applyLocation.mockClear();
    await act(async () => {
      window.dispatchEvent(new MouseEvent('mouseup', { button: 4, bubbles: true }));
    });
    expect(applyLocation).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: 'note', notePath: 'notes/b.md' } }));
    expect(result.current.canGoForward).toBe(false); // back at the newest entry again
  });
});

describe('navLocationKey', () => {
  it('is stable for identical scene targets and differs across tabs/targets', () => {
    expect(navLocationKey(sceneLoc('scene-a'))).toBe(navLocationKey(sceneLoc('scene-a')));
    expect(navLocationKey(sceneLoc('scene-a'))).not.toBe(navLocationKey(sceneLoc('scene-b')));
    expect(navLocationKey(sceneLoc('scene-a'))).not.toBe(navLocationKey(noteLoc('scene-a')));
  });
});
