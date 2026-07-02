import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';

/**
 * SKY-5702 (GH#650 WL-1): detects a live `[[` trigger in the current text
 * block and reports the query typed after it, mirroring the `@`-mention
 * picker's detection strategy (EntityMentionPickerExtension).
 */
export interface WikiLinkPickerState {
  active: boolean;
  query: string;
  /** Absolute doc position of the first '[' of the trigger. */
  from: number;
  /** Absolute doc position of the cursor (end of query). */
  to: number;
}

const INACTIVE: WikiLinkPickerState = { active: false, query: '', from: 0, to: 0 };
const MAX_QUERY_LENGTH = 80;

export const wikiLinkPickerKey = new PluginKey<WikiLinkPickerState>('wikiLinkPicker');

function detectWikiLinkTrigger(state: EditorState): WikiLinkPickerState {
  const { selection } = state;
  // Only activate on collapsed cursor
  if (selection.from !== selection.to) return INACTIVE;

  const $from = selection.$from;
  if (!$from.parent.isTextblock) return INACTIVE;

  // Text inside current block from block-start to cursor
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '');
  if (!textBefore) return INACTIVE;

  // Scan backward for the nearest unclosed '[[' trigger.
  const limit = Math.max(0, textBefore.length - MAX_QUERY_LENGTH - 2);

  let triggerPos = -1;
  for (let i = textBefore.length - 2; i >= limit; i--) {
    if (textBefore[i] === '[' && textBefore[i + 1] === '[') {
      triggerPos = i;
      break;
    }
    // A closing ']]' between here and the cursor means any earlier '[[' is
    // already a completed link — stop scanning once we cross one.
    if (textBefore[i] === ']' && textBefore[i + 1] === ']') return INACTIVE;
  }

  if (triggerPos < 0) return INACTIVE;

  const query = textBefore.slice(triggerPos + 2);
  // Bail on a query that already contains a closing bracket or a newline —
  // the link is complete or malformed, not a live trigger.
  if (query.includes(']') || query.includes('\n')) return INACTIVE;

  const blockStart = $from.start($from.depth);

  return {
    active: true,
    query,
    from: blockStart + triggerPos,
    to: selection.from,
  };
}

export const WikiLinkPickerExtension = Extension.create({
  name: 'wikiLinkPicker',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: wikiLinkPickerKey,
        state: {
          init() {
            return INACTIVE;
          },
          apply(_tr, _prev, _oldState, newState) {
            return detectWikiLinkTrigger(newState);
          },
        },
      }),
    ];
  },
});

/** Exported for unit-testing the detection logic without a full editor. */
export { detectWikiLinkTrigger, INACTIVE as INACTIVE_WIKI_LINK_PICKER };
