import { useState, useRef, useEffect } from 'react';
import type { Scene } from './types';
import './SceneNotesPanel.css';

const NOTES_SAVE_DEBOUNCE_MS = 600;

interface Props { scene: Scene | null; }

export default function SceneNotesPanel({ scene }: Props) {
  const [note, setNote] = useState('');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedSceneIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!scene) { setNote(''); loadedSceneIdRef.current = null; return; }
    if (scene.id === loadedSceneIdRef.current) return;
    loadedSceneIdRef.current = scene.id;
    setNote('');
    window.api.notesGet?.(scene.id).then((res) => {
      if (loadedSceneIdRef.current === scene.id) setNote(res.content);
    }).catch(() => {});
  }, [scene]);

  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

  const persistNote = (sceneId: string, value: string) => {
    window.api.notesSet?.(sceneId, value).catch(() => {});
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setNote(value);
    if (!scene) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => persistNote(scene.id, value), NOTES_SAVE_DEBOUNCE_MS);
  };

  const handleBlur = () => {
    if (!scene) return;
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    persistNote(scene.id, note);
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
      <textarea
        className="snp-textarea"
        value={note}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="Scene notes, reminders, loose ideas…"
        aria-label="Scene notes"
      />
    </div>
  );
}
