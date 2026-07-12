import { useEditor } from '@tiptap/react';
import type { AnyExtension, Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Heading } from '@tiptap/extension-heading';
import { Paragraph } from '@tiptap/extension-paragraph';
import { TextAlign } from '@tiptap/extension-text-align';
import { Markdown } from 'tiptap-markdown';
import { defaultMarkdownSerializer, type MarkdownSerializerState } from 'prosemirror-markdown';
import type { Node as PmNode } from 'prosemirror-model';
import { WikiLink } from '../WikiLinkExtension';
import { WikiLinkResolutionExtension } from '../WikiLinkResolutionExtension';

// Alignment serialization uses an HTML comment marker so the surrounding
// tiptap-markdown serializer can emit it without wrapping the block in raw
// HTML (which would lose inline markdown marks inside the block).
// Format: <!-- align:center --> on its own line immediately before the block.
const ALIGN_COMMENT_RE = /^align:(left|center|right|justify)$/;

function writeAlignComment(state: MarkdownSerializerState, textAlign: unknown): void {
  if (!textAlign || textAlign === 'left') return;
  state.ensureNewLine();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (state as any).write(`<!-- align:${textAlign as string} -->\n`);
}

/**
 * Heading extension with textAlign markdown serialize + parse support.
 * StarterKit's bundled heading is disabled and replaced with this (SKY-5747).
 *
 * parse.updateDOM processes ALL align comments in the document (not just
 * headings) in a single DOM walk — paragraph alignment is handled here too.
 */
const AlignedHeading = Heading.extend({
  addStorage() {
    return {
      markdown: {
        serialize(
          state: MarkdownSerializerState,
          node: PmNode,
          parent: PmNode,
          index: number,
        ) {
          writeAlignComment(state, node.attrs['textAlign']);
          defaultMarkdownSerializer.nodes['heading']!(state, node, parent, index);
        },
        parse: {
          updateDOM(element: HTMLElement) {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_COMMENT);
            const toRemove: Comment[] = [];
            let commentNode: Node | null;
            // eslint-disable-next-line no-cond-assign
            while ((commentNode = walker.nextNode())) {
              const comment = commentNode as Comment;
              const m = ALIGN_COMMENT_RE.exec(comment.nodeValue?.trim() ?? '');
              if (!m) continue;
              const align = m[1];
              let sib: ChildNode | null = comment.nextSibling;
              while (sib && sib.nodeType === Node.TEXT_NODE) sib = sib.nextSibling;
              if (sib instanceof HTMLElement) {
                sib.style.textAlign = align;
              }
              toRemove.push(comment);
            }
            toRemove.forEach((c) => c.parentNode?.removeChild(c));
          },
        },
      },
    };
  },
});

/**
 * Paragraph extension with textAlign markdown serialize support.
 * StarterKit's bundled paragraph is disabled and replaced with this (SKY-5747).
 * parse.updateDOM lives on AlignedHeading to avoid a redundant second DOM walk.
 */
const AlignedParagraph = Paragraph.extend({
  addStorage() {
    return {
      markdown: {
        serialize(
          state: MarkdownSerializerState,
          node: PmNode,
          parent: PmNode,
          index: number,
        ) {
          writeAlignComment(state, node.attrs['textAlign']);
          defaultMarkdownSerializer.nodes['paragraph']!(state, node, parent, index);
        },
      },
    };
  },
});

/**
 * Shared Tiptap editor hook for all rich-text surfaces (Story/Notes).
 *
 * Base extensions: StarterKit (heading/paragraph disabled, replaced with
 * AlignedHeading/AlignedParagraph) · TextAlign · WikiLink ·
 * WikiLinkResolution · Markdown.
 * Surface-specific extensions are passed via `extraExtensions`.
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
    extensions: [
      // Disable StarterKit's heading/paragraph; mount alignment-aware replacements.
      StarterKit.configure({ heading: false, paragraph: false }),
      AlignedHeading,
      AlignedParagraph,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      WikiLink,
      WikiLinkResolutionExtension,
      Markdown,
      ...extraExtensions,
    ],
    content,
    editable,
    autofocus,
    onUpdate,
    onSelectionUpdate,
  });
}
