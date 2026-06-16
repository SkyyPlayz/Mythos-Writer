import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import './PanelDragContext.css';

// ── Types ──────────────────────────────────────────────────────────────────────

export type DragSidebar = 'left' | 'right';

export interface PanelDragState {
  panelId: SidebarPanelId;
  label: string;
  sourceSidebar: DragSidebar;
  sourceIndex: number;
}

export interface DropTarget {
  sidebar: DragSidebar;
  /** Insertion index: 0 = before first panel, N = after last panel. */
  index: number;
}

/** State for keyboard-driven drag mode. */
interface KeyboardDrag extends PanelDragState {
  sidebar: DragSidebar;
  index: number;
  leftCount: number;
  rightCount: number;
}

// ── Context value ──────────────────────────────────────────────────────────────

export interface PanelDragContextValue {
  /** Currently-dragging panel, null when idle. */
  dragState: PanelDragState | null;
  /** Nearest valid drop target while dragging. */
  activeDropTarget: DropTarget | null;
  setActiveDropTarget: (t: DropTarget | null) => void;

  /** Start a pointer/HTML5 drag. `ghostPos` is the initial ghost position. */
  startDrag: (state: PanelDragState) => void;
  /** Commit the drop to `activeDropTarget` and end drag. */
  commitDrop: (target: DropTarget) => void;
  /** End drag without committing (drag-end fired without drop). */
  endDrag: () => void;
  /** Cancel drag and return panel to origin. */
  cancelDrag: () => void;

  /** Keyboard-drag state (null when in pointer mode or idle). */
  kbDrag: KeyboardDrag | null;
  startKeyboardDrag: (state: PanelDragState, leftCount: number, rightCount: number) => void;
  moveKbTarget: (dir: 'up' | 'down' | 'left' | 'right') => void;
  commitKbDrop: () => void;
}

const Ctx = createContext<PanelDragContextValue | null>(null);

export function usePanelDrag(): PanelDragContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePanelDrag must be used within PanelDragProvider');
  return ctx;
}

// ── Provider ───────────────────────────────────────────────────────────────────

interface ProviderProps {
  children: ReactNode;
  /** Called when a drop is committed (pointer or keyboard). DesktopShell handles the move. */
  onDrop: (
    panelId: SidebarPanelId,
    fromSidebar: DragSidebar,
    fromIndex: number,
    toSidebar: DragSidebar,
    toIndex: number,
  ) => void;
}

export function PanelDragProvider({ children, onDrop }: ProviderProps) {
  const [dragState, setDragState] = useState<PanelDragState | null>(null);
  const [ghostPos, setGhostPos] = useState({ x: -9999, y: -9999 });
  const [activeDropTarget, setActiveDropTarget] = useState<DropTarget | null>(null);
  const [kbDrag, setKbDrag] = useState<KeyboardDrag | null>(null);
  const announceRef = useRef<HTMLDivElement | null>(null);

  // Polite announcements for screen readers
  const announce = (msg: string) => {
    if (!announceRef.current) return;
    announceRef.current.textContent = '';
    requestAnimationFrame(() => {
      if (announceRef.current) announceRef.current.textContent = msg;
    });
  };

  // Track ghost cursor position via the global dragover event
  useEffect(() => {
    if (!dragState) return;
    const handler = (e: DragEvent) => {
      if (e.clientX !== 0 || e.clientY !== 0) {
        setGhostPos({ x: e.clientX + 14, y: e.clientY - 14 });
      }
    };
    document.addEventListener('dragover', handler);
    return () => document.removeEventListener('dragover', handler);
  }, [dragState]);

  // Escape key cancels either drag mode
  useEffect(() => {
    if (!dragState && !kbDrag) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setDragState(null);
        setActiveDropTarget(null);
        setKbDrag(null);
        announce('Drag cancelled.');
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [dragState, kbDrag]);

  const startDrag = useCallback((state: PanelDragState) => {
    setDragState(state);
    setActiveDropTarget(null);
  }, []);

  const endDrag = useCallback(() => {
    setDragState(null);
    setActiveDropTarget(null);
  }, []);

  const cancelDrag = useCallback(() => {
    setDragState(null);
    setActiveDropTarget(null);
  }, []);

  const commitDrop = useCallback(
    (target: DropTarget) => {
      if (!dragState) return;
      onDrop(
        dragState.panelId,
        dragState.sourceSidebar,
        dragState.sourceIndex,
        target.sidebar,
        target.index,
      );
      setDragState(null);
      setActiveDropTarget(null);
    },
    [dragState, onDrop],
  );

  const startKeyboardDrag = useCallback(
    (state: PanelDragState, leftCount: number, rightCount: number) => {
      setKbDrag({ ...state, sidebar: state.sourceSidebar, index: state.sourceIndex, leftCount, rightCount });
      announce(
        `Keyboard drag started for ${state.label}. Arrow keys to choose position, Enter to drop, Escape to cancel.`,
      );
    },
    [],
  );

  const moveKbTarget = useCallback((dir: 'up' | 'down' | 'left' | 'right') => {
    setKbDrag((prev) => {
      if (!prev) return null;
      let { sidebar, index } = prev;
      const { leftCount, rightCount } = prev;
      const maxIdx = sidebar === 'left' ? leftCount : rightCount;
      if (dir === 'up') index = Math.max(0, index - 1);
      else if (dir === 'down') index = Math.min(maxIdx, index + 1);
      else if (dir === 'left') {
        sidebar = 'left';
        index = Math.min(index, leftCount);
      } else {
        sidebar = 'right';
        index = Math.min(index, rightCount);
      }
      announce(`Position ${index + 1} in ${sidebar} sidebar.`);
      return { ...prev, sidebar, index };
    });
  }, []);

  const commitKbDrop = useCallback(() => {
    if (!kbDrag) return;
    onDrop(kbDrag.panelId, kbDrag.sourceSidebar, kbDrag.sourceIndex, kbDrag.sidebar, kbDrag.index);
    const label = kbDrag.label;
    const sidebar = kbDrag.sidebar;
    const idx = kbDrag.index;
    setKbDrag(null);
    announce(`${label} moved to ${sidebar} sidebar at position ${idx + 1}.`);
  }, [kbDrag, onDrop]);

  const isDragging = dragState !== null;

  return (
    <Ctx.Provider
      value={{
        dragState,
        activeDropTarget,
        setActiveDropTarget,
        startDrag,
        commitDrop,
        endDrag,
        cancelDrag,
        kbDrag,
        startKeyboardDrag,
        moveKbTarget,
        commitKbDrop,
      }}
    >
      {children}

      {/* Accessible live region for drag announcements */}
      <div
        ref={announceRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="panel-drag-live"
      />

      {/* Floating ghost card — rendered in a portal so it's never clipped by sidebars */}
      {isDragging &&
        createPortal(
          <div
            className="panel-drag-ghost"
            style={{ transform: `translate(${ghostPos.x}px, ${ghostPos.y}px)` }}
            aria-hidden="true"
          >
            <span className="panel-drag-ghost-grip">⠿</span>
            <span className="panel-drag-ghost-label">{dragState.label}</span>
          </div>,
          document.body,
        )}
    </Ctx.Provider>
  );
}
