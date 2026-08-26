import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ZoomLevel } from './story/manuscriptModel';

// SKY-10916: one app-wide back/forward history. Every surface that can make
// a different document "the active one" (wikilinks, backlinks, References,
// search, the story/vault navigators, cross-tab link resolution, tab-strip
// clicks…) already funnels into a handful of shared setters in DesktopShell
// (selectedScene/selectedEntity/openedNotePath + tabShell.activeTab). Rather
// than instrument every call site individually (~20 of them, easy to miss
// one), this hook OBSERVES the resulting state via `location` and pushes a
// history entry whenever it changes — so any current or future navigation
// call site is covered automatically, as long as it goes through those
// setters.
//
// Scope: tracks pane 1 only (the primary Story/Notes document surface). The
// split-editor's pane 2 is a separate, session-only surface that no
// wikilink/backlink/search/navigator call site targets today (confirmed by
// audit) — it keeps its current, unrelated behavior.

export type NavTarget =
  | { kind: 'scene'; sceneId: string; chapterId: string; storyId: string }
  | { kind: 'entity'; entityId: string }
  | { kind: 'note'; notePath: string }
  | { kind: 'home' };

export interface NavLocation {
  tab: AppTab;
  target: NavTarget;
  view: StorySubView;
  viewDepth: ZoomLevel;
}

export interface NavHistoryEntry extends NavLocation {
  scrollTop: number;
}

export const NAV_HISTORY_MAX = 50;

export function navLocationKey(loc: NavLocation): string {
  const t = loc.target;
  switch (t.kind) {
    case 'scene': return `${loc.tab}:scene:${t.sceneId}`;
    case 'entity': return `${loc.tab}:entity:${t.entityId}`;
    case 'note': return `${loc.tab}:note:${t.notePath}`;
    case 'home': return `${loc.tab}:home`;
  }
}

// The two scrollable document surfaces this history restores position for
// (Story manuscript page, Notes rich-text body). Entity/home locations
// restore to the top — a reasonable, documented scope cut (see file header).
const SCROLLABLE_SELECTOR = '.msv-page, .note-tiptap-content';

interface HistoryState {
  entries: NavHistoryEntry[];
  index: number;
}

type HistoryAction =
  | { type: 'PUSH'; entry: NavHistoryEntry }
  | { type: 'GO'; index: number }
  | { type: 'SET_SCROLL'; index: number; scrollTop: number };

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'PUSH': {
      const kept = state.entries.slice(0, state.index + 1);
      const entries = [...kept, action.entry].slice(-NAV_HISTORY_MAX);
      return { entries, index: entries.length - 1 };
    }
    case 'GO':
      return action.index >= 0 && action.index < state.entries.length
        ? { ...state, index: action.index }
        : state;
    case 'SET_SCROLL': {
      if (!state.entries[action.index] || state.entries[action.index].scrollTop === action.scrollTop) return state;
      return {
        ...state,
        entries: state.entries.map((e, i) => (i === action.index ? { ...e, scrollTop: action.scrollTop } : e)),
      };
    }
    default:
      return state;
  }
}

export interface NavigationHistoryControl {
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
}

