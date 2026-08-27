// SKY-204 / SKY-3208 / SKY-3624: Notes editor — Rich (TipTap) / Markdown /
// Source views, plus a legacy read-only Preview (Ctrl+E) kept for compat.
// W0.2 (Beta 4): frontmatter and %% kanban:settings %% trailers never render in
// Rich or Preview — they are held aside verbatim and reassembled on save.
// Markdown and Source modes keep showing the raw file (FULL-SPEC §6).
// M17 (Beta 4 "Refine"): editable Lora title + tag chips (frontmatter-backed),
// gear menu → Rich/Markdown/Source seg + always-open-rich toggle, purple
// callout cards + links block in Rich mode, and a backlinks footer.
import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { countWords, countChars } from './wordStats';
import { detectLossyFeatures, type LossyFeature } from './notesFidelityGuard';
import { normalize, wikiLinkTargetStem, type WikiLinkCandidate } from './crossTabLinkResolver';
import { replaceDisplayBody, stripHiddenBlocks } from './lib/frontmatter';
import { parseNoteFrontmatter, setFrontmatterField, setFrontmatterTags } from './noteFrontmatter';
import { NoteCallout } from './NoteCalloutExtension';
import { NoteLinksBlock } from './NoteLinksBlockExtension';
import RichTextEditor from './RichTextEditor';
import type { FormatToolbarActions } from './FormatToolbar';
import { showLnToast } from './theme/lnToast';
import type { AnyExtension } from '@tiptap/core';
import './NoteViewer.css';

export type NoteViewerMode = 'source' | 'rich' | 'markdown' | 'preview';

interface Props {
  path: string;
  /** 'rich' (TipTap) | 'markdown' (raw, editable) | 'source' (raw, editable) | legacy 'preview'. */
  // dead-wiring-ignore: SKY-10926 — the gear-menu "VIEW AS" seg (GEAR_MODES,
  // handleModeClick) already switches rich/markdown/source via NoteViewer's
  // own `mode` state on every render path, uncontrolled by this prop or by
  // `onModeChange`; no caller-side UI is gated behind either. `mode` /
  // `onModeChange` are a forward-compatible controlled-component API for a
  // future caller that wants to own/observe the mode externally (mirroring
  // the deprecated `previewMode`/`onPreviewModeChange` pair one level up in
  // richness) — real callers (DesktopShell, NotesTabPanel, NoteSplitPane)
  // still only need the legacy preview boolean today. Migrating them is out
  // of scope for this finding; see SKY-10926.
  mode?: NoteViewerMode;
  // dead-wiring-ignore: SKY-10926 — see rationale on `mode` above.
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
  /** @deprecated Use `mode` + `onModeChange`. Kept for callers that have not migrated. */
  previewMode?: boolean;
  /** @deprecated Use `mode` + `onModeChange`. */
  onPreviewModeChange?: (previewMode: boolean) => void;
  /** M8d: Read/Dictate toolbar buttons (prototype toolbar 1532-1538) — reuses
   * the app's existing TTS/voice pipeline (R11: utility, not AI). */
  toolbarActions?: FormatToolbarActions;
}

// ---------------------------------------------------------------------------
// M17: "always open rich" preference (gear menu toggle)
// ---------------------------------------------------------------------------

export const NOTES_DEFAULT_RICH_KEY = 'mythos:notes:defaultRich';
// SKY-10929: per-note sticky view mode — once a note has been explicitly
// switched, it reopens in that mode regardless of the global default below.
export const NOTES_MODE_BY_PATH_KEY = 'mythos:notes:modeByPath';
type StickyMode = 'rich' | 'markdown' | 'source';

function readDefaultRichPref(): boolean {
  try {
    // SKY-10929: Rich is the out-of-the-box default — an explicit '0' is the
    // only way to opt out (readMissing → true), matching the toggle default.
    return window.localStorage.getItem(NOTES_DEFAULT_RICH_KEY) !== '0';
  } catch {
    return true;
  }
}

function writeDefaultRichPref(on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(NOTES_DEFAULT_RICH_KEY);
    else window.localStorage.setItem(NOTES_DEFAULT_RICH_KEY, '0');
  } catch {
    // storage unavailable — the toggle still works for this session
  }
}

