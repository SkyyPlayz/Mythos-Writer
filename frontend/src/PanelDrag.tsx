/**
 * SKY-1695 Wave 2b — cross-sidebar panel drag system.
 *
 * Design principles:
 * - Pointer events (not HTML5 DnD) for full ghost-card control.
 * - elementsFromPoint on pointermove to detect drop zones without re-parenting.
 * - Keyboard drag mode: Space/Enter on handle → arrow keys navigate, Enter commits, Escape cancels.
 * - Extensible: drop targets for off-sidebar (Wave 2c) and tab bar (Wave 2d) use the same DropZoneLine + registry.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import './PanelDrag.css';

export type GrsPanelId = 'writing-assistant' | 'archive-continuity' | 'scene-preview';
export type SidebarPanelId = LeftPanelId | GrsPanelId;
export type SidebarSide = 'left' | 'right';

interface DropTarget {
  sidebar: SidebarSide;
  insertIndex: number;
}

interface ActiveDrag {
  panelId: SidebarPanelId;
  sourceSidebar: SidebarSide;
  /** 0-based position of the panel within its source sidebar. */
  sourceIndex: number;
  panelLabel: string;
  ghostPos: { x: number; y: number };
  dropTarget: DropTarget | null;
  keyboardMode: boolean;
}

interface PanelDragContextValue {
  dragState: ActiveDrag | null;
  startPointerDrag(
    panelId: SidebarPanelId,
    sourceSidebar: SidebarSide,
    sourceIndex: number,
    label: string,
    e: React.PointerEvent,
  ): void;
  startKeyboardDrag(
    panelId: SidebarPanelId,
    sourceSidebar: SidebarSide,
    sourceIndex: number,
    label: string,
  ): void;
  setKeyboardDropTarget(target: DropTarget): void;
  cancelDrag(): void;
  commitDrop(): void;
  onPanelMove: (
    panelId: SidebarPanelId,
    from: SidebarSide,
    to: SidebarSide,
    insertIndex: number,
  ) => void;
}

const PanelDragContext = createContext<PanelDragContextValue | null>(null);

export function usePanelDrag(): PanelDragContextValue {
  const ctx = useContext(PanelDragContext);
  if (!ctx) throw new Error('usePanelDrag must be used within PanelDragProvider');
  return ctx;
}

function GhostCard({ label, pos }: { label: string; pos: { x: number; y: number } }) {
  return createPortal(
    <div
      className="pdrag-ghost"
      style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      aria-hidden="true"
    >
      <span className="pdrag-ghost-handle">⠿</span>
      <span className="pdrag-ghost-label">{label}</span>
    </div>,
    document.body,
  );
}

interface PanelDragProviderProps {
  children: React.ReactNode;
  onPanelMove: PanelDragContextValue['onPanelMove'];
}

