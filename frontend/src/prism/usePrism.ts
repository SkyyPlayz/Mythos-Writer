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

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { PrismSettingsPatch } from './settings';
import { prismLiveStore, prismSettingsStore, type PrismLiveSnapshot } from './store';
import type { PrismSettings } from './types';

/** Load a book's prism.json (once per path) without making it the current book. */
export function usePrismOpenBook(story: { id: string; path: string } | null | undefined): void {
  const storyId = story?.id ?? null;
  const storyPath = story?.path ?? null;
  useEffect(() => {
    if (storyId && storyPath) prismSettingsStore.open(storyId, storyPath);
  }, [storyId, storyPath]);
}

export function usePrismBook(
  story: { id: string; path: string } | null | undefined
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

/** The live editor's latest Prism snapshot for a scene, or null. */
export function usePrismLive(sceneId: string | null | undefined): PrismLiveSnapshot | null {
  return useSyncExternalStore(prismLiveStore.subscribe, () => prismLiveStore.get(sceneId));
}
