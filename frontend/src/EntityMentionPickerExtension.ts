import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';

export interface MentionPickerState {
  active: boolean;
  query: string;
  /** Absolute doc position of the '@' character. */
  from: number;
  /** Absolute doc position of the cursor (end of query). */
  to: number;
}

const INACTIVE: MentionPickerState = { active: false, query: '', from: 0, to: 0 };
const MAX_QUERY_LENGTH = 60;

export const mentionPickerKey = new PluginKey<MentionPickerState>('entityMentionPicker');

function detectMention(state: EditorState): MentionPickerState {
  const { selection } = state;
  // Only activate on collapsed cursor
  if (selection.from !== selection.to) return INACTIVE;

  const $from = selection.$from;
  if (!$from.parent.isTextblock) return INACTIVE;

  // Text inside current block from block-start to cursor
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '');
  if (!textBefore) return INACTIVE;

  // Scan backward for a valid '@' trigger.
  // Limit scan to MAX_QUERY_LENGTH + 1 chars so we don't walk the entire line.
  const limit = Math.max(0, textBefore.length - MAX_QUERY_LENGTH - 1);

  let atPos = -1;
  for (let i = textBefore.length - 1; i >= limit; i--) {
    if (textBefore[i] === '@') {
      // Valid trigger: '@' at block start or preceded by whitespace
      if (i === 0 || /\s/.test(textBefore[i - 1])) {
        atPos = i;
      }
      // Stop at first '@' found regardless (working backward)
      break;
    }
  }

  if (atPos < 0) return INACTIVE;

  const query = textBefore.slice(atPos + 1);
  // Block start in absolute document coordinates
  const blockStart = $from.start($from.depth);

  return {
    active: true,
    query,
    from: blockStart + atPos,
    to: selection.from,
  };
}

export const EntityMentionPickerExtension = Extension.create({
  name: 'entityMentionPicker',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: mentionPickerKey,
        state: {
          init() {
            return INACTIVE;
          },
          apply(_tr, _prev, _oldState, newState) {
            return detectMention(newState);
          },
        },
      }),
    ];
  },
});

/** Exported for unit-testing the detection logic without a full editor. */
export { detectMention, INACTIVE };
