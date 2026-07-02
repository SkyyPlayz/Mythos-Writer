// SKY-3204: shared rich-text editor core for Story (BlockEditor) and Notes (NoteViewer).
// Owns the base extension set, the entity @-mention picker stack, wiki-link click
// delegation, debounced Markdown onChange, and the FormatToolbar + EditorContent
// scaffolding. Surface-specific behaviour (draft states, tri-mode, page chrome, …)
// lives in the thin wrappers.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent } from '@tiptap/react';
import type { AnyExtension, Editor } from '@tiptap/core';
import { EntityMention } from './EntityMentionExtension';
import { EntityMentionPickerExtension, mentionPickerKey, type MentionPickerState } from './EntityMentionPickerExtension';
import EntityMentionPicker, { matchesEntityQuery } from './EntityMentionPicker';
import type { EntityEntry } from './types';
import { useRichEditor, getEditorMarkdown } from './lib/useRichEditor';
import FormatToolbar from './FormatToolbar';
import './EntityMention.css';

const INACTIVE_MENTION: MentionPickerState = { active: false, query: '', from: 0, to: 0 };

const CHANGE_DEBOUNCE_MS = 800;

export interface RichTextEditorProps {
  /** Initial Markdown content. Read once at editor creation — remount (key) to reload. */
  content: string;
  /**
   * Surface-specific Tiptap extensions, inserted between the shared base
   * (StarterKit · Underline · WikiLink · Markdown) and the shared mention stack
   * (EntityMention · EntityMentionPickerExtension) so the Story editor keeps its
   * pre-extraction extension order exactly.
   */
  extraExtensions?: AnyExtension[];
  /** Whether the editor accepts user input. Defaults to true. */
  editable?: boolean;
  /** Cursor placement on mount. */
  autofocus?: 'start' | 'end' | 'all' | number | boolean;
  /** Debounced serialized-Markdown change callback (trailing newline guaranteed). */
  onChangeMarkdown?: (markdown: string) => void;
  /** Debounce for onChangeMarkdown. Defaults to 800ms — the app-wide autosave budget. */
  debounceMs?: number;
  /**
   * Invoked with the editor at the start of a debounced flush, before the document
   * is serialized (Story applies auto-linker suggestions here).
   */
  onBeforeFlush?: (editor: Editor) => void;
  /**
   * Flush a pending debounced change on unmount so fast surface switches never
   * drop the last keystrokes. Defaults to true. Read once on mount.
   */
  flushPendingOnUnmount?: boolean;
  /**
   * Suppress change callbacks caused by Tiptap normalizing the initial content
   * parse, so loading a document is never mistaken for an edit. Read once on mount.
   */
  suppressInitialChange?: boolean;
  /** Reports the live editor instance (null until created). */
  onEditorChange?: (editor: Editor | null) => void;
  /** Called after core handling on every document update. */
  onUpdate?: (editor: Editor) => void;
  /** Called after core handling on every selection change. */
  onSelectionUpdate?: (editor: Editor) => void;
  /** Called when the user activates a [[wiki link]]. */
  onWikiLinkClick?: (target: string) => void;
  /** Called when the user clicks an @-entity chip. */
  onEntityClick?: (entityId: string) => void;
  /** Render the shared formatting toolbar. Defaults to true. */
  showToolbar?: boolean;
  /** Class for the positioned wrapper div around the editable surface. */
  wrapClassName?: string;
  /** Class for the EditorContent element. */
  contentClassName?: string;
  /** Accessible label for the wrapper div. */
  wrapAriaLabel?: string;
  /** Receives the wrapper element for overlay positioning in wrappers. */
  wrapRef?: React.MutableRefObject<HTMLDivElement | null>;
  onWrapMouseOver?: (e: React.MouseEvent) => void;
  onWrapMouseLeave?: (e: React.MouseEvent) => void;
  /** Overlays rendered inside the wrapper (tooltips, bubbles, empty-state hints). */
  children?: ReactNode;
}

