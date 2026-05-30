import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';

export interface MentionPickerState {
  active: boolean;
  query: string;
  from: number;
  to: number;
}

export const mentionPickerKey = new PluginKey<MentionPickerState>('entityMentionPicker');

const INACTIVE: MentionPickerState = { active: false, query: '', from: 0, to: 0 };

function detectQuery(state: EditorState): MentionPickerState {
  const { $from } = state.selection;
  if (!$from.parent.isTextblock) return INACTIVE;

  // textBetween with '\0' as leaf-node placeholder prevents atom nodes from
  // merging with adjacent text, so we never accidentally match across mentions.
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\0');

  // Match @word-chars-and-spaces at end of text before cursor (max 50 chars).
  const match = textBefore.match(/@([\w ]*)$/);
  if (!match || match[1].length > 50) return INACTIVE;

  return {
    active: true,
    query: match[1],
    from: $from.pos - match[0].length,
    to: $from.pos,
  };
}

export const EntityMentionPickerExtension = Extension.create({
  name: 'entityMentionPicker',

  addProseMirrorPlugins() {
    return [
      new Plugin<MentionPickerState>({
        key: mentionPickerKey,
        state: {
          init(_, editorState) {
            return detectQuery(editorState);
          },
          apply(_tr, _old, _oldState, newState) {
            return detectQuery(newState);
          },
        },
      }),
    ];
  },
});
