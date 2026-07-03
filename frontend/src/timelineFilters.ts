// SKY-795: Pure helpers for timeline filtering, arc focus, and entity tabs.
// Kept side-effect free so they're trivial to unit-test and reuse from any view.
// SKY-3185: TimelineViewMode + TimelineGroupBy for the shared view switcher + grouping.

import type { SpreadsheetScene } from './TimelineSpreadsheet';

export type EntityTab = 'all' | 'character' | 'arc' | 'location';

/** F5 — which surface is active in the timeline panel. */
export type TimelineViewMode = 'spreadsheet' | 'aeon' | 'track';

export const VALID_TIMELINE_VIEW_MODES: readonly TimelineViewMode[] = ['spreadsheet', 'aeon', 'track'];

/** F5 — how scenes are grouped in views that support grouping (spreadsheet today). */
export type TimelineGroupBy = 'none' | 'arc' | 'chapter' | 'character' | 'location';

export const VALID_TIMELINE_GROUP_BYS: readonly TimelineGroupBy[] = ['none', 'arc', 'chapter', 'character', 'location'];

export interface TimelineFilters {
  entityTab: EntityTab;
  /** When set with entityTab='character'|'arc'|'location', non-matching scenes are dimmed (not hidden). */
  entityValue: string;
  /** When set, scenes whose chronological date is outside [from, to] are hidden. */
  dateFrom: string;
  dateTo: string;
  /** Single-arc focus per spec §3.3 — selected arc rendered normally, other arcs ghosted to 20%. */
  focusedArcId: string;
}

export const DEFAULT_FILTERS: TimelineFilters = {
  entityTab: 'all',
  entityValue: '',
  dateFrom: '',
  dateTo: '',
  focusedArcId: '',
};

/** True if the date falls within the [from, to] range. Empty endpoints are treated as unbounded. */
export function isWithinDateRange(date: string, from: string, to: string): boolean {
  if (!date) return !from && !to; // undated scenes only show when range filter is off
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

/** True if the scene matches the active entity tab. 'all' or empty entityValue → always true. */
export function matchesEntityTab(scene: SpreadsheetScene, filters: TimelineFilters): boolean {
  if (filters.entityTab === 'all' || !filters.entityValue) return true;
  if (filters.entityTab === 'character') return scene.characterIds.includes(filters.entityValue);
  if (filters.entityTab === 'arc') return scene.arcIds.includes(filters.entityValue);
  if (filters.entityTab === 'location') return scene.locationId === filters.entityValue;
  return true;
}

export type SceneOpacity = 1 | 0.3 | 0.2 | 0;

/** Resolve a scene's render opacity given the active filters.
 *  - 0   : hidden (outside date range)
 *  - 0.3 : non-matching track for entity tab (spec §2.4 — "tracks fade, not hidden")
 *  - 0.2 : non-focused arc when single-arc focus is active (spec §3.3)
 *  - 1   : full opacity
 *  Date-range hide takes precedence; otherwise entity-tab fade and arc-focus fade compose by taking
 *  the minimum non-hidden opacity so a row dimmed by both stays at the dimmest level.
 */
export function sceneOpacity(scene: SpreadsheetScene, filters: TimelineFilters): SceneOpacity {
  if (!isWithinDateRange(scene.date, filters.dateFrom, filters.dateTo)) return 0;

  let opacity: SceneOpacity = 1;
  if (!matchesEntityTab(scene, filters)) opacity = 0.3;
  if (filters.focusedArcId && !scene.arcIds.includes(filters.focusedArcId)) {
    opacity = 0.2;
  }
  return opacity;
}

/** Returns true if the scene should be excluded from the rendered grid entirely (opacity 0). */
export function isSceneHidden(scene: SpreadsheetScene, filters: TimelineFilters): boolean {
  return sceneOpacity(scene, filters) === 0;
}

/** Chronologically sorted scene id list — drives Tab/Shift+Tab cycling per spec §4. */
export function chronologicalSceneIds(scenes: SpreadsheetScene[]): string[] {
  return [...scenes]
    .sort((a, b) => {
      const ad = a.date || '￿'; // undated scenes sort last
      const bd = b.date || '￿';
      if (ad !== bd) return ad.localeCompare(bd);
      return a.title.localeCompare(b.title);
    })
    .map(s => s.id);
}

/** Advance the focused scene id by `delta` steps within the chronological ordering. */
export function stepFocusedScene(
  currentId: string | null,
  chronoIds: string[],
  delta: 1 | -1,
): string | null {
  if (chronoIds.length === 0) return null;
  if (!currentId) return delta === 1 ? chronoIds[0] : chronoIds[chronoIds.length - 1];
  const idx = chronoIds.indexOf(currentId);
  if (idx === -1) return chronoIds[0];
  const next = (idx + delta + chronoIds.length) % chronoIds.length;
  return chronoIds[next];
}
