// SKY-204: Markdown note viewer/editor for daily notes and vault notes.
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { countWords } from './wordStats';
import './NoteViewer.css';

interface Props {
  path: string;
  previewMode?: boolean;
  onPreviewModeChange?: (previewMode: boolean) => void;
  onWikiLinkClick?: (target: string) => void;
  onWordCountChange?: (wordCount: number) => void;
  onClose?: () => void;
}

function renderWikiLinkedText(text: string, onWikiLinkClick?: (target: string) => void): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const target = match[1];
    nodes.push(
      <button
        key={`${match.index}-${target}`}
        type="button"
        className="note-wiki-link"
        data-testid="note-wiki-link"
        onClick={() => onWikiLinkClick?.(target)}
      >
        {`[[${target}]]`}
      </button>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export default function NoteViewer({ path, previewMode = false, onPreviewModeChange, onWikiLinkClick, onWordCountChange, onClose }: Props) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  const sourceRef = useRef<'notes' | 'story'>('notes');
  contentRef.current = content;

  const fileName = path.split('/').pop() ?? path;

  useEffect(() => {
    setLoading(true);
    setError(null);
    window.api.readNotesVault(path)
      .then(async (r) => {
        if ('error' in r) {
          const fallback = await window.api.readVault(path);
          sourceRef.current = 'story';
          return fallback;
        }
        sourceRef.current = 'notes';
        return r;
      })
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
      if (sourceRef.current === 'story') {
        await window.api.writeVault(path, text);
      } else {
        const r = await window.api.writeNotesVault(path, text);
        if ('error' in r) throw new Error(r.error);
      }
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

  // Flush on unmount and when the app-level Save shortcut is pressed.
  useEffect(() => {
    const handleManualSave = () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveContent(contentRef.current);
    };
    window.addEventListener('mythos:save-note', handleManualSave);
    return () => {
      window.removeEventListener('mythos:save-note', handleManualSave);
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
        <button
          className={`note-viewer-mode${!previewMode ? ' active' : ''}`}
          type="button"
          aria-pressed={!previewMode}
          onClick={() => onPreviewModeChange?.(false)}
        >
          Edit
        </button>
        <button
          className={`note-viewer-mode${previewMode ? ' active' : ''}`}
          type="button"
          aria-pressed={previewMode}
          onClick={() => onPreviewModeChange?.(true)}
        >
          Preview
        </button>
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
      {previewMode ? (
        <div className="note-viewer-preview" data-testid="note-viewer-preview">
          {content.split('\n').map((line, index) => (
            <p key={index}>{renderWikiLinkedText(line, onWikiLinkClick)}</p>
          ))}
        </div>
      ) : (
        <textarea
          className="note-viewer-editor"
          value={content}
          onChange={handleChange}
          aria-label={`Edit note: ${fileName}`}
          spellCheck
        />
      )}
    </div>
  );
}
