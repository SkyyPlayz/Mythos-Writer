// M17 (Beta 4 "Refine", FULL-SPEC §6): the notes editor "links block" —
// prototype note blocks `{ k: 'links', items }` render a flex row of chip-
// styled [[wiki links]]. In real notes that block is a paragraph made only of
// wiki links and separators (`[[A]] · [[B]] · [[C]]`), so this extension adds
// a decoration class (`note-links-block`) to exactly those paragraphs and CSS
// grows the links into chips. Decorations only — the document, the markdown
// serialization, and the M6 wiki-link machinery are untouched (CF-9/CF-11).
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

/** Text allowed BETWEEN links in a links block: whitespace + list separators. */
const SEPARATOR_TEXT_RE = /^[\s·•|,;/–—-]*$/;

/**
 * True when a paragraph consists solely of ≥2 [[wiki links]] plus separator
 * text — the prototype's "Linked Notes" chip row. Exported for unit tests.
 */
export function isLinksOnlyParagraph(node: PMNode): boolean {
  if (node.type.name !== 'paragraph' || node.childCount === 0) return false;
  let links = 0;
  let valid = true;
  node.forEach((child) => {
    if (child.type.name === 'wikiLink') {
      links += 1;
    } else if (!(child.isText && SEPARATOR_TEXT_RE.test(child.text ?? ''))) {
      valid = false;
    }
  });
  return valid && links >= 2;
}

function buildDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return true;
    if (isLinksOnlyParagraph(node)) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'note-links-block' }));
    }
    return false; // paragraphs have no block children
  });
  return DecorationSet.create(doc, decorations);
}

const pluginKey = new PluginKey<DecorationSet>('noteLinksBlock');

export const NoteLinksBlock = Extension.create({
  name: 'noteLinksBlock',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: pluginKey,
        state: {
          init(_, { doc }) {
            return buildDecorations(doc);
          },
          apply(tr, prev) {
            return tr.docChanged ? buildDecorations(tr.doc) : prev;
          },
        },
        props: {
          decorations(state) {
            return pluginKey.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
