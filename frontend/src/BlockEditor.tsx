import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { useRef, useState, useEffect, useCallback } from 'react';
import type { Block, Scene, DraftState, EntityEntry } from './types';
import { WikiLink } from './WikiLinkExtension';
import { WikiLinkHintExtension, WIKI_LINK_HINT_META, type WLSuggestion } from './WikiLinkHintExtension';
import { EntityMentionExtension } from './EntityMentionExtension';
import { EntityMentionPickerExtension, mentionPickerKey } from './EntityMentionPickerExtension';
import { EntityMentionPicker, matchesEntityQuery } from './EntityMentionPicker';
import './BlockEditor.css';
import './EntityMention.css';

export interface BlockEditorApi {
  jumpToText: (text: string) => void;
  insertWikiLink: (link: string, anchorText: string) => void;
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

interface ActiveMentionPicker {
  query: string;
  from: number;
  to: number;
  top: number;
  left: number;
}

export default function BlockEditor({ scene, onBlocksChange, onDraftStateChange, onEditorReady, onBetaReadRequest, wikiLinkSuggestions, onAcceptWikiLink, onRejectWikiLink, initialCursorPos, onCursorPosChange }: Props) {
  const [draftState, setDraftState] = useState<DraftState>(scene.draftState ?? 'in-progress');
  const [selectionText, setSelectionText] = useState<string>('');
  const [betaReadBubble, setBetaReadBubble] = useState<{ top: number; left: number } | null>(null);
  const [hintTooltip, setHintTooltip] = useState<{
    id: string; link: string; anchor: string; top: number; left: number;
  } | null>(null);

  // SKY-176: @entity mention typeahead state
  const [allEntities, setAllEntities] = useState<EntityEntry[]>([]);
  const [activePicker, setActivePicker] = useState<ActiveMentionPicker | null>(null);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  // Refs for keyboard handler (avoids stale closure in capture-phase listener)
  const allEntitiesRef = useRef<EntityEntry[]>([]);
  const activePickerRef = useRef<ActiveMentionPicker | null>(null);
  const selectedMentionIndexRef = useRef(0);
  const pickerSuppressedRef = useRef<{ from: number } | null>(null);
  const lastPickerQueryRef = useRef<string>('');
  allEntitiesRef.current = allEntities;
  activePickerRef.current = activePicker;
  selectedMentionIndexRef.current = selectedMentionIndex;

  const onAcceptWikiLinkRef = useRef(onAcceptWikiLink);
  onAcceptWikiLinkRef.current = onAcceptWikiLink;
  const onRejectWikiLinkRef = useRef(onRejectWikiLink);
  onRejectWikiLinkRef.current = onRejectWikiLink;
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

  // SKY-176: read mention picker plugin state and update React picker state.
  // Called from both onUpdate and onSelectionUpdate so all transitions are captured.
  // Uses a ref so the stale useEditor closure always calls the latest implementation.
  const syncPickerStateRef = useRef<(ed: typeof editor) => void>(() => {});
  syncPickerStateRef.current = (ed) => {
    if (!ed) return;
    const ps = mentionPickerKey.getState(ed.state);

    if (!ps?.active) {
      setActivePicker(null);
      return;
    }

    // Escape-key suppression: if user pressed Escape at this @ position, keep closed.
    if (pickerSuppressedRef.current?.from === ps.from) {
      setActivePicker(null);
      return;
    }
    // A different @ position clears stale suppression.
    pickerSuppressedRef.current = null;

    // Reset selected index when query text changes.
    if (ps.query !== lastPickerQueryRef.current) {
      setSelectedMentionIndex(0);
      lastPickerQueryRef.current = ps.query;
    }

    // Compute pixel position relative to editor wrap.
    let top = 0;
    let left = 0;
    try {
      const coords = ed.view.coordsAtPos(ps.from);
      const wrapEl = editorWrapRef.current;
      if (wrapEl) {
        const wrapRect = wrapEl.getBoundingClientRect();
        top = coords.bottom - wrapRect.top + 4;
        left = Math.max(0, coords.left - wrapRect.left);
      }
    } catch {
      // coordsAtPos can throw for out-of-range positions; leave defaults.
    }

    setActivePicker({ query: ps.query, from: ps.from, to: ps.to, top, left });
  };

  const editor = useEditor({
    extensions: [
      StarterKit,
      WikiLink,
      WikiLinkHintExtension,
      EntityMentionExtension,
      EntityMentionPickerExtension,
      Markdown,
    ],
    content: blocksToMarkdownBody(scene.blocks),
    onUpdate({ editor: ed }) {
      // tiptap-markdown adds storage.markdown at runtime; cast to bypass static type gap
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (ed.storage as any).markdown.getMarkdown() as string;
      // tiptap-markdown v0.9 omits a trailing newline; add it for tooling compatibility.
      const markdown = raw.endsWith('\n') ? raw : `${raw}\n`;
      if (changeRef.current) clearTimeout(changeRef.current);
      changeRef.current = setTimeout(() => {
        onBlocksChangeRef.current([{
          id: blockIdRef.current,
          type: 'prose',
          content: markdown,
          order: 0,
          updatedAt: new Date().toISOString(),
        }]);
      }, 800);
      syncPickerStateRef.current(ed);
    },
    onSelectionUpdate({ editor: ed }) {
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
      syncPickerStateRef.current(ed);
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

  // SKY-130: flush pending cursor debounce on unmount to avoid stale callbacks
  useEffect(() => {
    return () => {
      if (changeRef.current) clearTimeout(changeRef.current);
      if (cursorDebounceRef.current) clearTimeout(cursorDebounceRef.current);
    };
  }, []);

  // SKY-176: fetch entity list once on mount for the typeahead.
  useEffect(() => {
    window.api?.entityList?.().then((res) => {
      setAllEntities(res?.entities ?? []);
    }).catch(() => { /* entity list unavailable — picker shows no results */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SKY-176: insert entity mention node, replacing the @query text.
  const insertEntityMention = useCallback((entity: EntityEntry, picker: ActiveMentionPicker) => {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: picker.from, to: picker.to })
      .insertContent({
        type: 'entityMention',
        attrs: { id: entity.id, label: entity.name, entityType: entity.type },
      })
      .run();
    setActivePicker(null);
    setSelectedMentionIndex(0);
    pickerSuppressedRef.current = null;
    lastPickerQueryRef.current = '';
  }, [editor]);

  // SKY-176: keyboard capture handler — intercepts arrows/enter/escape when picker is open.
  // Runs in capture phase so ProseMirror never sees these keys.
  useEffect(() => {
    if (!editor) return;

    function handleKeyDown(e: KeyboardEvent) {
      const picker = activePickerRef.current;
      if (!picker) return;

      const filtered = allEntitiesRef.current
        .filter((en) => matchesEntityQuery(en, picker.query))
        .slice(0, 10);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedMentionIndex((i) => Math.min(Math.max(0, filtered.length - 1), i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedMentionIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const entity = filtered[selectedMentionIndexRef.current];
        if (entity) insertEntityMention(entity, picker);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        pickerSuppressedRef.current = { from: picker.from };
        setActivePicker(null);
      }
    }

    const el = editor.view.dom;
    el.addEventListener('keydown', handleKeyDown, true);
    return () => el.removeEventListener('keydown', handleKeyDown, true);
  }, [editor, insertEntityMention]);

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
        {activePicker && (
          <EntityMentionPicker
            entities={allEntities}
            query={activePicker.query}
            selectedIndex={selectedMentionIndex}
            onSelect={(entity) => insertEntityMention(entity, activePicker)}
            style={{ top: activePicker.top, left: activePicker.left }}
          />
        )}
        <EditorContent editor={editor} className="tiptap-content" />
      </div>
    </div>
  );
}
