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
 * M16 (Beta 3): additionally marks links that resolve to STORY scenes with
 * `.wiki-link-scene`, so the notes editor can render them gold (prototype
 * `mkLink` parity) while note links stay slot-B purple.
 *
 * The resolved-title set is supplied externally (built once from the current
 * vault state via `buildWikiLinkTitleIndex`) and pushed in via transaction
 * meta — the plugin itself does no vault I/O.
 */
export const WIKI_LINK_RESOLUTION_META = 'wikiLinkResolvedTitles';

/** M16: richer meta payload; a bare ReadonlySet<string> is still accepted. */
export interface WikiLinkResolutionMeta {
  resolvedTitles: ReadonlySet<string>;
  /** Stems that resolve to story scenes (subset styling, gold links). */
  sceneTitles?: ReadonlySet<string>;
}

interface ResolutionPluginState {
  resolvedTitles: ReadonlySet<string>;
  sceneTitles: ReadonlySet<string>;
  decorations: DecorationSet;
}

const pluginKey = new PluginKey<ResolutionPluginState>('wikiLinkResolution');

const EMPTY_SET: ReadonlySet<string> = new Set();

function targetStem(rawTarget: string): string {
  return normalize(rawTarget.split('#')[0].split('|')[0]);
}

function normalizeMeta(meta: ReadonlySet<string> | WikiLinkResolutionMeta): { resolvedTitles: ReadonlySet<string>; sceneTitles: ReadonlySet<string> } {
  if (meta instanceof Set) {
    return { resolvedTitles: meta, sceneTitles: EMPTY_SET };
  }
  const rich = meta as WikiLinkResolutionMeta;
  return { resolvedTitles: rich.resolvedTitles ?? EMPTY_SET, sceneTitles: rich.sceneTitles ?? EMPTY_SET };
}

function buildDecorations(
  doc: PMNode,
  resolvedTitles: ReadonlySet<string>,
  sceneTitles: ReadonlySet<string> = EMPTY_SET,
): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'wikiLink') return true;
    const target = (node.attrs.target as string) ?? '';
    const stem = targetStem(target);
    if (!stem) return true;
    if (!resolvedTitles.has(stem)) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'wiki-link-unresolved' }));
    } else if (sceneTitles.has(stem)) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'wiki-link-scene' }));
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
            return { resolvedTitles: new Set(), sceneTitles: new Set(), decorations: DecorationSet.empty };
          },
          apply(tr, prev) {
            const meta = tr.getMeta(WIKI_LINK_RESOLUTION_META) as ReadonlySet<string> | WikiLinkResolutionMeta | undefined;
            const { resolvedTitles, sceneTitles } = meta !== undefined
              ? normalizeMeta(meta)
              : { resolvedTitles: prev.resolvedTitles, sceneTitles: prev.sceneTitles };
            if (meta !== undefined || tr.docChanged) {
              return { resolvedTitles, sceneTitles, decorations: buildDecorations(tr.doc, resolvedTitles, sceneTitles) };
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
