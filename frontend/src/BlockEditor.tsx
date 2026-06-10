import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { useRef, useState, useEffect, useCallback } from 'react';
import type { Block, Scene, DraftState, EntityEntry } from './types';
import { WikiLink } from './WikiLinkExtension';
import { WikiLinkHintExtension, WIKI_LINK_HINT_META, type WLSuggestion } from './WikiLinkHintExtension';
import {
  AutoLinkerExtension,
  AUTO_LINKER_META,
  getAutoLinkerState,
  collectAutoLinkerRanges,
  type AutoLinkerMode,
} from './AutoLinkerExtension';
import { EntityMention } from './EntityMentionExtension';
import { EntityMentionPickerExtension, mentionPickerKey, type MentionPickerState } from './EntityMentionPickerExtension';
import EntityMentionPicker, { matchesEntityQuery } from './EntityMentionPicker';
import { countWords } from './wordStats';
import './BlockEditor.css';
import './EntityMention.css';

export interface BlockEditorApi {
  jumpToText: (text: string) => void;
  insertWikiLink: (link: string, anchorText: string) => void;
  /** Apply all current auto-linker suggestions as a single undoable transaction. */
  applyAutoLinks: () => void;
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
  /** SKY-616: called when user clicks an @-entity chip to navigate to that entity. */
  onEntityClick?: (entityId: string) => void;
}

const DRAFT_STATE_LABELS: Record<DraftState, string> = {
  'in-progress': 'In Progress',
  review: 'Review',
  final: 'Final',
};

const INACTIVE_MENTION: MentionPickerState = { active: false, query: '', from: 0, to: 0 };

