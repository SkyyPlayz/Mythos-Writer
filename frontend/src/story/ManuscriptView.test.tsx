// Beta 3 M9 — ManuscriptView tests: rendering, folding, status-dot cycling,
// paragraph edit callbacks, zoom navigation (chevrons / crumbs / page arrows /
// arrow keys), and the lazy virtualization window (GH#843).

import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { Block, Chapter, DraftState, Scene, Story } from '../types';
import ManuscriptView from './ManuscriptView';
import { mergeParagraphUp, splitParagraph, type ManuscriptCursor } from './manuscriptModel';

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

  it('commits on Enter without a duplicate blur commit (legacy: no split handler)', () => {
    // Without onSplitParagraph (M8), Enter falls back to commit-and-blur.
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

// ─── Beta 3 M10 — toolbar v2, page modes, edge drag, paragraph drag ──────────

describe('toolbar v2 (M10, prototype 742–777)', () => {
  it('renders style/font/size controls and applies font + size to the sheet', () => {
    renderView();
    expect(screen.getByTestId('msv-style-select')).toHaveValue('Body Text');
    const wrap = document.querySelector('.msv-sheet-wrap') as HTMLElement;
    // Prototype defaults: Lora at fsize 12 → 12 × 1.42 = 17.0px (jsdom drops the .0).
    expect(wrap.style.fontFamily).toContain('Lora');
    expect(wrap.style.fontSize).toBe('17px');

    fireEvent.change(screen.getByTestId('msv-font-select'), { target: { value: 'Inter' } });
    expect(wrap.style.fontFamily).toContain('Inter');

    fireEvent.click(screen.getByTestId('msv-size-up'));
    expect(screen.getByTestId('msv-size-val')).toHaveTextContent('13');
    expect(wrap.style.fontSize).toBe('18.5px'); // 13 × 1.42 = 18.46 → 18.5
  });

  it('clamps font size to the prototype 9–18 range', () => {
    renderView();
    const down = screen.getByTestId('msv-size-down');
    const up = screen.getByTestId('msv-size-up');
    for (let i = 0; i < 10; i++) fireEvent.click(down);
    expect(screen.getByTestId('msv-size-val')).toHaveTextContent('9');
    for (let i = 0; i < 20; i++) fireEvent.click(up);
    expect(screen.getByTestId('msv-size-val')).toHaveTextContent('18');
  });

  it('B/I/U/S toggles and alignment apply to paragraph text (prototype pSt)', () => {
    renderView({ cursor: cur('scene', 0, 0) });
    const para = screen.getByTestId('msv-para-s1-b0');
    expect(para.style.fontWeight).toBe('400');
    expect(para.style.textAlign).toBe('left');

    fireEvent.click(screen.getByTestId('msv-fmt-b'));
    expect(screen.getByTestId('msv-fmt-b')).toHaveAttribute('aria-pressed', 'true');
    expect(para.style.fontWeight).toBe('600');

    fireEvent.click(screen.getByTestId('msv-fmt-i'));
    expect(para.style.fontStyle).toBe('italic');

    fireEvent.click(screen.getByTestId('msv-fmt-u'));
    fireEvent.click(screen.getByTestId('msv-fmt-s'));
    expect(para.style.textDecoration).toBe('underline line-through');

    fireEvent.click(screen.getByTestId('msv-align-justify'));
    expect(screen.getByTestId('msv-align-justify')).toHaveAttribute('aria-pressed', 'true');
    expect(para.style.textAlign).toBe('justify');
  });

  it('hides Dictate/Assist without handlers and wires them when provided', () => {
    const onDictate = vi.fn();
    const onAssist = vi.fn();
    const { unmount } = renderView();
    expect(screen.queryByTestId('msv-tb-dictate')).not.toBeInTheDocument();
    expect(screen.queryByTestId('msv-tb-assist')).not.toBeInTheDocument();
    unmount();

    renderView({ onDictate, onAssist, dictating: true });
    fireEvent.click(screen.getByTestId('msv-tb-dictate'));
    fireEvent.click(screen.getByTestId('msv-tb-assist'));
    expect(onDictate).toHaveBeenCalledTimes(1);
    expect(onAssist).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('msv-tb-dictate')).toHaveAttribute('aria-pressed', 'true');
  });

  // W0.4 (GAP P0#4): exactly ONE Read button — on the format toolbar, always
  // present, toggling the built-in M13 reader dock (the old zoombar reader
  // chip was the duplicate and is gone).
  it('renders a single always-on Read button that toggles the reader dock', () => {
    renderView();
    expect(screen.queryByTestId('msv-reader-chip')).not.toBeInTheDocument();
    const readButtons = screen.getAllByRole('button', { name: /read/i })
      .filter((b) => b.textContent === 'Read');
    expect(readButtons).toHaveLength(1);

    const read = screen.getByTestId('msv-tb-read');
    expect(read).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('msv-reader-bar')).not.toBeInTheDocument();
    fireEvent.click(read);
    expect(read).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('msv-reader-bar')).toBeInTheDocument();
    fireEvent.click(read);
    expect(read).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('msv-reader-bar')).not.toBeInTheDocument();
  });
});

