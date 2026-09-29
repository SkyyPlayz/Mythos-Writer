// SKY-10916: app-wide navigation history hook.
import { renderHook } from '@testing-library/react';
import { act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import {
  useNavigationHistory,
  findLastStoryEditorLocation,
  isStoryEditorLocation,
  type NavigationLocation,
  type PersistedNavHistory,
} from './useNavigationHistory';


function makeLocation(overrides: Partial<NavigationLocation> = {}): NavigationLocation {
  return {
    tab: 'story',
    focusedPane: 1,
    view: 'editor',
    viewDepth: 'scene',
    notesSubView: 'editor',
    sceneId: 'scene-1',
    chapterId: 'chapter-1',
    storyId: 'story-1',
    entityId: null,
    notePath: null,
    storyDocTabId: null,
    notesDocTabId: null,
    splitWindowEnabled: false,
    pane2SceneId: null,
    pane2ChapterId: null,
    pane2StoryId: null,
    scrollTop: 0,
    ...overrides,
  };
}

describe('useNavigationHistory', () => {
  it('seeds a single-entry stack with no history at the start', () => {
    const getScrollTop = vi.fn(() => 0);
    const { result } = renderHook(
      ({ location }) => useNavigationHistory(location, getScrollTop),
      { initialProps: { location: makeLocation() } },
    );
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.canGoForward).toBe(false);
    expect(result.current.goBack()).toBeNull();
  });

  it('pushes a new entry when the identity fields change', () => {
    const getScrollTop = vi.fn(() => 0);
    const { result, rerender } = renderHook(
      ({ location }) => useNavigationHistory(location, getScrollTop),
      { initialProps: { location: makeLocation({ sceneId: 'scene-1' }) } },
    );
    expect(result.current.canGoBack).toBe(false);

    rerender({ location: makeLocation({ sceneId: 'scene-2' }) });
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.canGoForward).toBe(false);
    expect(result.current.getSnapshot().stack.map((l) => l.sceneId)).toEqual(['scene-1', 'scene-2']);
    expect(result.current.getSnapshot().index).toBe(1);
  });

  it('does not push when only scrollTop changes (scroll-only movement is not a navigation)', () => {
    const getScrollTop = vi.fn(() => 0);
    const { result, rerender } = renderHook(
      ({ location }) => useNavigationHistory(location, getScrollTop),
      { initialProps: { location: makeLocation({ sceneId: 'scene-1', scrollTop: 0 }) } },
    );

    rerender({ location: makeLocation({ sceneId: 'scene-1', scrollTop: 400 }) });
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.getSnapshot().stack).toHaveLength(1);
  });

  it('round-trips back and forward, restoring the frozen scroll position of each entry', () => {
    let currentScrollTop = 0;
    const getScrollTop = vi.fn(() => currentScrollTop);
    const { result, rerender } = renderHook(
      ({ location }) => useNavigationHistory(location, getScrollTop),
      { initialProps: { location: makeLocation({ sceneId: 'scene-1' }) } },
    );

    // Simulate the user scrolling scene-1 down before navigating away.
    currentScrollTop = 250;
    rerender({ location: makeLocation({ sceneId: 'scene-2' }) });
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.canGoForward).toBe(false);

    currentScrollTop = 900; // scene-2's live scroll position at the moment Back is pressed
    const captured: { loc: NavigationLocation | null } = { loc: null };
    act(() => { captured.loc = result.current.goBack(); });
    expect(captured.loc?.sceneId).toBe('scene-1');
    expect(captured.loc?.scrollTop).toBe(250); // frozen when we left scene-1
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.canGoForward).toBe(true);

    // Applying the restored location (the caller would do this) — the live
    // location prop now mirrors what goBack returned. This must NOT push a
    // duplicate entry (the suppress-next-push handshake).
    rerender({ location: makeLocation({ sceneId: 'scene-1', scrollTop: 250 }) });
    expect(result.current.getSnapshot().stack).toHaveLength(2);
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.canGoForward).toBe(true);

    act(() => { captured.loc = result.current.goForward(); });
    expect(captured.loc?.sceneId).toBe('scene-2');
    expect(captured.loc?.scrollTop).toBe(900); // frozen when Back was pressed from scene-2
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.canGoForward).toBe(false);
  });

  it('truncates forward history when a new navigation branches off after going back', () => {
    const getScrollTop = vi.fn(() => 0);
    const { result, rerender } = renderHook(
      ({ location }) => useNavigationHistory(location, getScrollTop),
      { initialProps: { location: makeLocation({ sceneId: 'scene-1' }) } },
    );

    rerender({ location: makeLocation({ sceneId: 'scene-2' }) });
    rerender({ location: makeLocation({ sceneId: 'scene-3' }) });
    expect(result.current.getSnapshot().stack.map((l) => l.sceneId)).toEqual(['scene-1', 'scene-2', 'scene-3']);

    act(() => { result.current.goBack(); }); // now at scene-2, index 1
    rerender({ location: makeLocation({ sceneId: 'scene-2' }) }); // consume suppress flag
    expect(result.current.canGoForward).toBe(true);

    // A brand-new navigation from here (not a forward replay) must drop the
    // old "scene-3" forward entry — same as a browser tab.
    rerender({ location: makeLocation({ sceneId: 'scene-4' }) });
    const snap = result.current.getSnapshot();
    expect(snap.stack.map((l) => l.sceneId)).toEqual(['scene-1', 'scene-2', 'scene-4']);
    expect(snap.index).toBe(2);
    expect(result.current.canGoForward).toBe(false);
  });

  it('canGoBack becomes true after exactly one navigation (no off-by-one)', () => {
    const getScrollTop = vi.fn(() => 0);
    const { result, rerender } = renderHook(
      ({ location }) => useNavigationHistory(location, getScrollTop),
      { initialProps: { location: makeLocation({ sceneId: 'scene-1' }) } },
    );
    expect(result.current.canGoBack).toBe(false);

    rerender({ location: makeLocation({ sceneId: 'scene-2' }) });
    expect(result.current.canGoBack).toBe(true);

    const captured: { loc: NavigationLocation | null } = { loc: null };
    act(() => { captured.loc = result.current.goBack(); });
    expect(captured.loc?.sceneId).toBe('scene-1');
    expect(result.current.canGoBack).toBe(false);
  });

  it('hydrate() restores a persisted stack/index exactly once and is a no-op afterward', () => {
    const getScrollTop = vi.fn(() => 0);
    const { result } = renderHook(
      ({ location }) => useNavigationHistory(location, getScrollTop),
      { initialProps: { location: makeLocation({ sceneId: 'scene-1' }) } },
    );

    const persisted: PersistedNavHistory = {
      stack: [makeLocation({ sceneId: 'a' }), makeLocation({ sceneId: 'b' }), makeLocation({ sceneId: 'c' })],
      index: 1,
    };
    act(() => { result.current.hydrate(persisted); });
    expect(result.current.getSnapshot()).toEqual(persisted);
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.canGoForward).toBe(true);

    // A second hydrate() call must not clobber the (possibly since-mutated) live stack.
    act(() => {
      result.current.hydrate({ stack: [makeLocation({ sceneId: 'z' })], index: 0 });
    });
    expect(result.current.getSnapshot()).toEqual(persisted);
  });

  it('treats switching between pseudo-tabs (Entity Browser <-> Outline) as a navigation even though scene/entity/note are all null', () => {
    // Mirrors DesktopShell's handleWorkspaceTabSelect: opening the Entity
    // Browser or Outline Planning doc-tab clears selectedScene/selectedEntity
    // (and openedNotePath is already null on the Story tab) — storyDocTabId
    // is the only field that actually differs between them.
    const getScrollTop = vi.fn(() => 0);
    const { result, rerender } = renderHook(
      ({ location }) => useNavigationHistory(location, getScrollTop),
      {
        initialProps: {
          location: makeLocation({ sceneId: null, chapterId: null, storyId: null, storyDocTabId: 'tab-entities' }),
        },
      },
    );

    rerender({
      location: makeLocation({ sceneId: null, chapterId: null, storyId: null, storyDocTabId: 'tab-outline' }),
    });
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.getSnapshot().stack.map((l) => l.storyDocTabId)).toEqual(['tab-entities', 'tab-outline']);
  });

  it('does not fracture one navigation into two entries when storyDocTabId catches up to selectedScene a render later', () => {
    // Regression: DesktopShell derives activeStoryDocTabId FROM selectedScene
    // in a separate effect that commits one render after the one that sets
    // selectedScene itself. Without this, Back would only undo the harmless
    // tab-id catch-up and never reach the actual prior scene.
    const getScrollTop = vi.fn(() => 0);
    const { result, rerender } = renderHook(
      ({ location }) => useNavigationHistory(location, getScrollTop),
      { initialProps: { location: makeLocation({ sceneId: 'scene-1', storyDocTabId: null }) } },
    );

    // Real navigation: content changes, doc-tab id hasn't caught up yet.
    rerender({ location: makeLocation({ sceneId: 'scene-2', storyDocTabId: null }) });
    // A render later: same content, only the derived tab id updates.
    rerender({ location: makeLocation({ sceneId: 'scene-2', storyDocTabId: 'tab-2' }) });

    expect(result.current.getSnapshot().stack.map((l) => l.sceneId)).toEqual(['scene-1', 'scene-2']);
    expect(result.current.canGoBack).toBe(true);
    const captured: { loc: NavigationLocation | null } = { loc: null };
    act(() => { captured.loc = result.current.goBack(); });
    expect(captured.loc?.sceneId).toBe('scene-1');
  });

  it('still treats a notePath-null pseudo-tab switch as a navigation when notesDocTabId is the only differing field', () => {
    const getScrollTop = vi.fn(() => 0);
    const { result, rerender } = renderHook(
      ({ location }) => useNavigationHistory(location, getScrollTop),
      {
        initialProps: {
          location: makeLocation({ tab: 'notes', sceneId: null, notePath: null, notesDocTabId: 'tab-a' }),
        },
      },
    );
    rerender({ location: makeLocation({ tab: 'notes', sceneId: null, notePath: null, notesDocTabId: 'tab-b' }) });
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.getSnapshot().stack.map((l) => l.notesDocTabId)).toEqual(['tab-a', 'tab-b']);
  });

  it('hydrate() clamps an out-of-range persisted index', () => {
    const getScrollTop = vi.fn(() => 0);
    const { result } = renderHook(
      ({ location }) => useNavigationHistory(location, getScrollTop),
      { initialProps: { location: makeLocation({ sceneId: 'scene-1' }) } },
    );
    act(() => {
      result.current.hydrate({ stack: [makeLocation({ sceneId: 'a' }), makeLocation({ sceneId: 'b' })], index: 99 });
    });
    expect(result.current.getSnapshot().index).toBe(1);
  });
});

