/**
 * SKY-11192/SKY-11674 §3 — Idea Collections filing state: which ideas are
 * already filed (computed by matching idea text against existing note names
 * in the TARGET FOLDER, re-run whenever that folder's contents change — a
 * rename away from the matching name un-blocks the idea, matching
 * ideaCollectionsFiling.ts's findFiledNote on the main-process side), and
 * the transient `Filing…` state for an in-flight `File` click.
 *
 * This hook only calls `fileIdea` when its returned `fileIdea` function is
 * invoked directly by a caller — it has no timer, no effect, and no agent
 * hook that calls it on its own. The one caller in this codebase is
 * IdeaCollectionsPanel's `File` button onClick (a direct user click) — see
 * that component's review-blocking constraint comment.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BoardCategoryKey } from '../../brainstormBoard';
import { IDEA_COLLECTION_FOLDER } from './ideaCollectionsFolders';
import { PILL_FOLDERS } from './BrainstormBoardSurface';

export type IdeaFileStatus = 'unfiled' | 'filing' | 'filed';

export interface FileIdeaArgs {
  key: string;
  cat: BoardCategoryKey;
  title: string;
  desc: string;
}

interface UseIdeaCollectionsFilingResult {
  statusFor: (idea: FileIdeaArgs) => IdeaFileStatus;
  /** File the idea. Resolves to the target folder path on success (for navigation), or null on failure/no-op. */
  fileIdea: (idea: FileIdeaArgs) => Promise<{ folderPath: string; itemPath: string; alreadyFiled: boolean } | null>;
  /** Undo a just-filed idea (toast action). */
  unfileIdea: (cat: BoardCategoryKey, itemPath: string) => Promise<void>;
  folderPathFor: (cat: BoardCategoryKey) => string;
  /** Total notes across the three mapped folders (activity-feed "Cards" stat). */
  totalNoteCount: number;
}

const FOLDER_PATHS = Array.from(new Set(PILL_FOLDERS.map((p) => p.folderPath)));

export function useIdeaCollectionsFiling(notesVaultValid: boolean): UseIdeaCollectionsFilingResult {
  // folderPath -> lowercase note stems present there (immediate .md children only).
  const [filedByFolder, setFiledByFolder] = useState<Map<string, Set<string>>>(new Map());
  const [filingKeys, setFilingKeys] = useState<ReadonlySet<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!notesVaultValid || typeof window.api?.listNotesVault !== 'function') return;
    const entries = await Promise.all(
      FOLDER_PATHS.map(async (folderPath) => {
        try {
          const result = await window.api.listNotesVault(folderPath);
          if ('error' in result) return [folderPath, new Set<string>()] as const;
          const stems = new Set(
            result.items
              .filter((it) => !it.path.includes('/') && /\.md$/i.test(it.name))
              .map((it) => it.name.slice(0, -3).trim().toLowerCase()),
          );
          return [folderPath, stems] as const;
        } catch {
          return [folderPath, new Set<string>()] as const;
        }
      }),
    );
    setFiledByFolder(new Map(entries));
  }, [notesVaultValid]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Follow the vault the same way the board itself does — a note filed,
  // renamed, or deleted by any path (not just this feature) must re-run the
  // already-filed check (§3: "re-runs whenever the target folder's contents change").
  useEffect(() => {
    if (!notesVaultValid) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void refresh(); }, 200);
    };
    const unsubscribes = [window.api.onVaultNotesUpdated?.(onChange)];
    return () => {
      if (timer) clearTimeout(timer);
      for (const unsub of unsubscribes) unsub?.();
    };
  }, [notesVaultValid, refresh]);

  const folderPathFor = useCallback((cat: BoardCategoryKey) => IDEA_COLLECTION_FOLDER[cat], []);

  /** Total notes across the three mapped folders — a real "Cards" count for the activity stat. */
  const totalNoteCount = useMemo(
    () => Array.from(filedByFolder.values()).reduce((sum, stems) => sum + stems.size, 0),
    [filedByFolder],
  );

  const statusFor = useCallback((idea: FileIdeaArgs): IdeaFileStatus => {
    if (filingKeys.has(idea.key)) return 'filing';
    const folderPath = IDEA_COLLECTION_FOLDER[idea.cat];
    const stems = filedByFolder.get(folderPath);
    if (stems?.has(idea.title.trim().toLowerCase())) return 'filed';
    return 'unfiled';
  }, [filingKeys, filedByFolder]);

  const fileIdea = useCallback(async (idea: FileIdeaArgs) => {
    if (typeof window.api?.ideaCollectionsFile !== 'function') return null;
    setFilingKeys((prev) => new Set(prev).add(idea.key));
    try {
      const result = await window.api.ideaCollectionsFile(idea.cat, idea.title, idea.desc);
      if ('error' in result) return null;
      await refresh();
      return { folderPath: result.folderPath, itemPath: result.itemPath, alreadyFiled: result.status === 'already-filed' };
    } finally {
      setFilingKeys((prev) => {
        const next = new Set(prev);
        next.delete(idea.key);
        return next;
      });
    }
  }, [refresh]);

  const unfileIdea = useCallback(async (cat: BoardCategoryKey, itemPath: string) => {
    if (typeof window.api?.ideaCollectionsUnfile !== 'function') return;
    await window.api.ideaCollectionsUnfile(cat, itemPath);
    await refresh();
  }, [refresh]);

  return { statusFor, fileIdea, unfileIdea, folderPathFor, totalNoteCount };
}
