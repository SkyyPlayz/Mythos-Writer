// Dockview adapter for the 0.5.9 widget frame: the only module that imports dockview, behind an adapter-neutral FrameAdapter API.
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import {
  createDockview,
  type DockviewApi,
  type DockviewGroupPanel,
  type IContentRenderer,
  type IDockviewPanel,
  type IGroupHeaderProps,
  type IHeaderActionsRenderer,
  type ITabRenderer,
  type TabPartInitParameters,
} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import {
  CENTER_PANEL_ID,
  type DockEdge,
  type FrameAction,
  type FrameState,
  type FrameWidgetKind,
  type WidgetInstance,
  findInstance,
  frameReducer,
  initialFrameState,
  widgetDef,
  widgetTitle,
} from './widgetRegistry';
import { announceLayout, describeLayoutChange } from './layoutAnnouncer';
import { featureFlags } from '../featureFlags';

/** Kind attribute on content hosts: the fixed center or one of the widget kinds. */
export type FrameHostKind = 'center' | FrameWidgetKind;

/** Size of a widget along the axis perpendicular to its edge, in px. */
export interface FrameWidgetSize {
  size: number;
  minSize: number;
}

export interface FrameAdapterOptions {
  /** Initial size for a widget when it is added at an edge. Falls back to the registry default. */
  sizeFor?: (instance: WidgetInstance) => FrameWidgetSize | undefined;
  /**
   * Sash pointerdown (capture phase, before dockview handles it). Return a token describing what had
   * focus (e.g. the editor and its selection); it is passed back to onSashRelease. No layout work here.
   */
  onSashGrab?: () => unknown;
  /** Sash pointerup/pointercancel: refocus the editor and restore its selection from the token. */
  onSashRelease?: (token: unknown) => void;
}

/**
 * Adapter-neutral frame API. A fixed-slot fallback (slotAdapter.ts) implements the same surface,
 * so DesktopShell never talks to dockview directly.
 */
export interface FrameAdapter {
  /** Stable content host for a panel id. Same element for the life of the frame, so portals never remount. */
  hostFor(id: string): HTMLElement;
  /** Stable header-actions host for a widget id (the widget menu button portals here). */
  headerHostFor(id: string): HTMLElement;
  /** Reconcile panels to the frame state: add, move (remove + re-add at the new edge), close, lock headers. */
  apply(state: FrameState): void;
  /** Hide or show a widget without removing it (content not rendered right now → no empty column). */
  setVisible(id: string, visible: boolean): void;
  /** Resize a widget's content along the axis perpendicular to its edge. A user action, never per pointer move. */
  setSize(id: string, size: number, minSize?: number): void;
  /** Move DOM focus to a widget's tab. False when it has no visible tab (locked, hidden, unknown). */
  focusTab(id: string): boolean;
  dispose(): void;
}

// ─── Hosts (adapter-neutral) ────────────────────────────────────────────────

const HOST_LAYOUT: Readonly<Record<FrameHostKind, string>> = {
  center: 'row',
  navRail: 'column',
  leftSidebar: 'column',
  rightSidebar: 'row',
};

function kindOfId(id: string): FrameHostKind {
  if (id === CENTER_PANEL_ID) return 'center';
  const kind = id.split(':')[0];
  return kind === 'navRail' || kind === 'leftSidebar' || kind === 'rightSidebar' ? kind : 'center';
}

/** Stable host elements per panel id. Created lazily (detached) so React can portal into them on first render. */
export class FrameHosts {
  private readonly content = new Map<string, HTMLElement>();
  private readonly headers = new Map<string, HTMLElement>();

  constructor(private readonly doc: Document = document) {}

  hostFor(id: string): HTMLElement {
    let el = this.content.get(id);
    if (!el) {
      const kind = kindOfId(id);
      el = this.doc.createElement('div');
      el.className = 'mythos-widget-host';
      el.dataset.widgetId = id;
      el.dataset.widgetKind = kind;
      el.style.flexDirection = HOST_LAYOUT[kind];
      this.content.set(id, el);
    }
    return el;
  }

