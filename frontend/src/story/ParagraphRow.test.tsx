// Perf audit P3 — ParagraphRow memoization. Render-count probes for the memo
// gate (paragraphRowPropsEqual), the mid-edit caret guard, and integration
// through ManuscriptView: per-row segment/hint computations must no longer
// run on unrelated view-level re-renders, and an in-flight contentEditable
// edit must survive them.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { memo, useCallback, useState, type CSSProperties } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Block, Chapter, Scene, Story } from '../types';
import ManuscriptView from './ManuscriptView';
import {
  ParagraphRowBase,
  paragraphRowPropsEqual,
  type ParagraphRowProps,
} from './ParagraphRow';
import { commentsStore, segmentsFor, type StoryComment } from '../comments';
import { findAutoLinkHints, type EntityTerm } from './autoLinkText';
import type { ManuscriptCursor } from './manuscriptModel';

// Passthrough spies: same behavior, observable call counts. Both ParagraphRow
// and ManuscriptView resolve these module ids, so per-row recomputation is
// countable from the outside.
vi.mock('../comments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../comments')>();
  return { ...actual, segmentsFor: vi.fn(actual.segmentsFor) };
});
vi.mock('./autoLinkText', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./autoLinkText')>();
  return { ...actual, findAutoLinkHints: vi.fn(actual.findAutoLinkHints) };
});

const NOW = '2026-07-08T00:00:00.000Z';

// ─── ParagraphRow probe fixtures ─────────────────────────────────────────────

const EMPTY_COMMENTS: readonly StoryComment[] = [];
const EMPTY_TERMS: EntityTerm[] = [];
const PARA_STYLE: CSSProperties = { textAlign: 'left' };
const noopCommit = () => {};
const noopGrip = () => {};
const noopOver = () => {};
const noopDrop = () => {};
const noopOpen = () => {};
const noopApply = () => {};

function mkComment(id: string, sceneId: string, anchor: string): StoryComment {
  return {
    id,
    storyId: 'story-1',
    sceneId,
    anchor,
    author: 'You',
    kind: 'user',
    text: 'note',
    createdAt: NOW,
  };
}

function rowProps(blockId: string, over: Partial<ParagraphRowProps> = {}): ParagraphRowProps {
  return {
    sceneId: 's1',
    blockId,
    content: `Prose for ${blockId}.`,
    comments: EMPTY_COMMENTS,
    autoLinkTerms: EMPTY_TERMS,
    reading: false,
    showDropLine: false,
    dragging: false,
    dropCap: false,
    paraStyle: PARA_STYLE,
    onCommit: noopCommit,
    onGripDown: noopGrip,
    onParaOver: noopOver,
    onParaDrop: noopDrop,
    onOpenComment: noopOpen,
    onApplyAutoLink: noopApply,
    ...over,
  };
}

/** Render-count probe: the production memo gate around a logging base row. */
const renderLog: string[] = [];
function LoggedRowBase(props: ParagraphRowProps) {
  renderLog.push(props.blockId);
  return <ParagraphRowBase {...props} />;
}
const LoggedRow = memo(LoggedRowBase, paragraphRowPropsEqual);

// ─── ManuscriptView fixtures (same shapes as the sibling MSV test files) ─────

function mkBlock(id: string, content: string, order: number): Block {
  return { id, type: 'prose', content, order, updatedAt: NOW };
}

