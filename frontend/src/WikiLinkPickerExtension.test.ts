/**
 * SKY-5702 (GH#650 WL-1): trigger detection for the [[ wiki-link autocomplete
 * popup. Mirrors EntityMentionPickerExtension's '@' detection strategy but
 * for a two-character '[[' trigger, closed by ']]'.
 */

import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { detectWikiLinkTrigger } from './WikiLinkPickerExtension';

function makeEditorAt(content: string, cursorPos: number) {
  const editor = new Editor({ extensions: [StarterKit], content });
  editor.commands.setTextSelection(cursorPos);
  return editor;
}

describe('detectWikiLinkTrigger', () => {
  it('is inactive with no [[ trigger in the block', () => {
    const editor = makeEditorAt('Hello world', 6);
    const state = detectWikiLinkTrigger(editor.state);
    editor.destroy();
    expect(state.active).toBe(false);
  });

  it('activates immediately after typing [[', () => {
    // doc: <p>Hello [[</p> — cursor right after the second '['
    const editor = makeEditorAt('Hello [[', 9);
    const state = detectWikiLinkTrigger(editor.state);
    editor.destroy();
    expect(state.active).toBe(true);
    expect(state.query).toBe('');
  });

  it('reports the query typed after the trigger', () => {
    const editor = makeEditorAt('Hello [[Elara', 14);
    const state = detectWikiLinkTrigger(editor.state);
    editor.destroy();
    expect(state.active).toBe(true);
    expect(state.query).toBe('Elara');
  });

  it('deactivates once the link is closed with ]]', () => {
    // cursor placed just after the closing ]]
    const editor = makeEditorAt('[[Elara]] said hi', 11);
    const state = detectWikiLinkTrigger(editor.state);
    editor.destroy();
    expect(state.active).toBe(false);
  });

  it('is inactive on a non-collapsed selection', () => {
    const editor = new Editor({ extensions: [StarterKit], content: 'Hello [[Elara' });
    editor.commands.setTextSelection({ from: 3, to: 6 });
    const state = detectWikiLinkTrigger(editor.state);
    editor.destroy();
    expect(state.active).toBe(false);
  });

  it('resumes tracking a later [[ trigger after an earlier closed link', () => {
    // "[[Foo]] and [[Bar" — cursor at the very end, after "Bar"
    const content = '[[Foo]] and [[Bar';
    const editor = makeEditorAt(content, content.length + 1);
    const state = detectWikiLinkTrigger(editor.state);
    editor.destroy();
    expect(state.active).toBe(true);
    expect(state.query).toBe('Bar');
  });

  it('reports the absolute doc position of the trigger start', () => {
    const editor = makeEditorAt('Hi [[Elara', 11);
    const state = detectWikiLinkTrigger(editor.state);
    const from = state.from;
    editor.destroy();
    // doc: <p> open (pos 1) + "Hi " (3 chars) = trigger starts at pos 4
    expect(from).toBe(4);
  });
});
