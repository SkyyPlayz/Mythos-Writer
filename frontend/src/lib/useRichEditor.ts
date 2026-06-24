import { useEditor } from '@tiptap/react';
import type { AnyExtension, Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { Markdown } from 'tiptap-markdown';
import { WikiLink } from '../WikiLinkExtension';

/**
 * Shared Tiptap editor hook for all rich-text surfaces (Story/Notes).
 *
 * Base extensions always included: StarterKit · Underline · WikiLink · Markdown.
 * Story-specific extensions (WikiLinkHint, AutoLinker, EntityMention, etc.)
 * are passed via `extraExtensions`.
 *
 * All other `useEditor` options are forwarded unchanged so callers retain
 * full control over autofocus, content, callbacks, etc.
 */
export interface UseRichEditorOptions {
  /** Initial Markdown content. */
  content?: string;
  /** Additional Tiptap extensions beyond the shared base. */
  extraExtensions?: AnyExtension[];
  /** Whether the editor accepts user input. Defaults to true. */
  editable?: boolean;
  /** Cursor placement on mount. */
  autofocus?: 'start' | 'end' | 'all' | number | boolean;
  /** Called on every ProseMirror transaction that changes the document. */
  onUpdate?: ({ editor }: { editor: Editor }) => void;
  /** Called on every selection change. */
  onSelectionUpdate?: ({ editor }: { editor: Editor }) => void;
}

/**
 * Read the current document as Markdown from a Tiptap editor.
 * Always appends a trailing newline for tooling compatibility
 * (tiptap-markdown v0.9 omits the trailing newline).
 */
export function getEditorMarkdown(editor: Editor): string {
  // tiptap-markdown attaches storage.markdown at runtime — cast is unavoidable
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (editor.storage as any).markdown.getMarkdown() as string;
  return raw.endsWith('\n') ? raw : `${raw}\n`;
}

export function useRichEditor({
  content = '',
  extraExtensions = [],
  editable,
  autofocus,
  onUpdate,
  onSelectionUpdate,
}: UseRichEditorOptions): Editor | null {
  return useEditor({
    extensions: [StarterKit, Underline, WikiLink, Markdown, ...extraExtensions],
    content,
    editable,
    autofocus,
    onUpdate,
    onSelectionUpdate,
  });
}