function readNoteModePref(path: string): StickyMode | null {
  try {
    const raw = window.localStorage.getItem(NOTES_MODE_BY_PATH_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, StickyMode>;
    return map[path] ?? null;
  } catch {
    return null;
  }
}

function writeNoteModePref(path: string, mode: StickyMode): void {
  try {
    const raw = window.localStorage.getItem(NOTES_MODE_BY_PATH_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, StickyMode>) : {};
    map[path] = mode;
    window.localStorage.setItem(NOTES_MODE_BY_PATH_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable — the choice still works for this session
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
// M8d: "Edited N ago ✓" badge (prototype 1478-1480) — relative phrasing off
// the same savedAt timestamp the existing "Saved HH:MM:SS" status already uses.
// ---------------------------------------------------------------------------

export function formatEditedAgo(savedAt: Date): string {
  const mins = Math.floor((Date.now() - savedAt.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
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
  toolbarActions?: FormatToolbarActions;
}

// Thin wrapper over the shared core (SKY-3204): Notes rich mode gets the same
// base extensions (including Underline) and entity @-mention picker as Story.
function NoteRichEditor({ content, onChange, onWikiLinkClick, resolvedWikiLinkTitles, sceneWikiLinkTitles, wikiLinkCandidates, fileName, toolbarActions }: RichEditorProps) {
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
        toolbarActions={toolbarActions}
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
  previewMode,
  onPreviewModeChange,
  toolbarActions,
}: Props) {
  const [defaultRich, setDefaultRich] = useState(readDefaultRichPref);
  // SKY-10929: this note's own remembered mode, if it was ever explicitly
  // switched — takes priority over the global default below.
  const stickyMode = useMemo(() => readNoteModePref(path), [path]);

  // Resolve mode from new prop, legacy previewMode bool, this note's sticky
  // choice, or the M17 "always open rich" default (Rich unless opted out).
  const resolvedMode: NoteViewerMode =
    modeProp ?? (previewMode ? 'preview' : (stickyMode ?? (defaultRich ? 'rich' : 'source')));
  const [mode, setMode] = useState<NoteViewerMode>(resolvedMode);
  // True while the initial mode came from the default (not an explicit prop
  // or a remembered per-note choice) — the fidelity guard then downgrades
  // silently on load rather than risk a surprise data loss (CF-11).
  const pendingPrefRichRef = useRef(modeProp === undefined && !previewMode && !stickyMode && resolvedMode === 'rich');

  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
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
  // M8d: header "+" tag affordance focuses the footer's real Add-tag input
  // (prototype's "+" chip carries no handler of its own — see 1516/1605).
  const footerTagInputRef = useRef<HTMLInputElement | null>(null);

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
      setSavedAt(new Date());
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

  // SKY-10712: a note rename cascade rewrote [[links]] in files on disk —
  // possibly this one. Re-read and adopt so a later autosave doesn't clobber
  // the rewrite. Same guard as above: pending local edits win.
  useEffect(() => {
    const onLinksRewritten = async (e: Event) => {
      const detail = (e as CustomEvent<{ changedNotesPaths?: string[] }>).detail;
      if (!detail?.changedNotesPaths?.includes(path)) return;
      if (saveTimerRef.current) return; // unsaved local edits — do not overwrite
      const res = await window.api.readNotesVault(path);
      if (!res || 'error' in res) return; // renamed/moved — tab retarget handles it
      if (saveTimerRef.current || res.content === contentRef.current) return;
      contentRef.current = res.content;
      setContent(res.content);
      setExternalRev((rev) => rev + 1);
      onWordCountChange?.(countWords(res.content));
    };
    window.addEventListener('mythos:vault-links-rewritten', onLinksRewritten);
    return () => window.removeEventListener('mythos:vault-links-rewritten', onLinksRewritten);
  }, [path, onWordCountChange]);

  // ── M17: frontmatter-backed title + tags (W0.2 engine — never rendered in Rich body) ──

  const noteMeta = useMemo(() => parseNoteFrontmatter(content), [content]);
  const titleField = noteMeta.fields.find((f) => f.key.toLowerCase() === 'title')?.value?.trim();
  const noteTitle = titleField || fileStem;
  const tags = noteMeta.tags;

  // M8d: breadcrumb (prototype 1472-1480 `noteCrumbs`) — vault-relative folder
  // path with the note title as the final, bold crumb.
  const breadcrumbItems = useMemo(() => {
    const folders = path.split('/').filter(Boolean).slice(0, -1);
    return [...folders, noteTitle];
  }, [path, noteTitle]);

  // M8d: footer word/character counts (prototype `noteWords`/`noteChars`) —
  // computed off the display body, same as the fidelity guard (frontmatter
  // and any kanban-settings trailer never count toward either).
  const displayBody = useMemo(() => stripHiddenBlocks(content), [content]);
  const bodyWordCount = useMemo(() => countWords(displayBody), [displayBody]);
  const bodyCharCount = useMemo(() => countChars(displayBody), [displayBody]);

  // SKY-10929: the app is 100% local — there is nothing to "share". This
  // copies the note path (kept as a utility, moved off the primary toolbar
  // and into the View options menu so it never reads as cloud sharing).
  const handleCopyPath = useCallback(() => {
    void navigator.clipboard.writeText(path)
      .then(() => showLnToast('Note path copied to clipboard'))
      .catch(() => showLnToast('Could not copy the note path'));
  }, [path]);

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
    // SKY-10929: an explicit gear-menu switch is sticky for this note.
    // (GEAR_MODES only offers rich/markdown/source — never 'preview'.)
    if (next !== 'preview') writeNoteModePref(path, next);
    applyMode(next);
  }, [mode, path, applyMode]);

  const handleFidelityEditInSource = useCallback(() => {
    setFidelityWarning(null);
    setPendingMode(null);
    writeNoteModePref(path, 'source');
    applyMode('source');
  }, [path, applyMode]);

  const handleFidelityOpenAnyway = useCallback(() => {
    setFidelityWarning(null);
    const next = pendingMode ?? 'rich';
    setPendingMode(null);
    if (next !== 'preview') writeNoteModePref(path, next);
    applyMode(next);
  }, [pendingMode, path, applyMode]);

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
        {/* M8d: breadcrumb (prototype `noteCrumbs`) — folder path + note title. */}
        <nav className="note-breadcrumb" aria-label="Note path" data-testid="note-breadcrumb">
          {breadcrumbItems.map((crumb, i) => (
            <span
              key={i}
              className={`note-breadcrumb-item${i === breadcrumbItems.length - 1 ? ' note-breadcrumb-item--current' : ''}`}
            >
              {i > 0 && <span className="note-breadcrumb-sep" aria-hidden="true">/</span>}
              {crumb}
            </span>
          ))}
        </nav>
        <span className="note-viewer-save-status" aria-live="polite">
          {saving ? 'Saving…' : savedAt ? `Saved ${savedAt.toLocaleTimeString()}` : ''}
        </span>
        {/* M8d: "Edited N ago ✓" (prototype 1478-1480) — hidden while a save
            error is showing so the surface never implies a clean save. */}
        {savedAt && !saveError && (
          <span className="note-edited-badge" data-testid="note-edited-badge">
            Edited {formatEditedAgo(savedAt)}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M8.5 12.5l2.5 2.5 4.5-5" />
            </svg>
          </span>
        )}
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
                <div className="note-gear-divider" aria-hidden="true" />
                {/* SKY-10929: the app is 100% local — this only copies the
                    note's vault-relative path, never a primary "Share" action. */}
                <button
                  type="button"
                  role="menuitem"
                  className="note-viewer-mode"
                  data-testid="note-copy-path-btn"
                  onClick={() => { setGearOpen(false); handleCopyPath(); }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="7" y="7" width="12" height="14" rx="2" />
                    <path d="M5 15V4a1 1 0 0 1 1-1h9" />
                  </svg>
                  Copy path
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
          {/* M8d: decorative favorite toggle (prototype 1512) — same unwired
              pattern as the Story editor's DocHeader star; no favorites data
              model exists yet to persist against. */}
          <button
            type="button"
            className="note-star-btn"
            data-testid="note-star-btn"
            aria-label="Toggle favorite"
            title="Add to favorites"
          >
            ☆
          </button>
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
          <button
            type="button"
            className="note-tag-add-btn"
            data-testid="note-tag-add-btn"
            aria-label="Add tag"
            title="Add tag"
            onClick={() => footerTagInputRef.current?.focus()}
          >
            +
          </button>
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
          toolbarActions={toolbarActions}
        />
      )}

      {mode === 'preview' && (
        <div className="note-viewer-preview" data-testid="note-viewer-preview">
          {renderMarkdownPreview(content, onWikiLinkClick, resolvedWikiLinkTitles, sceneWikiLinkTitles)}
        </div>
      )}

      {/* M8d: footer word/character counts + Add-tag input (prototype 1602-1606). */}
      <div className="note-footer" data-testid="note-footer">
        <span data-testid="note-word-count">{bodyWordCount.toLocaleString()} words</span>
        <span className="note-footer-sep" aria-hidden="true">·</span>
        <span data-testid="note-char-count">{bodyCharCount.toLocaleString()} characters</span>
        <div className="note-footer-spacer" />
        <input
          ref={footerTagInputRef}
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
  );
}
