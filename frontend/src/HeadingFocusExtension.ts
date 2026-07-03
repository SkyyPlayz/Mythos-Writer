// GH #631: heading-focus mode — hides every top-level block outside the active
// heading section using node decorations (display:none via CSS). The document
// is untouched: serialization, autosave, and scene version backups always see
// the full text. Inert until setHeadingFocus is dispatched.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { clampIndex, hiddenRanges } from './lib/headingFocus';

export interface HeadingFocusState {
  level: number | null;
  index: number;
}

export const headingFocusKey = new PluginKey<HeadingFocusState>('headingFocus');

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    headingFocus: {
      /** Focus the `index`-th heading of `level`; everything outside its section hides. */
      setHeadingFocus: (level: number, index: number) => ReturnType;
      /** Show the whole document again. */
      clearHeadingFocus: () => ReturnType;
    };
  }
}

export const HeadingFocusExtension = Extension.create({
  name: 'headingFocus',

  addCommands() {
    return {
      setHeadingFocus:
        (level: number, index: number) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(headingFocusKey, { level, index }));
          return true;
        },
      clearHeadingFocus:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(headingFocusKey, { level: null, index: 0 }));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<HeadingFocusState>({
        key: headingFocusKey,
        state: {
          init: () => ({ level: null, index: 0 }),
          apply: (tr, prev) => {
            const meta = tr.getMeta(headingFocusKey) as HeadingFocusState | undefined;
            const next = meta ?? prev;
            if (next.level === null) return { level: null, index: 0 };
            // Doc edits can remove headings — keep the focus index valid.
            return { level: next.level, index: clampIndex(tr.doc, next.level, next.index) };
          },
        },
        props: {
          decorations(state) {
            const focus = headingFocusKey.getState(state);
            if (!focus || focus.level === null) return DecorationSet.empty;
            const ranges = hiddenRanges(state.doc, focus.level, focus.index);
            if (ranges.length === 0) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              ranges.map(({ from, to }) => Decoration.node(from, to, { class: 'heading-focus-hidden' })),
            );
          },
        },
      }),
    ];
  },
});