  headerHostFor(id: string): HTMLElement {
    let el = this.headers.get(id);
    if (!el) {
      el = this.doc.createElement('div');
      el.className = 'mythos-widget-header-actions';
      el.dataset.widgetHeader = id;
      this.headers.set(id, el);
    }
    return el;
  }

  /** Forget a closed copy's hosts (its portals unmount on the same render). */
  release(id: string): void {
    this.content.get(id)?.remove();
    this.headers.get(id)?.remove();
    this.content.delete(id);
    this.headers.delete(id);
  }
}

// ─── Scoped styles ──────────────────────────────────────────────────────────

const STYLE_ID = 'mythos-widget-frame-styles';
/** Space between a widget's card and its inner neighbour (today's 10 px glass-card gutter). Part of the widget's size. */
export const FRAME_WIDGET_GUTTER = 10;
const THEME_CLASS = 'mythos-dockview-theme';

/**
 * Frame CSS, scoped under .mythos-widget-frame and injected once (no new .css file).
 * - dockview variables map to the app's Liquid Neon tokens; backgrounds stay transparent so the glass shows.
 * - .dv-render-overlay loses its transform/containment/z-index: with them every fixed dialog, popover and
 *   menu rendered inside a widget (Settings, Export, context menus) would be clipped to that widget and
 *   painted under its neighbours. Without them they stack against .desktop-shell__body as in the old shell.
 * - An open rail popover lifts the rail above dockview's sash (z-index 99). The popover hangs out of the
 *   rail and otherwise loses its corner to that sash once a locked top widget sits on the boundary.
 * - UI zoom moves from the body row onto each host so dockview's pixel geometry stays unzoomed.
 */
export const FRAME_STYLES = `
.desktop-shell__body:has(> .mythos-widget-frame) { zoom: 1; overflow: clip; }
.mythos-widget-frame { position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; height: 100%; }
.mythos-widget-frame .${THEME_CLASS} {
  --dv-group-view-background-color: transparent;
  --dv-tabs-and-actions-container-background-color: transparent;
  --dv-tabs-and-actions-container-height: 30px;
  --dv-tabs-and-actions-container-font-size: 12px;
  --dv-activegroup-visiblepanel-tab-background-color: var(--glass2, rgba(21, 26, 45, .5));
  --dv-activegroup-hiddenpanel-tab-background-color: transparent;
  --dv-inactivegroup-visiblepanel-tab-background-color: var(--glass2, rgba(21, 26, 45, .5));
  --dv-inactivegroup-hiddenpanel-tab-background-color: transparent;
  --dv-activegroup-visiblepanel-tab-color: var(--text-header, #edecf6);
  --dv-activegroup-hiddenpanel-tab-color: var(--text-muted, #8a9bb0);
  --dv-inactivegroup-visiblepanel-tab-color: var(--text-body, #bfd6e8);
  --dv-inactivegroup-hiddenpanel-tab-color: var(--text-muted, #8a9bb0);
  --dv-tab-divider-color: transparent;
  --dv-separator-border: transparent;
  --dv-paneview-header-border-color: transparent;
  --dv-sash-color: transparent;
  --dv-active-sash-color: var(--neon-cyan, #00f0ff);
  --dv-active-sash-transition-delay: 0.2s;
  --dv-tab-border-radius: var(--radius-xs, 8px);
  --dv-icon-hover-background-color: var(--glass-highlight, rgba(255, 255, 255, .04));
  background-color: transparent;
}
.mythos-widget-frame .dv-render-overlay {
  contain: none; isolation: auto; transform: none; will-change: auto; backface-visibility: visible; z-index: auto;
}
.mythos-widget-frame .dv-tabs-and-actions-container { border-radius: var(--radius-xs, 8px) var(--radius-xs, 8px) 0 0; }
.mythos-widget-frame .dv-tab { padding: 0 10px; display: flex; align-items: center; min-width: 0; flex-shrink: 1; }
.mythos-widget-frame .dv-tab:focus-visible { outline: 2px solid var(--focus-ring, var(--neon-cyan, #00f0ff)); outline-offset: -2px; }
.mythos-widget-frame .mythos-widget-tab { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mythos-widget-frame .mythos-widget-header-actions { display: flex; align-items: center; height: 100%; padding: 0 4px; }
.mythos-widget-frame .mythos-widget-host {
  display: flex; width: 100%; height: 100%; min-width: 0; min-height: 0; box-sizing: border-box; zoom: var(--ln-ui-zoom, 1);
}
.mythos-widget-frame .mythos-widget-host > * { min-width: 0; min-height: 0; }
.mythos-widget-frame .mythos-widget-host[data-widget-edge="left"] { padding-right: ${FRAME_WIDGET_GUTTER}px; }
.mythos-widget-frame .mythos-widget-host[data-widget-edge="right"] { padding-left: ${FRAME_WIDGET_GUTTER}px; }
.mythos-widget-frame .mythos-widget-host[data-widget-edge="top"] { padding-bottom: ${FRAME_WIDGET_GUTTER}px; }
.mythos-widget-frame .mythos-widget-host[data-widget-edge="bottom"] { padding-top: ${FRAME_WIDGET_GUTTER}px; }
.mythos-widget-frame .mythos-widget-host[data-widget-kind="center"] > .desktop-shell__main-col { height: 100%; }
.mythos-widget-frame .mythos-widget-host[data-widget-kind="leftSidebar"] > .shell-left { width: 100% !important; max-width: none; min-width: 0; }
.mythos-widget-frame .mythos-widget-host[data-widget-kind="leftSidebar"] > .shell-left--edge { width: 14px !important; }
.mythos-widget-frame .mythos-widget-host[data-widget-kind="rightSidebar"] > .grs-sidebar,
.mythos-widget-frame .mythos-widget-host[data-widget-kind="rightSidebar"] > .grs-collapsed-edge { flex: 1 1 auto; max-width: none; min-width: 0; height: 100%; }
.mythos-widget-frame .nav-rail[data-orientation="horizontal"] { flex-direction: row; padding: 0 10px; }
.mythos-widget-frame .nav-rail[data-orientation="horizontal"] .nav-rail__nav,
.mythos-widget-frame .nav-rail[data-orientation="horizontal"] .nav-rail__vaults,
.mythos-widget-frame .nav-rail[data-orientation="horizontal"] .nav-rail__bottom,
.mythos-widget-frame .nav-rail[data-orientation="horizontal"] .nav-rail__tools { flex-direction: row; }
.mythos-widget-frame .nav-rail[data-orientation="horizontal"] .nav-rail__divider { display: none; }
.mythos-widget-frame .nav-rail--pop { z-index: 100; }
`;

function ensureFrameStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = FRAME_STYLES;
  doc.head.appendChild(style);
}

// ─── Dockview adapter ───────────────────────────────────────────────────────

const EDGE_DIRECTION: Readonly<Record<DockEdge, 'left' | 'right' | 'above' | 'below'>> = {
  left: 'left',
  right: 'right',
  top: 'above',
  bottom: 'below',
};

function isHorizontalEdge(edge: DockEdge): boolean {
  return edge === 'left' || edge === 'right';
}

/** Tab content: the title only, no nested interactive (POC learning). */
class TitleTab implements ITabRenderer {
  readonly element: HTMLElement;
  constructor(id: string) {
    this.element = document.createElement('span');
    this.element.className = 'mythos-widget-tab';
    this.element.dataset.widgetTab = id;
  }
  init(params: TabPartInitParameters): void {
    this.element.textContent = params.title;
  }
}

/** Right header actions: hosts the active panel's header host (where React portals the widget menu button). */
class HeaderActions implements IHeaderActionsRenderer {
  readonly element: HTMLElement;
  private sub: { dispose(): void } | undefined;
  constructor(private readonly hosts: FrameHosts) {
    this.element = document.createElement('div');
    this.element.className = 'mythos-widget-header-slot';
    this.element.style.height = '100%';
  }
  init(params: IGroupHeaderProps): void {
    const mount = (panel: IDockviewPanel | undefined) => {
      if (!panel || panel.id === CENTER_PANEL_ID) {
        this.element.replaceChildren();
        return;
      }
      const host = this.hosts.headerHostFor(panel.id);
      if (host.parentElement !== this.element) this.element.replaceChildren(host);
    };
    mount(params.group.activePanel);
    this.sub = params.api.onDidActivePanelChange((e) => mount(e.panel));
  }
  dispose(): void {
    this.sub?.dispose();
    this.sub = undefined;
  }
}

