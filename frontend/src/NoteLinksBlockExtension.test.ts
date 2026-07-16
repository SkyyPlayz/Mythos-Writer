/**
 * M17 (Beta 4 "Refine"): links block — a paragraph made only of [[wiki links]]
 * (+ separators) gets the `note-links-block` decoration class so CSS renders
 * the prototype chip row. Decorations only: the doc and serialization are
 * untouched (CF-11).
 */
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { Markdown } from 'tiptap-markdown';
import { AlignedParagraph, AlignedHeading } from './lib/alignedBlocks';
import { WikiLink } from './WikiLinkExtension';
import { NoteLinksBlock, isLinksOnlyParagraph } from './NoteLinksBlockExtension';
import type { Node as PMNode } from '@tiptap/pm/model';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = Editor & { storage: any };

function makeEditor(content: string): AnyEditor {
  return new Editor({
    extensions: [
      StarterKit.configure({ paragraph: false, heading: false }),
      AlignedParagraph,
      AlignedHeading,
      TextAlign.configure({ types: ['paragraph', 'heading'] }),
      WikiLink,
      Markdown,
      NoteLinksBlock,
    ],
    content,
  }) as AnyEditor;
}

function firstParagraph(editor: Editor): PMNode {
  let node: PMNode | undefined;
  editor.state.doc.descendants((n) => {
    if (!node && n.type.name === 'paragraph') node = n;
    return !node;
  });
  if (!node) throw new Error('document has no paragraph');
  return node;
}

describe('isLinksOnlyParagraph', () => {
  it('accepts the prototype links row ([[A]] · [[B]] · [[C]])', () => {
    const editor = makeEditor('[[The Great Deep]] · [[Drownlight]] · [[Tide Mechanics]]');
    expect(isLinksOnlyParagraph(firstParagraph(editor))).toBe(true);
    editor.destroy();
  });

  it('rejects a paragraph with prose around the links', () => {
    const editor = makeEditor('See [[The Great Deep]] and [[Drownlight]] for details.');
    expect(isLinksOnlyParagraph(firstParagraph(editor))).toBe(false);
    editor.destroy();
  });

  it('rejects a single lone link (not a links block)', () => {
    const editor = makeEditor('[[The Great Deep]]');
    expect(isLinksOnlyParagraph(firstParagraph(editor))).toBe(false);
    editor.destroy();
  });

  it('rejects an empty paragraph', () => {
    const editor = makeEditor('');
    expect(isLinksOnlyParagraph(firstParagraph(editor))).toBe(false);
    editor.destroy();
  });
});

describe('NoteLinksBlock decorations', () => {
  it('adds note-links-block to links-only paragraphs and only those', () => {
    const editor = makeEditor(
      'Intro prose with [[One Link]].\n\n[[The Great Deep]] · [[Drownlight]] · [[Tide Mechanics]]',
    );
    const decorated = editor.view.dom.querySelectorAll('p.note-links-block');
    expect(decorated).toHaveLength(1);
    expect(decorated[0].textContent).toContain('[[The Great Deep]]');
    editor.destroy();
  });

  it('drops the class when prose is typed into the links row', () => {
    const editor = makeEditor('[[The Great Deep]] · [[Drownlight]]');
    expect(editor.view.dom.querySelectorAll('p.note-links-block')).toHaveLength(1);
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' and some prose');
    expect(editor.view.dom.querySelectorAll('p.note-links-block')).toHaveLength(0);
    editor.destroy();
  });

  it('never changes the serialized markdown (decoration-only)', () => {
    const md = '[[The Great Deep]] · [[Drownlight]] · [[Tide Mechanics]]';
    const editor = makeEditor(md);
    expect(editor.storage.markdown.getMarkdown()).toBe(md);
    editor.destroy();
  });
});
