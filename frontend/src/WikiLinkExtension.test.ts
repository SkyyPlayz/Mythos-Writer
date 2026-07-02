/**
 * SKY-5702 (GH#650 WL-1): [[Target|Alias]] parsing, rendering, and round-trip
 * serialization for the wiki-link atom node.
 */

import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { WikiLink } from './WikiLinkExtension';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = Editor & { storage: any };

function makeEditor(content: string): AnyEditor {
  return new Editor({
    extensions: [StarterKit, WikiLink, Markdown],
    content,
  }) as AnyEditor;
}

describe('WikiLink alias parsing (SKY-5702)', () => {
  it('parses [[Target|Alias]] into separate target and alias attrs', () => {
    const editor = makeEditor('[[Elara Brightwood|Elara]]');
    const span = editor.view.dom.querySelector('span[data-wiki-link]') as HTMLElement | null;
    editor.destroy();
    expect(span).not.toBeNull();
    expect(span?.getAttribute('data-wiki-link')).toBe('Elara Brightwood');
    expect(span?.getAttribute('data-wiki-link-alias')).toBe('Elara');
  });

  it('displays the alias, not the raw target, as the visible text', () => {
    const editor = makeEditor('[[Elara Brightwood|Elara]]');
    const span = editor.view.dom.querySelector('span[data-wiki-link]');
    editor.destroy();
    expect(span?.textContent).toBe('[[Elara]]');
  });

  it('round-trips [[Target|Alias]] without corrupting content', () => {
    const editor = makeEditor('See [[Elara Brightwood|Elara]] at the gate.');
    const md = editor.storage.markdown.getMarkdown() as string;
    editor.destroy();
    expect(md).toContain('[[Elara Brightwood|Elara]]');
  });

  it('round-trips a plain [[Target]] link with no alias unchanged', () => {
    const editor = makeEditor('[[Elara Brightwood]]');
    const span = editor.view.dom.querySelector('span[data-wiki-link]');
    const md = editor.storage.markdown.getMarkdown() as string;
    editor.destroy();
    expect(span?.getAttribute('data-wiki-link-alias')).toBeNull();
    expect(span?.textContent).toBe('[[Elara Brightwood]]');
    expect(md).toContain('[[Elara Brightwood]]');
    expect(md).not.toContain('|');
  });

  it('only splits on the first pipe when the target itself contains one', () => {
    const editor = makeEditor('[[A|B|C]]');
    const span = editor.view.dom.querySelector('span[data-wiki-link]') as HTMLElement | null;
    editor.destroy();
    expect(span?.getAttribute('data-wiki-link')).toBe('A');
    expect(span?.getAttribute('data-wiki-link-alias')).toBe('B|C');
  });

  it('escapes HTML in both target and alias', () => {
    const editor = makeEditor('[[<b>t</b>|<i>a</i>]]');
    const injected = editor.view.dom.querySelector('b, i');
    editor.destroy();
    expect(injected).toBeNull();
  });
});
