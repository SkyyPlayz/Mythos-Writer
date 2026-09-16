// SKY-11189 (Notes Board 6/9) §8: "one session-scoped undo stack shared by
// vault ops (create/rename/delete/move) and board-metadata edits
// (drag/resize/recolour/furniture) — Ctrl+Z walks both back in order, not two
// separate stacks."
//
// This ticket's own scope is delete (the deferred-delete/trash model) —
// pushing an undo entry for every OTHER op type in that list (rename, move,
// drag, resize, recolour, furniture CRUD) is real scope for the tickets that
// OWN those interactions, not something to retrofit here speculatively. What
// this module commits to is the shared, generic SHAPE: any future caller
// pushes a `{ label, undo }` entry and Ctrl+Z walks the same one stack in
// order, regardless of which op type pushed it — exactly the "not two
// separate stacks" requirement — without needing to know about deletes,
// drags, or anything else.
//
// Deliberately a plain module-level singleton, not React state: it needs to
// survive being read from a DIFFERENT part of the tree than whatever pushed
// onto it (DesktopShell's global Ctrl+Z handler vs. the Boards canvas, where
// the only current pusher — BoardsTabPanel's trash action — lives), and
// "session-scoped" literally means "cleared on app restart", which a
// module-level array
// already is by construction — no persistence to add or remove.

export interface UndoEntry {
  /** Shown in a toast/status line — e.g. "Delete 3 items". */
  label: string;
  undo: () => Promise<void> | void;
}

type Listener = () => void;

const stack: UndoEntry[] = [];
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function pushUndo(entry: UndoEntry): void {
  stack.push(entry);
  notify();
}

export function canUndo(): boolean {
  return stack.length > 0;
}

export function peekUndoLabel(): string | null {
  return stack.length > 0 ? stack[stack.length - 1].label : null;
}

/** Pop and run the most recent entry. No-op (resolves immediately) if the stack is empty. */
export async function undo(): Promise<void> {
  const entry = stack.pop();
  if (!entry) return;
  notify();
  await entry.undo();
}

/** Notified on every push/pop — e.g. to show/hide an "Undo available" affordance. */
export function subscribeUndoStack(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Unit tests only. */
export function resetUndoStackForTests(): void {
  stack.length = 0;
  notify();
}
