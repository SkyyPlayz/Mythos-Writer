import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';

export interface MentionPickerState {
  active: boolean;
  query: string;
  from: number; // doc position of the @ character
  to: number;   // doc position of cursor (end of query text)
}

const INACTIVE: MentionPickerState = { active: false, query: '', from: 0, to: 0 };

export const mentionPickerKey = new PluginKey<MentionPickerState>('entityMentionPicker');

/**
 * Detect an active @query pattern before the cursor.
 *
 * Rules:
 *   - Cursor must be a collapsed selection (no range)
 *   - Search backward in the current block for @
 *   - @ must not be preceded by a word character (word-boundary-style)
 *   - Characters between @ and cursor must match [\w ]* (word chars + spaces)
 *   - Query length capped at 50 characters
 *
 * Position arithmetic: textBetween uses '\0' for atom-node leaf text.
 * Each atom occupies one doc position and one '\0' char, so the bijection
 * between string index and parent-relative doc position holds and
 * `$from.pos - queryPart.length - 1` gives the correct absolute doc position.
 */
function detectQuery(state: EditorState): MentionPickerState {
  const { selection } = state;
  if (selection.from !== selection.to) return INACTIVE; // range selection

  const { $from } = selection;

  // Text from block start to cursor; atom nodes become '\0' (1 char = 1 doc pos)
  const text = $from.parent.textBetween(0, $from.parentOffset, '\0', '\0');

  // Walk backward to find a valid @ trigger
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];

    if (ch === '@') {
      // @ must not be immediately preceded by a word character
      const prev = i > 0 ? text[i - 1] : ' ';
      if (/\w/.test(prev)) return INACTIVE;

      const queryPart = text.slice(i + 1);
      if (queryPart.length > 50) return INACTIVE;
      // Query may only contain word chars and spaces (no '\0' from atom nodes)
      if (!/^[\w ]*$/.test(queryPart)) return INACTIVE;

      return {
        active: true,
        query: queryPart,
        from: $from.pos - queryPart.length - 1,
        to: $from.pos,
      };
    }

    // Stop scanning backward at any character that isn't a word char or space.
    // This ensures we don't match an @ that's preceded by unrelated text
    // without an intervening word boundary.
    if (!/[\w ]/.test(ch)) return INACTIVE;
  }

  return INACTIVE;
}

export const EntityMentionPickerExtension = Extension.create({
  name: 'entityMentionPicker',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: mentionPickerKey,
        state: {
          init(_config, editorState) {
            return detectQuery(editorState);
          },
          apply(tr, prev, _oldState, newState) {
            if (!tr.selectionSet && !tr.docChanged) return prev;
            return detectQuery(newState);
          },
        },
      }),
    ];
  },
});
