// Beta 3 M11 — React binding for the comments store.
//
// One hook per manuscript surface: binds the story to its vault path (loads
// `<Story.path>/comments.json` once), subscribes via useSyncExternalStore,
// and hands back document-ordered comments plus the visibility flags.
// Non-React callers (M23 archive plumbing) use `createComment` from
// './store' directly — see the M23 hook doc there.

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Story } from '../types';
import { orderCommentsByDocument } from './model';
import { commentsStore } from './store';
import type { CreateCommentInput, StoryComment } from './types';

export interface StoryCommentsApi {
  /** Raw comments, insertion order (stable snapshot reference). */
  comments: readonly StoryComment[];
  /** Comments sorted by where their anchors appear in the manuscript. */
  ordered: readonly StoryComment[];
  /** Master visibility toggle (the comments chip). */
  showComments: boolean;
  /** Focus-mode override ("Show in focus"). */
  commentsInFocus: boolean;
  setShowComments: (value: boolean) => void;
  setCommentsInFocus: (value: boolean) => void;
  /** Create a comment on this story (persisted). No-op without a story. */
  create: (input: Omit<CreateCommentInput, 'storyId' | 'storyPath'>) => StoryComment | null;
  /** Resolve (delete) a comment on this story (persisted). */
  resolve: (commentId: string) => boolean;
}

export function useStoryComments(story: Story | null | undefined): StoryCommentsApi {
  const storyId = story?.id ?? null;
  const storyPath = story?.path ?? null;

  useEffect(() => {
    if (storyId && storyPath) void commentsStore.open(storyId, storyPath);
  }, [storyId, storyPath]);

  const comments = useSyncExternalStore(commentsStore.subscribe, () =>
    commentsStore.list(storyId)
  );
  const ui = useSyncExternalStore(commentsStore.subscribe, commentsStore.uiState);

  const ordered = useMemo(
    () => (story ? orderCommentsByDocument(story, comments) : comments),
    [story, comments]
  );

  const create = useCallback(
    (input: Omit<CreateCommentInput, 'storyId' | 'storyPath'>): StoryComment | null => {
      if (!storyId) return null;
      return commentsStore.create({
        ...input,
        storyId,
        ...(storyPath ? { storyPath } : {}),
      });
    },
    [storyId, storyPath]
  );

  const resolve = useCallback(
    (commentId: string): boolean => (storyId ? commentsStore.resolve(storyId, commentId) : false),
    [storyId]
  );

  const setShowComments = useCallback((value: boolean) => {
    commentsStore.setShowComments(value);
  }, []);
  const setCommentsInFocus = useCallback((value: boolean) => {
    commentsStore.setCommentsInFocus(value);
  }, []);

  return {
    comments,
    ordered,
    showComments: ui.showComments,
    commentsInFocus: ui.commentsInFocus,
    setShowComments,
    setCommentsInFocus,
    create,
    resolve,
  };
}
