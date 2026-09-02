import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * SKY-11211: a generic per-route content slot for GlobalRightSidebar.
 *
 * A page (Brainstorm today; Scene Crafter/Timeline can follow the same
 * contract) wraps whatever it wants the global right sidebar to show in
 * <RightSidebarSlot>, from anywhere in the tree. GlobalRightSidebar hosts a
 * portal target and swaps to it — instead of its default content — while a
 * slot claims it, then falls back automatically once the claim releases
 * (route unmount). Nobody has to branch on the active route to make this
 * work; the "which route wins" question never needs answering because only
 * one page is ever mounted at a time.
 */

interface RightSidebarSlotContextValue {
  slotEl: HTMLDivElement | null;
  registerSlotEl: (el: HTMLDivElement | null) => void;
  claim: (id: string) => void;
  release: (id: string) => void;
  occupied: boolean;
}

const RightSidebarSlotContext = createContext<RightSidebarSlotContextValue | null>(null);

export function RightSidebarSlotProvider({ children }: { children: ReactNode }) {
  const [slotEl, setSlotEl] = useState<HTMLDivElement | null>(null);
  const [occupied, setOccupied] = useState(false);
  const claimsRef = useRef<Set<string>>(new Set());

  const registerSlotEl = useCallback((el: HTMLDivElement | null) => {
    setSlotEl(el);
  }, []);

  const claim = useCallback((id: string) => {
    claimsRef.current.add(id);
    setOccupied(true);
  }, []);

  const release = useCallback((id: string) => {
    claimsRef.current.delete(id);
    setOccupied(claimsRef.current.size > 0);
  }, []);

  const value = useMemo<RightSidebarSlotContextValue>(
    () => ({ slotEl, registerSlotEl, claim, release, occupied }),
    [slotEl, registerSlotEl, claim, release, occupied],
  );

  return (
    <RightSidebarSlotContext.Provider value={value}>
      {children}
    </RightSidebarSlotContext.Provider>
  );
}

/** GlobalRightSidebar renders this where its route-owned content should land. */
export function RightSidebarSlotTarget({ className }: { className?: string }) {
  const ctx = useContext(RightSidebarSlotContext);
  return <div ref={ctx?.registerSlotEl} className={className} data-testid="grs-route-slot" />;
}

/** True while some page has claimed the sidebar — GlobalRightSidebar uses
 *  this to decide whether to show the route slot or its default content. */
export function useRightSidebarSlotOccupied(): boolean {
  const ctx = useContext(RightSidebarSlotContext);
  return ctx?.occupied ?? false;
}

let nextSlotId = 0;

/** A page wraps its own right-sidebar content in this. Portals it into
 *  GlobalRightSidebar's slot target for as long as it stays mounted, and
 *  releases the claim automatically on unmount so the default content
 *  (Assistant panel) comes back with no caller-side cleanup required. */
export function RightSidebarSlot({ children }: { children: ReactNode }) {
  const ctx = useContext(RightSidebarSlotContext);
  const idRef = useRef<string>();
  if (idRef.current === undefined) {
    idRef.current = `rss-${nextSlotId++}`;
  }

  useEffect(() => {
    if (!ctx) return;
    const id = idRef.current!;
    ctx.claim(id);
    return () => ctx.release(id);
  }, [ctx]);

  // No provider above (e.g. a unit test rendering the page standalone), or
  // the sidebar itself is collapsed/hidden right now (GlobalRightSidebar
  // doesn't mount a slot target in that state): fall back to rendering
  // inline exactly as before this slot existed, rather than losing content.
  if (!ctx?.slotEl) return <>{children}</>;
  return createPortal(children, ctx.slotEl);
}