interface Placed {
  edge: DockEdge;
}

/**
 * Gives the center group high layout priority so it, not a widget, absorbs every size change (window
 * resize, widget resize, add/remove). dockview 8.6.2 has no public setter for a dock group's priority;
 * this is the one private field the adapter touches (dependency pinned exactly; swap-out = slotAdapter).
 */
function preferCenter(group: DockviewGroupPanel | undefined): void {
  if (group) (group as unknown as { _priority?: 'low' | 'normal' | 'high' })._priority = 'high';
}

/** Vanilla dockview frame. Drag-and-drop off; every move goes through apply(). */
export function createDockFrameAdapter(container: HTMLElement, hosts: FrameHosts, opts: FrameAdapterOptions = {}): FrameAdapter {
  const doc = container.ownerDocument;
  ensureFrameStyles(doc);
  const placed = new Map<string, Placed>();
  /** Intended size per widget (px along the axis perpendicular to its edge): default, then what the user left it at. */
  const intended = new Map<string, number>();
  const hidden = new Set<string>();
  let locked = true;
  let disposed = false;

  const api: DockviewApi = createDockview(container, {
    createComponent: ({ id }): IContentRenderer => ({ element: hosts.hostFor(id), init: () => {} }),
    createTabComponent: ({ id }) => new TitleTab(id),
    createRightHeaderActionComponent: () => new HeaderActions(hosts),
    disableDnd: true,
    disableFloatingGroups: true,
    defaultRenderer: 'always',
    announcements: false,
    // Narrow widgets (the rail) ellipsize their one tab instead of showing an overflow chevron.
    disableTabsOverflowList: true,
    // Window resizes go to the high-priority center instead of scaling the rail and sidebars.
    proportionalLayout: false,
    theme: { name: 'mythos', className: `dockview-theme-dark ${THEME_CLASS}`, colorScheme: 'dark', gap: 0 },
  });

  const groupOf = (id: string): DockviewGroupPanel | undefined => api.getPanel(id)?.group;

  const syncHeader = (id: string) => {
    const group = groupOf(id);
    if (!group) return;
    const hide = id === CENTER_PANEL_ID ? true : locked;
    if (group.model.header.hidden !== hide) group.model.header.hidden = hide;
  };

  const syncVisibility = (id: string) => {
    const group = groupOf(id);
    if (!group) return;
    const visible = !hidden.has(id);
    if (group.api.isVisible !== visible) group.api.setVisible(visible);
  };

  /** Outer size = content size + gutter (the gutter is host padding on the side facing the center). */
  const sizedFor = (inst: WidgetInstance): FrameWidgetSize => {
    const def = widgetDef(inst.kind);
    const sized = opts.sizeFor?.(inst) ?? { size: def.defaultSize, minSize: def.minSize };
    return { size: sized.size + FRAME_WIDGET_GUTTER, minSize: sized.minSize + FRAME_WIDGET_GUTTER };
  };

  /** Layout-engine size of a widget (no DOM read). */
  const currentSize = (id: string): number | undefined => {
    const where = placed.get(id);
    const group = groupOf(id);
    if (!where || !group || !group.api.isVisible) return undefined;
    const size = isHorizontalEdge(where.edge) ? group.api.width : group.api.height;
    return size > 0 ? size : undefined;
  };

  const resizeGroup = (id: string, size: number, minSize?: number) => {
    const where = placed.get(id);
    const group = groupOf(id);
    if (!where || !group) return;
    if (isHorizontalEdge(where.edge)) {
      if (minSize !== undefined) group.api.setConstraints({ minimumWidth: minSize });
      if (group.api.isVisible) group.api.setSize({ width: size });
    } else {
      if (minSize !== undefined) group.api.setConstraints({ minimumHeight: minSize });
      if (group.api.isVisible) group.api.setSize({ height: size });
    }
  };

  /** Remember what the user resized each visible widget to (sash), so later restores keep it. */
  const snapshotSizes = () => {
    for (const id of placed.keys()) {
      const size = currentSize(id);
      if (size !== undefined) intended.set(id, size);
    }
  };

  /** Adding a group splits its row evenly; put every widget back to its intended size (the center absorbs). */
  const restoreSizes = () => {
    for (const [id, size] of intended) resizeGroup(id, size);
  };

  const addWidget = (inst: WidgetInstance) => {
    const sized = sizedFor(inst);
    const horizontal = isHorizontalEdge(inst.edge);
    hosts.hostFor(inst.id).dataset.widgetEdge = inst.edge;
    api.addPanel({
      id: inst.id,
      component: inst.kind,
      tabComponent: 'title',
      title: widgetTitle(inst),
      position: { direction: EDGE_DIRECTION[inst.edge] },
      inactive: true,
      ...(horizontal
        ? { initialWidth: sized.size, minimumWidth: Math.min(sized.minSize, sized.size) }
        : { initialHeight: sized.size, minimumHeight: Math.min(sized.minSize, sized.size) }),
    });
    placed.set(inst.id, { edge: inst.edge });
    intended.set(inst.id, sized.size);
    syncHeader(inst.id);
    syncVisibility(inst.id);
  };

  const removeWidget = (id: string) => {
    const panel = api.getPanel(id);
    if (panel) api.removePanel(panel);
    placed.delete(id);
    intended.delete(id);
  };

  // Sash focus (POC learning): the sash never takes focus; the editor gets focus + selection back on release.
  // Nothing here reads or writes layout per pointer move; the drag itself is dockview's.
  let sashToken: unknown;
  let sashArmed = false;
  const onSashDown = (event: Event) => {
    const target = event.target as Element | null;
    if (!target || typeof target.closest !== 'function' || !target.closest('.dv-sash')) return;
    event.preventDefault();
    if (event.type === 'pointerdown' && !sashArmed) {
      sashArmed = true;
      sashToken = opts.onSashGrab?.();
    }
  };
  const onSashUp = () => {
    if (!sashArmed) return;
    sashArmed = false;
    const token = sashToken;
    sashToken = undefined;
    opts.onSashRelease?.(token);
  };
  container.addEventListener('pointerdown', onSashDown, true);
  container.addEventListener('mousedown', onSashDown, true);
  doc.addEventListener('pointerup', onSashUp, true);
  doc.addEventListener('pointercancel', onSashUp, true);

  const adapter: FrameAdapter = {
    hostFor: (id) => hosts.hostFor(id),
    headerHostFor: (id) => hosts.headerHostFor(id),
    apply(state) {
      if (disposed) return;
      locked = state.locked;
      if (!api.getPanel(CENTER_PANEL_ID)) {
        api.addPanel({ id: CENTER_PANEL_ID, component: 'center', title: 'Editor' });
        preferCenter(groupOf(CENTER_PANEL_ID));
        syncHeader(CENTER_PANEL_ID);
      }
      // Keep what the user resized to (sash) for widgets that stay where they are.
      snapshotSizes();
      let changed = false;
      const wanted = new Set(state.instances.map((inst) => inst.id));
      for (const id of [...placed.keys()]) {
        if (!wanted.has(id)) {
          removeWidget(id);
          hidden.delete(id);
          changed = true;
        }
      }
      for (const inst of state.instances) {
        const prev = placed.get(inst.id);
        if (prev && prev.edge === inst.edge) continue;
        if (prev) removeWidget(inst.id);
        addWidget(inst);
        changed = true;
      }
      for (const id of placed.keys()) syncHeader(id);
      if (changed) restoreSizes();
    },
    setVisible(id, visible) {
      if (disposed) return;
      const wasHidden = hidden.has(id);
      if (wasHidden === !visible) return;
      snapshotSizes();
      if (visible) hidden.delete(id);
      else hidden.add(id);
      syncVisibility(id);
      if (visible && wasHidden) restoreSizes();
    },
    setSize(id, size, minSize) {
      if (disposed || !placed.has(id)) return;
      const outer = size + FRAME_WIDGET_GUTTER;
      intended.set(id, outer);
      resizeGroup(id, outer, minSize === undefined ? undefined : minSize + FRAME_WIDGET_GUTTER);
    },
    focusTab(id) {
      if (disposed || locked || hidden.has(id)) return false;
      const tab = container.querySelector<HTMLElement>(`.dv-tab[data-tab-panel-id="${CSS.escape(id)}"]`);
      if (!tab) return false;
      // preventScroll: focusing mid-layout must never scroll the shell row (overflow is clipped too).
      tab.focus({ preventScroll: true });
      return doc.activeElement === tab;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      container.removeEventListener('pointerdown', onSashDown, true);
      container.removeEventListener('mousedown', onSashDown, true);
      doc.removeEventListener('pointerup', onSashUp, true);
      doc.removeEventListener('pointercancel', onSashUp, true);
      api.dispose();
      placed.clear();
      intended.clear();
    },
  };
  return adapter;
}

