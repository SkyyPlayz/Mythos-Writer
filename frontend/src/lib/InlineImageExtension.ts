// B10 — Inline image rendering in the document body.
// tiptap-markdown's built-in Image node handles markdown serialization/parsing
// but doesn't define renderHTML, so ![alt](url) is parsed into the ProseMirror
// document but never painted as an <img>. This extension adds the missing
// renderHTML + parseHTML so images appear inline.
import { Node } from '@tiptap/core';

export const InlineImageExtension = Node.create({
  name: 'image',
  inline: true,
  group: 'inline',
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'img[src]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', {
      ...HTMLAttributes,
      class: 'rte-inline-image',
      loading: 'lazy',
      decoding: 'async',
    }];
  },
});