export function useNavigationHistory(
  location: NavLocation | null,
  applyLocation: (entry: NavHistoryEntry) => void | Promise<void>,
  canResolveTarget: (target: NavTarget) => boolean,
  stepperActive: () => boolean,
): NavigationHistoryControl {
  const [state, dispatch] = useReducer(historyReducer, { entries: [], index: -1 });
  const stateRef = useRef(state);
  stateRef.current = state;

  const lastKeyRef = useRef<string | null>(null);
  const pendingKeyRef = useRef<string | null>(null);
  const restoringRef = useRef(false);
  // Continuously mirrors the current surface's scroll position. Reading the
  // DOM reactively AFTER a navigation is too late — by the time an effect
  // observes the state change, the old document is already unmounted. This
  // ref is kept live by a scroll listener instead, so it always holds the
  // outgoing page's last scroll position at the moment we navigate away.
  const lastScrollRef = useRef(0);

  useEffect(() => {
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el?.matches?.(SCROLLABLE_SELECTOR)) lastScrollRef.current = el.scrollTop;
    };
    // Capture phase: `scroll` does not bubble, so a single document-level
    // listener needs capture:true to observe it from any descendant.
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, []);

  const restoreScroll = useCallback((scrollTop: number) => {
    // Double rAF: give React a commit + the browser a paint before reading
    // back the (possibly just-mounted) scroll container.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(SCROLLABLE_SELECTOR);
        if (el) el.scrollTop = scrollTop;
        lastScrollRef.current = scrollTop;
      });
    });
  }, []);

  const locationKey = useMemo(() => (location ? navLocationKey(location) : null), [location]);

  // The single funnel: any observed location change becomes a history push,
  // unless it's the tail end of our own goBack/goForward.
  useEffect(() => {
    if (!location || locationKey === null) return;
    if (lastKeyRef.current === null) {
      // First-ever observed location: seed it as entries[0] rather than
      // treating it as a "navigation" — otherwise it's dropped entirely and
      // the very first Back press has nothing to land on.
      lastKeyRef.current = locationKey;
      dispatch({ type: 'PUSH', entry: { ...location, scrollTop: 0 } });
      return;
    }
    if (locationKey === lastKeyRef.current) return;
    if (locationKey === pendingKeyRef.current) {
      pendingKeyRef.current = null;
      lastKeyRef.current = locationKey;
      return;
    }
    const outgoingIndex = stateRef.current.index;
    if (outgoingIndex >= 0) dispatch({ type: 'SET_SCROLL', index: outgoingIndex, scrollTop: lastScrollRef.current });
    dispatch({ type: 'PUSH', entry: { ...location, scrollTop: 0 } });
    lastScrollRef.current = 0;
    lastKeyRef.current = locationKey;
  }, [location, locationKey]);

  const go = useCallback((direction: 1 | -1) => {
    if (restoringRef.current) return;
    const { entries, index } = stateRef.current;
    let targetIndex = index + direction;
    while (targetIndex >= 0 && targetIndex < entries.length && !canResolveTarget(entries[targetIndex].target)) {
      targetIndex += direction;
    }
    if (targetIndex < 0 || targetIndex >= entries.length) return;
    restoringRef.current = true;
    if (index >= 0) dispatch({ type: 'SET_SCROLL', index, scrollTop: lastScrollRef.current });
    const entry = entries[targetIndex];
    pendingKeyRef.current = navLocationKey(entry);
    dispatch({ type: 'GO', index: targetIndex });
    Promise.resolve(applyLocation(entry)).finally(() => {
      restoreScroll(entry.scrollTop);
      restoringRef.current = false;
    });
  }, [applyLocation, canResolveTarget, restoreScroll]);

  const goBack = useCallback(() => go(-1), [go]);
  const goForward = useCallback(() => go(1), [go]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const isBack = e.key === 'ArrowLeft';
      // ManuscriptView also binds plain Alt+←/→, to same-level scene/chapter
      // stepping while the manuscript is on screen at non-book zoom (M8
      // keyboard map). Both features can claim the same keypress there —
      // resolve it by priority: replay real history first (that's what the
      // user just did and is most likely trying to undo), and only fall
      // back to "step to a scene never visited this session" when there is
      // nothing in that direction to replay.
      const { entries, index } = stateRef.current;
      const historyAvailable = isBack
        ? entries.slice(0, index).some((en) => canResolveTarget(en.target))
        : entries.slice(index + 1).some((en) => canResolveTarget(en.target));
      if (!historyAvailable && stepperActive()) return;
      e.preventDefault();
      if (isBack) goBack(); else goForward();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goBack, goForward, stepperActive, canResolveTarget]);

  useEffect(() => {
    // Browser-style side buttons: button 3 = back, button 4 = forward
    // (standard Chromium MouseEvent.button values; Electron's renderer is
    // Chromium so the same mapping applies).
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3) { e.preventDefault(); goBack(); }
      else if (e.button === 4) { e.preventDefault(); goForward(); }
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [goBack, goForward]);

  const canGoBack = state.index > 0 && state.entries.slice(0, state.index).some((e) => canResolveTarget(e.target));
  const canGoForward = state.index < state.entries.length - 1
    && state.entries.slice(state.index + 1).some((e) => canResolveTarget(e.target));

  return { canGoBack, canGoForward, goBack, goForward };
}
