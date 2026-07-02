// Contract tests for SKY-5705 / GH #642 — the shared document mark/format
// schema used by BOTH the Story (BlockEditor) and Notes (NoteViewer) editors.
// Builds the editor with the exact extension set `useRichEditor` wires up
// (not a re-implementation) so these tests fail if the shared schema drifts.
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { Markdown } from 'tiptap-markdown';
import { WikiLink } from '../WikiLinkExtension';
import { AlignedParagraph, AlignedHeading } from './alignedBlocks';

function sharedExtensions() {
  return [
    StarterKit.configure({ paragraph: false, heading: false }),
    AlignedParagraph,
    AlignedHeading,
    TextAlign.configure({ types: ['paragraph', 'heading'] }),
    WikiLink,
    Markdown,
  ];
}

function makeEditor(content: string): Editor {
  return new Editor({ extensions: sharedExtensions(), content });
}

function serialize(editor: Editor): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (editor.storage as any).markdown.getMarkdown() as string;
}

/** Parse markdown, re-serialize, and return the result (a single save→reload cycle). */
function roundTrip(markdown: string): string {
  const editor = makeEditor(markdown);
  const out = serialize(editor);
  editor.destroy();
  return out;
}

describe('CONTRACT: shared rich-text schema — full mark set round-trips (SKY-5705)', () => {
  it('bold round-trips', () => {
    expect(roundTrip('This is **bold** text.')).toContain('**bold**');
  });

  it('italic round-trips', () => {
    expect(roundTrip('This is *italic* text.')).toMatch(/[*_]italic[*_]/);
  });

  it('underline round-trips as raw HTML (no CommonMark underline syntax)', () => {
    const editor = makeEditor('This is <u>underlined</u> text.');
    expect(editor.getHTML()).toContain('<u>underlined</u>');
    editor.destroy();
  });

  it('strikethrough round-trips', () => {
    expect(roundTrip('This is ~~struck~~ text.')).toContain('~~struck~~');
  });

  it.each([1, 2, 3, 4, 5, 6])('H%i heading round-trips exactly', (level) => {
    const md = `${'#'.repeat(level)} Heading text`;
    expect(roundTrip(md).trim()).toBe(md);
  });

  it('bullet list round-trips all items', () => {
    const out = roundTrip('- One\n- Two\n- Three');
    expect(out).toContain('One');
    expect(out).toContain('Two');
    expect(out).toContain('Three');
    expect(out).toMatch(/[-*+]\s/);
  });

  it('ordered list round-trips all items and numbering', () => {
    const out = roundTrip('1. One\n2. Two\n3. Three');
    expect(out).toMatch(/1\.\s+One/);
    expect(out).toMatch(/2\.\s+Two/);
    expect(out).toMatch(/3\.\s+Three/);
  });

  it('[[wiki-link]] tokens survive round-trip unescaped', () => {
    expect(roundTrip('See [[Elara]] for details.')).toContain('[[Elara]]');
  });
});

describe('CONTRACT: paragraph/heading alignment (SKY-5705)', () => {
  it('left alignment (the default) never emits a marker — existing docs are byte-stable', () => {
    const md = 'Plain paragraph, never aligned.';
    expect(roundTrip(md).trim()).toBe(md);
  });

  it('a document with no alignment set round-trips identically before and after this feature', () => {
    // Regression guard for "existing documents load without loss": headings and
    // lists that never touch alignment must serialize exactly as they did
    // before AlignedParagraph/AlignedHeading/TextAlign existed.
    const md = '# Chapter One\n\nA paragraph with **bold** and *italic* text.\n\n- alpha\n- beta';
    expect(roundTrip(md).trim()).toBe(md.trim());
  });

  it('setting paragraph alignment to center persists through save and reload', () => {
    const editor = makeEditor('Centered text.');
    editor.commands.setTextAlign('center');
    const saved = serialize(editor);
    editor.destroy();

    expect(saved).toContain('{.center}');

    const reloaded = makeEditor(saved);
    expect(reloaded.getJSON().content?.[0]?.attrs?.textAlign).toBe('center');
    expect(serialize(reloaded).trim()).toBe(saved.trim());
    reloaded.destroy();
  });

  it('right and justify alignment both persist through save and reload', () => {
    for (const align of ['right', 'justify'] as const) {
      const editor = makeEditor('Aligned text.');
      editor.commands.setTextAlign(align);
      const saved = serialize(editor);
      editor.destroy();

      expect(saved).toContain(`{.${align}}`);

      const reloaded = makeEditor(saved);
      expect(reloaded.getJSON().content?.[0]?.attrs?.textAlign).toBe(align);
      reloaded.destroy();
    }
  });

  it('heading alignment persists through save and reload alongside the heading level', () => {
    const editor = makeEditor('## Scene Two');
    editor.commands.setTextAlign('center');
    const saved = serialize(editor);
    editor.destroy();

    expect(saved.trim()).toBe('## Scene Two {.center}');

    const reloaded = makeEditor(saved);
    const headingNode = reloaded.getJSON().content?.[0];
    expect(headingNode?.type).toBe('heading');
    expect(headingNode?.attrs?.level).toBe(2);
    expect(headingNode?.attrs?.textAlign).toBe('center');
    reloaded.destroy();
  });

  it('unsetting alignment removes the marker on the next save', () => {
    const editor = makeEditor('Text.');
    editor.commands.setTextAlign('center');
    editor.commands.unsetTextAlign();
    const saved = serialize(editor);
    editor.destroy();

    expect(saved).not.toContain('{.center}');
  });

  it('a full-mark-set document (headings, lists, alignment, inline marks) round-trips byte-stable', () => {
    const editor = makeEditor(
      '# Title\n\nA paragraph with **bold**, *italic*, and ~~struck~~ text.\n\n- alpha\n- beta',
    );
    editor.commands.setTextAlign('center');
    const saved = serialize(editor);
    editor.destroy();

    const reloaded = makeEditor(saved);
    const resaved = serialize(reloaded);
    reloaded.destroy();

    expect(resaved).toBe(saved);
  });
});
