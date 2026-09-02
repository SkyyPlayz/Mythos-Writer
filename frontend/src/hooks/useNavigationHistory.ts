// SKY-10916: ONE app-wide navigation history stack. Every surface that
// changes "what's displayed" (wikilink click, backlink, search result,
// References-tab jump, scene navigator, cross-tab-link-modal, entity
// browser, Brainstorm/Writing-Assistant navigate-to-scene, workspace-tab
// activation…) already funnels through a small set of DesktopShell state
// setters (selectedScene/selectedChapter/selectedStory/selectedEntity,
// openedNotePath, tabShell, view, viewDepth, split-pane state). Rather than
// hand-instrumenting every call site, this hook derives a composite
// `NavigationLocation` from that state each render and auto-pushes when it
// changes — automatically correct for every current AND future call site.
//
// AppTab / StorySubView / NotesSubView / ZoomLevel are ambient globals
// (global.d.ts) except ZoomLevel, which lives in story/manuscriptModel.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ZoomLevel } from '../story/manuscriptModel';

export interface NavigationLocation {
  tab: AppTab;
  /** Which split pane this location was viewed from (1 when not split). */
  focusedPane: 1 | 2;
  view: StorySubView;
  viewDepth: ZoomLevel;
  notesSubView: NotesSubView;
  sceneId: string | null;
  chapterId: string | null;
  storyId: string | null;
  entityId: string | null;
  notePath: string | null;
  /**
   * Active Story/Notes doc-tab id. Redundant with sceneId/notePath for
   * ordinary scene/note tabs (those already differentiate on their own), but
   * load-bearing for the pseudo-tabs (Entity Browser, Outline Planning) that
   * clear selectedScene/selectedEntity without setting any other identity
   * field — without this, switching between two pseudo-tabs wouldn't count
   * as a navigation at all.
   */
  storyDocTabId: string | null;
  notesDocTabId: string | null;
  splitWindowEnabled: boolean;
  pane2SceneId: string | null;
  pane2ChapterId: string | null;
  pane2StoryId: string | null;
  /** Scroll offset of the active surface's scroll container. Frozen into the
   *  outgoing entry right before a new location is pushed / before Back or
   *  Forward steps away from it — never compared for push-vs-no-push. */
  scrollTop: number;
}

/** Persisted shape (app-settings.json, via settingsSet — see AppSettings.navHistory). */
export interface PersistedNavHistory {
  stack: NavigationLocation[];
  index: number;
}

// Bound growth across a long session (relaunch persistence writes the whole
// stack; unbounded growth would bloat app-settings.json indefinitely).
const MAX_ENTRIES = 200;

// storyDocTabId only carries identity when the Story tab is actually active
// AND has no scene selected (the Entity Browser / Outline Planning
// pseudo-tabs). It keeps tracking the last-active story doc tab in the
// background even while a different top-level tab is showing (e.g. it's
// non-null while viewing Notes, from whatever story tab was last open), so
// comparing it unconditionally would see spurious drift on every Notes-only
// navigation. Same reasoning for notesDocTabId, gated on the Notes tab.
function storyDocTabIdMatters(loc: NavigationLocation): boolean {
  return loc.tab === 'story' && loc.sceneId == null;
}
function notesDocTabIdMatters(loc: NavigationLocation): boolean {
  return loc.tab === 'notes' && loc.notePath == null;
}

/**
 * Everything except scrollTop — scroll-only movement must never push a new
 * entry.
 *
 * storyDocTabId/notesDocTabId are compared ONLY when they're the sole
 * identity signal for the location they're on (see storyDocTabIdMatters /
 * notesDocTabIdMatters) — never when sceneId/notePath already identifies the
 * content, or when the other tab is active. DesktopShell derives
 * activeStoryDocTabId/activeNotesDocTabId FROM selectedScene/openedNotePath
 * in a separate effect that fires a render after the one that sets
 * selectedScene/openedNotePath itself, so a plain unconditional comparison
 * would see two different NavigationLocations for one real navigation
 * (content set, stale tab id → content set, caught-up tab id) and fracture
 * it into two history entries, with the harmless second one masking the real
 * one on Back/Forward.
 */
function sameIdentity(a: NavigationLocation, b: NavigationLocation): boolean {
  return (
    a.tab === b.tab &&
    a.focusedPane === b.focusedPane &&
    a.view === b.view &&
    a.viewDepth === b.viewDepth &&
    a.notesSubView === b.notesSubView &&
    a.sceneId === b.sceneId &&
    a.chapterId === b.chapterId &&
    a.storyId === b.storyId &&
    a.entityId === b.entityId &&
    a.notePath === b.notePath &&
    (!storyDocTabIdMatters(a) && !storyDocTabIdMatters(b) || a.storyDocTabId === b.storyDocTabId) &&
    (!notesDocTabIdMatters(a) && !notesDocTabIdMatters(b) || a.notesDocTabId === b.notesDocTabId) &&
    a.splitWindowEnabled === b.splitWindowEnabled &&
    a.pane2SceneId === b.pane2SceneId &&
    a.pane2ChapterId === b.pane2ChapterId &&
    a.pane2StoryId === b.pane2StoryId
  );
}