// ─── React binding ──────────────────────────────────────────────────────────

export interface FrameAdapterHandle {
  /** Callback ref for the frame root element. The adapter is created synchronously when it attaches. */
  containerRef: (el: HTMLElement | null) => void;
  /** Stable hosts for portals; usable before the adapter exists. */
  hosts: FrameHosts;
  /** The live adapter (null while disabled or before the root mounts). */
  adapter: FrameAdapter | null;
}

/**
 * Creates the dock frame on the root element when enabled, applies every state change, and disposes it
 * when the root detaches (the ref callback gets null on unmount). The adapter is built inside the ref
 * callback so content hosts are in the document before any portal child's layout effect runs. Options
 * are read through a ref; changing them never rebuilds the frame.
 */
export function useFrameAdapter(enabled: boolean, state: FrameState, opts: FrameAdapterOptions = {}): FrameAdapterHandle {
  const hostsRef = useRef<FrameHosts | null>(null);
  if (hostsRef.current === null) hostsRef.current = new FrameHosts();
  const hosts = hostsRef.current;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const stateRef = useRef(state);
  stateRef.current = state;
  const adapterRef = useRef<FrameAdapter | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const [adapter, setAdapter] = useState<FrameAdapter | null>(null);

  const containerRef = useCallback((el: HTMLElement | null) => {
    if (el === rootRef.current) return;
    adapterRef.current?.dispose();
    adapterRef.current = null;
    rootRef.current = el;
    if (!el || !enabled) {
      setAdapter(null);
      return;
    }
    const next = createDockFrameAdapter(el, hosts, {
      sizeFor: (inst) => optsRef.current.sizeFor?.(inst),
      onSashGrab: () => optsRef.current.onSashGrab?.(),
      onSashRelease: (token) => optsRef.current.onSashRelease?.(token),
    });
    next.apply(stateRef.current);
    adapterRef.current = next;
    setAdapter(next);
  }, [enabled, hosts]);

  // Reconcile after every state change; runs before paint so a move never shows a stale frame.
  useLayoutEffect(() => {
    adapterRef.current?.apply(state);
  }, [state]);

  // Closed copies: drop their hosts once the adapter removed the panels.
  const knownIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ids = new Set(state.instances.map((inst) => inst.id));
    for (const id of knownIdsRef.current) if (!ids.has(id)) hosts.release(id);
    knownIdsRef.current = ids;
  }, [state, hosts]);

  return { containerRef, hosts, adapter };
}