export function PanelDragProvider({ children, onPanelMove }: PanelDragProviderProps) {
  const [dragState, setDragState] = useState<ActiveDrag | null>(null);
  const stateRef = useRef<ActiveDrag | null>(null);
  stateRef.current = dragState;
  const onPanelMoveRef = useRef(onPanelMove);
  onPanelMoveRef.current = onPanelMove;

  const cancelDrag = useCallback(() => setDragState(null), []);

  const commitDrop = useCallback(() => {
    const s = stateRef.current;
    if (!s) return;
    if (s.dropTarget) {
      onPanelMoveRef.current(s.panelId, s.sourceSidebar, s.dropTarget.sidebar, s.dropTarget.insertIndex);
    }
    setDragState(null);
  }, []);

  const startPointerDrag = useCallback((
    panelId: SidebarPanelId,
    sourceSidebar: SidebarSide,
    sourceIndex: number,
    label: string,
    e: React.PointerEvent,
  ) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragState({
      panelId, sourceSidebar, sourceIndex, panelLabel: label,
      ghostPos: { x: e.clientX - 16, y: e.clientY - 8 },
      dropTarget: null,
      keyboardMode: false,
    });
  }, []);

  const startKeyboardDrag = useCallback((
    panelId: SidebarPanelId,
    sourceSidebar: SidebarSide,
    sourceIndex: number,
    label: string,
  ) => {
    setDragState({
      panelId, sourceSidebar, sourceIndex, panelLabel: label,
      ghostPos: { x: 0, y: 0 },
      dropTarget: { sidebar: sourceSidebar, insertIndex: sourceIndex },
      keyboardMode: true,
    });
  }, []);

  const setKeyboardDropTarget = useCallback((target: DropTarget) => {
    setDragState(prev => prev ? { ...prev, dropTarget: target } : null);
  }, []);

  // Pointer-mode: global pointermove + pointerup + Escape
  useEffect(() => {
    if (!dragState || dragState.keyboardMode) return;

    const onMove = (e: PointerEvent) => {
      // Find the topmost [data-drop-zone] element under cursor (ghost is pointer-events:none)
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      const dropEl = els.find(
        el => (el as HTMLElement).dataset.dropZone === 'true',
      ) as HTMLElement | undefined;

      const dropTarget: DropTarget | null = dropEl
        ? {
            sidebar: dropEl.dataset.sidebar as SidebarSide,
            insertIndex: Number(dropEl.dataset.insertIndex),
          }
        : null;

      setDragState(prev =>
        prev
          ? { ...prev, ghostPos: { x: e.clientX - 16, y: e.clientY - 8 }, dropTarget }
          : null,
      );
    };

    const onUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      commitDrop();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); cancelDrag(); }
    };

    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('keydown', onKey);
    };
  }, [dragState, commitDrop, cancelDrag]);

  // Keyboard-mode: Escape/Enter
  useEffect(() => {
    if (!dragState || !dragState.keyboardMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); cancelDrag(); }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); commitDrop(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dragState, commitDrop, cancelDrag]);

  const ctx: PanelDragContextValue = {
    dragState,
    startPointerDrag,
    startKeyboardDrag,
    setKeyboardDropTarget,
    cancelDrag,
    commitDrop,
    onPanelMove,
  };

  return (
    <PanelDragContext.Provider value={ctx}>
      {children}
      {dragState && !dragState.keyboardMode && (
        <GhostCard label={dragState.panelLabel} pos={dragState.ghostPos} />
      )}
    </PanelDragContext.Provider>
  );
}

// ── DragHandle ──────────────────────────────────────────────────────────────

interface DragHandleProps {
  panelId: SidebarPanelId;
  sidebar: SidebarSide;
  label: string;
  insertIndex: number;
}

export function DragHandle({ panelId, sidebar, label, insertIndex }: DragHandleProps) {
  const { dragState, startPointerDrag, startKeyboardDrag } = usePanelDrag();
  const isBeingDragged =
    dragState?.panelId === panelId && dragState.sourceSidebar === sidebar;

  return (
    <span
      className={`pdrag-handle${isBeingDragged ? ' pdrag-handle--active' : ''}`}
      role="button"
      aria-label={`Move ${label}`}
      aria-grabbed={isBeingDragged ? true : undefined}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        startPointerDrag(panelId, sidebar, insertIndex, label, e);
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          startKeyboardDrag(panelId, sidebar, insertIndex, label);
        }
      }}
      onClick={(e) => e.stopPropagation()}
    >
      ⠿
    </span>
  );
}

// ── DropZoneLine ─────────────────────────────────────────────────────────────

interface DropZoneLineProps {
  sidebar: SidebarSide;
  insertIndex: number;
  /** True when this is the only drop target in an empty sidebar panel zone. */
  isEmpty?: boolean;
}

export function DropZoneLine({ sidebar, insertIndex, isEmpty }: DropZoneLineProps) {
  const { dragState } = usePanelDrag();
  if (!dragState) return null;

  const isActive =
    dragState.dropTarget?.sidebar === sidebar &&
    dragState.dropTarget?.insertIndex === insertIndex;

  // A noop drop: same sidebar and the insert position equals where it already is
  // (inserting before index N on source sidebar is a no-op when the panel is at N)
  const isNoop =
    dragState.sourceSidebar === sidebar &&
    (insertIndex === dragState.sourceIndex || insertIndex === dragState.sourceIndex + 1);

  return (
    <div
      className={[
        'pdrag-dropzone',
        isActive ? 'pdrag-dropzone--active' : '',
        isEmpty ? 'pdrag-dropzone--empty' : '',
        isNoop ? 'pdrag-dropzone--noop' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-drop-zone="true"
      data-sidebar={sidebar}
      data-insert-index={String(insertIndex)}
      aria-hidden="true"
    />
  );
}

// ── DragPlaceholder ──────────────────────────────────────────────────────────

/** Dashed placeholder shown in the source slot while the panel is being dragged. */
export function DragPlaceholder() {
  return <div className="pdrag-placeholder" aria-hidden="true" />;
}
