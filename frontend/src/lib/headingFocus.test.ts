// GH #631 — heading-focus selectors + extension contract.
// The hard contract: heading focus is decoration-only. The document (and thus
// autosave payloads and scene version backups) always carries the full text.
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { WikiLink } from '../WikiLinkExtension';
import {
  collectHeadings,
  levelsPresent,
  headingsAtLevel,
  sectionRange,
  hiddenRanges,
  clampIndex,
  stepFocus,
  focusState,
  reconcileFocusLevel,
} from './headingFocus';
import { HeadingFocusExtension, headingFocusKey } from '../HeadingFocusExtension';

const DOC = [
  '# Book One',
  '',
  'Intro paragraph.',
  '',
  '## Chapter A',
  '',
  'Chapter A text.',
  '',
  '### Scene A1',
  '',
  'Scene A1 text.',
  '',
  '## Chapter B',
  '',
  'Chapter B text.',
].join('\n');

function makeEditor(content: string): Editor {
  return new Editor({
    extensions: [StarterKit, WikiLink, Markdown, HeadingFocusExtension],
    content,
  });
}

function markdownOf(editor: Editor): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (editor.storage as any).markdown.getMarkdown() as string;
}

describe('headingFocus selectors', () => {
  it('collects headings in document order with levels', () => {
    const editor = makeEditor(DOC);
    const headings = collectHeadings(editor.state.doc);
    expect(headings.map((h) => [h.level, h.text])).toEqual([
      [1, 'Book One'],
      [2, 'Chapter A'],
      [3, 'Scene A1'],
      [2, 'Chapter B'],
    ]);
    editor.destroy();
  });

  it('reports the distinct levels present', () => {
    const editor = makeEditor(DOC);
    expect(levelsPresent(editor.state.doc)).toEqual([1, 2, 3]);
    editor.destroy();
  });

  it('section of an H2 ends at the next heading of level <= 2', () => {
    const editor = makeEditor(DOC);
    const doc = editor.state.doc;
    const [chapterA, chapterB] = headingsAtLevel(doc, 2);
    const range = sectionRange(doc, 2, 0);
    expect(range).not.toBeNull();
    expect(range!.start).toBe(chapterA.pos);
    // Chapter A's section swallows Scene A1 (H3) but stops at Chapter B (H2).
    expect(range!.end).toBe(chapterB.pos);
    editor.destroy();
  });

  it('the last section runs to the end of the document', () => {
    const editor = makeEditor(DOC);
    const range = sectionRange(editor.state.doc, 2, 1);
    expect(range!.end).toBe(editor.state.doc.content.size);
    editor.destroy();
  });

  it('hiddenRanges excludes exactly the out-of-section top-level blocks', () => {
    const editor = makeEditor(DOC);
    const doc = editor.state.doc;
    const hidden = hiddenRanges(doc, 2, 0);
    const section = sectionRange(doc, 2, 0)!;
    for (const r of hidden) {
      expect(r.to <= section.start || r.from >= section.end).toBe(true);
    }
    // H1 + intro before, Chapter B heading + text after = 4 hidden blocks.
    expect(hidden).toHaveLength(4);
    editor.destroy();
  });

  it('returns no hidden ranges when the level has no headings', () => {
    const editor = makeEditor(DOC);
    expect(hiddenRanges(editor.state.doc, 5, 0)).toEqual([]);
    editor.destroy();
  });

  it('clamps the index when headings disappear', () => {
    const editor = makeEditor(DOC);
    expect(clampIndex(editor.state.doc, 2, 7)).toBe(1);
    expect(clampIndex(editor.state.doc, 2, -3)).toBe(0);
    expect(clampIndex(editor.state.doc, 6, 4)).toBe(0);
    editor.destroy();
  });

  it('steps between same-level siblings with bounded semantics', () => {
    const editor = makeEditor(DOC);
    const doc = editor.state.doc;
    const next = stepFocus(doc, 2, 0, 'next');
    expect(next).toEqual({ index: 1, count: 2, canPrev: true, canNext: false });
    const prevAtStart = stepFocus(doc, 2, 0, 'prev');
    expect(prevAtStart.index).toBe(0);
    expect(prevAtStart.canPrev).toBe(false);
    editor.destroy();
  });

  it('focusState reports without moving', () => {
    const editor = makeEditor(DOC);
    expect(focusState(editor.state.doc, 2, 1)).toEqual({ index: 1, count: 2, canPrev: true, canNext: false });
    editor.destroy();
  });
});

describe('HeadingFocusExtension (decoration-only contract)', () => {
  it('is inert by default', () => {
    const editor = makeEditor(DOC);
    expect(headingFocusKey.getState(editor.state)).toEqual({ level: null, index: 0 });
    editor.destroy();
  });

  it('setHeadingFocus updates plugin state; clearHeadingFocus resets it', () => {
    const editor = makeEditor(DOC);
    editor.commands.setHeadingFocus(2, 1);
    expect(headingFocusKey.getState(editor.state)).toEqual({ level: 2, index: 1 });
    editor.commands.clearHeadingFocus();
    expect(headingFocusKey.getState(editor.state)).toEqual({ level: null, index: 0 });
    editor.destroy();
  });

  it('produces hide decorations for out-of-section blocks', () => {
    const editor = makeEditor(DOC);
    editor.commands.setHeadingFocus(2, 0);
    const plugin = headingFocusKey.get(editor.state)!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const decoSet = (plugin.props.decorations as any).call(plugin, editor.state);
    expect(decoSet.find()).toHaveLength(4);
    editor.destroy();
  });

  it('CONTRACT: serialized markdown is the FULL document while focused', () => {
    const editor = makeEditor(DOC);
    const before = markdownOf(editor);
    editor.commands.setHeadingFocus(2, 0);
    const during = markdownOf(editor);
    expect(during).toBe(before);
    expect(during).toContain('# Book One');
    expect(during).toContain('## Chapter B');
    editor.destroy();
  });

  it('clamps focus index when the document loses headings', () => {
    const editor = makeEditor(DOC);
    editor.commands.setHeadingFocus(2, 1);
    // Delete everything and retype a single H2 — index must clamp to 0.
    editor.commands.setContent('## Only Chapter\n\nText.');
    const state = headingFocusKey.getState(editor.state);
    expect(state).toEqual({ level: 2, index: 0 });
    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// SKY-5902 — reconcileFocusLevel: the BlockEditor <select> must never point
// at a level `levelsPresent` no longer reports (an orphaned <option>).
// ---------------------------------------------------------------------------

describe('reconcileFocusLevel (SKY-5902)', () => {
  it('resets to All when the focused level is no longer present', () => {
    expect(reconcileFocusLevel({ level: 3, index: 2 }, [2])).toEqual({ level: null, index: 0 });
  });

  it('leaves the selection untouched when the focused level is still present', () => {
    const selection = { level: 2, index: 1 };
    expect(reconcileFocusLevel(selection, [2, 3])).toBe(selection);
  });

  it('is a no-op when nothing is focused (level: null)', () => {
    const selection = { level: null, index: 0 };
    expect(reconcileFocusLevel(selection, [])).toBe(selection);
  });

  it('resets when every heading has been removed from the document', () => {
    expect(reconcileFocusLevel({ level: 2, index: 0 }, [])).toEqual({ level: null, index: 0 });
  });
});
