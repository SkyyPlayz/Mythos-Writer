import { useRef, useState, useEffect, useCallback } from 'react';
import type { Editor } from '@tiptap/core';
import type { Block, Scene, DraftState, EntityEntry } from './types';
import { WikiLinkHintExtension, WIKI_LINK_HINT_META, type WLSuggestion } from './WikiLinkHintExtension';
import type { WikiLinkCandidate } from './crossTabLinkResolver';
import {
  AutoLinkerExtension,
  AUTO_LINKER_META,
  getAutoLinkerState,
  collectAutoLinkerRanges,
  type AutoLinkerMode,
} from './AutoLinkerExtension';
import { countWords } from './wordStats';
import { getEditorMarkdown } from './lib/useRichEditor';
import RichTextEditor from './RichTextEditor';
import type { FormatToolbarActions } from './FormatToolbar';
import { HeadingFocusExtension } from './HeadingFocusExtension';
import { levelsPresent, focusState, stepFocus, headingsAtLevel, reconcileFocusLevel } from './lib/headingFocus';
import './BlockEditor.css';

export interface BlockEditorApi {
  jumpToText: (text: string) => void;
  insertWikiLink: (link: string, anchorText: string) => void;
  /** Return the editor's current Markdown without waiting for the debounced scene state sync. */
  getMarkdown: () => string;
  /** Apply all current auto-linker suggestions as a single undoable transaction. */
  applyAutoLinks: () => void;
  /** Insert plain text at the current cursor position (used by voice transcript). */
  insertText: (text: string) => void;
  focus: () => void;
}

interface Props {
  scene: Scene;
  onBlocksChange: (blocks: Block[]) => void;
  onDraftStateChange: (state: DraftState) => void;
  onEditorReady?: (api: BlockEditorApi) => void;
  /** Called when user triggers Beta-Read on a selection. */
  onBetaReadRequest?: (selectedText: string) => void;
  /** Archive wiki-link suggestions to highlight inline. */
  wikiLinkSuggestions?: WLSuggestion[];
  onAcceptWikiLink?: (id: string, link: string, anchorText: string) => void;
  onRejectWikiLink?: (id: string) => void;
  /** SKY-192: entity list for the auto-linker decoration layer. */
  autoLinkerEntities?: EntityEntry[];
  /** SKY-192: auto-linker mode. Defaults to 'suggest'. */
  autoLinkerMode?: AutoLinkerMode;
  /** SKY-130: ProseMirror document position to restore on mount. 0 or undefined = top. */
  initialCursorPos?: number;
  /** SKY-130: debounced callback reporting cursor position changes for session persistence. */
  onCursorPosChange?: (pos: number) => void;
  /** SKY-1188: post-onboarding guidance copy for blank scenes. */
  emptySceneHint?: string;
  /** SKY-616: called when user clicks an @-entity chip to navigate to that entity. */
  onEntityClick?: (entityId: string) => void;
  /** SKY-2099: called when user clicks a [[typed wiki link]]. */
  onWikiLinkClick?: (target: string) => void;
  /** SKY-5702: resolvable note/story titles, for unresolved [[link]] styling. */
  resolvedWikiLinkTitles?: ReadonlySet<string>;
  /** SKY-5702: cross-vault candidate list for the [[ autocomplete popup. */
  wikiLinkCandidates?: WikiLinkCandidate[];
  /** SKY-2011: called when the editor selection changes, debounced by TipTap's onSelectionUpdate. */
  onSelectionChange?: (text: string) => void;
  /** When false, suppress Tiptap's autofocus on mount (used in multi-editor views like ChapterContinuousView). */
  autoFocus?: boolean;
  /** GH #631: show the heading-focus control (H1–H6 section view splitting). Single-scene view only. */
  enableHeadingFocus?: boolean;
  /** Beta 3 M10: optional Read/Dictate/Assist toolbar buttons (prototype 766–777). */
  toolbarActions?: FormatToolbarActions;
}

