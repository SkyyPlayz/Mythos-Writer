// Beta 4 M10 — Drafts v2 store client.
//
// One fetch for every drafts surface (popover, compare split, full diff):
// the SKY-10 version IPC (`versionList`), which M5 gates onto numbered draft
// FILES for MythosVault v2 (`<Story>/drafts/…/Scene NN.draft-K.md`) and onto
// the per-chapter `versions/` tree for legacy vaults. Labels come straight
// from the file numbering: ts `draft-6` → "Draft 6"; legacy timestamp stems
// fall back to positional numbering (oldest = Draft 1).
import { useCallback, useEffect, useState } from 'react';

export interface SceneDraftEntry {
  /** Store token for version:get / version:rollback (`draft-K` on v2 vaults). */
  ts: string;
  /** Display label, e.g. "Draft 6". */
  label: string;
  /** Full snapshot text. */
  content: string;
  intent: VersionIntent;
  /** Epoch ms of the save when the store records one, else null. */
  savedAtMs: number | null;
}

/** Parse the M5 numbered-draft token: "draft-6" → 6, anything else → null. */
export function draftNumberFromTs(ts: string): number | null {
  const m = /^draft-(\d+)$/.exec(ts);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * Label for a version at `index` in a NEWEST-FIRST list of `total` versions.
 * v2 drafts use their real file number; legacy stems use position.
 */
export function draftLabelFor(ts: string, index: number, total: number): string {
  const n = draftNumberFromTs(ts);
  return `Draft ${n ?? total - index}`;
}

/**
 * Label for the live editor text — one past the newest stored draft
 * (prototype: stored Draft 6 ⇒ the editor is "Draft 7 · current").
 */
export function currentDraftLabel(versions: Array<{ ts: string }>): string {
  let maxN = 0;
  for (let i = 0; i < versions.length; i++) {
    const n = draftNumberFromTs(versions[i].ts);
    maxN = Math.max(maxN, n ?? versions.length - i);
  }
  return `Draft ${maxN + 1}`;
}

export function toSceneDraftEntries(versions: SceneVersion[]): SceneDraftEntry[] {
  return versions.map((v, i) => ({
    ts: v.ts,
    label: draftLabelFor(v.ts, i, versions.length),
    content: v.content,
    intent: v.intent,
    savedAtMs: v.savedAt ? (Number.isFinite(Date.parse(v.savedAt)) ? Date.parse(v.savedAt) : null) : null,
  }));
}

export interface UseSceneDraftsResult {
  /** Stored drafts, newest first (the live editor text is NOT included). */
  drafts: SceneDraftEntry[];
  /** Label of the live editor text, e.g. "Draft 7". */
  currentLabel: string;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useSceneDrafts(sceneId: string | null): UseSceneDraftsResult {
  const [drafts, setDrafts] = useState<SceneDraftEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sceneId) {
      setDrafts([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await window.api.versionList(sceneId);
      setDrafts(toSceneDraftEntries(res.versions));
    } catch (err) {
      setError(`Couldn't load drafts: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [sceneId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { drafts, currentLabel: currentDraftLabel(drafts), loading, error, refresh };
}
