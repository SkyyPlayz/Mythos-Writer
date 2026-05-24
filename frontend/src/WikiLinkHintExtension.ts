import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface WLSuggestion {
  id: string;
  anchorText: string;
  wikiLink: string;
}

export const WIKI_LINK_HINT_META = 'wikiLinkHintSuggestions';

const pluginKey = new PluginKey<DecorationSet>('wikiLinkHint');

function buildDecorations(doc: import('@tiptap/pm/model').Node, suggestions: WLSuggestion[]): DecorationSet {
  if (!suggestions.length) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  for (const s of suggestions) {
    const needle = s.anchorText.toLowerCase();
    doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return true;
      const text = node.text.toLowerCase();
      let start = 0;
      let idx: number;
      while ((idx = text.indexOf(needle, start)) >= 0) {
        decorations.push(
          Decoration.inline(pos + idx, pos + idx + s.anchorText.length, {
            class: 'archive-wl-hint',
            'data-wl-id': s.id,
            'data-wl-link': s.wikiLink,
            'data-wl-anchor': s.anchorText,
          })
        );
        start = idx + needle.length;
      }
      return true;
    });
  }
  return DecorationSet.create(doc, decorations);
}

export const WikiLinkHintExtension = Extension.create({
  name: 'wikiLinkHint',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr, old) {
            const suggestions = tr.getMeta(WIKI_LINK_HINT_META) as WLSuggestion[] | undefined;
            if (suggestions !== undefined) {
              return buildDecorations(tr.doc, suggestions);
            }
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return pluginKey.getState(state);
          },
        },
      }),
    ];
  },
});
