// Prism (#1764) — React bindings for the Prism stores.
//
// usePrismBook binds the selected book to its vault path (loads
// `<Story.path>/prism.json` once), claims it as the current book and writes
// settings; ManuscriptView and the sidebar Analytics zone both call it. A
// surface showing some other book (a split pane) only opens it, through
// usePrismOpenBook. The editor only reads, by story id, through
// usePrismSettingsById (falling back to usePrismCurrentBookId when its scene
// has no storyId), and the checklist reads the editor's live findings through
// usePrismLive.

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { PrismSettingsPatch } from './settings';
import { prismLiveStore, prismSettingsStore, type PrismLiveSnapshot } from './store';
import type { PrismSettings } from './types';

/** The parts of a Story the Prism bindings read; chapters/parts list its scenes. */
export interface PrismBookRef {
  id: string;
  path: string;
  chapters?: ReadonlyArray<{ scenes: ReadonlyArray<{ id: string }> }>;
  parts?: ReadonlyArray<{ chapters: ReadonlyArray<{ scenes: ReadonlyArray<{ id: string }> }> }>;
}

function bookSceneIds(story: PrismBookRef): string[] {
  const ids: string[] = [];
  const chapters = [...(story.chapters ?? []), ...(story.parts ?? []).flatMap((p) => p.chapters)];
  for (const ch of chapters) for (const sc of ch.scenes) ids.push(sc.id);
  return ids;
}

/**
 * Load a book's prism.json (once per path) without making it the current
 * book, and register its scenes so their editors find the book even when a
 * scene carries no storyId.
 */
export function usePrismOpenBook(story: PrismBookRef | null | undefined): void {
  const storyId = story?.id ?? null;
  const storyPath = story?.path ?? null;
  useEffect(() => {
    if (storyId && storyPath) prismSettingsStore.open(storyId, storyPath);
  }, [storyId, storyPath]);

  // Keyed by the id list's contents, not the story object (which changes on every save).
  const sceneKey = story ? bookSceneIds(story).join('\n') : '';
  const sceneIds = useMemo(() => (sceneKey ? sceneKey.split('\n') : []), [sceneKey]);
  useEffect(() => {
    if (storyId && sceneIds.length) return prismSettingsStore.registerBookScenes(storyId, sceneIds);
  }, [storyId, sceneIds]);
}

export function usePrismBook(
  story: PrismBookRef | null | undefined
): [PrismSettings, (patch: PrismSettingsPatch) => void] {
  const storyId = story?.id ?? null;
  usePrismOpenBook(story);

  useEffect(() => {
    if (storyId) return prismSettingsStore.claimCurrentBook(storyId);
  }, [storyId]);

  const settings = usePrismSettingsById(storyId);

  const update = useCallback(
    (patch: PrismSettingsPatch) => {
      if (storyId) prismSettingsStore.update(storyId, patch);
    },
    [storyId]
  );

  return [settings, update];
}

/** Read-only settings for a book (defaults until some surface opens it). */
export function usePrismSettingsById(storyId: string | null | undefined): PrismSettings {
  return useSyncExternalStore(prismSettingsStore.subscribe, () => prismSettingsStore.get(storyId));
}

/** The book the writer has selected (claimed by usePrismBook), or null. */
export function usePrismCurrentBookId(): string | null {
  return useSyncExternalStore(prismSettingsStore.subscribe, prismSettingsStore.getCurrentBookId);
}

/** The book a surface registered this scene under (see usePrismOpenBook), or null. */
export function usePrismBookForScene(sceneId: string | null | undefined): string | null {
  return useSyncExternalStore(prismSettingsStore.subscribe, () =>
    prismSettingsStore.getBookForScene(sceneId)
  );
}

/** The live editor's latest Prism snapshot for a scene, or null. */
export function usePrismLive(sceneId: string | null | undefined): PrismLiveSnapshot | null {
  return useSyncExternalStore(prismLiveStore.subscribe, () => prismLiveStore.get(sceneId));
}
