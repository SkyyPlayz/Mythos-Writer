import { useState, useRef, useEffect, useMemo } from 'react';
import type { Scene } from './types';
import {
  SCENE_NOTE_DRAG_MIME,
  NOTE_TIERS,
  NOTE_TIER_LABELS,
  parseSceneNotes,
  serializeSceneNotes,
  noteStoreKeyForTier,
  legacyBarePartStoreKey,
  type NoteTier,
  type NoteTierIds,
  type SceneNoteDragPayload,
} from './sceneNotes';
import './SceneNotesPanel.css';

interface Props {
  scene: Scene | null;
  /**
   * M9b (SKY-9823): bumped by DesktopShell after a note is promoted to the
   * vault (the promote drop lands on StoryNavigator, outside this panel), so
   * the list re-fetches the store it no longer solely owns.
   */
  refreshToken?: number;
  /** Keyboard-accessible promote path (Enter on a focused note card). */
  onPromoteNote?: (payload: SceneNoteDragPayload) => void;
  /**
   * Called after an add/remove lands in the store. DesktopShell bumps the
   * shared refreshToken here so a second mounted instance (the scene-notes
   * panel slot and the hub Notes tab can coexist) never acts on a stale list.
   */
  onNotesChanged?: () => void;
  /**
   * F5: optional part id when the parent already knows ancestry. When omitted,
   * the panel resolves part via `notesTierContext` IPC from the selected scene.
   */
  partId?: string | null;
}

function tierIdsFromScene(scene: Scene | null, partId: string | null): NoteTierIds {
  if (!scene) {
    return { bookId: null, partId: null, chapterId: null, sceneId: null };
  }
  return {
    bookId: scene.storyId ?? null,
    partId,
    chapterId: scene.chapterId ?? null,
    sceneId: scene.id,
  };
}