export default function RichTextEditor({
  content,
  extraExtensions,
  editable,
  autofocus,
  onChangeMarkdown,
  debounceMs = CHANGE_DEBOUNCE_MS,
  onBeforeFlush,
  flushPendingOnUnmount = true,
  suppressInitialChange = false,
  onEditorChange,
  onUpdate,
  onSelectionUpdate,
  onWikiLinkClick,
  onEntityClick,
  showToolbar = true,
  wrapClassName,
  contentClassName,
  wrapAriaLabel,
  wrapRef,
  onWrapMouseOver,
  onWrapMouseLeave,
  children,
}: RichTextEditorProps) {
  const [entities, setEntities] = useState<EntityEntry[]>([]);
  const [mentionState, setMentionState] = useState<MentionPickerState>(INACTIVE_MENTION);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  // Tracks whether the user dismissed the picker with Escape for the current
  // @-trigger position. Cleared when the trigger position changes (new '@' typed).
  const mentionSuppressedFromRef = useRef<number>(-1);
  const [mentionSuppressed, setMentionSuppressed] = useState(false);

  const innerWrapRef = useRef<HTMLDivElement | null>(null);
  const setWrapEl = useCallback((el: HTMLDivElement | null) => {
    innerWrapRef.current = el;
    if (wrapRef) wrapRef.current = el;
    // The forwarded ref object is stable for the wrapper's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Latest-callback refs so the Tiptap callbacks (bound once at creation) never go stale.
  const onChangeMarkdownRef = useRef(onChangeMarkdown);
  onChangeMarkdownRef.current = onChangeMarkdown;
  const onBeforeFlushRef = useRef(onBeforeFlush);
  onBeforeFlushRef.current = onBeforeFlush;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const onSelectionUpdateRef = useRef(onSelectionUpdate);
  onSelectionUpdateRef.current = onSelectionUpdate;
  const onWikiLinkClickRef = useRef(onWikiLinkClick);
  onWikiLinkClickRef.current = onWikiLinkClick;
  const onEntityClickRef = useRef(onEntityClick);
  onEntityClickRef.current = onEntityClick;
  const onEditorChangeRef = useRef(onEditorChange);
  onEditorChangeRef.current = onEditorChange;

  const changeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFlushRef = useRef<(() => void) | null>(null);
  const initializedRef = useRef(!suppressInitialChange);
  // Skip mention-state setters until mounted, preventing React act() warnings
  // from Tiptap's internal initialization events.
  const editorMountedRef = useRef(false);

  useEffect(() => {
    window.api.entityList().then(({ entities: list }) => setEntities(list)).catch(() => {});
  }, []);

  useEffect(() => { setMentionSelectedIndex(0); }, [mentionState.query]);

  const syncMentionState = useCallback((ed: Editor) => {
    if (!editorMountedRef.current) return;
    const ps = mentionPickerKey.getState(ed.state) ?? INACTIVE_MENTION;
    // Clear suppression when the '@' trigger moves to a new position
    if (ps.active && ps.from !== mentionSuppressedFromRef.current) {
      setMentionSuppressed(false);
    }
    setMentionState(ps);
  }, []);

  const editor = useRichEditor({
    content,
    editable,
    autofocus,
    extraExtensions: [...(extraExtensions ?? []), EntityMention, EntityMentionPickerExtension],
    onUpdate({ editor: ed }) {
      syncMentionState(ed);
      onUpdateRef.current?.(ed);
      if (!initializedRef.current) return;
      if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
      const flush = () => {
        pendingFlushRef.current = null;
        changeTimerRef.current = null;
        onBeforeFlushRef.current?.(ed);
        onChangeMarkdownRef.current?.(getEditorMarkdown(ed));
      };
      pendingFlushRef.current = flush;
      changeTimerRef.current = setTimeout(flush, debounceMs);
    },
    onSelectionUpdate({ editor: ed }) {
      syncMentionState(ed);
      onSelectionUpdateRef.current?.(ed);
    },
  });

  useEffect(() => {
    onEditorChangeRef.current?.(editor);
  }, [editor]);

  // Mark mounted / initialized after the first render cycle so the initial
  // content-normalization transaction never fires a change callback.
  useEffect(() => {
    if (!editor) return;
    editorMountedRef.current = true;
    if (initializedRef.current) {
      return () => { editorMountedRef.current = false; };
    }
    const timer = setTimeout(() => { initializedRef.current = true; }, 0);
    return () => {
      clearTimeout(timer);
      editorMountedRef.current = false;
    };
  }, [editor]);

  // Flush a pending debounced change on unmount so surface switches never drop text.
  // flushPendingOnUnmount is config, read once by design.
  useEffect(() => {
    return () => {
      if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
      if (flushPendingOnUnmount) pendingFlushRef.current?.();
      pendingFlushRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Insert an entityMention node at the current @-trigger position.
  const insertEntityMention = useCallback((entity: EntityEntry) => {
    if (!editor || !mentionState.active) return;
    const { from, to } = mentionState;
    const nodeType = editor.schema.nodes.entityMention;
    if (!nodeType) return;
    const node = nodeType.create({ entityId: entity.id, label: entity.name });
    editor.view.dispatch(editor.state.tr.delete(from, to).insert(from, node));
    editor.view.focus();
  }, [editor, mentionState]);

  // Keyboard handling for the mention picker in capture phase (runs before Tiptap).
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

  // Event delegation for entity-chip and wiki-link clicks.
  const handleEditorClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const chip = target.closest('.entity-mention-chip') as HTMLElement | null;
    if (chip) {
      const entityId = chip.dataset.entityId;
      if (entityId) {
        e.preventDefault();
        onEntityClickRef.current?.(entityId);
        return;
      }
    }

    const wikiLink = target.closest('[data-wiki-link]') as HTMLElement | null;
    const linkTarget = wikiLink?.dataset.wikiLink;
    if (linkTarget) {
      e.preventDefault();
      onWikiLinkClickRef.current?.(linkTarget);
      return;
    }

    // Fallback: an unambiguous plain-text [[wiki link]] (not yet parsed into a node).
    for (const text of [target.textContent ?? '', editor?.state.doc.textBetween(0, editor.state.doc.content.size, '\n') ?? '']) {
      const plainTextWikiLinks = Array.from(text.matchAll(/\[\[([^\]]+)\]\]/g));
      if (plainTextWikiLinks.length === 1) {
        e.preventDefault();
        onWikiLinkClickRef.current?.(plainTextWikiLinks[0][1]);
        return;
      }
    }
  }, [editor]);

  // Compute picker position from the @-trigger doc position.
  let pickerTop = 0;
  let pickerLeft = 0;
  const showPicker = mentionState.active && !mentionSuppressed;
  if (showPicker && editor && innerWrapRef.current) {
    try {
      const coords = editor.view.coordsAtPos(mentionState.from);
      const wrapRect = innerWrapRef.current.getBoundingClientRect();
      pickerTop = coords.bottom - wrapRect.top + 4;
      pickerLeft = coords.left - wrapRect.left;
    } catch {
      // coordsAtPos can throw if position is out of range; ignore
    }
  }

  return (
    <>
      {showToolbar && <FormatToolbar editor={editor} />}
      <div
        className={wrapClassName}
        ref={setWrapEl}
        style={{ position: 'relative' }}
        onKeyDownCapture={handlePickerKeyDown}
        onClickCapture={handleEditorClick}
        onMouseOver={onWrapMouseOver}
        onMouseLeave={onWrapMouseLeave}
        aria-label={wrapAriaLabel}
      >
        {children}
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
        <EditorContent editor={editor} className={contentClassName} />
      </div>
    </>
  );
}