describe('page modes (M10, prototype sheetBoxSt 4607–4617)', () => {
  it('defaults to the neon sheet with no runes', () => {
    renderView();
    const sheet = screen.getByTestId('msv-sheet');
    expect(sheet).toHaveAttribute('data-page-mode', 'neon');
    expect(screen.queryByTestId('lnpm-runes')).not.toBeInTheDocument();
  });

  it('renders the scroll parchment with rune overlays from liquidNeon settings', () => {
    renderView({
      liquidNeon: { pageCfg: { mode: 'scroll', bg: '#0a0d18', op: 66, blur: 0, sym: true } },
    });
    const sheet = screen.getByTestId('msv-sheet');
    expect(sheet).toHaveAttribute('data-page-mode', 'scroll');
    expect(sheet.style.borderRadius).toBe('10px');
    expect(screen.getByTestId('lnpm-runes')).toBeInTheDocument();
  });

  it("strips all chrome in 'off' mode", () => {
    renderView({ liquidNeon: { pageCfg: { mode: 'off', bg: '#0a0d18', op: 66, blur: 0 } } });
    const sheet = screen.getByTestId('msv-sheet');
    expect(sheet).toHaveAttribute('data-page-mode', 'off');
    expect(sheet.style.background).toBe('transparent');
    expect(sheet.style.boxShadow).toBe('none');
    expect(sheet.style.borderRadius).toBe('0');
  });
});

describe('page-edge drag (M10, prototype startDrag 3392–3400)', () => {
  it('drags the right edge to grow the width by 2× the delta and commits on release', () => {
    const onPageWidthChange = vi.fn();
    renderView({ onPageWidthChange });
    const wrap = document.querySelector('.msv-sheet-wrap') as HTMLElement;
    fireEvent.mouseDown(screen.getByTestId('msv-edge-r'), { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 550 });
    expect(wrap.style.width).toBe('1100px'); // 1000 + 50×2
    expect(screen.getByTestId('msv-width-badge')).toHaveTextContent('1100 px');
    fireEvent.mouseUp(window, { clientX: 550 });
    expect(onPageWidthChange).toHaveBeenCalledWith(1100);
    expect(screen.queryByTestId('msv-width-badge')).not.toBeInTheDocument();
  });

  it('left edge drags outward symmetrically and clamps at 520–3000', () => {
    const onPageWidthChange = vi.fn();
    renderView({ onPageWidthChange });
    const wrap = document.querySelector('.msv-sheet-wrap') as HTMLElement;
    fireEvent.mouseDown(screen.getByTestId('msv-edge-l'), { clientX: 300 });
    fireEvent.mouseMove(window, { clientX: 900 }); // +600 × −1 side × 2 = −1200 → clamp 520
    expect(wrap.style.width).toBe('520px');
    fireEvent.mouseUp(window, { clientX: 900 });
    expect(onPageWidthChange).toHaveBeenCalledWith(520);
  });

  it('nudges the width with arrow keys on a focused edge handle', () => {
    const onPageWidthChange = vi.fn();
    renderView({ onPageWidthChange });
    fireEvent.keyDown(screen.getByTestId('msv-edge-r'), { key: 'ArrowRight' });
    expect(onPageWidthChange).toHaveBeenCalledWith(1020);
    fireEvent.keyDown(screen.getByTestId('msv-edge-r'), { key: 'ArrowLeft' });
    expect(onPageWidthChange).toHaveBeenLastCalledWith(1000);
  });

  it('slider changes commit through onPageWidthChange too', () => {
    const onPageWidthChange = vi.fn();
    renderView({ onPageWidthChange });
    fireEvent.change(screen.getByTestId('msv-width-slider'), { target: { value: '2000' } });
    expect(onPageWidthChange).toHaveBeenCalledWith(2000);
  });
});

