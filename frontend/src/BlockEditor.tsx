import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { useRef, useState, useEffect, useCallback } from 'react';
import type { Block, Scene, DraftState } from './types';
import { WikiLink } from './WikiLinkExtension';
import { WikiLinkHintExtension, WIKI_LINK_HINT_META, type WLSuggestion } from './WikiLinkHintExtension';
import {
  AutoLinkerExtension,
  AUTO_LINKER_META,
  getAutoLinkerState,
  collectAutoLinkerRanges,
  type AutoLinkerMode,
} from './AutoLinkerExtension';
import { EntityMentionExtension } from './EntityMentionExtension';
import { EntityMentionPickerExtension, mentionPickerKey } from './EntityMentionPickerExtension';
import { EntityMentionPicker, matchesEntityQuery } from './EntityMentionPicker';
import type { EntityEntry } from './types';
import './BlockEditor.css';
import './EntityMention.css';

export interface BlockEditorApi {
  jumpToText: (text: string) => void;
  insertWikiLink: (link: string, anchorText: string) => void;
  /** Apply all current auto-linker suggestions as a single undoable transaction. */
  applyAutoLinks: () => void;
  insertText: (text: string) => void;
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
}

const DRAFT_STATE_LABELS: Record<DraftState, string> = {
  'in-progress': 'In Progress',
  review: 'Review',
  final: 'Final',
};

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

interface ActivePickerState {
  active: boolean;
  query: string;
  from: number;
  to: number;
  top: number;
  left: number;
}

const PICKER_INACTIVE: ActivePickerState = { active: false, query: '', from: 0, to: 0, top: 0, left: 0 };

