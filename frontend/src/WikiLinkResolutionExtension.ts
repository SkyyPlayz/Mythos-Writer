import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { normalize } from './crossTabLinkResolver';

/**
 * SKY-5702 (GH#650 WL-1): marks [[wiki-link]] nodes whose target does not
 * resolve to a known note/story title with `.wiki-link-unresolved`, so
 * broken links are visually distinct before the reader clicks them.
 *
 * The resolved-title set is supplied externally (built once from the current
 * vault state via `buildWikiLinkTitleIndex`) and pushed in via transaction
 * meta — the plugin itself does no vault I/O.
 */
export const WIKI_LINK_RESOLUTION_META = 'wikiLinkResolvedTitles';

interface ResolutionPluginState {
  resolvedTitles: ReadonlySet<string>;
  decorations: DecorationSet;
}

const pluginKey = new PluginKey<ResolutionPluginState>('wikiLinkResolution');

function targetStem(rawTarget: string): string {
  return normalize(rawTarget.split('#')[0].split('|')[0]);
}

function buildDecorations(doc: PMNode, resolvedTitles: ReadonlySet<string>): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'wikiLink') return true;
    const target = (node.attrs.target as string) ?? '';
    const stem = targetStem(target);
    if (stem && !resolvedTitles.has(stem)) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'wiki-link-unresolved' }));
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

export const WikiLinkResolutionExtension = Extension.create({
  name: 'wikiLinkResolution',

  addProseMirrorPlugins() {
    return [
      new Plugin<ResolutionPluginState>({
        key: pluginKey,
        state: {
          init() {
            return { resolvedTitles: new Set(), decorations: DecorationSet.empty };
          },
          apply(tr, prev) {
            const meta = tr.getMeta(WIKI_LINK_RESOLUTION_META) as ReadonlySet<string> | undefined;
            const resolvedTitles = meta ?? prev.resolvedTitles;
            if (meta !== undefined || tr.docChanged) {
              return { resolvedTitles, decorations: buildDecorations(tr.doc, resolvedTitles) };
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            return pluginKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

/** Exported for unit testing without a full editor. */
export { targetStem, buildDecorations, pluginKey as wikiLinkResolutionKey };