export default function SceneNotesPanel({
  scene,
  refreshToken = 0,
  onPromoteNote,
  onNotesChanged,
  partId: partIdProp = null,
}: Props) {
  const [notes, setNotes] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [tier, setTier] = useState<NoteTier>('scene');
  const [resolvedPartId, setResolvedPartId] = useState<string | null>(partIdProp);
  /** Critic H3: true while notesTierContext is in flight after a scene switch. */
  const [partPending, setPartPending] = useState(false);
  const loadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setResolvedPartId(partIdProp);
    if (partIdProp) setPartPending(false);
  }, [partIdProp]);

  // Resolve part id from manifest when parent didn't pass one (no DesktopShell hunk).
  useEffect(() => {
    if (!scene?.id) {
      setResolvedPartId(partIdProp);
      setPartPending(false);
      return;
    }
    if (partIdProp) {
      setResolvedPartId(partIdProp);
      setPartPending(false);
      return;
    }
    // Clear stale part before IPC returns so a Part-tab write cannot land on
    // the previous scene's part — but stay on the Part tab while pending (H3).
    setResolvedPartId(null);
    const tierCtx = window.api.notesTierContext;
    if (!tierCtx) {
      setPartPending(false);
      return;
    }
    setPartPending(true);
    let cancelled = false;
    tierCtx(scene.id)
      .then((res) => {
        if (cancelled) return;
        setPartPending(false);
        if (res?.ok && res.partId) setResolvedPartId(res.partId);
        else setResolvedPartId(null);
      })
      .catch(() => {
        if (!cancelled) {
          setPartPending(false);
          setResolvedPartId(null);
        }
      });
    return () => { cancelled = true; };
  }, [scene?.id, partIdProp]);

  const tierIds = useMemo(
    () => tierIdsFromScene(scene, resolvedPartId),
    [scene, resolvedPartId],
  );

  const storeKey = noteStoreKeyForTier(tier, tierIds);

  useEffect(() => {
    if (!scene || !storeKey) {
      setNotes([]);
      loadedKeyRef.current = null;
      return;
    }
    const loadKey = `${storeKey}:${refreshToken}`;
    if (loadKey === loadedKeyRef.current) return;
    loadedKeyRef.current = loadKey;
    const notesGet = window.api.notesGet;
    if (!notesGet) {
      setNotes([]);
      return;
    }
    const load = async () => {
      try {
        const res = await notesGet(storeKey);
        let content = res?.content ?? '';
        // H2: old-key fallback — bare `part:Part N` still loads under scoped ids.
        if (
          tier === 'part'
          && resolvedPartId
          && !content.trim()
        ) {
          const legacy = legacyBarePartStoreKey(resolvedPartId);
          if (legacy && legacy !== storeKey) {
            const legacyRes = await notesGet(legacy);
            if (legacyRes?.content?.trim()) content = legacyRes.content;
          }
        }
        if (loadedKeyRef.current === loadKey) setNotes(parseSceneNotes(content));
      } catch {
        /* non-fatal */
      }
    };
    void load();
  }, [scene, storeKey, refreshToken, tier, resolvedPartId]);

  // When the active tier becomes unavailable, fall back to scene — but stay on
  // Part while tier context is still pending (Critic H3).
  useEffect(() => {
    if (partPending && tier === 'part') return;
    if (!noteStoreKeyForTier(tier, tierIds) && tierIds.sceneId) {
      setTier('scene');
    }
  }, [tier, tierIds, partPending]);

  const persist = (nodeKey: string, next: string[]) => {
    setNotes(next);
    window.api.notesSet?.(nodeKey, serializeSceneNotes(next))
      .then(() => onNotesChanged?.())
      .catch(() => {});
  };

  const addNote = () => {
    const text = draft.trim();
    if (!text || !storeKey || partPending) return;
    persist(storeKey, [...notes, text]);
    setDraft('');
  };

  const removeNote = (index: number) => {
    if (!storeKey) return;
    persist(storeKey, notes.filter((_, i) => i !== index));
  };

  const handleNoteDragStart = (e: React.DragEvent, index: number, text: string) => {
    if (!scene || tier !== 'scene') return;
    const payload: SceneNoteDragPayload = { sceneId: scene.id, index, text };
    e.dataTransfer.setData(SCENE_NOTE_DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.setData('text/plain', text);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleNoteKeyDown = (e: React.KeyboardEvent, index: number, text: string) => {
    if (!scene) return;
    if (e.key === 'Enter' && onPromoteNote && tier === 'scene') {
      e.preventDefault();
      onPromoteNote({ sceneId: scene.id, index, text });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeNote(index);
    }
  };

  if (!scene) {
    return (
      <div className="snp-empty">
        <div className="snp-empty-icon" aria-hidden="true">📝</div>
        <p>Select a scene to add notes.</p>
        <p className="snp-empty-sub">Notes are private workspace annotations — they won&apos;t appear in your exported story.</p>
      </div>
    );
  }

  const tierLabel = NOTE_TIER_LABELS[tier].toUpperCase();
  const promoteHint = tier === 'scene'
    ? 'Pinned to this scene — promote a note to the vault by dragging it onto the navigator.'
    : `Pinned to this ${NOTE_TIER_LABELS[tier].toLowerCase()} — separate from the manuscript body.`;
  const addDisabled = !draft.trim() || !storeKey || partPending;

  return (
    <div className="snp-root" data-testid="snp-root">
      <div className="snp-header">{tierLabel} NOTES</div>
      <div
        className="snp-tiers"
        role="tablist"
        aria-label="Notes tier"
        data-testid="snp-tiers"
      >
        {NOTE_TIERS.map((t) => {
          const available = !!noteStoreKeyForTier(t, tierIds);
          const on = t === tier;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={on}
              disabled={!available}
              className={`snp-tier${on ? ' snp-tier--on' : ''}`}
              data-testid={`snp-tier-${t}`}
              title={
                t === 'part' && partPending && on
                  ? 'Resolving part…'
                  : available
                    ? `${NOTE_TIER_LABELS[t]} notes`
                    : `${NOTE_TIER_LABELS[t]} not in context`
              }
              onClick={() => setTier(t)}
            >
              {NOTE_TIER_LABELS[t]}
            </button>
          );
        })}
      </div>
      <ul className="snp-list" aria-label={`${NOTE_TIER_LABELS[tier]} notes`}>
        {notes.map((text, i) => (
          <li
            key={`${i}:${text}`}
            className="snp-note"
            draggable={tier === 'scene'}
            tabIndex={0}
            aria-label={
              tier === 'scene'
                ? `Scene note: ${text}. Press Enter to promote to the vault, Delete to remove.`
                : `${NOTE_TIER_LABELS[tier]} note: ${text}. Press Delete to remove.`
            }
            onDragStart={(e) => handleNoteDragStart(e, i, text)}
            onKeyDown={(e) => handleNoteKeyDown(e, i, text)}
            data-testid="snp-note"
          >
            <span className="snp-note-text">{text}</span>
            <button
              className="snp-note-remove"
              aria-label={`Remove note: ${text}`}
              title="Remove note"
              onClick={() => removeNote(i)}
            >
              <svg width="9" height="9" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
      <div className="snp-add-row">
        <input
          className="snp-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addNote(); }}
          placeholder={`Jot a ${NOTE_TIER_LABELS[tier].toLowerCase()} note…`}
          aria-label={`New ${NOTE_TIER_LABELS[tier].toLowerCase()} note`}
        />
        <button className="snp-add-btn" onClick={addNote} disabled={addDisabled}>
          Add
        </button>
      </div>
      <p className="snp-hint">{promoteHint}</p>
    </div>
  );
}