export default function BlockEditor({ scene, onBlocksChange, onDraftStateChange, onEditorReady, onBetaReadRequest, wikiLinkSuggestions, onAcceptWikiLink, onRejectWikiLink, autoLinkerEntities, autoLinkerMode, initialCursorPos, onCursorPosChange }: Props) {
  const [draftState, setDraftState] = useState<DraftState>(scene.draftState ?? 'in-progress');
  const [selectionText, setSelectionText] = useState<string>('');
  const [betaReadBubble, setBetaReadBubble] = useState<{ top: number; left: number } | null>(null);
  const [hintTooltip, setHintTooltip] = useState<{
    id: string; link: string; anchor: string; top: number; left: number;
  } | null>(null);

  // SKY-233: @entity mention picker
  const [mentionEntities, setMentionEntities] = useState<EntityEntry[]>([]);
  const [activePicker, setActivePicker] = useState<ActivePickerState>(PICKER_INACTIVE);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const activePickerRef = useRef(activePicker);
  activePickerRef.current = activePicker;
  const suppressedAtRef = useRef<number>(-1);
  const filteredEntitiesRef = useRef<EntityEntry[]>([]);
  // Assigned in render body so onUpdate/onSelectionUpdate always get the freshest closure.
  const syncPickerRef = useRef<((ed: import('@tiptap/core').Editor) => void) | null>(null);
  const insertMentionRef = useRef<((entity: EntityEntry) => void) | null>(null);

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
  const editorWrapRef = useRef<HTMLDivElement | null>(null);
  // SKY-130: cursor tracking refs
  const onCursorPosChangeRef = useRef(onCursorPosChange);
  onCursorPosChangeRef.current = onCursorPosChange;
  const cursorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: [StarterKit, WikiLink, WikiLinkHintExtension, AutoLinkerExtension, EntityMentionExtension, EntityMentionPickerExtension, Markdown],
    content: blocksToMarkdownBody(scene.blocks),
    onUpdate({ editor }) {
      if (changeRef.current) clearTimeout(changeRef.current);
      changeRef.current = setTimeout(() => {
        // Auto on save: apply all auto-linker suggestions as a single transaction,
        // then read the updated markdown. The applyingAutoLinksRef flag prevents
        // the resulting onUpdate from triggering a second application cycle.
        if (autoLinkerModeRef.current === 'auto' && !applyingAutoLinksRef.current) {
          const linkerState = getAutoLinkerState(editor.state);
          if (linkerState && linkerState.entities.length > 0) {
            const ranges = collectAutoLinkerRanges(editor.state.doc, linkerState.entities);
            if (ranges.length > 0) {
              applyingAutoLinksRef.current = true;
              const sorted = [...ranges].sort((a, b) => b.from - a.from);
              let tr = editor.state.tr;
              for (const r of sorted) {
                const wikiNode = editor.schema.nodes['wikiLink']?.create({ target: r.target });
                if (wikiNode) tr = tr.replaceWith(r.from, r.to, wikiNode);
              }
              editor.view.dispatch(tr);
              applyingAutoLinksRef.current = false;
            }
          }
        }
        // tiptap-markdown adds storage.markdown at runtime; cast to bypass static type gap
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = (editor.storage as any).markdown.getMarkdown() as string;
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
      syncPickerRef.current?.(editor);
    },
    onSelectionUpdate({ editor }) {
      const { from, to } = editor.state.selection;
      const text = from === to ? '' : editor.state.doc.textBetween(from, to, ' ');
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
      syncPickerRef.current?.(editor);
    },
  });

  // Expose jump-to-text and insert-wiki-link APIs to the parent once the editor is ready
  useEffect(() => {
    if (!editor) return;
    const cb = onEditorReadyRef.current;
    if (!cb) return;

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
    });
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
    };
  }, []);

  // SKY-233: fetch entity list for @mention picker (once per scene mount)
  useEffect(() => {
    const p = window.api?.entityList?.();
    if (p) {
      p.then((res) => setMentionEntities(res?.entities ?? [])).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SKY-233: reset selected index when query changes
  useEffect(() => {
    setSelectedMentionIndex(0);
  }, [activePicker.query]);

  // SKY-233: capture-phase keyboard handler for picker navigation
  useEffect(() => {
    const el = editorWrapRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if (!activePickerRef.current.active) return;
      const count = filteredEntitiesRef.current.length;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedMentionIndex((i) => (count > 0 ? Math.min(i + 1, count - 1) : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedMentionIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        const entity = filteredEntitiesRef.current[selectedMentionIndex];
        if (entity) {
          e.preventDefault();
          e.stopPropagation();
          insertMentionRef.current?.(entity);
        }
      } else if (e.key === 'Escape') {
        suppressedAtRef.current = activePickerRef.current.from;
        setActivePicker((p) => ({ ...p, active: false }));
      }
    };
    el.addEventListener('keydown', handler, true); // capture phase
    return () => el.removeEventListener('keydown', handler, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SKY-233: compute filtered entities for current picker query (also updates ref for keyboard handler)
  const filteredEntities = activePicker.active
    ? mentionEntities.filter((e) => matchesEntityQuery(e, activePicker.query)).slice(0, 10)
    : [];
  filteredEntitiesRef.current = filteredEntities;

  // SKY-233: assign picker sync fn in render body so closures are always fresh
  syncPickerRef.current = (ed) => {
    if (!editorWrapRef.current) return;
    const ps = mentionPickerKey.getState(ed.state);
    if (!ps?.active || suppressedAtRef.current === ps.from) {
      setActivePicker((prev) => (prev.active ? { ...prev, active: false } : prev));
      return;
    }
    const coords = ed.view.coordsAtPos(ps.from);
    const wrapRect = editorWrapRef.current.getBoundingClientRect();
    const next: ActivePickerState = {
      active: true,
      query: ps.query,
      from: ps.from,
      to: ps.to,
      top: coords.bottom - wrapRect.top + 4,
      left: coords.left - wrapRect.left,
    };
    setActivePicker((prev) =>
      prev.active && prev.query === ps.query && prev.from === ps.from ? prev : next,
    );
  };

  // SKY-233: assign insert fn in render body so it captures the latest editor ref
  insertMentionRef.current = (entity: EntityEntry) => {
    if (!editor) return;
    const ps = mentionPickerKey.getState(editor.state);
    if (!ps?.active) return;
    editor.chain()
      .focus()
      .setTextSelection({ from: ps.from, to: ps.to })
      .insertContent({ type: 'entityMention', attrs: { id: entity.id, label: entity.name, entityType: entity.type } })
      .insertContent(' ')
      .run();
    suppressedAtRef.current = -1;
    setActivePicker(PICKER_INACTIVE);
    setSelectedMentionIndex(0);
  };

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

  return (
    <div className="block-editor">
      <div className="block-editor-toolbar">
        <span className="scene-name">{scene.title}</span>
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
        {activePicker.active && filteredEntities.length > 0 && (
          <EntityMentionPicker
            entities={filteredEntities}
            selectedIndex={selectedMentionIndex}
            onSelect={(entity) => insertMentionRef.current?.(entity)}
            style={{ position: 'absolute', top: activePicker.top, left: activePicker.left }}
          />
        )}
        <EditorContent editor={editor} className="tiptap-content" />
      </div>
    </div>
  );
}
