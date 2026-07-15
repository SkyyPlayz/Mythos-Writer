// SKY-204 / SKY-3208 / SKY-3624: Notes editor — Rich (TipTap) / Markdown /
// Source views, plus a legacy read-only Preview (Ctrl+E) kept for compat.
// W0.2 (Beta 4): frontmatter and %% kanban:settings %% trailers never render in
// Rich or Preview — they are held aside verbatim and reassembled on save.
// Markdown and Source modes keep showing the raw file (FULL-SPEC §6).
// M17 (Beta 4 "Refine"): editable Lora title + tag chips (frontmatter-backed),
// gear menu → Rich/Markdown/Source seg + always-open-rich toggle, purple
// callout cards + links block in Rich mode, and a backlinks footer.
import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { countWords } from './wordStats';
import { detectLossyFeatures, type LossyFeature } from './notesFidelityGuard';
import { normalize, wikiLinkTargetStem, type WikiLinkCandidate } from './crossTabLinkResolver';
import { replaceDisplayBody, stripHiddenBlocks } from './lib/frontmatter';
import { parseNoteFrontmatter, setFrontmatterField, setFrontmatterTags } from './noteFrontmatter';
import { NoteCallout } from './NoteCalloutExtension';
import { NoteLinksBlock } from './NoteLinksBlockExtension';
import RichTextEditor from './RichTextEditor';
import Backlinks from './Backlinks';
import type { Story, Scene, Chapter } from './types';
import type { AnyExtension } from '@tiptap/core';
import './NoteViewer.css';

export type NoteViewerMode = 'source' | 'rich' | 'markdown' | 'preview';

interface Props {
  path: string;
  /** 'rich' (TipTap) | 'markdown' (raw, editable) | 'source' (raw, editable) | legacy 'preview'. */
  mode?: NoteViewerMode;
  onModeChange?: (mode: NoteViewerMode) => void;
  onWikiLinkClick?: (target: string) => void;
  /** SKY-5702: resolvable note/story titles, for unresolved [[link]] styling. */
  resolvedWikiLinkTitles?: ReadonlySet<string>;
  /** M16: stems resolving to story scenes, for gold [[scene link]] styling. */
  sceneWikiLinkTitles?: ReadonlySet<string>;
  /** SKY-5702: cross-vault candidate list for the [[ autocomplete popup. */
  wikiLinkCandidates?: WikiLinkCandidate[];
  onWordCountChange?: (wordCount: number) => void;
  onClose?: () => void;
  /** M17: loaded stories — enables the backlinks footer under the note body. */
  stories?: Story[];
  /** M17: open a backlinking note (Notes-Vault-relative path). */
  onOpenBacklinkNote?: (path: string) => void;
  /** M17: open a backlinking story scene. */
  onOpenBacklinkScene?: (scene: Scene, chapter: Chapter, story: Story) => void;
  /** @deprecated Use `mode` + `onModeChange`. Kept for callers that have not migrated. */
  previewMode?: boolean;
  /** @deprecated Use `mode` + `onModeChange`. */
  onPreviewModeChange?: (previewMode: boolean) => void;
}

// ---------------------------------------------------------------------------
// M17: "always open rich" preference (gear menu toggle)
// ---------------------------------------------------------------------------

export const NOTES_DEFAULT_RICH_KEY = 'mythos:notes:defaultRich';