describe('paragraph grip drag (M10, prototype paraDown/Over/Drop 3705–3719)', () => {
  it('shows a drop indicator over the hovered paragraph and fires onMoveParagraph on drop', () => {
    const onMoveParagraph = vi.fn();
    renderView({ onMoveParagraph, cursor: cur('book') });
    // Start dragging s1-b0 by its grip.
    fireEvent.mouseDown(screen.getByTestId('msv-grip-s1-b0'));
    expect(screen.queryByTestId('msv-dropline')).not.toBeInTheDocument();

    // Hover another paragraph row → gradient drop line appears.
    const targetRow = screen.getByTestId('msv-para-s3-b0').parentElement as HTMLElement;
    fireEvent.mouseEnter(targetRow);
    expect(screen.getByTestId('msv-dropline')).toBeInTheDocument();

    fireEvent.mouseUp(targetRow);
    expect(onMoveParagraph).toHaveBeenCalledWith(
      { sceneId: 's1', blockId: 's1-b0' },
      { sceneId: 's3', blockId: 's3-b0' }
    );
    expect(screen.queryByTestId('msv-dropline')).not.toBeInTheDocument();
  });

  it('dropping a block onto itself is a no-op', () => {
    const onMoveParagraph = vi.fn();
    renderView({ onMoveParagraph, cursor: cur('scene', 0, 0) });
    fireEvent.mouseDown(screen.getByTestId('msv-grip-s1-b0'));
    const selfRow = screen.getByTestId('msv-para-s1-b0').parentElement as HTMLElement;
    fireEvent.mouseUp(selfRow);
    expect(onMoveParagraph).not.toHaveBeenCalled();
  });

  it('releasing outside any paragraph abandons the drag', () => {
    const onMoveParagraph = vi.fn();
    renderView({ onMoveParagraph, cursor: cur('book') });
    fireEvent.mouseDown(screen.getByTestId('msv-grip-s1-b0'));
    fireEvent.mouseUp(window);
    // A later hover shows no drop line — the drag is gone.
    const row = screen.getByTestId('msv-para-s3-b0').parentElement as HTMLElement;
    fireEvent.mouseEnter(row);
    expect(screen.queryByTestId('msv-dropline')).not.toBeInTheDocument();
    fireEvent.mouseUp(row);
    expect(onMoveParagraph).not.toHaveBeenCalled();
  });
});

// ─── Beta 4 M8 — editing model hardening (FULL-SPEC §14.1/§14.2) ─────────────

