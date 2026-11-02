// Widget catalog and frame state for the 0.5.9 widget shell: which widgets exist, their home spot, and move/duplicate/lock.
// Pure data and a reducer. No React, no dockview, no settings or vault access: S1b keeps layouts in memory only.

/** A widget the frame can place. Sidebars and the nav rail; the editor is the fixed center, not a widget. */
export type FrameWidgetKind = 'navRail' | 'leftSidebar' | 'rightSidebar';

/** One of the four frame edges a widget can sit on. */
export type DockEdge = 'left' | 'right' | 'top' | 'bottom';

export const DOCK_EDGES: readonly DockEdge[] = ['left', 'right', 'top', 'bottom'];

/** Panel id of the fixed center (editor column). Never moved, duplicated or closed. */
export const CENTER_PANEL_ID = 'center';

export interface FrameWidgetDef {
  kind: FrameWidgetKind;
  /** Visible tab title and the name used in announcements. */
  title: string;
  /** Home spot: today's sidebar position (Skyy, 2026-10-26). */
  homeEdge: DockEdge;
  /** Whether "Duplicate" is offered. The Assistant sidebar runs agent scans and owns the single route slot, so one copy only. */
  duplicable: boolean;
  /** Initial size in px along the axis perpendicular to its edge. */
  defaultSize: number;
  /** Smallest size in px the frame lets a sash shrink it to. */
  minSize: number;
}

/** Order is the build order of the home layout: inner widgets first, so each later left/right add lands outermost. */
export const FRAME_WIDGETS: readonly FrameWidgetDef[] = [
  { kind: 'leftSidebar', title: 'Story navigator', homeEdge: 'left', duplicable: true, defaultSize: 260, minSize: 160 },
  { kind: 'navRail', title: 'Navigation', homeEdge: 'left', duplicable: true, defaultSize: 72, minSize: 56 },
  { kind: 'rightSidebar', title: 'Assistant', homeEdge: 'right', duplicable: false, defaultSize: 320, minSize: 200 },
];

const DEF_BY_KIND: Readonly<Record<FrameWidgetKind, FrameWidgetDef>> = Object.freeze(
  Object.fromEntries(FRAME_WIDGETS.map((def) => [def.kind, def])) as Record<FrameWidgetKind, FrameWidgetDef>,
);

export function isFrameWidgetKind(value: unknown): value is FrameWidgetKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DEF_BY_KIND, value);
}

export function isDockEdge(value: unknown): value is DockEdge {
  return typeof value === 'string' && (DOCK_EDGES as readonly string[]).includes(value);
}

export function widgetDef(kind: FrameWidgetKind): FrameWidgetDef {
  return DEF_BY_KIND[kind];
}

/** A placed widget. `copy` is 0 for the original and 2, 3, … for duplicates. */
export interface WidgetInstance {
  id: string;
  kind: FrameWidgetKind;
  edge: DockEdge;
  copy: number;
}

export interface FrameState {
  /** Locked = today's shell look: no tab headers, no widget menus. Unlock to move or duplicate. */
  locked: boolean;
  instances: readonly WidgetInstance[];
}

export type FrameAction =
  | { type: 'unlock' }
  | { type: 'lock' }
  | { type: 'move'; id: string; edge: DockEdge }
  | { type: 'duplicate'; id: string }
  | { type: 'close'; id: string };

/** Home layout: one original per widget at its home edge, locked. */
export function initialFrameState(): FrameState {
  return {
    locked: true,
    instances: FRAME_WIDGETS.map((def) => ({ id: def.kind, kind: def.kind, edge: def.homeEdge, copy: 0 })),
  };
}

export function findInstance(state: FrameState, id: string): WidgetInstance | undefined {
  return state.instances.find((inst) => inst.id === id);
}

export function instancesOf(state: FrameState, kind: FrameWidgetKind): WidgetInstance[] {
  return state.instances.filter((inst) => inst.kind === kind);
}

export function widgetTitle(instance: Pick<WidgetInstance, 'kind' | 'copy'>): string {
  const base = DEF_BY_KIND[instance.kind].title;
  return instance.copy > 0 ? `${base} (copy ${instance.copy})` : base;
}

function nextCopyNumber(state: FrameState, kind: FrameWidgetKind): number {
  let max = 1;
  for (const inst of state.instances) if (inst.kind === kind && inst.copy > max) max = inst.copy;
  return max + 1;
}

/**
 * Applies one layout action. Locked frames ignore move/duplicate/close (returns the same object).
 * Unknown ids, a move to the current edge, duplicating a single-copy widget, and closing an
 * original are no-ops too, so callers can compare by reference to know whether anything changed.
 */
export function frameReducer(state: FrameState, action: FrameAction): FrameState {
  switch (action.type) {
    case 'unlock':
      return state.locked ? { ...state, locked: false } : state;
    case 'lock':
      return state.locked ? state : { ...state, locked: true };
    case 'move': {
      if (state.locked || !isDockEdge(action.edge)) return state;
      const target = findInstance(state, action.id);
      if (!target || target.edge === action.edge) return state;
      return {
        ...state,
        instances: state.instances.map((inst) => (inst.id === action.id ? { ...inst, edge: action.edge } : inst)),
      };
    }
    case 'duplicate': {
      if (state.locked) return state;
      const source = findInstance(state, action.id);
      if (!source || !DEF_BY_KIND[source.kind].duplicable) return state;
      const copy = nextCopyNumber(state, source.kind);
      const clone: WidgetInstance = { id: `${source.kind}:copy:${copy}`, kind: source.kind, edge: source.edge, copy };
      return { ...state, instances: [...state.instances, clone] };
    }
    case 'close': {
      if (state.locked) return state;
      const target = findInstance(state, action.id);
      if (!target || target.copy === 0) return state;
      return { ...state, instances: state.instances.filter((inst) => inst.id !== action.id) };
    }
    default: {
      const exhaustive: never = action;
      void exhaustive;
      return state;
    }
  }
}