function readDefaultRichPref(): boolean {
  try {
    return window.localStorage.getItem(NOTES_DEFAULT_RICH_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDefaultRichPref(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(NOTES_DEFAULT_RICH_KEY, '1');
    else window.localStorage.removeItem(NOTES_DEFAULT_RICH_KEY);
  } catch {
    // storage unavailable — the toggle still works for this session
  }
}

// ---------------------------------------------------------------------------
// M17: tag chip colors — prototype tag palette, deterministic per tag name
// ---------------------------------------------------------------------------

const TAG_PALETTE = ['#2fe6c8', '#9b5fff', '#ff4dff', '#3d9bff', '#00f0ff', '#ffd319'];

function hexA(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function tagColor(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

// ---------------------------------------------------------------------------
// Preview renderer — safe, no dangerouslySetInnerHTML (legacy read-only view)
// ---------------------------------------------------------------------------

function renderInline(
  text: string,
  onWikiLinkClick?: (target: string) => void,
  resolvedTitles?: ReadonlySet<string>,
  sceneTitles?: ReadonlySet<string>,
): ReactNode[] {
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
      // M17: resolved/scene/unresolved styling in preview mode too — same
      // class contract as the rich editor's WikiLinkResolutionExtension.
      let cls = 'note-wiki-link';
      if (resolvedTitles) {
        const stem = normalize(wikiLinkTargetStem(target));
        if (stem && !resolvedTitles.has(stem)) cls += ' wiki-link-unresolved';
        else if (stem && sceneTitles?.has(stem)) cls += ' wiki-link-scene';
      }
      nodes.push(
        <button
          key={key++}
          type="button"
          className={cls}
          data-testid="note-wiki-link"
          // M16: hover-preview target hook (distinct from data-wiki-link so the
          // rich editor's CSS never bleeds onto preview-mode buttons).
          data-wiki-target={target}
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

function renderMarkdownPreview(
  content: string,
  onWikiLinkClick?: (target: string) => void,
  resolvedTitles?: ReadonlySet<string>,
  sceneTitles?: ReadonlySet<string>,
): ReactNode {
  // W0.2: preview never renders frontmatter or kanban-settings trailers.
  const body = stripHiddenBlocks(content);
  const lines = body.split('\n');
  const nodes: ReactNode[] = [];
  let i = 0;

  const inline = (text: string) => renderInline(text, onWikiLinkClick, resolvedTitles, sceneTitles);

  while (i < lines.length) {
    const line = lines[i];
    const h3 = line.match(/^### (.+)/);
    const h2 = !h3 && line.match(/^## (.+)/);
    const h1 = !h3 && !h2 && line.match(/^# (.+)/);

    if (h3) {
      nodes.push(<h3 key={i}>{inline(h3[1])}</h3>);
      i++;
    } else if (h2) {
      nodes.push(<h2 key={i}>{inline(h2[1])}</h2>);
      i++;
    } else if (h1) {
      nodes.push(<h1 key={i}>{inline(h1[1])}</h1>);
      i++;
    } else if (/^[-*+] /.test(line)) {
      const items: ReactNode[] = [];
      const start = i;
      while (i < lines.length && /^[-*+] /.test(lines[i])) {
        items.push(<li key={i}>{inline(lines[i].slice(2))}</li>);
        i++;
      }
      nodes.push(<ul key={start}>{items}</ul>);
    } else if (/^\d+\. /.test(line)) {
      const items: ReactNode[] = [];
      const start = i;
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(<li key={i}>{inline(lines[i].replace(/^\d+\. /, ''))}</li>);
        i++;
      }
      nodes.push(<ol key={start}>{items}</ol>);
    } else if (line.trim() === '') {
      i++;
    } else {
      nodes.push(<p key={i}>{inline(line)}</p>);
      i++;
    }
  }

  return <>{nodes}</>;
}

// ---------------------------------------------------------------------------
// Rich-mode TipTap editor (inner component, mounted only when mode='rich')
// ---------------------------------------------------------------------------

// M17: Notes-only rich extensions — purple callout cards + links-block chips.
// Story's BlockEditor never mounts these, so story serialization is untouched.
const NOTE_RICH_EXTENSIONS: AnyExtension[] = [NoteCallout, NoteLinksBlock];

interface RichEditorProps {
  content: string;
  onChange: (text: string) => void;
  onWikiLinkClick?: (target: string) => void;
  resolvedWikiLinkTitles?: ReadonlySet<string>;
  sceneWikiLinkTitles?: ReadonlySet<string>;
  wikiLinkCandidates?: WikiLinkCandidate[];
  fileName: string;
}

// Thin wrapper over the shared core (SKY-3204): Notes rich mode gets the same
// base extensions (including Underline) and entity @-mention picker as Story.
function NoteRichEditor({ content, onChange, onWikiLinkClick, resolvedWikiLinkTitles, sceneWikiLinkTitles, wikiLinkCandidates, fileName }: RichEditorProps) {
  return (
    <div className="note-rich-editor">
      <RichTextEditor
        content={content}
        suppressInitialChange
        extraExtensions={NOTE_RICH_EXTENSIONS}
        onChangeMarkdown={onChange}
        onWikiLinkClick={onWikiLinkClick}
        resolvedWikiLinkTitles={resolvedWikiLinkTitles}
        sceneWikiLinkTitles={sceneWikiLinkTitles}
        wikiLinkCandidates={wikiLinkCandidates}
        wrapClassName="note-rich-editor-wrap"
        contentClassName="note-tiptap-content"
        wrapAriaLabel={`Rich edit note: ${fileName}`}
      />
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

// M17 gear menu (prototype gearItems): the three spec views. The legacy
// read-only Preview stays reachable via Ctrl+E / the previewMode prop only.
const GEAR_MODES: Array<{ mode: NoteViewerMode; label: string }> = [
  { mode: 'rich', label: 'Rich Text' },
  { mode: 'markdown', label: 'Markdown' },
  { mode: 'source', label: 'Source Mode' },
];

export default function NoteViewer({
  path,
  mode: modeProp,
  onModeChange,
  onWikiLinkClick,
  resolvedWikiLinkTitles,
  sceneWikiLinkTitles,
  wikiLinkCandidates,
  onWordCountChange,
  onClose,
  stories,
  onOpenBacklinkNote,
  onOpenBacklinkScene,
  previewMode,
  onPreviewModeChange,
}: Props) {
  const [defaultRich, setDefaultRich] = useState(readDefaultRichPref);

  // Resolve mode from new prop, legacy previewMode bool, or the M17
  // "always open rich" preference.
  const resolvedMode: NoteViewerMode =
    modeProp ?? (previewMode ? 'preview' : (defaultRich ? 'rich' : 'source'));
  const [mode, setMode] = useState<NoteViewerMode>(resolvedMode);
  // True while the initial mode came from the always-rich pref (not an
  // explicit prop) — the fidelity guard then downgrades silently on load.
  const pendingPrefRichRef = useRef(modeProp === undefined && !previewMode && resolvedMode === 'rich');

  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // GH#616: surface autosave failures instead of silently dropping them, so a
  // writer never loses changes to a save they believe succeeded.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fidelityWarning, setFidelityWarning] = useState<LossyFeature[] | null>(null);
  const [pendingMode, setPendingMode] = useState<NoteViewerMode | null>(null);
  const [gearOpen, setGearOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;
  const titleElRef = useRef<HTMLSpanElement | null>(null);

  // W0.5 (PERFORMANCE §4): the word count reaches the app shell
  // (setOpenedNoteWordCount → BottomBar) — never per keystroke. Counting and
  // reporting are debounced; the count is per-note (this file only).
  const wcTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onWordCountChangeRef = useRef(onWordCountChange);
  onWordCountChangeRef.current = onWordCountChange;
  const scheduleWordCount = useCallback((text: string) => {
    if (wcTimerRef.current) clearTimeout(wcTimerRef.current);
    wcTimerRef.current = setTimeout(() => {
      onWordCountChangeRef.current?.(countWords(text));
    }, 300);
  }, []);
  useEffect(() => () => {
    if (wcTimerRef.current) clearTimeout(wcTimerRef.current);
  }, []);

  const fileName = path.split('/').pop() ?? path;
  const fileStem = fileName.replace(/\.[^.]+$/, '');

  const applyMode = useCallback((next: NoteViewerMode) => {
    setMode(next);
    onModeChange?.(next);
    onPreviewModeChange?.(next === 'preview');
  }, [onModeChange, onPreviewModeChange]);
  const applyModeRef = useRef(applyMode);
  applyModeRef.current = applyMode;

  useEffect(() => {
    setLoading(true);
    setError(null);
    window.api.readNotesVault(path)
      .then((r) => {
        if ('error' in r) throw new Error(r.error);
        setContent(r.content);
        onWordCountChange?.(countWords(r.content));
        // M17: the always-rich pref must never silently destroy lossy
        // markdown (CF-11) — downgrade to Source without a modal on open.
        if (pendingPrefRichRef.current) {
          pendingPrefRichRef.current = false;
          if (detectLossyFeatures(stripHiddenBlocks(r.content)).length > 0) {
            applyModeRef.current('source');
          }
        }
      })
      .catch(() => setError('Could not load note.'))
      .finally(() => setLoading(false));
  }, [path, onWordCountChange]);

  const saveContent = useCallback(async (text: string): Promise<boolean> => {
    setSaving(true);
    try {
      const r = await window.api.writeNotesVault(path, text);
      if ('error' in r) throw new Error(r.error);
      setSavedAt(new Date().toLocaleTimeString());
      setSaveError(null);
      return true;
    } catch {
      // GH#616: the write did NOT persist. Surface an actionable error and make
      // sure we do not imply the note is saved (clear any stale "Saved" stamp).
      setSavedAt(null);
      setSaveError('Failed to save — changes not persisted.');
      return false;
    } finally {
      setSaving(false);
    }
  }, [path]);

  const handleSourceChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    // Sync the ref immediately — a change flushed during unmount never re-renders,
    // so the unmount save below would otherwise persist stale content.
    contentRef.current = text;
    setContent(text);
    scheduleWordCount(text);
    setSavedAt(null);
    setSaveError(null); // GH#616: editing is a retry — drop the stale error until the next save resolves.
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveContent(text), 800);
  }, [saveContent, scheduleWordCount]);

  const handleRichChange = useCallback((bodyText: string) => {
    // W0.2: Rich mode edits only the display body. The frontmatter block and
    // any %% kanban:settings %% trailer were hidden from the editor — splice
    // them back verbatim so a Rich-mode save never drops or reorders them.
    const text = replaceDisplayBody(contentRef.current, bodyText);
    contentRef.current = text;
    setContent(text);
    scheduleWordCount(text);
    setSavedAt(null);
    setSaveError(null); // GH#616: editing is a retry — drop the stale error until the next save resolves.
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveContent(text), 800);
  }, [saveContent, scheduleWordCount]);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    void saveContent(contentRef.current);
  }, [saveContent]);

  useEffect(() => {
    window.addEventListener('mythos:save-note', flushSave);
    return () => {
      window.removeEventListener('mythos:save-note', flushSave);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        void saveContent(contentRef.current);
      }
    };
  }, [flushSave, saveContent]);

  // M16: the properties/tags panel writes frontmatter to this same file. Sync
  // its result into the open editor so a later autosave doesn't clobber it.
  // If local edits are pending (debounce timer armed), the editor wins.
  const [externalRev, setExternalRev] = useState(0);
  useEffect(() => {
    const onExternalUpdate = (e: Event) => {
      const detail = (e as CustomEvent<{ path: string; content: string }>).detail;
      if (!detail || detail.path !== path) return;
      if (saveTimerRef.current) return; // unsaved local edits — do not overwrite
      if (detail.content === contentRef.current) return;
      contentRef.current = detail.content;
      setContent(detail.content);
      setExternalRev((rev) => rev + 1); // remount rich editor with fresh content
      onWordCountChange?.(countWords(detail.content));
    };
    window.addEventListener('mythos:note-frontmatter-updated', onExternalUpdate);
    return () => window.removeEventListener('mythos:note-frontmatter-updated', onExternalUpdate);
  }, [path, onWordCountChange]);

  // ── M17: frontmatter-backed title + tags (W0.2 engine — never rendered in Rich body) ──

  const noteMeta = useMemo(() => parseNoteFrontmatter(content), [content]);
  const titleField = noteMeta.fields.find((f) => f.key.toLowerCase() === 'title')?.value?.trim();
  const noteTitle = titleField || fileStem;
  const tags = noteMeta.tags;

  // A frontmatter edit (title/tags) is a discrete commit: adopt + save now.
  const adoptFrontmatterChange = useCallback((next: string) => {
    if (next === contentRef.current) return;
    contentRef.current = next;
    setContent(next);
    scheduleWordCount(next);
    setSavedAt(null);
    setSaveError(null);
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    void saveContent(next).then((ok) => {
      if (!ok) return;
      // Keep any other open surface on this note (split pane, properties
      // panel) in sync — same event contract as NoteProperties (M16).
      window.dispatchEvent(new CustomEvent('mythos:note-frontmatter-updated', {
        detail: { path, content: next },
      }));
    });
  }, [path, saveContent, scheduleWordCount]);

  const commitTitle = useCallback(() => {
    const el = titleElRef.current;
    if (!el) return;
    // innerText preferred (prototype noteTitleEdit); jsdom only has textContent.
    const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t || t === noteTitle) {
      el.textContent = noteTitle; // revert empty/unchanged edits (prototype noteTitleEdit)
      return;
    }
    adoptFrontmatterChange(setFrontmatterField(contentRef.current, 'title', t));
  }, [noteTitle, adoptFrontmatterChange]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      (e.target as HTMLElement).textContent = noteTitle;
      (e.target as HTMLElement).blur();
    }
  }, [noteTitle]);

  const commitAddTag = useCallback(() => {
    const tag = tagInput.trim().replace(/^#/, '');
    setTagInput('');
    if (!tag || tags.includes(tag)) return;
    adoptFrontmatterChange(setFrontmatterTags(contentRef.current, [...tags, tag]));
  }, [tagInput, tags, adoptFrontmatterChange]);

  const removeTag = useCallback((tag: string) => {
    adoptFrontmatterChange(setFrontmatterTags(contentRef.current, tags.filter((t) => t !== tag)));
  }, [tags, adoptFrontmatterChange]);

  // ── Mode switching (gear menu) ──

  const handleModeClick = useCallback((next: NoteViewerMode) => {
    setGearOpen(false);
    if (next === mode) return;
    if (next === 'rich') {
      // W0.2: judge fidelity on what Rich mode actually consumes — the display
      // body. Frontmatter/kanban-settings are held aside verbatim, not lost.
      const lossy = detectLossyFeatures(stripHiddenBlocks(contentRef.current));
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

  const toggleDefaultRich = useCallback(() => {
    setDefaultRich((prev) => {
      const next = !prev;
      writeDefaultRichPref(next);
      return next;
    });
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

  const backlinksFooter = stories && onOpenBacklinkNote && onOpenBacklinkScene
    ? { stories, onOpenNote: onOpenBacklinkNote, onOpenScene: onOpenBacklinkScene }
    : null;

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
        {saveError && (
          <span className="note-viewer-save-error" role="alert">
            {saveError}{' '}
            <button
              type="button"
              className="note-viewer-save-retry"
              onClick={flushSave}
            >
              Retry
            </button>
          </span>
        )}
        {/* M17: gear menu — prototype "View options" popover (VIEW AS seg +
            always-open-rich toggle) replaces the always-visible mode row. */}
        <div className="note-gear-wrap">
          <button
            type="button"
            className={`note-gear-btn${gearOpen ? ' note-gear-btn--open' : ''}`}
            aria-label="View options"
            aria-haspopup="menu"
            aria-expanded={gearOpen}
            data-testid="note-gear-btn"
            onClick={() => setGearOpen((o) => !o)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M4.5 7.5h15M4.5 16.5h15" />
              <circle cx="9.5" cy="7.5" r="2.4" />
              <circle cx="14.5" cy="16.5" r="2.4" />
            </svg>
          </button>
          {gearOpen && (
            <>
              <div className="note-gear-backdrop" onClick={() => setGearOpen(false)} />
              <div
                className="note-gear-menu"
                role="menu"
                aria-label="View options"
                data-testid="note-gear-menu"
                onKeyDown={(e) => { if (e.key === 'Escape') setGearOpen(false); }}
              >
                <div className="note-gear-heading" aria-hidden="true">VIEW AS</div>
                <div className="note-mode-group" role="group" aria-label="Editor mode">
                  {GEAR_MODES.map(({ mode: m, label }) => (
                    <button
                      key={m}
                      type="button"
                      role="menuitemradio"
                      aria-checked={mode === m}
                      className={`note-viewer-mode${mode === m ? ' active' : ''}`}
                      data-testid={`note-gear-mode-${m}`}
                      onClick={() => handleModeClick(m)}
                    >
                      <span className="note-gear-dot" aria-hidden="true" />
                      {label}
                    </button>
                  ))}
                </div>
                <div className="note-gear-divider" aria-hidden="true" />
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={defaultRich}
                  className="note-gear-toggle-row"
                  data-testid="note-default-rich-toggle"
                  onClick={toggleDefaultRich}
                >
                  <span className="note-gear-toggle-label">Always open notes in Rich view</span>
                  <span className={`note-gear-pill${defaultRich ? ' on' : ''}`} aria-hidden="true">
                    <span className="note-gear-knob" />
                  </span>
                </button>
              </div>
            </>
          )}
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

      {/* M17: note header — editable Lora title + tag chips with add input.
          Both are frontmatter-backed (W0.2 shared engine, never in Rich body). */}
      <div className="note-header" data-testid="note-header">
        <div className="note-header-row">
          <div className="note-header-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--n1, #00f0ff)" strokeWidth="1.7" strokeLinecap="round">
              <path d="M12 3v18M3 12h18" />
              <circle cx="12" cy="12" r="3.6" />
            </svg>
          </div>
          <span
            ref={titleElRef}
            key={`${noteTitle}:${externalRev}`}
            className="note-title"
            role="textbox"
            aria-label="Note title"
            data-testid="note-title"
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            onBlur={commitTitle}
            onKeyDown={handleTitleKeyDown}
          >
            {noteTitle}
          </span>
        </div>
        <div className="note-tags-row" data-testid="note-tags-row">
          {tags.map((tag) => {
            const c = tagColor(tag);
            return (
              <span
                key={tag}
                className="note-tag-chip"
                data-testid={`note-header-tag-${tag}`}
                style={{ color: c, borderColor: hexA(c, 0.5), background: hexA(c, 0.1), boxShadow: `0 0 10px -3px ${hexA(c, 0.3)}` }}
              >
                {tag}
                <button
                  type="button"
                  className="note-tag-remove"
                  aria-label={`Remove tag ${tag}`}
                  onClick={() => removeTag(tag)}
                >
                  ×
                </button>
              </span>
            );
          })}
          <input
            className="note-add-tag-input"
            placeholder="Add tag…"
            aria-label="Add tag"
            data-testid="note-add-tag-input"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitAddTag(); }}
          />
        </div>
      </div>

      {mode === 'source' && (
        <div className="note-viewer-editor-pane">
          <div className="note-mode-banner note-mode-banner--source" data-testid="note-mode-banner-source">
            <span className="note-mode-banner-dot" aria-hidden="true" />
            Source mode — frontmatter + markup, no rendering
          </div>
          <textarea
            className="note-viewer-editor note-viewer-editor--source"
            value={content}
            onChange={handleSourceChange}
            aria-label={`Edit note: ${fileName}`}
            spellCheck
          />
        </div>
      )}

      {mode === 'markdown' && (
        <div className="note-viewer-editor-pane">
          <div className="note-mode-banner note-mode-banner--markdown" data-testid="note-mode-banner-markdown">
            <span className="note-mode-banner-dot" aria-hidden="true" />
            Markdown view — the raw file, editable
          </div>
          <textarea
            className="note-viewer-editor note-viewer-editor--markdown"
            value={content}
            onChange={handleSourceChange}
            aria-label={`Edit note: ${fileName}`}
            spellCheck
          />
        </div>
      )}

      {mode === 'rich' && (
        <NoteRichEditor
          key={`${path}:${externalRev}`}
          // W0.2 (FULL-SPEC §6): frontmatter + kanban-settings never render in
          // Rich view — the hidden chunks are re-attached in handleRichChange.
          content={stripHiddenBlocks(content)}
          onChange={handleRichChange}
          onWikiLinkClick={onWikiLinkClick}
          resolvedWikiLinkTitles={resolvedWikiLinkTitles}
          sceneWikiLinkTitles={sceneWikiLinkTitles}
          wikiLinkCandidates={wikiLinkCandidates}
          fileName={fileName}
        />
      )}

      {mode === 'preview' && (
        <div className="note-viewer-preview" data-testid="note-viewer-preview">
          {renderMarkdownPreview(content, onWikiLinkClick, resolvedWikiLinkTitles, sceneWikiLinkTitles)}
        </div>
      )}

      {/* M17: backlinks footer — lives in the note body (the right panel is
          owned by M15/M18; see BETA-REFINE M17). */}
      {backlinksFooter && (
        <div className="note-backlinks-footer" data-testid="note-backlinks-footer">
          <Backlinks
            notePath={path}
            stories={backlinksFooter.stories}
            onOpenNote={backlinksFooter.onOpenNote}
            onOpenScene={backlinksFooter.onOpenScene}
          />
        </div>
      )}
    </div>
  );
}