/** Place a collapsed caret at a plain-text offset inside a contentEditable. */
function setCaret(el: HTMLElement, offset: number) {
  const node = el.firstChild ?? el;
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

describe('M8 — Enter splits at the caret', () => {
  it('hands trimmed halves to onSplitParagraph; the released blur does not re-commit', () => {
    const onSplitParagraph = vi.fn(() => 'nb-1');
    const { props } = renderView({ cursor: cur('scene', 0, 0), onSplitParagraph });
    const para = screen.getByTestId('msv-para-s1-b0'); // 'Mira counted the bells.'
    act(() => para.focus());
    setCaret(para, 12);
    fireEvent.keyDown(para, { key: 'Enter' });

    expect(onSplitParagraph).toHaveBeenCalledTimes(1);
    expect(onSplitParagraph).toHaveBeenCalledWith('s1', 's1-b0', 'Mira counted', 'the bells.');
    // The row was blur-released so the split can re-render it through React —
    // and the split itself persisted both halves, so no blur commit fired.
    expect(document.activeElement).not.toBe(para);
    expect(props.onEditParagraph).not.toHaveBeenCalled();
  });

  it('splits at the end (empty trailing half → single space) without a usable selection', () => {
    const onSplitParagraph = vi.fn(() => 'nb-1');
    renderView({ cursor: cur('scene', 0, 0), onSplitParagraph });
    const para = screen.getByTestId('msv-para-s1-b0');
    window.getSelection()?.removeAllRanges();
    fireEvent.keyDown(para, { key: 'Enter' });
    expect(onSplitParagraph).toHaveBeenCalledWith('s1', 's1-b0', 'Mira counted the bells.', ' ');
  });

  it('moves the caret into the new paragraph once the split story renders', () => {
    const onSplitParagraph = vi.fn(() => 'nb-1');
    const { rerender, props } = renderView({ cursor: cur('scene', 0, 0), onSplitParagraph });
    const para = screen.getByTestId('msv-para-s1-b0');
    act(() => para.focus());
    setCaret(para, 12);
    fireEvent.keyDown(para, { key: 'Enter' });

    // The caller's split lands in state → the view re-renders with it.
    const split = splitParagraph(
      props.story,
      { sceneId: 's1', blockId: 's1-b0' },
      'Mira counted',
      'the bells.',
      { makeId: () => 'nb-1' }
    )!;
    rerender(<ManuscriptView {...props} onSplitParagraph={onSplitParagraph} story={split.story} />);

    const fresh = screen.getByTestId('msv-para-nb-1');
    expect(fresh).toHaveTextContent('the bells.');
    expect(document.activeElement).toBe(fresh);
    // The (unfocused) source row re-synced to the before-half through React.
    expect(screen.getByTestId('msv-para-s1-b0').textContent).toBe('Mira counted');
    // The new paragraph's text is already committed — blur is a no-op.
    fireEvent.blur(fresh);
    expect(props.onEditParagraph).not.toHaveBeenCalled();
  });
});

describe('M8 — Backspace at start merges up', () => {
  it('merges into the previous paragraph and consumes the keystroke', () => {
    const onMergeParagraph = vi.fn(() => ({
      mergedBlockId: 's1-b0',
      mergedText: 'Mira counted the bells. The lanterns guttered.',
    }));
    renderView({ cursor: cur('scene', 0, 0), onMergeParagraph });
    const para = screen.getByTestId('msv-para-s1-b1'); // 'The lanterns guttered.'
    act(() => para.focus());
    setCaret(para, 0);
    const notCancelled = fireEvent.keyDown(para, { key: 'Backspace' });
    expect(onMergeParagraph).toHaveBeenCalledWith('s1', 's1-b1', 'The lanterns guttered.');
    expect(notCancelled).toBe(false); // preventDefault — the merge ate the keystroke
  });

  it('leaves the keystroke alone mid-paragraph and when the merge is refused', () => {
    const onMergeParagraph = vi.fn(() => null);
    renderView({ cursor: cur('scene', 0, 0), onMergeParagraph });
    const para = screen.getByTestId('msv-para-s1-b1');
    act(() => para.focus());

    setCaret(para, 3);
    fireEvent.keyDown(para, { key: 'Backspace' });
    expect(onMergeParagraph).not.toHaveBeenCalled();

    // First block of a scene: the caller returns null (no cross-scene merge).
    setCaret(para, 0);
    const notCancelled = fireEvent.keyDown(para, { key: 'Backspace' });
    expect(onMergeParagraph).toHaveBeenCalledTimes(1);
    expect(notCancelled).toBe(true);
  });

  it('focuses the merged paragraph (caret at its end) once the merged story renders', () => {
    const merged = mergeParagraphUp(
      mkStory(),
      { sceneId: 's1', blockId: 's1-b1' },
      'The lanterns guttered.'
    )!;
    const onMergeParagraph = vi.fn(() => ({
      mergedBlockId: merged.mergedBlockId,
      mergedText: merged.mergedText,
    }));
    const { rerender, props } = renderView({ cursor: cur('scene', 0, 0), onMergeParagraph });
    const para = screen.getByTestId('msv-para-s1-b1');
    act(() => para.focus());
    setCaret(para, 0);
    fireEvent.keyDown(para, { key: 'Backspace' });

    rerender(
      <ManuscriptView {...props} onMergeParagraph={onMergeParagraph} story={merged.story} />
    );
    const survivor = screen.getByTestId('msv-para-s1-b0');
    expect(survivor).toHaveTextContent('Mira counted the bells. The lanterns guttered.');
    expect(document.activeElement).toBe(survivor);
    expect(screen.queryByTestId('msv-para-s1-b1')).not.toBeInTheDocument();
    // The merged text is pre-committed — blur must not re-commit it.
    fireEvent.blur(survivor);
    expect(props.onEditParagraph).not.toHaveBeenCalled();
  });
});

describe('M8 — empty paragraph removal on blur (min 1 per scene)', () => {
  it('removes an emptied paragraph instead of committing it', () => {
    const onRemoveParagraph = vi.fn(() => true);
    const { props } = renderView({ cursor: cur('scene', 0, 0), onRemoveParagraph });
    const para = screen.getByTestId('msv-para-s1-b1');
    para.textContent = '   ';
    fireEvent.blur(para);
    expect(onRemoveParagraph).toHaveBeenCalledWith('s1', 's1-b1');
    expect(props.onEditParagraph).not.toHaveBeenCalled();
  });

  it("commits the scene's kept last paragraph as a single space when removal is refused", () => {
    const onRemoveParagraph = vi.fn(() => false);
    const { props } = renderView({ cursor: cur('scene', 0, 1), onRemoveParagraph });
    const para = screen.getByTestId('msv-para-s2-b0');
    para.textContent = '';
    fireEvent.blur(para);
    expect(onRemoveParagraph).toHaveBeenCalledWith('s2', 's2-b0');
    expect(props.onEditParagraph).toHaveBeenCalledWith('s2', 's2-b0', ' ');
  });
});

describe('M8 — inline heading renames', () => {
  it('headings are editable only when rename handlers exist', () => {
    const { unmount } = renderView();
    expect(screen.getByTestId('msv-scene-title-s1')).toHaveAttribute('contenteditable', 'false');
    expect(screen.getByTestId('msv-chapter-title-ch1')).toHaveAttribute('contenteditable', 'false');
    unmount();

    renderView({ onRenameScene: vi.fn(), onRenameChapter: vi.fn() });
    expect(screen.getByTestId('msv-scene-title-s1')).toHaveAttribute('contenteditable', 'true');
    expect(screen.getByTestId('msv-chapter-title-ch1')).toHaveAttribute('contenteditable', 'true');
  });

  it('commits a normalized scene title on blur and writes it back to the heading', () => {
    const onRenameScene = vi.fn();
    renderView({ onRenameScene });
    const title = screen.getByTestId('msv-scene-title-s1');
    title.textContent = '  Dawn\nWatch ';
    fireEvent.blur(title);
    expect(onRenameScene).toHaveBeenCalledWith('s1', 'Dawn Watch');
    expect(title.textContent).toBe('Dawn Watch');
  });

  it('Enter commits a heading rename (§1: Enter commits inline renames)', () => {
    const onRenameChapter = vi.fn();
    renderView({ onRenameChapter });
    const title = screen.getByTestId('msv-chapter-title-ch1');
    act(() => title.focus());
    title.textContent = 'The Quiet Storm';
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(onRenameChapter).toHaveBeenCalledWith('ch1', 'The Quiet Storm');
  });

  it('reverts empty renames without calling the handler', () => {
    const onRenameScene = vi.fn();
    renderView({ onRenameScene });
    const title = screen.getByTestId('msv-scene-title-s1');
    title.textContent = '  \n ';
    fireEvent.blur(title);
    expect(onRenameScene).not.toHaveBeenCalled();
    expect(title.textContent).toBe("The Watcher's Call");
  });

  it('unchanged titles do not fire the handler', () => {
    const onRenameScene = vi.fn();
    renderView({ onRenameScene });
    const title = screen.getByTestId('msv-scene-title-s1');
    fireEvent.blur(title);
    expect(onRenameScene).not.toHaveBeenCalled();
  });
});

describe('M8 — drop cap on the first scene paragraph', () => {
  it('marks only the first paragraph of a scene at scene/chapter zoom', () => {
    const { rerender, props } = renderView({ cursor: cur('scene', 0, 0) });
    expect(screen.getByTestId('msv-para-s1-b0').className).toContain('msv-para-text--dropcap');
    expect(screen.getByTestId('msv-para-s1-b1').className).not.toContain(
      'msv-para-text--dropcap'
    );

    rerender(<ManuscriptView {...props} cursor={cur('chapter', 0)} />);
    expect(screen.getByTestId('msv-para-s1-b0').className).toContain('msv-para-text--dropcap');
    expect(screen.getByTestId('msv-para-s2-b0').className).toContain('msv-para-text--dropcap');

    // Prototype: no drop caps at book zoom.
    rerender(<ManuscriptView {...props} cursor={cur('book')} />);
    expect(screen.getByTestId('msv-para-s1-b0').className).not.toContain(
      'msv-para-text--dropcap'
    );
  });
});

describe('M8 — Alt+←/→ hops scenes (chapters at chapter zoom)', () => {
  it('hops even while the caret is inside a paragraph', () => {
    const { props } = renderView({ cursor: cur('scene', 0, 0) });
    const para = screen.getByTestId('msv-para-s1-b0');
    act(() => para.focus());
    fireEvent.keyDown(para, { key: 'ArrowRight', altKey: true });
    expect(props.onCursorChange).toHaveBeenLastCalledWith(cur('scene', 0, 1));
    // The in-flight edit was blur-committed before the hop, not lost.
    expect(document.activeElement).not.toBe(para);
  });

  it('hops chapters at chapter zoom and stays put at book zoom', () => {
    // The fixture has two chapters — both hops wrap between them.
    const { rerender, props } = renderView({ cursor: cur('chapter', 0) });
    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true });
    expect(props.onCursorChange).toHaveBeenLastCalledWith(cur('chapter', 1));
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
    expect(props.onCursorChange).toHaveBeenLastCalledWith(cur('chapter', 1)); // 0 → wrap
    expect(props.onCursorChange).toHaveBeenCalledTimes(2);

    rerender(<ManuscriptView {...props} cursor={cur('book')} />);
    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true });
    expect(props.onCursorChange).toHaveBeenCalledTimes(2); // book zoom ignored the hop
  });
});

