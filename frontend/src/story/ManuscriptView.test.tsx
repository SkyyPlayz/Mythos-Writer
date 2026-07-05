// Beta 3 M9 — ManuscriptView tests: rendering, folding, status-dot cycling,
// paragraph edit callbacks, zoom navigation (chevrons / crumbs / page arrows /
// arrow keys), and the lazy virtualization window (GH#843).

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Block, Chapter, DraftState, Scene, Story } from '../types';
import ManuscriptView from './ManuscriptView';
import type { ManuscriptCursor } from './manuscriptModel';

const NOW = '2026-07-05T00:00:00.000Z';

function mkBlock(id: string, content: string, order: number): Block {
  return { id, type: 'prose', content, order, updatedAt: NOW };
}

function mkScene(
  id: string,
  title: string,
  order: number,
  draftState: DraftState | undefined,
  paras: string[]
): Scene {
  return {
    id,
    title,
    path: `scenes/${id}.md`,
    order,
    blocks: paras.map((p, i) => mkBlock(`${id}-b${i}`, p, i)),
    draftState,
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
        mkScene('s1', "The Watcher's Call", 0, 'final', ['Mira counted the bells.', 'The lanterns guttered.']),
        mkScene('s2', 'A City in Shadows', 1, undefined, ['By morning the rumor had teeth.']),
      ]),
      mkChapter('ch2', 'Fractures', 1, [
        mkScene('s3', "The Smuggler's Bargain", 0, 'in-progress', ['Kael dealt cards slowly.']),
      ]),
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** A story large enough to exercise the virtualization window. */
function mkHugeStory(sceneCount: number): Story {
  return {
    id: 'story-huge',
    title: 'Epic',
    path: 'stories/story-huge',
    chapters: [
      mkChapter(
        'chh',
        'Everything',
        0,
        Array.from({ length: sceneCount }, (_v, i) =>
          mkScene(`hs${i}`, `Scene ${i}`, i, undefined, [`Paragraph for scene ${i}.`])
        )
      ),
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function cur(zoom: ManuscriptCursor['zoom'], chapter = 0, scene = 0): ManuscriptCursor {
  return { zoom, part: 0, chapter, scene };
}

function renderView(overrides: Partial<Parameters<typeof ManuscriptView>[0]> = {}) {
  const props = {
    story: mkStory(),
    cursor: cur('book'),
    onCursorChange: vi.fn(),
    onEditParagraph: vi.fn(),
    onCycleStatus: vi.fn(),
    ...overrides,
  };
  const utils = render(<ManuscriptView {...props} />);
  return { ...utils, props };
}

describe('ManuscriptView rendering', () => {
  it('renders chapter headings, scene headings, and paragraphs at book zoom', () => {
    renderView();
    expect(screen.getByText('CHAPTER 1')).toBeInTheDocument();
    expect(screen.getByText('The Quiet Before')).toBeInTheDocument();
    expect(screen.getByText('CHAPTER 2')).toBeInTheDocument();
    expect(screen.getByText("The Watcher's Call")).toBeInTheDocument();
    expect(screen.getByText('Mira counted the bells.')).toBeInTheDocument();
    expect(screen.getByText('Kael dealt cards slowly.')).toBeInTheDocument();
  });

  it('scopes to one chapter at chapter zoom and one scene at scene zoom', () => {
    const { rerender, props } = renderView({ cursor: cur('chapter', 1) });
    expect(screen.getByText('Fractures')).toBeInTheDocument();
    expect(screen.queryByText('The Quiet Before')).not.toBeInTheDocument();

    rerender(
      <ManuscriptView
        {...props}
        cursor={cur('scene', 0, 1)}
      />
    );
    // Scene title appears in the sheet (and again in the breadcrumb trail).
    const sheet = within(screen.getByTestId('msv-sheet'));
    expect(sheet.getByText('A City in Shadows')).toBeInTheDocument();
    expect(sheet.queryByText('CHAPTER 1')).not.toBeInTheDocument();
    expect(sheet.queryByText("The Watcher's Call")).not.toBeInTheDocument();
  });

  it('renders status dots with prototype tooltips', () => {
    renderView();
    expect(screen.getByTestId('msv-dot-s1')).toHaveAttribute('title', 'Complete');
    expect(screen.getByTestId('msv-dot-s2')).toHaveAttribute('title', 'Not started');
    expect(screen.getByTestId('msv-dot-s3')).toHaveAttribute('title', 'In draft');
  });

  it('renders a margin grip on every paragraph row', () => {
    renderView({ cursor: cur('scene', 0, 0) });
    const paras = screen.getAllByTestId(/^msv-para-/);
    expect(paras).toHaveLength(2);
    expect(document.querySelectorAll('.msv-grip')).toHaveLength(2);
  });
});

describe('folding', () => {
  it('fold on a chapter hides its scenes and shows the fold pill; the pill expands again', () => {
    renderView();
    fireEvent.click(screen.getByTestId('msv-fold-ch1'));

    expect(screen.queryByText("The Watcher's Call")).not.toBeInTheDocument();
    expect(screen.queryByText('Mira counted the bells.')).not.toBeInTheDocument();
    // Sibling chapter unaffected.
    expect(screen.getByText('Kael dealt cards slowly.')).toBeInTheDocument();

    const pill = screen.getByTestId('msv-pill-ch1');
    expect(pill).toHaveTextContent('2 scenes hidden — click to expand');
    fireEvent.click(pill);
    expect(screen.getByText("The Watcher's Call")).toBeInTheDocument();
    expect(screen.getByText('Mira counted the bells.')).toBeInTheDocument();
  });

  it('fold on a scene hides only its paragraphs', () => {
    renderView();
    fireEvent.click(screen.getByTestId('msv-fold-s1'));
    expect(screen.getByText("The Watcher's Call")).toBeInTheDocument();
    expect(screen.queryByText('Mira counted the bells.')).not.toBeInTheDocument();
    expect(screen.getByTestId('msv-pill-s1')).toHaveTextContent('Scene collapsed — click to expand');
    expect(screen.getByText('By morning the rumor had teeth.')).toBeInTheDocument();
  });
});

describe('status dot', () => {
  it('clicking a dot calls onCycleStatus with the scene id', () => {
    const { props } = renderView();
    fireEvent.click(screen.getByTestId('msv-dot-s3'));
    expect(props.onCycleStatus).toHaveBeenCalledTimes(1);
    expect(props.onCycleStatus).toHaveBeenCalledWith('s3');
  });
});

describe('paragraph editing', () => {
  it('commits on blur with the scene id, block id, and new text', () => {
    const { props } = renderView({ cursor: cur('scene', 0, 0) });
    const para = screen.getByTestId('msv-para-s1-b0');
    para.textContent = 'Mira counted nine bells.';
    fireEvent.blur(para);
    expect(props.onEditParagraph).toHaveBeenCalledTimes(1);
    expect(props.onEditParagraph).toHaveBeenCalledWith('s1', 's1-b0', 'Mira counted nine bells.');
  });

  it('commits on Enter without a duplicate blur commit', () => {
    const { props } = renderView({ cursor: cur('scene', 0, 0) });
    const para = screen.getByTestId('msv-para-s1-b1');
    para.textContent = 'The lanterns went dark.';
    fireEvent.keyDown(para, { key: 'Enter' });
    fireEvent.blur(para);
    expect(props.onEditParagraph).toHaveBeenCalledTimes(1);
    expect(props.onEditParagraph).toHaveBeenCalledWith('s1', 's1-b1', 'The lanterns went dark.');
  });

  it('does not fire when the text is unchanged', () => {
    const { props } = renderView({ cursor: cur('scene', 0, 0) });
    fireEvent.blur(screen.getByTestId('msv-para-s1-b0'));
    expect(props.onEditParagraph).not.toHaveBeenCalled();
  });
});

describe('zoom navigation', () => {
  it('zoom segment buttons change zoom while keeping indices', () => {
    const { props } = renderView({ cursor: cur('book', 0, 0) });
    fireEvent.click(screen.getByTestId('msv-zoom-chapter'));
    expect(props.onCursorChange).toHaveBeenCalledWith(cur('chapter', 0, 0));
  });

  it('chevrons hop same-level siblings and wrap at the end', () => {
    const { props } = renderView({ cursor: cur('chapter', 1) });
    fireEvent.click(screen.getByTestId('msv-zoom-next'));
    expect(props.onCursorChange).toHaveBeenLastCalledWith(cur('chapter', 0)); // wrap
    fireEvent.click(screen.getByTestId('msv-zoom-prev'));
    expect(props.onCursorChange).toHaveBeenLastCalledWith(cur('chapter', 0));
  });

  it('hides chevrons and floating page arrows at book zoom', () => {
    renderView({ cursor: cur('book') });
    expect(screen.queryByTestId('msv-zoom-next')).not.toBeInTheDocument();
    expect(screen.queryByTestId('msv-page-next')).not.toBeInTheDocument();
  });

  it('floating page arrows step siblings (scene zoom, across chapters)', () => {
    const { props } = renderView({ cursor: cur('scene', 0, 1) });
    fireEvent.click(screen.getByTestId('msv-page-next'));
    expect(props.onCursorChange).toHaveBeenLastCalledWith(cur('scene', 1, 0));
    fireEvent.click(screen.getByTestId('msv-page-prev'));
    expect(props.onCursorChange).toHaveBeenLastCalledWith(cur('scene', 0, 0));
  });

  it('breadcrumbs show the trail and jump zoom levels on click', () => {
    const { props } = renderView({ cursor: cur('scene', 1, 0) });
    const crumbs = within(screen.getByTestId('msv-crumbs'));
    expect(crumbs.getByText('The Last City of Veynn')).toBeInTheDocument();
    expect(crumbs.getByText('Ch. 2: Fractures')).toBeInTheDocument();
    expect(crumbs.getByText("The Smuggler's Bargain")).toBeInTheDocument();
    fireEvent.click(crumbs.getByText('The Last City of Veynn'));
    expect(props.onCursorChange).toHaveBeenCalledWith(cur('book', 1, 0));
  });

  it('←/→ keys hop siblings except at book zoom or while typing', () => {
    const { props, rerender } = renderView({ cursor: cur('scene', 0, 0) });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(props.onCursorChange).toHaveBeenLastCalledWith(cur('scene', 0, 1));
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(props.onCursorChange).toHaveBeenLastCalledWith(cur('scene', 1, 0)); // wrap back
    expect(props.onCursorChange).toHaveBeenCalledTimes(2);

    // Ignored while the target is an editable paragraph.
    fireEvent.keyDown(screen.getByTestId('msv-para-s1-b0'), { key: 'ArrowRight' });
    expect(props.onCursorChange).toHaveBeenCalledTimes(2);

    // Ignored entirely at book zoom.
    rerender(
      <ManuscriptView
        story={props.story}
        cursor={cur('book')}
        onCursorChange={props.onCursorChange}
        onEditParagraph={props.onEditParagraph}
        onCycleStatus={props.onCycleStatus}
      />
    );
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(props.onCursorChange).toHaveBeenCalledTimes(2);
  });
});

describe('page width', () => {
  it('defaults the sheet to 1000px and follows the slider (520–3000)', () => {
    renderView();
    const wrap = document.querySelector('.msv-sheet-wrap') as HTMLElement;
    expect(wrap.style.width).toBe('1000px');
    const slider = screen.getByTestId('msv-width-slider') as HTMLInputElement;
    expect(slider.min).toBe('520');
    expect(slider.max).toBe('3000');
    fireEvent.change(slider, { target: { value: '1400' } });
    expect(wrap.style.width).toBe('1400px');
    expect(screen.getByText('1400px')).toBeInTheDocument();
  });

  it('honors the pageWidth prop as the initial width', () => {
    renderView({ pageWidth: 760 });
    expect((document.querySelector('.msv-sheet-wrap') as HTMLElement).style.width).toBe('760px');
  });
});

describe('lazy windowing (GH#843)', () => {
  it('renders only a window of a huge manuscript with spacers for the rest', () => {
    // 600 scenes → 1 h2 + 600 h3 + 600 paras = 1201 blocks.
    renderView({ story: mkHugeStory(600) });
    const paras = screen.getAllByTestId(/^msv-para-/);
    const headings = screen.getAllByTestId(/^msv-h3-/);
    expect(paras.length + headings.length).toBeLessThanOrEqual(120);
    expect(screen.getByTestId('msv-spacer-top').style.height).toBe('0px');
    const bottom = parseInt(screen.getByTestId('msv-spacer-bottom').style.height, 10);
    expect(bottom).toBeGreaterThan(0);
    // First blocks are real, distant ones are virtualized away.
    expect(screen.getByTestId('msv-h3-hs0')).toBeInTheDocument();
    expect(screen.queryByTestId('msv-h3-hs599')).not.toBeInTheDocument();
  });

  it('moves the window as the page scrolls', () => {
    renderView({ story: mkHugeStory(600) });
    const page = screen.getByTestId('msv-page');
    Object.defineProperty(page, 'scrollTop', { value: 30000, configurable: true });
    fireEvent.scroll(page);
    expect(parseInt(screen.getByTestId('msv-spacer-top').style.height, 10)).toBeGreaterThan(0);
    expect(screen.queryByTestId('msv-h3-hs0')).not.toBeInTheDocument();
  });

  it('renders small manuscripts completely (window covers everything)', () => {
    renderView();
    expect(screen.getAllByTestId(/^msv-para-/)).toHaveLength(4);
    expect(screen.getByTestId('msv-spacer-bottom').style.height).toBe('0px');
  });
});
