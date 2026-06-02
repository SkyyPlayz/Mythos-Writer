/**
 * Security regression tests -- SKY-234
 *
 * The markdown-it wiki_link renderer returns a raw HTML string.  Without
 * escaping `<` and `>`, a wiki-link like [[<script>alert(1)</script>]] would
 * inject a live element into the editor DOM when the string is parsed as HTML.
 *
 * These tests confirm that XSS payloads in wiki-link targets are neutralised
 * before they reach the DOM.
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

describe('WikiLink renderer -- XSS escaping (SKY-234)', () => {
  it('script tag payload does not create a <script> element in the editor DOM', () => {
    const editor = makeEditor('[[<script>alert(1)</script>]]');
    const found = editor.view.dom.querySelector('script');
    editor.destroy();
    expect(found).toBeNull();
  });

  it('img onerror payload does not create an injected <img> element in the editor DOM', () => {
    // ProseMirror adds its own <img class="ProseMirror-separator"> nodes -- we
    // look specifically for an img with an onerror attribute, which would only
    // appear if the XSS payload was injected unescaped.
    const editor = makeEditor('[[<img src=x onerror=alert(1)>]]');
    const found = editor.view.dom.querySelector('img[onerror]');
    editor.destroy();
    expect(found).toBeNull();
  });

  it('safe wiki-link targets are still rendered and round-trip correctly', () => {
    const editor = makeEditor('[[Elara Brightwood]]');
    const span = editor.view.dom.querySelector('span[data-wiki-link]');
    const roundTripped = editor.storage.markdown.getMarkdown() as string;
    editor.destroy();
    expect(span).not.toBeNull();
    expect(roundTripped).toContain('[[Elara Brightwood]]');
  });

  it('ampersand in wiki-link target survives round-trip', () => {
    const editor = makeEditor('See [[A & B]] for details.');
    const md = editor.storage.markdown.getMarkdown() as string;
    editor.destroy();
    expect(md).toContain('[[A & B]]');
  });
});
