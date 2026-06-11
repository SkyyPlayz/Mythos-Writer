// SKY-204: Markdown note viewer/editor for daily notes and vault notes.
import { useState, useEffect, useCallback, useRef } from 'react';
import { countWords } from './wordStats';
import './NoteViewer.css';

interface Props {
  path: string;
  onWordCountChange?: (wordCount: number) => void;
  onClose?: () => void;
}

export default function NoteViewer({ path, onWordCountChange, onClose }: Props) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  const fileName = path.split('/').pop() ?? path;

  useEffect(() => {
    setLoading(true);
    setError(null);
    window.api.readVault(path)
      .then((r) => {
        setContent(r.content);
        const wc = countWords(r.content);
        onWordCountChange?.(wc);
      })
      .catch(() => setError('Could not load note.'))
      .finally(() => setLoading(false));
  }, [path, onWordCountChange]);

  const saveContent = useCallback(async (text: string) => {
    setSaving(true);
    try {
      await window.api.writeVault(path, text);
      setSavedAt(new Date().toLocaleTimeString());
    } catch {
      // non-fatal; user sees no save indicator
    } finally {
      setSaving(false);
    }
  }, [path]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setContent(text);
    onWordCountChange?.(countWords(text));
    setSavedAt(null);

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveContent(text), 800);
  }, [saveContent, onWordCountChange]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveContent(contentRef.current);
      }
    };
  }, [saveContent]);

  if (loading) {
    return (
      <div className="note-viewer" aria-live="polite">
        <div className="note-viewer-loading">Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="note-viewer" role="alert">
        <div className="note-viewer-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="note-viewer">
      <div className="note-viewer-toolbar">
        <span className="note-viewer-filename">{fileName}</span>
        <span className="note-viewer-save-status" aria-live="polite">
          {saving ? 'Saving…' : savedAt ? `Saved ${savedAt}` : ''}
        </span>
        {onClose && (
          <button
            className="note-viewer-close"
            onClick={onClose}
            aria-label="Close note"
          >
            ✕
          </button>
        )}
      </div>
      <textarea
        className="note-viewer-editor"
        value={content}
        onChange={handleChange}
        aria-label={`Edit note: ${fileName}`}
        spellCheck
      />
    </div>
  );
}
