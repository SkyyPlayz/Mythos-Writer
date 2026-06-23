// SKY-204 / SKY-3208 / SKY-3624: Notes tri-mode editor — Source (textarea) / Rich (TipTap) / Preview.
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { WikiLink } from './WikiLinkExtension';
import { EntityMention } from './EntityMentionExtension';
import { EntityMentionPickerExtension, mentionPickerKey, type MentionPickerState } from './EntityMentionPickerExtension';
import EntityMentionPicker, { matchesEntityQuery } from './EntityMentionPicker';
import type { EntityEntry } from './types';
import { countWords } from './wordStats';
import { detectLossyFeatures, type LossyFeature } from './notesFidelityGuard';
import FormatToolbar from './FormatToolbar';
import './NoteViewer.css';
import './EntityMention.css';

export type NoteViewerMode = 'source' | 'rich' | 'preview';

interface Props {
  path: string;
  /** Tri-mode: 'source' (raw textarea) | 'rich' (TipTap) | 'preview' (read-only). Defaults to 'source'. */
  mode?: NoteViewerMode;
  onModeChange?: (mode: NoteViewerMode) => void;
  onWikiLinkClick?: (target: string) => void;
  onWordCountChange?: (wordCount: number) => void;
  onClose?: () => void;
  /** @deprecated Use `mode` + `onModeChange`. Kept for callers that have not migrated. */
  previewMode?: boolean;
  /** @deprecated Use `mode` + `onModeChange`. */
  onPreviewModeChange?: (previewMode: boolean) => void;
}

// ---------------------------------------------------------------------------
// Preview renderer — safe, no dangerouslySetInnerHTML
// ---------------------------------------------------------------------------

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const rest = content.slice(3);
  if (rest.length > 0 && rest[0] !== '\n' && rest[0] !== '\r') return content;
  const end = rest.indexOf('\n---');
  if (end === -1) return content;
  return rest.slice(end + 4).replace(/^\r?\n/, '');
}

function renderInline(text: string, onWikiLinkClick?: (target: string) => void): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[\[[^\]]+\]\])/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) nodes.push(text.slice(lastIdx, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      nodes.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('*')) {
      nodes.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith('`')) {
      nodes.push(<code key={key++}>{tok.slice(1, -1)}</code>);
    } else {
      const target = tok.slice(2, -2);
      nodes.push(
        <button
          key={key++}
          type="button"
          className="note-wiki-link"
          data-testid="note-wiki-link"
          onClick={() => onWikiLinkClick?.(target)}
        >
          {tok}
        </button>,
      );
    }
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) nodes.push(text.slice(lastIdx));
  return nodes;
}