export function blocksToMarkdownBody(blocks: Block[]): string {
  const sorted = [...blocks].sort((a, b) => a.order - b.order);
  const lines: string[] = [];
  for (const block of sorted) {
    if (!block.content.trim()) continue;
    switch (block.type) {
      case 'heading': lines.push(`# ${block.content}`); break;
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

export default function BlockEditor({ scene, onBlocksChange, onDraftStateChange, onEditorReady, onBetaReadRequest, wikiLinkSuggestions, onAcceptWikiLink, onRejectWikiLink, autoLinkerEntities, autoLinkerMode, initialCursorPos, onCursorPosChange, onEntityClick }: Props) {
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

  // SKY-616: entity mention state
  const [entities, setEntities] = useState<EntityEntry[]>([]);
  const [mentionState, setMentionState] = useState<MentionPickerState>(INACTIVE_MENTION);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  // Tracks whether user dismissed the picker with Escape for the current @-trigger position.
  // Cleared when the trigger position changes (new '@' typed).
  const mentionSuppressedFromRef = useRef<number>(-1);
  const [mentionSuppressed, setMentionSuppressed] = useState(false);

  const onAcceptWikiLinkRef = useRef(onAcceptWikiLink);
  onAcceptWikiLinkRef.current = onAcceptWikiLink;
  const onRejectWikiLinkRef = useRef(onRejectWikiLink);
  onRejectWikiLinkRef.current = onRejectWikiLink;
  const autoLinkerModeRef = useRef(autoLinkerMode);
  autoLinkerModeRef.current = autoLinkerMode;
  // Flag to break the auto-link → onUpdate → auto-link cycle
  const applyingAutoLinksRef = useRef(false);
  const changeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onBlocksChangeRef = useRef(onBlocksChange);
  onBlocksChangeRef.current = onBlocksChange;
  const blockIdRef = useRef(scene.blocks[0]?.id ?? crypto.randomUUID());
  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;
  const onBetaReadRef = useRef(onBetaReadRequest);
  onBetaReadRef.current = onBetaReadRequest;
  const onEntityClickRef = useRef(onEntityClick);
  onEntityClickRef.current = onEntityClick;
  const editorWrapRef = useRef<HTMLDivElement | null>(null);
  // SKY-130: cursor tracking refs
  const onCursorPosChangeRef = useRef(onCursorPosChange);
  onCursorPosChangeRef.current = onCursorPosChange;
  const cursorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // SKY-616: load entities once on scene mount
  useEffect(() => {
    window.api.entityList().then(({ entities: list }) => setEntities(list)).catch(() => {});
  }, []);

  // SKY-616: reset selected index when query changes
  useEffect(() => {
    setMentionSelectedIndex(0);
  }, [mentionState.query]);

  const syncMentionState = useCallback((editor: ReturnType<typeof useEditor>) => {
    if (!editor) return;
    const ps = mentionPickerKey.getState(editor.state) ?? INACTIVE_MENTION;
    // Clear suppression when the '@' trigger moves to a new position
    if (ps.active && ps.from !== mentionSuppressedFromRef.current) {
      setMentionSuppressed(false);
    }
    setMentionState(ps);
  }, []);

  const editor = useEditor({
    extensions: [StarterKit, WikiLink, WikiLinkHintExtension, AutoLinkerExtension, EntityMention, EntityMentionPickerExtension, Markdown],
    content: blocksToMarkdownBody(scene.blocks),
    autofocus: initialCursorPos && initialCursorPos > 0 ? Math.max(1, initialCursorPos) : 'end',
    onUpdate({ editor: ed }) {
      setIsEditorEmpty(ed.isEmpty);
      syncMentionState(ed);
      // Word count: debounced at 250ms so typing stays smooth
      if (wcDebounceRef.current) clearTimeout(wcDebounceRef.current);
      wcDebounceRef.current = setTimeout(() => {
        // tiptap-markdown adds storage.markdown at runtime; cast to bypass static type gap
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = (ed.storage as any).markdown.getMarkdown() as string;
        const markdown = raw.endsWith('\n') ? raw : `${raw}\n`;
        setWordCount(countWords(markdown));
      }, WC_DEBOUNCE_MS);
      if (changeRef.current) clearTimeout(changeRef.current);
      changeRef.current = setTimeout(() => {
        // Auto on save: apply all auto-linker suggestions as a single transaction,
        // then read the updated markdown. The applyingAutoLinksRef flag prevents
        // the resulting onUpdate from triggering a second application cycle.
        if (autoLinkerModeRef.current === 'auto' && !applyingAutoLinksRef.current) {
          const linkerState = getAutoLinkerState(ed.state);
          if (linkerState && linkerState.entities.length > 0) {
            const ranges = collectAutoLinkerRanges(ed.state.doc, linkerState.entities);
            if (ranges.length > 0) {
              applyingAutoLinksRef.current = true;
              const sorted = [...ranges].sort((a, b) => b.from - a.from);
              let tr = ed.state.tr;
              for (const r of sorted) {
                const wikiNode = ed.schema.nodes['wikiLink']?.create({ target: r.target });
                if (wikiNode) tr = tr.replaceWith(r.from, r.to, wikiNode);
              }
              ed.view.dispatch(tr);
              applyingAutoLinksRef.current = false;
            }
          }
        }
        // tiptap-markdown adds storage.markdown at runtime; cast to bypass static type gap
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = (ed.storage as any).markdown.getMarkdown() as string;
        // tiptap-markdown v0.9 omits a trailing newline; add it for tooling compatibility.
        const markdown = raw.endsWith('\n') ? raw : `${raw}\n`;
        onBlocksChangeRef.current([{
          id: blockIdRef.current,
          type: 'prose',
          content: markdown,
          order: 0,
          updatedAt: new Date().toISOString(),
        }]);
      }, 800);
    },
    onSelectionUpdate({ editor: ed }) {
      syncMentionState(ed);
      const { from, to } = ed.state.selection;
      const text = from === to ? '' : ed.state.doc.textBetween(from, to, ' ');
      const trimmed = text.trim();
      setSelectionText(trimmed);
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
    },
  });

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
    const focusTimer = setTimeout(focusEditor, 0);
    const cb = onEditorReadyRef.current;
    if (!cb) return () => clearTimeout(focusTimer);

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
        const range = findTextRange(anchorText);
        if (range) {
          editor.chain().setTextSelection(range).insertContent(link).run();
        } else {
          editor.chain().focus().insertContent(link).run();
        }
      },
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
    return () => clearTimeout(focusTimer);
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

  // SKY-130: flush pending cursor debounce on unmount to avoid stale callbacks
  useEffect(() => {
    return () => {
      if (changeRef.current) clearTimeout(changeRef.current);
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
    const related = e.relatedTarget as HTMLElement | null;
    if (related?.closest('.wl-hint-tooltip')) return;
    setHintTooltip(null);
  }, []);

  const handleDraftChange = (state: DraftState) => {
    setDraftState(state);
    onDraftStateChange(state);
  };

  const handleBetaReadClick = useCallback(() => {
    if (!selectionText) return;
    onBetaReadRef.current?.(selectionText);
    setBetaReadBubble(null);
    setSelectionText('');
    editor?.commands.setTextSelection(editor.state.selection.from);
  }, [selectionText, editor]);

  // SKY-616: insert an entityMention node at the current @-trigger position
  const insertEntityMention = useCallback((entity: EntityEntry) => {
    if (!editor || !mentionState.active) return;
    const { from, to } = mentionState;
    const nodeType = editor.schema.nodes.entityMention;
    if (!nodeType) return;
    const node = nodeType.create({ entityId: entity.id, label: entity.name });
    const tr = editor.state.tr.delete(from, to).insert(from, node);
    editor.view.dispatch(tr);
    editor.view.focus();
  }, [editor, mentionState]);

  // SKY-616: keyboard handling for the mention picker in capture phase (runs before TipTap)
  const handlePickerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!mentionState.active || mentionSuppressed) return;
    const filtered = entities.filter((ent) => matchesEntityQuery(ent, mentionState.query)).slice(0, 10);
    if (filtered.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setMentionSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setMentionSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const target = filtered[mentionSelectedIndex];
      if (target) {
        e.preventDefault();
        e.stopPropagation();
        insertEntityMention(target);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      mentionSuppressedFromRef.current = mentionState.from;
      setMentionSuppressed(true);
    }
  }, [mentionState, mentionSuppressed, entities, mentionSelectedIndex, insertEntityMention]);

  // SKY-616: event delegation for entity chip click → navigate to entity page
  const handleEditorClick = useCallback((e: React.MouseEvent) => {
    const chip = (e.target as HTMLElement).closest('.entity-mention-chip') as HTMLElement | null;
    if (!chip) return;
    const entityId = chip.dataset.entityId;
    if (entityId) {
      e.preventDefault();
      onEntityClickRef.current?.(entityId);
    }
  }, []);

  // Compute picker position from the @-trigger doc position
  let pickerTop = 0;
  let pickerLeft = 0;
  const showPicker = mentionState.active && !mentionSuppressed;
  if (showPicker && editor && editorWrapRef.current) {
    try {
      const coords = editor.view.coordsAtPos(mentionState.from);
      const wrapRect = editorWrapRef.current.getBoundingClientRect();
      pickerTop = coords.bottom - wrapRect.top + 4;
      pickerLeft = coords.left - wrapRect.left;
    } catch {
      // coordsAtPos can throw if position is out of range; ignore
    }
  }

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
      </div>
      <div
        className="tiptap-editor-wrap"
        ref={editorWrapRef}
        style={{ position: 'relative' }}
        onKeyDownCapture={handlePickerKeyDown}
        onClick={handleEditorClick}
        onMouseOver={handleHintMouseOver}
        onMouseLeave={handleHintMouseLeave}
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
        {isEditorEmpty && (
          <div className="block-editor-empty-hint" aria-live="polite">
            Start typing to begin.
          </div>
        )}
        <EditorContent editor={editor} className="tiptap-content" />
      </div>
    </div>
  );
}