describe('findLastStoryEditorLocation (F2#7 Back to story)', () => {
  it('returns null for an empty stack', () => {
    expect(findLastStoryEditorLocation({ stack: [], index: 0 })).toBeNull();
  });

  it('returns null when no story-editor entry exists', () => {
    const snap: PersistedNavHistory = {
      stack: [
        makeLocation({ tab: 'notes', view: 'editor', sceneId: null, notePath: '/a.md' }),
        makeLocation({ tab: 'story', view: 'kanban', sceneId: 'scene-1' }),
      ],
      index: 1,
    };
    expect(findLastStoryEditorLocation(snap)).toBeNull();
    expect(isStoryEditorLocation(snap.stack[1]!)).toBe(false);
  });

  it('restores the most recent story-editor stop behind the current index, including scrollTop', () => {
    const editorA = makeLocation({ sceneId: 'scene-a', scrollTop: 120 });
    const editorB = makeLocation({ sceneId: 'scene-b', scrollTop: 480 });
    const notes = makeLocation({ tab: 'notes', sceneId: null, notePath: '/n.md', scrollTop: 0 });
    const snap: PersistedNavHistory = {
      stack: [editorA, editorB, notes],
      index: 2,
    };
    const found = findLastStoryEditorLocation(snap);
    expect(found?.sceneId).toBe('scene-b');
    expect(found?.scrollTop).toBe(480);
    expect(isStoryEditorLocation(found!)).toBe(true);
  });

  it('ignores forward (discarded) history past index', () => {
    const editorOld = makeLocation({ sceneId: 'scene-old', scrollTop: 10 });
    const notes = makeLocation({ tab: 'notes', sceneId: null, notePath: '/n.md' });
    const editorForward = makeLocation({ sceneId: 'scene-fwd', scrollTop: 999 });
    const snap: PersistedNavHistory = {
      stack: [editorOld, notes, editorForward],
      index: 1,
    };
    expect(findLastStoryEditorLocation(snap)?.sceneId).toBe('scene-old');
  });

  it('returns the current entry when already on the story editor', () => {
    const editor = makeLocation({ sceneId: 'scene-1', scrollTop: 55 });
    const snap: PersistedNavHistory = { stack: [editor], index: 0 };
    expect(findLastStoryEditorLocation(snap)).toEqual(editor);
  });
});