// ─── Shell controller (adapter-neutral glue) ────────────────────────────────

/**
 * Whether the shell renders the widget frame: the compile-time `widgetShell` beta flag. Read here so the
 * shell itself names no flag (frame modules own flags and persistence keys; S1a guard on DesktopShell).
 */
export const WIDGET_FRAME_ENABLED: boolean = featureFlags.widgetShell;

/** Selector of the nav rail's lock toggle; focus lands here after lock (and stays after unlock). */
export const LAYOUT_LOCK_TOGGLE_SELECTOR = '[data-testid="widget-layout-lock-toggle"]';

export interface WidgetFrameController extends FrameAdapterHandle {
  state: FrameState;
  /** Reduce, announce the change, then (after the adapter applied it) move focus per the a11y contract. */
  dispatch: (action: FrameAction) => void;
}

interface PendingFocus {
  action: FrameAction;
  before: FrameState;
  after: FrameState;
}

/** Where focus goes after an applied action: a widget tab id, the lock toggle, or nothing. */
function focusTargetFor({ action, before, after }: PendingFocus): { tab: string } | 'lockToggle' | null {
  switch (action.type) {
    case 'move':
      return { tab: action.id };
    case 'duplicate': {
      const added = after.instances.find((inst) => !before.instances.some((prev) => prev.id === inst.id));
      return added ? { tab: added.id } : null;
    }
    case 'close': {
      const gone = findInstance(before, action.id);
      const source = gone ? after.instances.find((inst) => inst.kind === gone.kind && inst.copy === 0) ?? after.instances.find((inst) => inst.kind === gone.kind) : undefined;
      return source ? { tab: source.id } : null;
    }
    case 'lock':
    case 'unlock':
      return 'lockToggle';
    default:
      return null;
  }
}

