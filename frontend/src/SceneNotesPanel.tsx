import { useState, useRef, useEffect } from 'react';
import type { Scene } from './types';
import {
  SCENE_NOTE_DRAG_MIME,
  parseSceneNotes,
  serializeSceneNotes,
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
}

export default function SceneNotesPanel({
  scene,
  refreshToken = 0,
  onPromoteNote,
  onNotesChanged,
}: Props) {
  const [notes, setNotes] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const loadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!scene) {
      setNotes([]);
      loadedKeyRef.current = null;
      return;
    }
    const loadKey = `${scene.id}:${refreshToken}`;
    if (loadKey === loadedKeyRef.current) return;
    loadedKeyRef.current = loadKey;
    window.api.notesGet?.(scene.id).then((res) => {
      if (loadedKeyRef.current === loadKey) setNotes(parseSceneNotes(res.content));
    }).catch(() => {});
  }, [scene, refreshToken]);

  const persist = (sceneId: string, next: string[]) => {
    setNotes(next);
    window.api.notesSet?.(sceneId, serializeSceneNotes(next))
      .then(() => onNotesChanged?.())
      .catch(() => {});
  };

  const addNote = () => {
    const text = draft.trim();
    if (!text || !scene) return;
    persist(scene.id, [...notes, text]);
    setDraft('');
  };

  const removeNote = (index: number) => {
    if (!scene) return;
    persist(scene.id, notes.filter((_, i) => i !== index));
  };

  const handleNoteDragStart = (e: React.DragEvent, index: number, text: string) => {
    if (!scene) return;
    const payload: SceneNoteDragPayload = { sceneId: scene.id, index, text };
    e.dataTransfer.setData(SCENE_NOTE_DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.setData('text/plain', text);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleNoteKeyDown = (e: React.KeyboardEvent, index: number, text: string) => {
    if (!scene) return;
    if (e.key === 'Enter' && onPromoteNote) {
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

  return (
    <div className="snp-root">
      <div className="snp-header">SCENE NOTES</div>
      <ul className="snp-list" aria-label="Scene notes">
        {notes.map((text, i) => (
          <li
            key={`${i}:${text}`}
            className="snp-note"
            draggable
            tabIndex={0}
            aria-label={`Scene note: ${text}. Press Enter to promote to the vault, Delete to remove.`}
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
          placeholder="Jot a scene note…"
          aria-label="New scene note"
        />
        <button className="snp-add-btn" onClick={addNote} disabled={!draft.trim()}>
          Add
        </button>
      </div>
      <p className="snp-hint">
        Pinned to this scene — promote a note to the vault by dragging it onto the navigator.
      </p>
    </div>
  );
}
