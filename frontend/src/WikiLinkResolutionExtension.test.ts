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

// ─── M16 (Beta 3): scene-kind decoration + rich meta payload ───

function makeEditorWithMeta(content: string, meta: unknown) {
  const editor = new Editor({
    extensions: [StarterKit, WikiLink, WikiLinkResolutionExtension, Markdown],
    content,
  });
  editor.view.dispatch(editor.state.tr.setMeta(WIKI_LINK_RESOLUTION_META, meta));
  return editor;
}

describe('WikiLinkResolutionExtension scene-kind decorations (M16)', () => {
  it('marks a link resolving to a scene with .wiki-link-scene', () => {
    const editor = makeEditorWithMeta('[[Opening Scene]]', {
      resolvedTitles: new Set(['opening scene']),
      sceneTitles: new Set(['opening scene']),
    });
    const span = editor.view.dom.querySelector('span[data-wiki-link]');
    editor.destroy();
    expect(span?.classList.contains('wiki-link-scene')).toBe(true);
    expect(span?.classList.contains('wiki-link-unresolved')).toBe(false);
  });

  it('leaves a note link without the scene class', () => {
    const editor = makeEditorWithMeta('[[Elara Voss]]', {
      resolvedTitles: new Set(['elara voss', 'opening scene']),
      sceneTitles: new Set(['opening scene']),
    });
    const span = editor.view.dom.querySelector('span[data-wiki-link]');
    editor.destroy();
    expect(span?.classList.contains('wiki-link-scene')).toBe(false);
    expect(span?.classList.contains('wiki-link-unresolved')).toBe(false);
  });

  it('unresolved wins over scene when the stem is not in resolvedTitles', () => {
    const editor = makeEditorWithMeta('[[Ghost Scene]]', {
      resolvedTitles: new Set(),
      sceneTitles: new Set(['ghost scene']),
    });
    const span = editor.view.dom.querySelector('span[data-wiki-link]');
    editor.destroy();
    expect(span?.classList.contains('wiki-link-unresolved')).toBe(true);
    expect(span?.classList.contains('wiki-link-scene')).toBe(false);
  });

  it('still accepts the legacy bare-Set meta shape (back-compat)', () => {
    const editor = makeEditorWithMeta('[[Elara Voss]]', new Set(['elara voss']));
    const span = editor.view.dom.querySelector('span[data-wiki-link]');
    editor.destroy();
    expect(span?.classList.contains('wiki-link-unresolved')).toBe(false);
    expect(span?.classList.contains('wiki-link-scene')).toBe(false);
  });
});