const DRAFT_STATE_LABELS: Record<DraftState, string> = {
  'in-progress': 'In Progress',
  review: 'Review',
  final: 'Final',
};

/** Story-only extensions layered onto the shared RichTextEditor core. */
const STORY_EXTENSIONS = [WikiLinkHintExtension, AutoLinkerExtension, HeadingFocusExtension];

// Block.type === 'heading' carries no dedicated level field — a heading's level
// (H1–H6) lives in its own leading `#` run inside `content` (e.g. "## Chapter Two"),
// the same way every other Markdown source in this app represents it. Preserve
// that run verbatim so headings survive the legacy Block[] snapshot/restore path
// at the level they were written; only fall back to H1 when content carries no
// heading marker at all (e.g. bare heading text with no `#` prefix).
const HEADING_PREFIX_RE = /^#{1,6}(?=\s|$)/;

export function blocksToMarkdownBody(blocks: Block[]): string {
  const sorted = [...blocks].sort((a, b) => a.order - b.order);
  const lines: string[] = [];
  for (const block of sorted) {
    if (!block.content.trim()) continue;
    switch (block.type) {
      case 'heading':
        lines.push(HEADING_PREFIX_RE.test(block.content) ? block.content : `# ${block.content}`);
        break;
      case 'dialogue': lines.push(`> ${block.content}`); break;
      case 'action': lines.push(`**${block.content}**`); break;
      case 'description': lines.push(`*${block.content}*`); break;
      case 'note': lines.push(`<!-- ${block.content} -->`); break;
      default: lines.push(block.content);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

const WC_DEBOUNCE_MS = 250;

export default function BlockEditor({ scene, onBlocksChange, onDraftStateChange, onEditorReady, onBetaReadRequest, wikiLinkSuggestions, onAcceptWikiLink, onRejectWikiLink, autoLinkerEntities, autoLinkerMode, initialCursorPos, onCursorPosChange, emptySceneHint = 'Start typing to begin.', onEntityClick, onWikiLinkClick, resolvedWikiLinkTitles, wikiLinkCandidates, onSelectionChange, autoFocus = true, enableHeadingFocus = false, toolbarActions }: Props) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [draftState, setDraftState] = useState<DraftState>(scene.draftState ?? 'in-progress');
  const [wordCount, setWordCount] = useState<number>(() =>
    scene.blocks.reduce((sum, b) => sum + countWords(b.content), 0)
  );
  const wcDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectionText, setSelectionText] = useState<string>('');
  const [isEditorEmpty, setIsEditorEmpty] = useState(() => blocksToMarkdownBody(scene.blocks).trim().length === 0);
  const [betaReadBubble, setBetaReadBubble] = useState<{ top: number; left: number } | null>(null);
  const [hintTooltip, setHintTooltip] = useState<{
    id: string; link: string; anchor: string; top: number; left: number;
  } | null>(null);

  const onAcceptWikiLinkRef = useRef(onAcceptWikiLink);
  onAcceptWikiLinkRef.current = onAcceptWikiLink;
  const onRejectWikiLinkRef = useRef(onRejectWikiLink);
  onRejectWikiLinkRef.current = onRejectWikiLink;
  const autoLinkerModeRef = useRef(autoLinkerMode);
  autoLinkerModeRef.current = autoLinkerMode;
  // Flag to break the auto-link → onUpdate → auto-link cycle
  const applyingAutoLinksRef = useRef(false);
  const onBlocksChangeRef = useRef(onBlocksChange);
  onBlocksChangeRef.current = onBlocksChange;
  const blockIdRef = useRef(scene.blocks[0]?.id ?? crypto.randomUUID());
  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;
  const onBetaReadRef = useRef(onBetaReadRequest);
  onBetaReadRef.current = onBetaReadRequest;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const editorWrapRef = useRef<HTMLDivElement | null>(null);
  // SKY-130: cursor tracking refs
  const onCursorPosChangeRef = useRef(onCursorPosChange);
  onCursorPosChangeRef.current = onCursorPosChange;
  const cursorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEditorUpdate = useCallback((ed: Editor) => {
    setIsEditorEmpty(ed.isEmpty);
    // Word count: debounced at 250ms so typing stays smooth
    if (wcDebounceRef.current) clearTimeout(wcDebounceRef.current);
    wcDebounceRef.current = setTimeout(() => {
      setWordCount(countWords(getEditorMarkdown(ed)));
    }, WC_DEBOUNCE_MS);
  }, []);

  // Auto on save: apply all auto-linker suggestions as a single transaction just
  // before the debounced flush serializes. The applyingAutoLinksRef flag prevents
  // the resulting onUpdate from triggering a second application cycle.
  const handleBeforeFlush = useCallback((ed: Editor) => {
    if (autoLinkerModeRef.current !== 'auto' || applyingAutoLinksRef.current) return;
    const linkerState = getAutoLinkerState(ed.state);
    if (!linkerState || linkerState.entities.length === 0) return;
    const ranges = collectAutoLinkerRanges(ed.state.doc, linkerState.entities);
    if (ranges.length === 0) return;
    applyingAutoLinksRef.current = true;
    const sorted = [...ranges].sort((a, b) => b.from - a.from);
    let tr = ed.state.tr;
    for (const r of sorted) {
      const wikiNode = ed.schema.nodes['wikiLink']?.create({ target: r.target });
      if (wikiNode) tr = tr.replaceWith(r.from, r.to, wikiNode);
    }
    ed.view.dispatch(tr);
    applyingAutoLinksRef.current = false;
  }, []);

  const handleChangeMarkdown = useCallback((markdown: string) => {
    onBlocksChangeRef.current([{
      id: blockIdRef.current,
      type: 'prose',
      content: markdown,
      order: 0,
      updatedAt: new Date().toISOString(),
    }]);
  }, []);

  const handleSelectionUpdate = useCallback((ed: Editor) => {
    const { from, to } = ed.state.selection;
    const text = from === to ? '' : ed.state.doc.textBetween(from, to, ' ');
    const trimmed = text.trim();
    setSelectionText(trimmed);
    onSelectionChangeRef.current?.(trimmed);
    if (trimmed.length > 3 && editorWrapRef.current) {
      // Position the bubble relative to the editorWrap using the native selection
      const nativeSel = window.getSelection();
      if (nativeSel && nativeSel.rangeCount > 0) {
        const range = nativeSel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const wrapRect = editorWrapRef.current.getBoundingClientRect();
        setBetaReadBubble({
          top: rect.top - wrapRect.top - 36,
          left: Math.max(0, rect.left - wrapRect.left + rect.width / 2 - 52),
        });
      } else {
        setBetaReadBubble(null);
      }
    } else {
      setBetaReadBubble(null);
    }
    // SKY-130: debounced cursor position reporting for session persistence
    if (cursorDebounceRef.current) clearTimeout(cursorDebounceRef.current);
    cursorDebounceRef.current = setTimeout(() => {
      onCursorPosChangeRef.current?.(from);
    }, 500);
  }, []);

  // Expose jump-to-text and insert-wiki-link APIs to the parent once the editor is ready
  useEffect(() => {
    if (!editor) return;
    const focusEditor = () => {
      if (!editor) return;
      // TipTap nulls commandManager during destroy() before React can re-render
      // the ref to null; guard against the destroyed-but-non-null editor case.
      try {
        editor.chain().focus(initialCursorPos && initialCursorPos > 0 ? Math.max(1, initialCursorPos) : 'end').run();
      } catch (_) { /* editor destroyed between render and effect */ }
    };
    const focusTimer = autoFocus ? setTimeout(focusEditor, 0) : undefined;
    const cb = onEditorReadyRef.current;
    if (!cb) return () => { if (focusTimer !== undefined) clearTimeout(focusTimer); };

    const findTextRange = (text: string): { from: number; to: number } | null => {
      const needle = text.toLowerCase();
      let result: { from: number; to: number } | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (result) return false;
        if (node.isText && node.text) {
          const idx = node.text.toLowerCase().indexOf(needle);
          if (idx >= 0) {
            result = { from: pos + idx, to: pos + idx + text.length };
          }
        }
        return true;
      });
      return result;
    };

    cb({
      jumpToText: (text: string) => {
        const range = findTextRange(text);
        if (range) {
          editor.commands.setTextSelection(range);
          editor.commands.scrollIntoView();
        }
      },
      insertWikiLink: (link: string, anchorText: string) => {
        // Extract target from [[target]] and create a proper WikiLink node so
        // tiptap-markdown serialises it as [[target]] (not as escaped \[\[target\]\]).
        // insertContent(string) inserts plain text which tiptap-markdown escapes.
        const target = link.replace(/^\[\[|\]\]$/g, '');
        const wikiNode = editor.schema.nodes['wikiLink']?.create({ target });
        if (!wikiNode) return;
        const range = findTextRange(anchorText);
        if (range) {
          editor.view.dispatch(editor.state.tr.replaceWith(range.from, range.to, wikiNode));
        } else {
          editor.chain().focus().command(({ tr, dispatch }) => {
            if (dispatch) dispatch(tr.insert(tr.selection.from, wikiNode));
            return true;
          }).run();
        }
      },
      getMarkdown: () => getEditorMarkdown(editor),
      applyAutoLinks: () => {
        const linkerState = getAutoLinkerState(editor.state);
        if (!linkerState || linkerState.mode === 'off') return;
        const ranges = collectAutoLinkerRanges(editor.state.doc, linkerState.entities);
        if (ranges.length === 0) return;
        const sorted = [...ranges].sort((a, b) => b.from - a.from);
        let tr = editor.state.tr;
        for (const r of sorted) {
          const wikiNode = editor.schema.nodes['wikiLink']?.create({ target: r.target });
          if (wikiNode) tr = tr.replaceWith(r.from, r.to, wikiNode);
        }
        editor.view.dispatch(tr);
      },
      insertText: (text: string) => {
        editor.chain().focus().insertContent(text).run();
      },
      focus: focusEditor,
    });
    return () => { if (focusTimer !== undefined) clearTimeout(focusTimer); };
  // Run only when the editor instance changes (new scene key causes remount)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // SKY-130: restore cursor position on mount from cross-restart session state.
  // initialCursorPos is fixed for the scene's lifetime (BlockEditor remounts per key).
  useEffect(() => {
    if (!editor || !initialCursorPos || initialCursorPos <= 0) return;
    const timer = setTimeout(() => {
      try {
        const docSize = editor.state.doc.nodeSize - 2;
        const clamped = Math.max(1, Math.min(initialCursorPos, docSize));
        editor.commands.setTextSelection({ from: clamped, to: clamped });
        editor.commands.scrollIntoView();
      } catch {
        // Out-of-range positions are silently ignored
      }
    }, 50);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Push updated wiki-link hint suggestions into the ProseMirror plugin
  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(WIKI_LINK_HINT_META, wikiLinkSuggestions ?? [])
    );
  }, [editor, wikiLinkSuggestions]);

  // Push updated auto-linker entities + mode into the AutoLinker plugin
  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(AUTO_LINKER_META, {
        entities: autoLinkerEntities ?? [],
        mode: autoLinkerMode ?? 'suggest',
      })
    );
  }, [editor, autoLinkerEntities, autoLinkerMode]);

  // SKY-130 / SKY-5087: the shared core flushes the pending content debounce on
  // unmount; clear the wrapper-owned cursor + word-count debounces here.
  useEffect(() => {
    return () => {
      if (cursorDebounceRef.current) clearTimeout(cursorDebounceRef.current);
      if (wcDebounceRef.current) clearTimeout(wcDebounceRef.current);
    };
  }, []);

  const handleHintMouseOver = useCallback((e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('.archive-wl-hint') as HTMLElement | null;
    if (!el || !editorWrapRef.current) return;
    const rect = el.getBoundingClientRect();
    const wrapRect = editorWrapRef.current.getBoundingClientRect();
    setHintTooltip({
      id: el.dataset.wlId ?? '',
      link: el.dataset.wlLink ?? '',
      anchor: el.dataset.wlAnchor ?? '',
      top: rect.bottom - wrapRect.top + 6,
      left: rect.left - wrapRect.left,
    });
  }, []);

  const handleHintMouseLeave = useCallback((e: React.MouseEvent) => {
    const related = e.relatedTarget;
    if (related instanceof Element && related.closest('.wl-hint-tooltip')) return;
    setHintTooltip(null);
  }, []);

  const handleDraftChange = (state: DraftState) => {
    setDraftState(state);
    onDraftStateChange(state);
  };

  // GH #631: heading-focus state. Level/index live here; the extension's
  // plugin renders the hide-decorations and re-clamps on document edits. The
  // level list and step state are derived per render — the word-count
  // debounce already re-renders during typing, keeping them fresh.
  const [hf, setHf] = useState<{ level: number | null; index: number }>({ level: null, index: 0 });
  const headingLevelOptions = enableHeadingFocus && editor ? levelsPresent(editor.state.doc) : [];
  const hfStep = enableHeadingFocus && editor && hf.level !== null
    ? focusState(editor.state.doc, hf.level, hf.index)
    : null;

  // SKY-5902: if edits remove the last Hn heading the user is focused on,
  // headingLevelOptions drops that level but `hf.level` doesn't — the
  // <select> would then hold a value with no matching <option>. Snap back
  // to "All" so the control and the document stay in sync.
  useEffect(() => {
    const next = reconcileFocusLevel(hf, headingLevelOptions);
    if (next !== hf) {
      setHf(next);
      editor?.commands.clearHeadingFocus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, hf, headingLevelOptions.join(',')]);

  const jumpToFocusHeading = useCallback((ed: Editor, level: number, index: number) => {
    const h = headingsAtLevel(ed.state.doc, level)[index];
    if (h) ed.chain().setTextSelection(h.pos + 1).scrollIntoView().run();
  }, []);

  const handleFocusLevelChange = useCallback((value: string) => {
    if (!editor) return;
    if (value === 'all') {
      setHf({ level: null, index: 0 });
      editor.commands.clearHeadingFocus();
      return;
    }
    const level = Number(value);
    setHf({ level, index: 0 });
    editor.commands.setHeadingFocus(level, 0);
    jumpToFocusHeading(editor, level, 0);
  }, [editor, jumpToFocusHeading]);

  const handleFocusStep = useCallback((direction: 'prev' | 'next') => {
    if (!editor || hf.level === null) return;
    const next = stepFocus(editor.state.doc, hf.level, hf.index, direction);
    setHf({ level: hf.level, index: next.index });
    editor.commands.setHeadingFocus(hf.level, next.index);
    jumpToFocusHeading(editor, hf.level, next.index);
  }, [editor, hf, jumpToFocusHeading]);

  const handleBetaReadClick = useCallback(() => {
    if (!selectionText) return;
    onBetaReadRef.current?.(selectionText);
    setBetaReadBubble(null);
    setSelectionText('');
    editor?.commands.setTextSelection(editor.state.selection.from);
  }, [selectionText, editor]);

  return (
    <div className="block-editor">
      <div className="block-editor-toolbar">
        <span className="scene-name">{scene.title}</span>
        {wordCount > 0 && (
          <span className="be-wordcount" aria-label={`${wordCount.toLocaleString()} words`}>
            {wordCount.toLocaleString()} words
          </span>
        )}
        <div className="draft-state-group">
          {(Object.keys(DRAFT_STATE_LABELS) as DraftState[]).map((s) => (
            <button
              key={s}
              className={`draft-btn draft-${s}${draftState === s ? ' active' : ''}`}
              onClick={() => handleDraftChange(s)}
              aria-pressed={draftState === s}
            >
              {DRAFT_STATE_LABELS[s]}
            </button>
          ))}
        </div>
        {/* GH #631: heading-focus — narrow the view to one Hn section; the
            document (and scene version backups) always keep the full text. */}
        {enableHeadingFocus && editor && headingLevelOptions.length > 0 && (
          <div className="heading-focus-group" role="group" aria-label="Heading focus" data-testid="heading-focus-group">
            <select
              className="heading-focus-select"
              aria-label="Heading focus level"
              value={hf.level === null ? 'all' : String(hf.level)}
              onChange={(e) => handleFocusLevelChange(e.target.value)}
            >
              <option value="all">All</option>
              {headingLevelOptions.map((l) => (
                <option key={l} value={String(l)}>H{l}</option>
              ))}
            </select>
            {hf.level !== null && hfStep && hfStep.count > 0 && (
              <>
                <button
                  className="heading-focus-step"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleFocusStep('prev')}
                  disabled={!hfStep.canPrev}
                  aria-label={`Previous H${hf.level} section`}
                >
                  ‹
                </button>
                <span className="heading-focus-pos" aria-live="polite">
                  {hfStep.index + 1}/{hfStep.count}
                </span>
                <button
                  className="heading-focus-step"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleFocusStep('next')}
                  disabled={!hfStep.canNext}
                  aria-label={`Next H${hf.level} section`}
                >
                  ›
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <RichTextEditor
        content={blocksToMarkdownBody(scene.blocks)}
        extraExtensions={STORY_EXTENSIONS}
        autofocus={!autoFocus ? false : (initialCursorPos && initialCursorPos > 0 ? Math.max(1, initialCursorPos) : 'end')}
        onEditorChange={setEditor}
        onUpdate={handleEditorUpdate}
        onSelectionUpdate={handleSelectionUpdate}
        onBeforeFlush={handleBeforeFlush}
        onChangeMarkdown={handleChangeMarkdown}
        onWikiLinkClick={onWikiLinkClick}
        plainTextWikiLinkFallback
        onEntityClick={onEntityClick}
        resolvedWikiLinkTitles={resolvedWikiLinkTitles}
        wikiLinkCandidates={wikiLinkCandidates}
        wrapRef={editorWrapRef}
        toolbarActions={toolbarActions}
        wrapClassName="tiptap-editor-wrap"
        contentClassName="tiptap-content"
        onWrapMouseOver={handleHintMouseOver}
        onWrapMouseLeave={handleHintMouseLeave}
      >
        {hintTooltip && (
          <div
            className="wl-hint-tooltip"
            style={{ top: hintTooltip.top, left: hintTooltip.left }}
            onMouseLeave={() => setHintTooltip(null)}
          >
            <span className="wl-hint-tooltip-link">{hintTooltip.link}</span>
            <button
              className="wl-hint-btn wl-hint-accept"
              onMouseDown={(e) => {
                e.preventDefault();
                onAcceptWikiLinkRef.current?.(hintTooltip.id, hintTooltip.link, hintTooltip.anchor);
                setHintTooltip(null);
              }}
              aria-label={`Accept wiki-link ${hintTooltip.link}`}
            >
              Accept
            </button>
            <button
              className="wl-hint-btn wl-hint-reject"
              onMouseDown={(e) => {
                e.preventDefault();
                onRejectWikiLinkRef.current?.(hintTooltip.id);
                setHintTooltip(null);
              }}
              aria-label={`Reject wiki-link ${hintTooltip.link}`}
            >
              Reject
            </button>
          </div>
        )}
        {betaReadBubble && (
          <button
            className="beta-read-bubble"
            style={{ top: betaReadBubble.top, left: betaReadBubble.left }}
            onMouseDown={(e) => { e.preventDefault(); handleBetaReadClick(); }}
            aria-label="Beta-read selected text"
            title="Send to Beta-Read assistant"
          >
            Beta-Read
          </button>
        )}
        {isEditorEmpty && emptySceneHint && (
          <div className="block-editor-empty-hint" aria-live="polite">
            {emptySceneHint}
          </div>
        )}
      </RichTextEditor>
    </div>
  );
}