export interface UseNavigationHistoryResult {
  canGoBack: boolean;
  canGoForward: boolean;
  /** Steps back one entry and returns the location to apply, or null if there's nothing behind. */
  goBack: () => NavigationLocation | null;
  /** Steps forward one entry and returns the location to apply, or null if there's nothing ahead. */
  goForward: () => NavigationLocation | null;
  /**
   * One-shot restore of a persisted stack (app relaunch). No-op after the
   * first call, and no-op if `persisted` is empty/absent. Must be called
   * before the caller's location-derived state has diverged from the
   * default boot location, ideally as part of the same settings-load path
   * that hydrates everything else (ordering caveat: DesktopShell.tsx calls
   * this from loadVault(), same as other AppSettings-derived state).
   */
  hydrate: (persisted: PersistedNavHistory | null | undefined) => void;
  /** Serializable snapshot for persistence (debounce-write on the caller's side). */
  getSnapshot: () => PersistedNavHistory;
  /** Bumps whenever the stack/index mutates — watch this to know when to re-persist. */
  version: number;
}

export function useNavigationHistory(
  location: NavigationLocation,
  getScrollTop: () => number,
): UseNavigationHistoryResult {
  const stackRef = useRef<NavigationLocation[]>([location]);
  const indexRef = useRef(0);
  // Set right before goBack/goForward hand a historical location back to the
  // caller to apply — the resulting state-change re-render must not be
  // mistaken for a fresh user navigation and re-pushed.
  const suppressNextPushRef = useRef(false);
  const hydratedRef = useRef(false);

  // getScrollTop typically closes over render-local state in the caller
  // (current pane/tab), so its identity changes every render — read the
  // latest via a ref instead of depending on it, so the push-effect and
  // goBack/goForward stay referentially stable.
  const getScrollTopRef = useRef(getScrollTop);
  getScrollTopRef.current = getScrollTop;

  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const hydrate = useCallback((persisted: PersistedNavHistory | null | undefined) => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    if (!persisted || persisted.stack.length === 0) return;
    stackRef.current = persisted.stack;
    indexRef.current = Math.min(Math.max(persisted.index, 0), persisted.stack.length - 1);
    // Deliberately does NOT set suppressNextPushRef: unlike goBack/goForward
    // (which synchronously hand the caller a location whose resulting
    // setState calls are guaranteed to land in the very next commit, making
    // the suppress-then-consume handshake reliable), nothing guarantees the
    // live composite location changes in lockstep with this hydration — the
    // rest of the app's boot restore (e.g. SKY-130's lastOpenedScene effect)
    // runs asynchronously and separately. If we suppressed here, a stuck
    // flag would silently swallow the next REAL navigation once boot restore
    // finally does change the location. Instead: let the normal push-effect
    // comparison run. If boot restore lands exactly on the hydrated stack's
    // top (the common case), nothing pushes (identity matches, no-op). If it
    // lands somewhere slightly different, that becomes one new entry appended
    // after the restored history — Back still reaches everywhere it did
    // before relaunch, just one hop later.
    bump();
  }, [bump]);

  useEffect(() => {
    if (suppressNextPushRef.current) {
      suppressNextPushRef.current = false;
      return;
    }
    const top = stackRef.current[indexRef.current];
    if (top && sameIdentity(top, location)) return;
    if (top) {
      stackRef.current[indexRef.current] = { ...top, scrollTop: getScrollTopRef.current() };
    }
    // A fresh navigation branches off the current point — any forward
    // ("redo") history past it is discarded, same as a browser.
    const truncated = stackRef.current.slice(0, indexRef.current + 1);
    truncated.push(location);
    const overflow = truncated.length - MAX_ENTRIES;
    stackRef.current = overflow > 0 ? truncated.slice(overflow) : truncated;
    indexRef.current = stackRef.current.length - 1;
    bump();
    // Identity fields only — scrollTop deliberately excluded (see sameIdentity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    location.tab, location.focusedPane, location.view, location.viewDepth, location.notesSubView,
    location.sceneId, location.chapterId, location.storyId, location.entityId, location.notePath,
    location.storyDocTabId, location.notesDocTabId,
    location.splitWindowEnabled, location.pane2SceneId, location.pane2ChapterId, location.pane2StoryId,
  ]);

  const goBack = useCallback((): NavigationLocation | null => {
    if (indexRef.current <= 0) return null;
    stackRef.current[indexRef.current] = { ...stackRef.current[indexRef.current], scrollTop: getScrollTopRef.current() };
    indexRef.current -= 1;
    suppressNextPushRef.current = true;
    bump();
    return stackRef.current[indexRef.current];
  }, [bump]);

  const goForward = useCallback((): NavigationLocation | null => {
    if (indexRef.current >= stackRef.current.length - 1) return null;
    stackRef.current[indexRef.current] = { ...stackRef.current[indexRef.current], scrollTop: getScrollTopRef.current() };
    indexRef.current += 1;
    suppressNextPushRef.current = true;
    bump();
    return stackRef.current[indexRef.current];
  }, [bump]);

  const getSnapshot = useCallback((): PersistedNavHistory => ({
    stack: stackRef.current,
    index: indexRef.current,
  }), []);

  return {
    canGoBack: indexRef.current > 0,
    canGoForward: indexRef.current < stackRef.current.length - 1,
    goBack,
    goForward,
    hydrate,
    getSnapshot,
    version,
  };
}