describe('M8 — grip drag hardening (§14.2: drag state can’t get stuck)', () => {
  it('dims the dragged block to 38% and restores it after the drop', () => {
    const onMoveParagraph = vi.fn();
    renderView({ onMoveParagraph, cursor: cur('book') });
    const draggedRow = screen.getByTestId('msv-para-s1-b0').parentElement as HTMLElement;
    fireEvent.mouseDown(screen.getByTestId('msv-grip-s1-b0'));
    expect(draggedRow.className).toContain('msv-para--dragging');
    // Only the dragged row dims.
    expect(
      (screen.getByTestId('msv-para-s3-b0').parentElement as HTMLElement).className
    ).not.toContain('msv-para--dragging');

    const targetRow = screen.getByTestId('msv-para-s3-b0').parentElement as HTMLElement;
    fireEvent.mouseUp(targetRow);
    expect(draggedRow.className).not.toContain('msv-para--dragging');
  });

  it('Escape cancels the drag: no move fires and all drag state clears', () => {
    const onMoveParagraph = vi.fn();
    renderView({ onMoveParagraph, cursor: cur('book') });
    fireEvent.mouseDown(screen.getByTestId('msv-grip-s1-b0'));
    const targetRow = screen.getByTestId('msv-para-s3-b0').parentElement as HTMLElement;
    fireEvent.mouseEnter(targetRow);
    expect(screen.getByTestId('msv-dropline')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('msv-dropline')).not.toBeInTheDocument();
    expect(
      (screen.getByTestId('msv-para-s1-b0').parentElement as HTMLElement).className
    ).not.toContain('msv-para--dragging');
    fireEvent.mouseUp(targetRow);
    expect(onMoveParagraph).not.toHaveBeenCalled();
  });

  it('losing window focus mid-drag clears the drag state too', () => {
    const onMoveParagraph = vi.fn();
    renderView({ onMoveParagraph, cursor: cur('book') });
    fireEvent.mouseDown(screen.getByTestId('msv-grip-s1-b0'));
    fireEvent.blur(window);
    const targetRow = screen.getByTestId('msv-para-s3-b0').parentElement as HTMLElement;
    fireEvent.mouseEnter(targetRow);
    expect(screen.queryByTestId('msv-dropline')).not.toBeInTheDocument();
    fireEvent.mouseUp(targetRow);
    expect(onMoveParagraph).not.toHaveBeenCalled();
  });
});