function mkScene(id: string, title: string, order: number, paras: string[]): Scene {
  return {
    id,
    title,
    path: `scenes/${id}.md`,
    order,
    blocks: paras.map((p, i) => mkBlock(`${id}-b${i}`, p, i)),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function mkChapter(id: string, title: string, order: number, scenes: Scene[]): Chapter {
  return { id, title, path: `chapters/${id}`, order, scenes, createdAt: NOW, updatedAt: NOW };
}

function mkStory(): Story {
  return {
    id: 'story-1',
    title: 'The Last City of Veynn',
    path: 'stories/story-1',
    chapters: [
      mkChapter('ch1', 'The Quiet Before', 0, [
        mkScene('s1', "The Watcher's Call", 0, [
          'Mira counted the bells. The lantern cast a trembling circle of light.',
          'Getting out would be another story.',
        ]),
        mkScene('s2', 'A City in Shadows', 1, ['By morning the rumor had teeth.']),
      ]),
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function mkEntity(name: string): EntityEntry {
  return {
    id: `ent-${name.toLowerCase()}`,
    name,
    type: 'character',
    aliases: [],
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
  } as unknown as EntityEntry;
}

const BOOK: ManuscriptCursor = { zoom: 'book', part: 0, chapter: 0, scene: 0 };
const ENTITIES = [mkEntity('Mira')];

function renderView(over: Partial<Parameters<typeof ManuscriptView>[0]> = {}) {
  const props = {
    story: mkStory(),
    cursor: BOOK,
    onCursorChange: vi.fn(),
    onEditParagraph: vi.fn(),
    onCycleStatus: vi.fn(),
    ...over,
  };
  return { ...render(<ManuscriptView {...props} />), props };
}

beforeEach(() => {
  commentsStore.reset();
  renderLog.length = 0;
  vi.mocked(segmentsFor).mockClear();
  vi.mocked(findAutoLinkHints).mockClear();
});

afterEach(() => {
  cleanup();
  commentsStore.reset();
});

// ─── The memo gate ───────────────────────────────────────────────────────────

describe('ParagraphRow memo gate (render-count probes)', () => {
  it('a parent re-render with unchanged props re-renders no rows', () => {
    const a = rowProps('b1');
    const b = rowProps('b2');
    const { rerender } = render(
      <div>
        <LoggedRow {...a} />
        <LoggedRow {...b} />
      </div>
    );
    expect(renderLog).toEqual(['b1', 'b2']);
    rerender(
      <div>
        <LoggedRow {...a} />
        <LoggedRow {...b} />
      </div>
    );
    rerender(
      <div>
        <LoggedRow {...a} />
        <LoggedRow {...b} />
      </div>
    );
    expect(renderLog).toEqual(['b1', 'b2']);
  });

  it('flipping `reading` re-renders only the affected row (M13 highlight tick)', () => {
    const a = rowProps('b1');
    const b = rowProps('b2');
    const { rerender } = render(
      <div>
        <LoggedRow {...a} />
        <LoggedRow {...b} />
      </div>
    );
    renderLog.length = 0;

    rerender(
      <div>
        <LoggedRow {...a} reading />
        <LoggedRow {...b} />
      </div>
    );
    expect(renderLog).toEqual(['b1']);
    expect(screen.getByTestId('msv-para-b1').className).toContain('msv-para-text--reading');
    expect(screen.getByTestId('msv-para-b2').className).not.toContain('msv-para-text--reading');

    // Highlight moves on: the un-highlighted and newly highlighted rows render.
    rerender(
      <div>
        <LoggedRow {...a} />
        <LoggedRow {...b} reading />
      </div>
    );
    expect(renderLog).toEqual(['b1', 'b1', 'b2']);
  });

  it('rebuilt-but-element-equal comment slices skip rows; a changed slice renders only its row', () => {
    const c1 = mkComment('c1', 's1', 'Prose for b1');
    const a = rowProps('b1', { comments: [c1] });
    const b = rowProps('b2');
    const { rerender } = render(
      <div>
        <LoggedRow {...a} />
        <LoggedRow {...b} />
      </div>
    );
    expect(screen.getByTestId('msv-anchor-c1')).toHaveTextContent('Prose for b1');
    renderLog.length = 0;

    // The parent rebuilds per-scene arrays on every store notify; unchanged
    // scenes keep the same comment objects → element-equal → no re-render.
    rerender(
      <div>
        <LoggedRow {...a} comments={[c1]} />
        <LoggedRow {...b} />
      </div>
    );
    expect(renderLog).toEqual([]);

    const c2 = mkComment('c2', 's1', 'for b1.');
    rerender(
      <div>
        <LoggedRow {...a} comments={[c1, c2]} />
        <LoggedRow {...b} />
      </div>
    );
    expect(renderLog).toEqual(['b1']);
  });

  it('skips a content-only change while its editable holds focus, and re-syncs after blur', () => {
    const a = rowProps('b1');
    const { rerender } = render(<LoggedRow {...a} />);
    const editable = screen.getByTestId('msv-para-b1');
    act(() => editable.focus());
    expect(document.activeElement).toBe(editable);

    // The user has typed — the DOM is ahead of the committed prop.
    editable.textContent = 'half-typed edit';
    renderLog.length = 0;

    // The row's own commit echoes back through state while still focused:
    // re-rendering would rip the text nodes out from under the caret.
    rerender(<LoggedRow {...a} content="Prose for b1. (committed)" />);
    expect(renderLog).toEqual([]);
    expect(editable.textContent).toBe('half-typed edit');

    // Once focus leaves, the next change renders and re-syncs the row.
    act(() => editable.blur());
    rerender(<LoggedRow {...a} content="Prose for b1. (committed again)" />);
    expect(renderLog).toEqual(['b1']);
    expect(editable.textContent).toBe('Prose for b1. (committed again)');
  });

  it('paragraphRowPropsEqual: identity changes to any row-facing prop defeat the gate', () => {
    const p = rowProps('b1');
    expect(paragraphRowPropsEqual(p, { ...p })).toBe(true);
    expect(paragraphRowPropsEqual(p, { ...p, comments: [...p.comments] })).toBe(true);
    // Unfocused content change → render (the guard applies only mid-edit).
    expect(paragraphRowPropsEqual(p, { ...p, content: 'changed' })).toBe(false);
    expect(paragraphRowPropsEqual(p, { ...p, reading: true })).toBe(false);
    expect(paragraphRowPropsEqual(p, { ...p, showDropLine: true })).toBe(false);
    // M8: drag-dim + drop-cap + split/merge handlers gate too.
    expect(paragraphRowPropsEqual(p, { ...p, dragging: true })).toBe(false);
    expect(paragraphRowPropsEqual(p, { ...p, dropCap: true })).toBe(false);
    expect(paragraphRowPropsEqual(p, { ...p, onSplit: () => {} })).toBe(false);
    expect(paragraphRowPropsEqual(p, { ...p, onMergeUp: () => true })).toBe(false);
    expect(paragraphRowPropsEqual(p, { ...p, paraStyle: { ...PARA_STYLE } })).toBe(false);
    expect(paragraphRowPropsEqual(p, { ...p, autoLinkTerms: [] })).toBe(false);
    expect(paragraphRowPropsEqual(p, { ...p, comments: [mkComment('c9', 's1', 'x')] })).toBe(false);
    expect(paragraphRowPropsEqual(p, { ...p, onParaOver: () => {} })).toBe(false);
    expect(paragraphRowPropsEqual(p, { ...p, onCommit: () => {} })).toBe(false);
  });
});

// ─── Through ManuscriptView ──────────────────────────────────────────────────

describe('ManuscriptView row memoization (integration)', () => {
  it('view-level re-renders (width slider) recompute no segments or hints', () => {
    commentsStore.create({
      storyId: 'story-1',
      sceneId: 's1',
      anchor: 'counted the bells',
      text: 'note',
    });
    renderView({ autoLinkEntities: ENTITIES, autoLinkMode: 'suggest' });
    // Mount: hints once per paragraph row (3), segments once per row whose
    // scene has comments (s1's 2 rows).
    expect(vi.mocked(findAutoLinkHints)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(segmentsFor)).toHaveBeenCalledTimes(2);
    vi.mocked(findAutoLinkHints).mockClear();
    vi.mocked(segmentsFor).mockClear();

    fireEvent.change(screen.getByTestId('msv-width-slider'), { target: { value: '1400' } });
    expect(screen.getByText('1400px')).toBeInTheDocument(); // the view re-rendered …
    expect(vi.mocked(findAutoLinkHints)).not.toHaveBeenCalled(); // … the rows did not
    expect(vi.mocked(segmentsFor)).not.toHaveBeenCalled();
  });

  it('a comment arriving on one scene recomputes only that scene’s segments and no hints', () => {
    renderView({ autoLinkEntities: ENTITIES, autoLinkMode: 'suggest' });
    const untouched = screen.getByTestId('msv-para-s1-b0').firstChild;
    vi.mocked(findAutoLinkHints).mockClear();
    vi.mocked(segmentsFor).mockClear();

    act(() => {
      commentsStore.create({
        storyId: 'story-1',
        sceneId: 's2',
        anchor: 'rumor had teeth',
        text: 'keep',
      });
    });

    expect(vi.mocked(segmentsFor)).toHaveBeenCalledTimes(1); // s2's single row
    expect(vi.mocked(segmentsFor).mock.calls[0][0]).toBe('By morning the rumor had teeth.');
    expect(vi.mocked(findAutoLinkHints)).not.toHaveBeenCalled(); // hints memo untouched
    const created = commentsStore.list('story-1')[0];
    expect(screen.getByTestId(`msv-anchor-${created.id}`)).toHaveTextContent('rumor had teeth');
    // The other scene's rows were memo-skipped: same DOM node, byte for byte.
    expect(screen.getByTestId('msv-para-s1-b0').firstChild).toBe(untouched);
  });

  it('an in-flight edit survives unrelated re-renders and still commits on blur', () => {
    const { props } = renderView();
    const para = screen.getByTestId('msv-para-s1-b0');
    act(() => para.focus());
    para.textContent = 'work in progress';

    // The re-render storms from the audit: an agent comment arriving on
    // another scene + a page-width change.
    act(() => {
      commentsStore.create({
        storyId: 'story-1',
        sceneId: 's2',
        anchor: 'rumor had teeth',
        text: 'Continuity flag',
        kind: 'archive',
      });
    });
    fireEvent.change(screen.getByTestId('msv-width-slider'), { target: { value: '1200' } });

    expect(para.textContent).toBe('work in progress'); // keystrokes intact
    expect(document.activeElement).toBe(para); // caret still in the row

    act(() => para.blur());
    expect(props.onEditParagraph).toHaveBeenCalledTimes(1);
    expect(props.onEditParagraph).toHaveBeenCalledWith('s1', 's1-b0', 'work in progress');
  });

  it('its own commit echoing back through story state does not clobber a resumed edit', () => {
    // Simulates DesktopShell's async persistence round-trip: the story-state
    // echo of a commit lands later, possibly while the writer is typing again.
    let flushEcho: (() => void) | null = null;
    const commits: string[] = [];

    function applyEdit(story: Story, sceneId: string, blockId: string, text: string): Story {
      return {
        ...story,
        chapters: story.chapters.map((ch) => ({
          ...ch,
          scenes: ch.scenes.map((sc) =>
            sc.id === sceneId
              ? {
                  ...sc,
                  blocks: sc.blocks.map((b) => (b.id === blockId ? { ...b, content: text } : b)),
                }
              : sc
          ),
        })),
      };
    }

    function EchoHarness() {
      const [story, setStory] = useState(mkStory);
      const handleEdit = useCallback((sceneId: string, blockId: string, text: string) => {
        commits.push(text);
        flushEcho = () => setStory((prev) => applyEdit(prev, sceneId, blockId, text));
      }, []);
      return (
        <ManuscriptView
          story={story}
          cursor={BOOK}
          onCursorChange={() => {}}
          onEditParagraph={handleEdit}
          onCycleStatus={() => {}}
        />
      );
    }

    render(<EchoHarness />);
    const para = screen.getByTestId('msv-para-s1-b0');

    // First edit commits on blur; its story echo is still in flight.
    act(() => para.focus());
    para.textContent = 'first edit';
    act(() => para.blur());
    expect(commits).toEqual(['first edit']);

    // The writer dives straight back in — and the echo lands mid-typing.
    act(() => para.focus());
    para.textContent = 'first edit plus more';
    act(() => flushEcho?.());
    expect(para.textContent).toBe('first edit plus more'); // caret guard held

    act(() => para.blur());
    expect(commits).toEqual(['first edit', 'first edit plus more']);
  });
});

// ─── M8: drop cap ────────────────────────────────────────────────────────────

describe('M8 drop cap (prototype: suppressed while comment anchors segment)', () => {
  it('applies the drop-cap class only while the text has no comment segments', () => {
    const p = rowProps('b1', { dropCap: true });
    const { rerender } = render(<ParagraphRowBase {...p} />);
    expect(screen.getByTestId('msv-para-b1').className).toContain('msv-para-text--dropcap');

    rerender(<ParagraphRowBase {...p} comments={[mkComment('c1', 's1', 'Prose for b1')]} />);
    expect(screen.getByTestId('msv-para-b1').className).not.toContain('msv-para-text--dropcap');
  });
});
