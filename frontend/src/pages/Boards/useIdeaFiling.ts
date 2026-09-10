/**
 * SKY-11192 §3 — the write side of Idea Collections.
 *
 * ── Why this file exists at all ────────────────────────────────────────────
 * Ticket AC 4 and CEO ruling 5 make one thing review-blocking: filing an idea
 * into the vault is ALWAYS a direct user click, never something an agent does
 * on the user's behalf. The agent may SUGGEST an idea — that is what putting a
 * row in Idea Collections means — and nothing more.
 *
 * A comment saying so is not enforcement, so the constraint is built into the
 * shape of the code. Three locks, each independently sufficient:
 *
 *   1. THE WRITE IS ONLY REACHABLE THROUGH A HOOK. `fileIdea` is returned by
 *      `useIdeaFiling()` and is not exported as a free function. React hooks
 *      can only run inside a component render, so an agent stream handler, a
 *      `setTimeout`, a batch job or a main-process message CANNOT obtain a
 *      reference to it. There is no module-level singleton to reach for.
 *
 *   2. IT DEMANDS A GESTURE TOKEN. `fileIdea(gesture, idea)` will not run
 *      without a `UserGesture`, and the only way to mint one is
 *      `userGestureFrom(event)` with a REAL, `isTrusted` DOM event behind it.
 *      A forged `{ isTrusted: true }` object is not a DOM event and is
 *      rejected; a programmatic `element.click()` produces an untrusted event
 *      and is rejected. Code paths with no user event — which is every
 *      autonomous path — have nothing to pass.
 *
 *   3. IT IS SINGLE-FLIGHT AND NON-BATCHABLE. `fileIdea` handles exactly one
 *      idea and refuses re-entry while a write is in flight, so there is no
 *      "file all" affordance to grow into one by accident.
 *
 * Verified by `ideaFiling.test.ts` (untrusted and forged events are refused;
 * a trusted one is honoured) and end-to-end by the real Playwright click in
 * `e2e/tests/sky-11192-brainstorm-boards-unification.spec.ts`.
 *
 * ── Folder creation ────────────────────────────────────────────────────────
 * If the target folder is missing it is created silently as part of the same
 * click (§3, approved in the CEO handoff). That is still the direct result of
 * the user's own click: the hard constraint is about agent autonomy, not about
 * a folder being an implicit side effect of an action the user just took.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IDEA_FOLDERS,
  IDEA_TARGET_FOLDER,
  ideaNoteBody,
  ideaNoteName,
  ideaTargetFolder,
  isIdeaFiled,
  type IdeaCategory,
} from './ideaFiling';

declare const userGestureBrand: unique symbol;

/**
 * Proof that a real user activated a control. Branded so it cannot be
 * structurally faked by an object literal in TypeScript, and only mintable
 * from a trusted DOM event at runtime.
 */
export interface UserGesture {
  readonly [userGestureBrand]: true;
}

const GESTURE: UserGesture = Object.freeze({}) as UserGesture;

/**
 * Mint a gesture token from a React event, or `null` if the event was not
 * user-generated.
 *
 * `isTrusted` is the browser's own answer to "did a human do this": it is true
 * only for events the user agent dispatched from real input, and false for
 * anything script-dispatched, including `element.click()` and a hand-built
 * `new MouseEvent(...)`. We read it off `nativeEvent` because React's
 * synthetic wrapper is script-constructed by definition.
 */
export function userGestureFrom(
  // `nativeEvent: unknown` rather than the React event types: the guarantee
  // here is a RUNTIME one (`instanceof Event` plus `isTrusted`), and a
  // narrower compile-time type would only imply a promise the types cannot
  // keep — a caller can always assert past it.
  event: { nativeEvent?: unknown } | null | undefined,
): UserGesture | null {
  const native: unknown = event?.nativeEvent;
  // Must be an actual DOM Event — a plain object claiming isTrusted is not.
  if (typeof Event === 'undefined' || !(native instanceof Event)) return null;
  return native.isTrusted ? GESTURE : null;
}

export interface FileableIdea {
  key: string;
  cat: IdeaCategory;
  title: string;
  desc: string;
  chips?: readonly string[];
}

export type FileIdeaResult =
  | { ok: true; folderPath: string; notePath: string; noteName: string }
  | { ok: false; reason: 'no-gesture' | 'busy' | 'duplicate'; message: string }
  | { ok: false; reason: 'error'; message: string };

export interface IdeaFiling {
  /** Key of the idea currently being written, if any — drives `Filing…`. */
  filingKey: string | null;
  /**
   * File ONE idea, on ONE user click. See the three locks in the file header.
   * @param gesture must come from `userGestureFrom(clickEvent)`.
   */
  fileIdea: (gesture: UserGesture | null, idea: FileableIdea) => Promise<FileIdeaResult>;
}

