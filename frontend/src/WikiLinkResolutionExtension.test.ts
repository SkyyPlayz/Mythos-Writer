/**
 * SKY-5702 (GH#650 WL-1): unresolved [[wiki link]] decoration — marks
 * wikiLink nodes whose target has no match in the current resolved-title
 * set with `.wiki-link-unresolved`.
 */

import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { WikiLink } from './WikiLinkExtension';
import { WikiLinkResolutionExtension, WIKI_LINK_RESOLUTION_META, targetStem } from './WikiLinkResolutionExtension';

function makeEditor(content: string, resolvedTitles: ReadonlySet<string>) {
  const editor = new Editor({
    extensions: [StarterKit, WikiLink, WikiLinkResolutionExtension, Markdown],
    content,
  });
  editor.view.dispatch(editor.state.tr.setMeta(WIKI_LINK_RESOLUTION_META, resolvedTitles));
  return editor;
}

describe('targetStem', () => {
  it('strips a #heading anchor', () => {
    expect(targetStem('Opening Scene#Notes')).toBe('opening scene');
  });

  it('strips a |alias suffix', () => {
    expect(targetStem('Elara Voss|Voss')).toBe('elara voss');
  });

  it('is case-insensitive', () => {
    expect(targetStem('ELARA')).toBe('elara');
  });
});

describe('WikiLinkResolutionExtension decorations', () => {
  it('does not mark a resolved wiki link', () => {
    const editor = makeEditor('[[Elara Voss]]', new Set(['elara voss']));
    const span = editor.view.dom.querySelector('span[data-wiki-link]');
    editor.destroy();
    expect(span?.classList.contains('wiki-link-unresolved')).toBe(false);
  });

  it('marks an unresolved wiki link with .wiki-link-unresolved', () => {
    const editor = makeEditor('[[Nobody Here]]', new Set(['elara voss']));
    const span = editor.view.dom.querySelector('span[data-wiki-link]');
    editor.destroy();
    expect(span?.classList.contains('wiki-link-unresolved')).toBe(true);
  });

  it('re-decorates after the resolved-title set is updated via meta', () => {
    const editor = makeEditor('[[Elara Voss]]', new Set());
    let span = editor.view.dom.querySelector('span[data-wiki-link]');
    expect(span?.classList.contains('wiki-link-unresolved')).toBe(true);

    editor.view.dispatch(editor.state.tr.setMeta(WIKI_LINK_RESOLUTION_META, new Set(['elara voss'])));
    span = editor.view.dom.querySelector('span[data-wiki-link]');
    editor.destroy();
    expect(span?.classList.contains('wiki-link-unresolved')).toBe(false);
  });

  it('ignores a [[Target|Alias]] pipe when checking resolution', () => {
    const editor = makeEditor('[[Elara Voss|Elara]]', new Set(['elara voss']));
    const span = editor.view.dom.querySelector('span[data-wiki-link]');
    editor.destroy();
    expect(span?.classList.contains('wiki-link-unresolved')).toBe(false);
  });
});
