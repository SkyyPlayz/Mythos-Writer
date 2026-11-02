// Screen-reader announcements for widget layout changes: one polite live region, plain-language messages.
import { type DockEdge, type FrameAction, type FrameState, findInstance, widgetTitle } from './widgetRegistry';

export const LAYOUT_ANNOUNCER_ID = 'widget-layout-announcer';

const EDGE_WORDS: Readonly<Record<DockEdge, string>> = { left: 'left', right: 'right', top: 'top', bottom: 'bottom' };

/**
 * Message for one applied action, or null when the action changed nothing.
 * `before` and `after` are the frame states around the reducer call.
 */
export function describeLayoutChange(action: FrameAction, before: FrameState, after: FrameState): string | null {
  if (before === after) return null;
  switch (action.type) {
    case 'unlock':
      return 'Layout unlocked. Widgets can be moved and duplicated.';
    case 'lock':
      return 'Layout locked.';
    case 'move': {
      const inst = findInstance(after, action.id);
      return inst ? `${widgetTitle(inst)} moved to the ${EDGE_WORDS[inst.edge]}.` : null;
    }
    case 'duplicate': {
      const added = after.instances.find((inst) => !before.instances.some((prev) => prev.id === inst.id));
      const source = findInstance(before, action.id);
      return added && source ? `${widgetTitle(source)} duplicated as ${widgetTitle(added)}.` : null;
    }
    case 'close': {
      const gone = findInstance(before, action.id);
      return gone ? `${widgetTitle(gone)} closed.` : null;
    }
    default:
      return null;
  }
}

/** Returns the live region, creating it under document.body on first use. */
export function ensureLayoutAnnouncer(doc: Document = document): HTMLElement {
  const existing = doc.getElementById(LAYOUT_ANNOUNCER_ID);
  if (existing) return existing;
  const region = doc.createElement('div');
  region.id = LAYOUT_ANNOUNCER_ID;
  region.className = 'sr-only';
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'true');
  region.setAttribute('data-testid', 'layout-announcer');
  doc.body.appendChild(region);
  return region;
}

/**
 * Announces a message. The region is cleared first and filled on the next frame, so the
 * same message twice in a row (move left, move right, move left) is read both times.
 */
export function announceLayout(message: string, doc: Document = document): void {
  const region = ensureLayoutAnnouncer(doc);
  region.textContent = '';
  const view = doc.defaultView;
  const fill = () => { region.textContent = message; };
  if (view && typeof view.requestAnimationFrame === 'function') view.requestAnimationFrame(fill);
  else fill();
}

/** Removes the live region (frame teardown, tests). */
export function disposeLayoutAnnouncer(doc: Document = document): void {
  doc.getElementById(LAYOUT_ANNOUNCER_ID)?.remove();
}