function renderMarkdownPreview(content: string, onWikiLinkClick?: (target: string) => void): ReactNode {
  const body = stripFrontmatter(content);
  const lines = body.split('\n');
  const nodes: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const h3 = line.match(/^### (.+)/);
    const h2 = !h3 && line.match(/^## (.+)/);
    const h1 = !h3 && !h2 && line.match(/^# (.+)/);

    if (h3) {
      nodes.push(<h3 key={i}>{renderInline(h3[1], onWikiLinkClick)}</h3>);
      i++;
    } else if (h2) {
      nodes.push(<h2 key={i}>{renderInline(h2[1], onWikiLinkClick)}</h2>);
      i++;
    } else if (h1) {
      nodes.push(<h1 key={i}>{renderInline(h1[1], onWikiLinkClick)}</h1>);
      i++;
    } else if (/^[-*+] /.test(line)) {
      const items: ReactNode[] = [];
      const start = i;
      while (i < lines.length && /^[-*+] /.test(lines[i])) {
        items.push(<li key={i}>{renderInline(lines[i].slice(2), onWikiLinkClick)}</li>);
        i++;
      }
      nodes.push(<ul key={start}>{items}</ul>);
    } else if (/^\d+\. /.test(line)) {
      const items: ReactNode[] = [];
      const start = i;
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(<li key={i}>{renderInline(lines[i].replace(/^\d+\. /, ''), onWikiLinkClick)}</li>);
        i++;
      }
      nodes.push(<ol key={start}>{items}</ol>);
    } else if (line.trim() === '') {
      i++;
    } else {
      nodes.push(<p key={i}>{renderInline(line, onWikiLinkClick)}</p>);
      i++;
    }
  }

  return <>{nodes}</>;
}

// ---------------------------------------------------------------------------
// Rich-mode TipTap editor (inner component, mounted only when mode='rich')
// ---------------------------------------------------------------------------

const INACTIVE_MENTION: MentionPickerState = { active: false, query: '', from: 0, to: 0 };

interface RichEditorProps {
  content: string;
  onChange: (text: string) => void;
  onWikiLinkClick?: (target: string) => void;
  fileName: string;
}

function NoteRichEditor({ content, onChange, onWikiLinkClick, fileName }: RichEditorProps) {
  const [entities, setEntities] = useState<EntityEntry[]>([]);
  const [mentionState, setMentionState] = useState<MentionPickerState>(INACTIVE_MENTION);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const mentionSuppressedFromRef = useRef<number>(-1);
  const [mentionSuppressed, setMentionSuppressed] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onWikiLinkClickRef = useRef(onWikiLinkClick);
  onWikiLinkClickRef.current = onWikiLinkClick;
  const changeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard so the initial load does not fire onChange with the same content.
  const initializedRef = useRef(false);
  // Guard to skip onSelectionUpdate state setters until the component is mounted,
  // preventing React act() warnings from TipTap's internal initialization.
  const editorMountedRef = useRef(false);

  useEffect(() => {
    window.api.entityList().then(({ entities: list }) => setEntities(list)).catch(() => {});
  }, []);

  useEffect(() => { setMentionSelectedIndex(0); }, [mentionState.query]);

  const syncMentionState = useCallback((editor: ReturnType<typeof useEditor>) => {
    // Skip pre-mount to prevent act() warnings from TipTap initialization events.
    if (!editor || !editorMountedRef.current) return;
    const ps = mentionPickerKey.getState(editor.state) ?? INACTIVE_MENTION;
    if (ps.active && ps.from !== mentionSuppressedFromRef.current) setMentionSuppressed(false);
    setMentionState(ps);
  }, []);

  const editor = useEditor({
    extensions: [StarterKit, WikiLink, EntityMention, EntityMentionPickerExtension, Markdown],
    content,
    onUpdate({ editor: ed }) {
      syncMentionState(ed);
      if (!initializedRef.current) return;
      if (changeRef.current) clearTimeout(changeRef.current);
      changeRef.current = setTimeout(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = (ed.storage as any).markdown.getMarkdown() as string;
        onChangeRef.current(raw.endsWith('\n') ? raw : `${raw}\n`);
      }, 800);
    },
    onSelectionUpdate({ editor: ed }) { syncMentionState(ed); },
  });

  // Mark as initialized after the first render cycle.
  useEffect(() => {
    if (editor) {
      editorMountedRef.current = true;
      const timer = setTimeout(() => { initializedRef.current = true; }, 0);
      return () => {
        clearTimeout(timer);
        editorMountedRef.current = false;
      };
    }
  }, [editor]);

  useEffect(() => {
    return () => { if (changeRef.current) clearTimeout(changeRef.current); };
  }, []);

  const insertEntityMention = useCallback((entity: EntityEntry) => {
    if (!editor || !mentionState.active) return;
    const { from, to } = mentionState;
    const nodeType = editor.schema.nodes.entityMention;
    if (!nodeType) return;
    const node = nodeType.create({ entityId: entity.id, label: entity.name });
    editor.view.dispatch(editor.state.tr.delete(from, to).insert(from, node));
    editor.view.focus();
  }, [editor, mentionState]);

  const handlePickerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!mentionState.active || mentionSuppressed) return;
    const filtered = entities.filter((ent) => matchesEntityQuery(ent, mentionState.query)).slice(0, 10);
    if (filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation();
      setMentionSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      setMentionSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const t = filtered[mentionSelectedIndex];
      if (t) { e.preventDefault(); e.stopPropagation(); insertEntityMention(t); }
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      mentionSuppressedFromRef.current = mentionState.from;
      setMentionSuppressed(true);
    }
  }, [mentionState, mentionSuppressed, entities, mentionSelectedIndex, insertEntityMention]);

  const handleEditorClick = useCallback((e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const wikiEl = t.closest('[data-wiki-link]') as HTMLElement | null;
    if (wikiEl?.dataset.wikiLink) { e.preventDefault(); onWikiLinkClickRef.current?.(wikiEl.dataset.wikiLink); }
  }, []);

  const showPicker = mentionState.active && !mentionSuppressed;
  let pickerTop = 0, pickerLeft = 0;
  if (showPicker && editor && wrapRef.current) {
    try {
      const coords = editor.view.coordsAtPos(mentionState.from);
      const rect = wrapRef.current.getBoundingClientRect();
      pickerTop = coords.bottom - rect.top + 4;
      pickerLeft = coords.left - rect.left;
    } catch { /* pos out of range */ }
  }

  return (
    <div
      className="note-rich-editor-wrap"
      ref={wrapRef}
      style={{ position: 'relative', flex: 1, overflow: 'hidden' }}
      onKeyDownCapture={handlePickerKeyDown}
      onClickCapture={handleEditorClick}
      aria-label={`Rich edit note: ${fileName}`}
    >
      {showPicker && (
        <EntityMentionPicker
          entities={entities}
          query={mentionState.query}
          top={pickerTop}
          left={pickerLeft}
          selectedIndex={mentionSelectedIndex}
          onSelect={insertEntityMention}
        />
      )}
      <FormatToolbar editor={editor} />
      <EditorContent editor={editor} className="note-tiptap-content" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// LC-2 fidelity guard modal
// ---------------------------------------------------------------------------

interface FidelityWarningProps {
  features: LossyFeature[];
  onEditInSource: () => void;
  onOpenRichAnyway: () => void;
}

function FidelityWarning({ features, onEditInSource, onOpenRichAnyway }: FidelityWarningProps) {
  return (
    <div className="note-fidelity-overlay" role="dialog" aria-modal="true" aria-labelledby="fidelity-title">
      <div className="note-fidelity-dialog">
        <h2 className="note-fidelity-title" id="fidelity-title">Rich mode may lose content</h2>
        <p className="note-fidelity-body">
          This note uses features that Rich mode cannot preserve:
        </p>
        <ul className="note-fidelity-list" aria-label="Unsupported features">
          {features.map((f) => <li key={f.key}>{f.label}</li>)}
        </ul>
        <p className="note-fidelity-body">
          Switching to Rich mode and saving may silently remove these elements.
          <strong> Source mode</strong> is always lossless.
        </p>
        <div className="note-fidelity-actions">
          <button
            className="note-fidelity-btn note-fidelity-btn--primary"
            onClick={onEditInSource}
            autoFocus
          >
            Edit in Source (safe)
          </button>
          <button
            className="note-fidelity-btn note-fidelity-btn--danger"
            onClick={onOpenRichAnyway}
          >
            Open in Rich anyway
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NoteViewer
// ---------------------------------------------------------------------------

const MODE_LABELS: Record<NoteViewerMode, string> = {
  source: 'Source',
  rich: 'Rich',
  preview: 'Preview',
};

export default function NoteViewer({
  path,
  mode: modeProp,
  onModeChange,
  onWikiLinkClick,
  onWordCountChange,
  onClose,
  previewMode,
  onPreviewModeChange,
}: Props) {
  // Resolve mode from new prop or legacy previewMode bool.
  const resolvedMode: NoteViewerMode = modeProp ?? (previewMode ? 'preview' : 'source');
  const [mode, setMode] = useState<NoteViewerMode>(resolvedMode);

  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fidelityWarning, setFidelityWarning] = useState<LossyFeature[] | null>(null);
  const [pendingMode, setPendingMode] = useState<NoteViewerMode | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  const fileName = path.split('/').pop() ?? path;

  useEffect(() => {
    setLoading(true);
    setError(null);
    window.api.readNotesVault(path)
      .then((r) => {
        if ('error' in r) throw new Error(r.error);
        setContent(r.content);
        onWordCountChange?.(countWords(r.content));
      })
      .catch(() => setError('Could not load note.'))
      .finally(() => setLoading(false));
  }, [path, onWordCountChange]);

  const saveContent = useCallback(async (text: string) => {
    setSaving(true);
    try {
      const r = await window.api.writeNotesVault(path, text);
      if ('error' in r) throw new Error(r.error);
      setSavedAt(new Date().toLocaleTimeString());
    } catch {
      // non-fatal
    } finally {
      setSaving(false);
    }
  }, [path]);

  const handleSourceChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setContent(text);
    onWordCountChange?.(countWords(text));
    setSavedAt(null);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveContent(text), 800);
  }, [saveContent, onWordCountChange]);

  const handleRichChange = useCallback((text: string) => {
    setContent(text);
    onWordCountChange?.(countWords(text));
    setSavedAt(null);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveContent(text), 800);
  }, [saveContent, onWordCountChange]);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveContent(contentRef.current);
  }, [saveContent]);

  useEffect(() => {
    window.addEventListener('mythos:save-note', flushSave);
    return () => {
      window.removeEventListener('mythos:save-note', flushSave);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveContent(contentRef.current);
      }
    };
  }, [flushSave, saveContent]);

  const applyMode = useCallback((next: NoteViewerMode) => {
    setMode(next);
    onModeChange?.(next);
    onPreviewModeChange?.(next === 'preview');
  }, [onModeChange, onPreviewModeChange]);

  const handleModeClick = useCallback((next: NoteViewerMode) => {
    if (next === mode) return;
    if (next === 'rich') {
      const lossy = detectLossyFeatures(contentRef.current);
      if (lossy.length > 0) {
        setPendingMode(next);
        setFidelityWarning(lossy);
        return;
      }
    }
    applyMode(next);
  }, [mode, applyMode]);

  const handleFidelityEditInSource = useCallback(() => {
    setFidelityWarning(null);
    setPendingMode(null);
    applyMode('source');
  }, [applyMode]);

  const handleFidelityOpenAnyway = useCallback(() => {
    setFidelityWarning(null);
    const next = pendingMode ?? 'rich';
    setPendingMode(null);
    applyMode(next);
  }, [pendingMode, applyMode]);

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
      {fidelityWarning && (
        <FidelityWarning
          features={fidelityWarning}
          onEditInSource={handleFidelityEditInSource}
          onOpenRichAnyway={handleFidelityOpenAnyway}
        />
      )}
      <div className="note-viewer-toolbar">
        <span className="note-viewer-filename">{fileName}</span>
        <span className="note-viewer-save-status" aria-live="polite">
          {saving ? 'Saving…' : savedAt ? `Saved ${savedAt}` : ''}
        </span>
        <div className="note-mode-group" role="group" aria-label="Editor mode">
          {(Object.keys(MODE_LABELS) as NoteViewerMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={`note-viewer-mode${mode === m ? ' active' : ''}`}
              aria-pressed={mode === m}
              onClick={() => handleModeClick(m)}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        {onClose && (
          <button
            className="note-viewer-close"
            type="button"
            onClick={onClose}
            aria-label="Close note"
          >
            ✕
          </button>
        )}
      </div>

      {mode === 'source' && (
        <textarea
          className="note-viewer-editor"
          value={content}
          onChange={handleSourceChange}
          aria-label={`Edit note: ${fileName}`}
          spellCheck
        />
      )}

      {mode === 'rich' && (
        <NoteRichEditor
          key={path}
          content={content}
          onChange={handleRichChange}
          onWikiLinkClick={onWikiLinkClick}
          fileName={fileName}
        />
      )}

      {mode === 'preview' && (
        <div className="note-viewer-preview" data-testid="note-viewer-preview">
          {renderMarkdownPreview(content, onWikiLinkClick)}
        </div>
      )}
    </div>
  );
}
