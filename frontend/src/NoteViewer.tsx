// SKY-204: Markdown note viewer/editor for daily notes and vault notes.
// SKY-3205: Rich-text edit mode via Tiptap + FormatToolbar (underline, headings, etc.)
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { WikiLink } from './WikiLinkExtension';
import { countWords } from './wordStats';
import FormatToolbar from './FormatToolbar';
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Preview mode only: rendered markdown string (not backed by editor state)
  const [previewContent, setPreviewContent] = useState('');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track loaded path to detect path changes vs initial mount
  const loadedPathRef = useRef<string | null>(null);

  const fileName = path.split('/').pop() ?? path;

  const saveContent = useCallback(async (text: string) => {
    setSaving(true);
    try {
      const r = await window.api.writeNotesVault(path, text);
      if ('error' in r) throw new Error(r.error);
      setSavedAt(new Date().toLocaleTimeString());
    } catch {
      // non-fatal; save indicator simply doesn't update
    } finally {
      setSaving(false);
    }
  }, [path]);

  // Tiptap editor — StarterKit (includes Underline) + Markdown (lossless round-trip)
  const editor = useEditor({
    extensions: [StarterKit, WikiLink, Markdown],
    content: '',
    editable: !previewMode,
    onUpdate({ editor: ed }) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (ed.storage as any).markdown.getMarkdown() as string;
      const markdown = raw.endsWith('\n') ? raw : `${raw}\n`;
      onWordCountChange?.(countWords(markdown));
      setSavedAt(null);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => saveContent(markdown), 800);
    },
  });

  // Sync editable flag when previewMode changes
  useEffect(() => {
    editor?.setEditable(!previewMode);
  }, [editor, previewMode]);

  // Load / reload note when path changes
  useEffect(() => {
    setLoading(true);
    setError(null);
    setSavedAt(null);
    loadedPathRef.current = path;

    window.api.readNotesVault(path)
      .then((r) => {
        if (loadedPathRef.current !== path) return; // stale
        if ('error' in r) throw new Error(r.error);
        const markdown = r.content;
        setPreviewContent(markdown);
        if (editor) {
          // setContent re-parses the markdown without destroying the editor.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (editor.commands as any).setContent(markdown);
        }
        onWordCountChange?.(countWords(markdown));
      })
      .catch(() => setError('Could not load note.'))
      .finally(() => {
        if (loadedPathRef.current === path) setLoading(false);
      });
  // editor is stable for the component's lifetime (no key remount here)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, onWordCountChange]);

  // If editor is ready but content wasn't loaded yet (initial mount race),
  // also set content once the editor becomes available.
  useEffect(() => {
    if (!editor || loading || error || loadedPathRef.current !== path) return;
    // Content was set during the load effect; nothing more to do.
  }, [editor, loading, error, path]);

  // Flush on unmount and on app-level Ctrl+S
  useEffect(() => {
    const handleManualSave = () => {
      if (!editor) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (editor.storage as any).markdown.getMarkdown() as string;
      const markdown = raw.endsWith('\n') ? raw : `${raw}\n`;
      saveContent(markdown);
    };
    window.addEventListener('mythos:save-note', handleManualSave);
    return () => {
      window.removeEventListener('mythos:save-note', handleManualSave);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        if (editor) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const raw = (editor.storage as any).markdown.getMarkdown() as string;
          const markdown = raw.endsWith('\n') ? raw : `${raw}\n`;
          saveContent(markdown);
        }
      }
    };
  }, [editor, saveContent]);

  // Destroy editor on unmount
  useEffect(() => {
    return () => { editor?.destroy(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      {!previewMode && <FormatToolbar editor={editor} />}

      {previewMode ? (
        <div className="note-viewer-preview" data-testid="note-viewer-preview">
          {previewContent.split('\n').map((line, index) => (
            <p key={index}>{renderWikiLinkedText(line, onWikiLinkClick)}</p>
          ))}
        </div>
      ) : (
        <div className="note-viewer-tiptap">
          <EditorContent editor={editor} className="note-tiptap-content" />
        </div>
      )}
    </div>
  );
}