/** List a folder's immediate note names; `null` when the folder is unreadable. */
async function listNoteNames(folderPath: string): Promise<string[] | null> {
  const res = await window.api.listNotesVault(folderPath);
  if ('error' in res) return null;
  // listNotesVault is recursive (see useVaultBoard) — a duplicate only counts
  // when it is an immediate child, because that is where we are about to write.
  return res.items
    .filter((i) => !i.isDirectory && !i.path.includes('/') && /\.md$/i.test(i.name))
    .map((i) => i.name);
}

export function useIdeaFiling(): IdeaFiling {
  const [filingKey, setFilingKey] = useState<string | null>(null);
  // A ref as well as state: two clicks in the same tick must not both pass the
  // guard, and state is not readable synchronously.
  const inFlightRef = useRef(false);

  const fileIdea = useCallback(async (
    gesture: UserGesture | null,
    idea: FileableIdea,
  ): Promise<FileIdeaResult> => {
    // LOCK 2 — no trusted user event, no write. This is the line a reviewer
    // should look for; deleting it is the whole regression.
    if (gesture !== GESTURE) {
      return { ok: false, reason: 'no-gesture', message: 'Filing an idea requires a direct click.' };
    }
    // LOCK 3 — one idea at a time.
    if (inFlightRef.current) {
      return { ok: false, reason: 'busy', message: 'Already filing an idea.' };
    }
    inFlightRef.current = true;
    setFilingKey(idea.key);
    try {
      const folderPath = IDEA_TARGET_FOLDER[idea.cat] ?? IDEA_TARGET_FOLDER.loose;
      const noteName = ideaNoteName(idea.title);
      const notePath = `${folderPath}/${noteName}.md`;

      // §3: create the target folder silently if a hand-built or imported
      // vault lacks it. mkdir is idempotent on an existing folder.
      const made = await window.api.mkdirNotesVault(folderPath);
      if ('error' in made) return { ok: false, reason: 'error', message: made.error };

      // Re-check on the folder we are about to write to, not on a listing the
      // UI cached: between render and click the note may have appeared. The
      // check is by NAME (§3) so a hand-made note of the same name also wins.
      const existing = await listNoteNames(folderPath);
      if (existing && isIdeaFiled(existing, idea.title)) {
        return {
          ok: false,
          reason: 'duplicate',
          message: `“${noteName}” is already in ${folderPath}.`,
        };
      }

      const written = await window.api.writeNotesVault(notePath, ideaNoteBody(idea));
      if ('error' in written) return { ok: false, reason: 'error', message: written.error };

      return { ok: true, folderPath, notePath, noteName };
    } catch (err) {
      return { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) };
    } finally {
      inFlightRef.current = false;
      setFilingKey(null);
    }
  }, []);

  return { filingKey, fileIdea };
}

/**
 * §3 already-filed detection, read from the vault rather than from a flag.
 *
 * Lists the three target folders and answers "does a note of this name already
 * exist in the folder this idea maps to". Because it is derived from note
 * NAMES, an idea filed in a previous session and a note the user typed by hand
 * both show `Filed ✓`, and both block the duplicate.
 *
 * It re-reads on `vault:notes-updated`, so renaming a note away un-blocks its
 * idea without a reload. Spec §3 calls that out as intended behaviour.
 *
 * Read-only: nothing here can create a note.
 */
export function useFiledIdeas(notesVaultValid: boolean): {
  isFiled: (idea: { cat: IdeaCategory; title: string }) => boolean;
  refresh: () => void;
} {
  const [namesByFolder, setNamesByFolder] = useState<Record<string, string[]>>({});
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!notesVaultValid) {
      setNamesByFolder({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(IDEA_FOLDERS.map(async (folder) => {
        const res = await window.api.listNotesVault(folder);
        // A missing folder is not an error here — it just has no notes yet, so
        // nothing in it is filed. Creating it is the `File` click's job.
        if ('error' in res) return [folder, [] as string[]] as const;
        const names = res.items
          .filter((i) => !i.isDirectory && !i.path.includes('/') && /\.md$/i.test(i.name))
          .map((i) => i.name);
        return [folder, names] as const;
      }));
      if (cancelled) return;
      setNamesByFolder(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [notesVaultValid, tick]);

  // Filing writes the note itself, and an app self-write does not always reach
  // the notes watcher — so callers also refresh() explicitly after a file.
  useEffect(() => {
    if (!notesVaultValid) return;
    const unsub = window.api.onVaultNotesUpdated?.(() => refresh());
    return () => { unsub?.(); };
  }, [notesVaultValid, refresh]);

  const isFiled = useCallback((idea: { cat: IdeaCategory; title: string }) => {
    const folder = ideaTargetFolder(idea.cat);
    return isIdeaFiled(namesByFolder[folder] ?? [], idea.title);
  }, [namesByFolder]);

  return { isFiled, refresh };
}
