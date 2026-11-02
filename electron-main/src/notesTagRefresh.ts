/** Paths a tag rename or merge rewrote, in publish order. Tests read this. */
const delivered: string[][] = [];

export type NotesTagRefreshListener = (notesRoot: string, relPaths: string[]) => void;

let listener: NotesTagRefreshListener | null = null;

export function setNotesTagRefreshListener(fn: NotesTagRefreshListener | null): void {
  listener = fn;
}

export function notesTagRefreshLog(): readonly string[][] {
  return delivered;
}

export function resetNotesTagRefreshLog(): void {
  delivered.length = 0;
}

/**
 * Tell the notes index about files a tag rename or merge just rewrote.
 * Recording happens before the listener so a refresh failure still leaves
 * the paths visible to tests.
 */
/** Main installs the fan-out that refreshes search, entities, and the renderer. */
export function installNotesTagIndexFanout(fanout: (notesRoot: string, relPath: string) => void): void {
  setNotesTagRefreshListener((notesRoot, relPaths) => {
    for (const rel of relPaths) fanout(notesRoot, rel);
  });
}

export function publishNotesTagRefresh(notesRoot: string, relPaths: string[]): void {
  if (relPaths.length === 0) return;
  const copy = relPaths.slice();
  delivered.push(copy);
  listener?.(notesRoot, copy);
}