/**
 * Widget-frame state + adapter for DesktopShell's flag branch. In-memory only: S1b persists nothing.
 * Every applied action is announced through the polite live region; no-op actions are silent.
 */
export function useWidgetFrame(enabled: boolean, opts: FrameAdapterOptions = {}): WidgetFrameController {
  const [state, rawDispatch] = useReducer(frameReducer, undefined, initialFrameState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const pendingRef = useRef<PendingFocus | null>(null);
  const handle = useFrameAdapter(enabled, state, opts);
  const adapterRef = useRef<FrameAdapter | null>(null);
  adapterRef.current = handle.adapter;

  const dispatch = useCallback((action: FrameAction) => {
    const before = stateRef.current;
    const after = frameReducer(before, action);
    if (after === before) return;
    stateRef.current = after;
    pendingRef.current = { action, before, after };
    rawDispatch(action);
    const message = describeLayoutChange(action, before, after);
    if (message) announceLayout(message);
  }, []);

  // Runs after useFrameAdapter's apply effect (declared earlier), so new tabs exist.
  useLayoutEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    const target = focusTargetFor(pending);
    if (target === 'lockToggle') {
      document.querySelector<HTMLElement>(LAYOUT_LOCK_TOGGLE_SELECTOR)?.focus({ preventScroll: true });
    } else if (target) {
      adapterRef.current?.focusTab(target.tab);
    }
  }, [state]);

  return { ...handle, state, dispatch };
}

export interface FrameSyncProps {
  adapter: FrameAdapter | null;
  state: FrameState;
  /** Whether each kind's content is rendered right now. Hidden kinds collapse (no empty column). */
  visible: Readonly<Record<FrameWidgetKind, boolean>>;
  /**
   * Size signature per kind (e.g. "collapsed" vs "expanded"). When a kind's signature changes after the
   * first render, every instance of it is resized via sizeFor. Never per pointer move.
   */
  sizeKeys: Readonly<Record<FrameWidgetKind, string>>;
  sizeFor: (instance: WidgetInstance) => FrameWidgetSize | undefined;
}

/** Render-time bridge from shell state to the adapter (visibility + explicit resizes). Renders nothing. */
export function FrameSync({ adapter, state, visible, sizeKeys, sizeFor }: FrameSyncProps): null {
  const latest = useRef({ state, visible, sizeKeys, sizeFor });
  latest.current = { state, visible, sizeKeys, sizeFor };
  const visibleKey = `${visible.navRail}|${visible.leftSidebar}|${visible.rightSidebar}`;
  const sizeKey = `${sizeKeys.navRail}|${sizeKeys.leftSidebar}|${sizeKeys.rightSidebar}`;

  useLayoutEffect(() => {
    if (!adapter) return;
    const { state: now, visible: shown } = latest.current;
    for (const inst of now.instances) adapter.setVisible(inst.id, shown[inst.kind]);
  }, [adapter, state, visibleKey]);

  // Resize only when a kind's size signature changes after the first render; state changes alone never resize.
  const lastKeysRef = useRef<Readonly<Record<FrameWidgetKind, string>> | null>(null);
  useLayoutEffect(() => {
    const { state: now, sizeKeys: keys, sizeFor: measure } = latest.current;
    const last = lastKeysRef.current;
    lastKeysRef.current = keys;
    if (!adapter || !last) return;
    for (const inst of now.instances) {
      if (last[inst.kind] === keys[inst.kind]) continue;
      const sized = measure(inst);
      if (sized) adapter.setSize(inst.id, sized.size, sized.minSize);
    }
  }, [adapter, sizeKey]);
  return null;
}
