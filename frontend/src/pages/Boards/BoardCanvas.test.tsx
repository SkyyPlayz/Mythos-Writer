/**
 * SKY-11186 — BoardCanvas: viewport culling, 3-tier LOD, thumbnail-aware
 * card sizes and the visible zoom-out limit (BOARDS-SPEC v2 §6/§9).
 *
 * jsdom has no layout, so the scroll panel's size is stubbed through a
 * ResizeObserver that reports a fixed viewport; everything else — which
 * cards mount, which tier they render at, how tall they are — is the real
 * component reacting to real state.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import BoardCanvas from './BoardCanvas';
import type { BoardItem } from './BoardCanvas';
import { CARD_DEFAULT_H, CARD_THUMB_DEFAULT_H, CELL_H, ORIGIN_Y } from './boardLod';

vi.mock('../../components/NoteThumbnail', () => ({
  NoteThumbnail: ({ alt }: { alt: string }) => <div data-testid="note-thumb-stub">{alt}</div>,
}));

const VIEWPORT = { width: 1200, height: 800 };

/** ResizeObserver stub that immediately reports the fixed viewport for whatever it observes. */
class ViewportResizeObserver {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.cb = cb; }
  observe(el: Element) {
    Object.defineProperty(el, 'clientWidth', { value: VIEWPORT.width, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: VIEWPORT.height, configurable: true });
    this.cb(
      [{ contentRect: { width: VIEWPORT.width, height: VIEWPORT.height } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

function notes(n: number, withThumb = false): BoardItem[] {
  return Array.from({ length: n }, (_, i) => ({
    path: `n${String(i).padStart(4, '0')}.md`,
    kind: 'note' as const,
    name: `Note ${i}`,
    excerpt: `Body of note ${i}`,
    thumb: withThumb
      ? { mode: 'auto' as const, src: `img${i}.png`, version: '1-1', missing: false, caption: `img${i}` }
      : undefined,
  }));
}

const view = { zoom: 100, panX: 0, panY: 0 };
const mounted = () => document.querySelectorAll('.board-canvas__item');
const cardStyle = (name: string) => (screen.getByLabelText(`Note card: ${name}`) as HTMLElement).style;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ViewportResizeObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('viewport culling (§6, §15 test 5)', () => {
  it('mounts only the cards inside the viewport plus one cell of margin — a far note is not in the DOM', () => {
    render(<BoardCanvas items={notes(600)} savedLayout={{}} savedView={view} />);
    // 1200px wide → 4 columns; 800px tall + one cell margin ≈ 5 rows → ≤ 24 cards.
    const count = mounted().length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(24);
    expect(screen.queryByLabelText('Note card: Note 599')).toBeNull();
    // The world still grows to hold every child — nothing is capped or hidden:
    // 600 cards over 4 columns is 150 rows, and the last row's card fits.
    const world = document.querySelector('.board-canvas__world') as HTMLElement;
    expect(parseFloat(world.style.height)).toBeGreaterThanOrEqual(ORIGIN_Y + 149 * CELL_H + CARD_DEFAULT_H);
  });

  it('scrolling the panel mounts the cards that came into view and releases the ones that left', () => {
    render(<BoardCanvas items={notes(600)} savedLayout={{}} savedView={view} />);
    const scroller = document.querySelector('.board-canvas__scroll-area') as HTMLElement;
    expect(screen.queryByLabelText('Note card: Note 0')).not.toBeNull();

    const lastRowY = ORIGIN_Y + 149 * CELL_H;
    Object.defineProperty(scroller, 'scrollTop', { value: lastRowY, configurable: true });
    Object.defineProperty(scroller, 'scrollLeft', { value: 0, configurable: true });
    act(() => { fireEvent.scroll(scroller); });

    expect(screen.queryByLabelText('Note card: Note 599')).not.toBeNull();
    expect(screen.queryByLabelText('Note card: Note 0')).toBeNull();
    expect(mounted().length).toBeLessThanOrEqual(24);
  });

  it('never culls the selected card — focus must survive a scroll', () => {
    render(<BoardCanvas items={notes(600)} savedLayout={{}} savedView={view} />);
    const first = screen.getByLabelText('Note card: Note 0');
    act(() => { first.focus(); });
    expect(screen.getByLabelText('Note card: Note 0 Selected.')).toBeTruthy();

    const scroller = document.querySelector('.board-canvas__scroll-area') as HTMLElement;
    Object.defineProperty(scroller, 'scrollTop', { value: ORIGIN_Y + 149 * CELL_H, configurable: true });
    act(() => { fireEvent.scroll(scroller); });

    expect(screen.queryByLabelText('Note card: Note 0 Selected.')).not.toBeNull();
    expect(mounted().length).toBeLessThanOrEqual(25);
  });

  it('the scroll extent follows the zoom — the sizer is the world × scale, the world itself is not', () => {
    render(<BoardCanvas items={notes(600)} savedLayout={{}} savedView={view} />);
    const world = document.querySelector('.board-canvas__world') as HTMLElement;
    const sizer = document.querySelector('.board-canvas__sizer') as HTMLElement;
    const worldH = parseFloat(world.style.height);
    expect(parseFloat(sizer.style.height)).toBe(worldH);

    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByLabelText('Zoom out')); // 100 → 40%
    expect(screen.getByLabelText(/Zoom: 40%/)).toBeTruthy();
    expect(parseFloat(sizer.style.height)).toBeCloseTo(worldH * 0.4, 3);
    expect(parseFloat(world.style.height)).toBe(worldH);
  });

  it('zooming out widens the world window and mounts more cards, still bounded', () => {
    render(<BoardCanvas items={notes(600)} savedLayout={{}} savedView={view} minZoom={10} />);
    const at100 = mounted().length;
    const root = document.querySelector('.board-canvas__root') as HTMLElement;
    for (let i = 0; i < 10; i++) fireEvent.wheel(root, { deltaY: 100 }); // 100 → 20%
    expect(screen.getByLabelText(/Zoom: 20%/)).toBeTruthy();
    const at20 = mounted().length;
    expect(at20).toBeGreaterThan(at100);
    // 6000×4000 world px visible + margin over a 4-column grid: every column,
    // ~22 rows — bounded well under the 600 children.
    expect(at20).toBeLessThanOrEqual(4 * 24);
  });
});

describe('3-tier LOD by on-screen size (§6)', () => {
  it('walks a default card through preview+image → image+title → coloured block as the zoom drops', () => {
    render(<BoardCanvas items={notes(3)} savedLayout={{}} savedView={view} />);
    const root = document.querySelector('.board-canvas__root') as HTMLElement;
    const card = () => screen.getByLabelText('Note card: Note 0');

    expect(card().getAttribute('data-lod')).toBe('1');
    expect(card().querySelector('.board-canvas__item-excerpt')).not.toBeNull();

    // 100 → 60 (five wheel stops): 141.6px on screen → tier 2, no preview.
    for (let i = 0; i < 5; i++) fireEvent.wheel(root, { deltaY: 100 });
    expect(screen.getByLabelText(/Zoom: 60%/)).toBeTruthy();
    expect(card().getAttribute('data-lod')).toBe('2');
    expect(card().querySelector('.board-canvas__item-name')).not.toBeNull();
    expect(card().querySelector('.board-canvas__item-excerpt')).toBeNull();

    // 60 → 40 (floor): 94.4px → tier 3, a bare coloured block.
    for (let i = 0; i < 5; i++) fireEvent.wheel(root, { deltaY: 100 });
    expect(screen.getByLabelText(/Zoom: 40%/)).toBeTruthy();
    expect(card().getAttribute('data-lod')).toBe('3');
    expect(card().querySelector('.board-canvas__item-name')).toBeNull();
    expect(card().querySelector('.board-canvas__item-excerpt')).toBeNull();
    expect(card().textContent).toBe('');
    // The name is still one hover away, and still the accessible name.
    expect(card().getAttribute('title')).toBe('Note 0');
  });

  it('a thumbnail card keeps its image at tier 2 and drops it only at tier 3 (owner ruling 5d)', () => {
    render(<BoardCanvas items={notes(2, true)} savedLayout={{}} savedView={view} />);
    const root = document.querySelector('.board-canvas__root') as HTMLElement;
    const card = () => screen.getByLabelText('Note card: Note 0');
    expect(card().querySelector('.board-canvas__thumb')).not.toBeNull();

    for (let i = 0; i < 5; i++) fireEvent.wheel(root, { deltaY: 100 }); // 60%
    expect(card().getAttribute('data-lod')).toBe('2');
    expect(card().querySelector('.board-canvas__thumb')).not.toBeNull();
    expect(card().querySelector('.board-canvas__item-excerpt')).toBeNull();

    for (let i = 0; i < 5; i++) fireEvent.wheel(root, { deltaY: 100 }); // 40%
    expect(card().getAttribute('data-lod')).toBe('3');
    expect(card().querySelector('.board-canvas__thumb')).toBeNull();
  });

  it('a board tile changes tier at the same zoom stops as the note card beside it', () => {
    const items: BoardItem[] = [
      { path: 'Court', kind: 'folder', name: 'Court', childBoards: 1, childCards: 2 },
      ...notes(1),
    ];
    render(<BoardCanvas items={items} savedLayout={{}} savedView={view} />);
    const root = document.querySelector('.board-canvas__root') as HTMLElement;
    const tile = () => screen.getByLabelText(/^Board: Court/);
    const card = () => screen.getByLabelText('Note card: Note 0');

    expect(tile().getAttribute('data-lod')).toBe('1');
    expect(tile().querySelector('.board-canvas__item-meta')).not.toBeNull();

    for (let i = 0; i < 4; i++) fireEvent.wheel(root, { deltaY: 100 }); // 68% — both still tier 1
    expect(tile().getAttribute('data-lod')).toBe('1');
    expect(card().getAttribute('data-lod')).toBe('1');

    fireEvent.wheel(root, { deltaY: 100 }); // 60% — both tier 2; the tile keeps its name, drops its counts
    expect(tile().getAttribute('data-lod')).toBe('2');
    expect(card().getAttribute('data-lod')).toBe('2');
    expect(tile().querySelector('.board-canvas__item-name')).not.toBeNull();
    expect(tile().querySelector('.board-canvas__item-meta')).toBeNull();

    for (let i = 0; i < 5; i++) fireEvent.wheel(root, { deltaY: 100 }); // 40% — both blocks
    expect(tile().getAttribute('data-lod')).toBe('3');
    expect(card().getAttribute('data-lod')).toBe('3');
  });

  it('a card the user resized wider keeps detail past the zoom where a default card lost it', () => {
    render(
      <BoardCanvas
        items={notes(2)}
        savedLayout={{ 'n0000.md': { x: 48, y: 44, w: 420, h: 154 } }}
        savedView={view}
      />,
    );
    const root = document.querySelector('.board-canvas__root') as HTMLElement;
    for (let i = 0; i < 5; i++) fireEvent.wheel(root, { deltaY: 100 }); // 60%
    expect(screen.getByLabelText('Note card: Note 0').getAttribute('data-lod')).toBe('1');
    expect(screen.getByLabelText('Note card: Note 1').getAttribute('data-lod')).toBe('2');
  });
});

describe('thumbnail-aware sizes and layout (§6/§9)', () => {
  it('a note with a thumbnail defaults to 236×272; without, 236×154; thumb:false is text-only', () => {
    const items: BoardItem[] = [
      { ...notes(1)[0], path: 'plain.md', name: 'Plain' },
      { ...notes(1, true)[0], path: 'pic.md', name: 'Pic' },
      {
        path: 'off.md', kind: 'note', name: 'Off', excerpt: 'has an image but thumb: false',
        thumb: { mode: 'off', src: null, version: null, missing: false, caption: '' },
      },
      {
        path: 'gone.md', kind: 'note', name: 'Gone', excerpt: 'image file was deleted',
        thumb: { mode: 'explicit', src: null, version: null, missing: true, caption: '' },
      },
    ];
    render(<BoardCanvas items={items} savedLayout={{}} savedView={view} />);
    expect(cardStyle('Plain').height).toBe(`${CARD_DEFAULT_H}px`);
    expect(cardStyle('Pic').height).toBe(`${CARD_THUMB_DEFAULT_H}px`);
    expect(cardStyle('Off').height).toBe(`${CARD_DEFAULT_H}px`);
    expect(screen.getByLabelText('Note card: Off').querySelector('.board-canvas__thumb')).toBeNull();
    // A missing source still gets the image block — the fallback glyph lives
    // inside it (owner ruling 5f) — so the layout does not jump when a file
    // goes away and comes back.
    expect(cardStyle('Gone').height).toBe(`${CARD_THUMB_DEFAULT_H}px`);
    expect(screen.getByLabelText('Note card: Gone').querySelector('.board-canvas__thumb')).not.toBeNull();
  });

  it('an auto-laid row holding a thumbnail card is taller, so the 272px card never overlaps the next row', () => {
    const items: BoardItem[] = [
      { ...notes(1, true)[0], path: 'a.md', name: 'A' },
      { ...notes(1)[0], path: 'b.md', name: 'B' },
      { ...notes(1)[0], path: 'c.md', name: 'C' },
      { ...notes(1)[0], path: 'd.md', name: 'D' },
      { ...notes(1)[0], path: 'e.md', name: 'E' }, // row 2 (4 columns)
    ];
    render(<BoardCanvas items={items} savedLayout={{}} savedView={view} />);
    const aBottom = parseFloat(cardStyle('A').top) + parseFloat(cardStyle('A').height);
    expect(parseFloat(cardStyle('E').top)).toBeGreaterThanOrEqual(aBottom);
    expect(parseFloat(cardStyle('E').top)).toBe(ORIGIN_Y + CELL_H + (CARD_THUMB_DEFAULT_H - CARD_DEFAULT_H));
  });
});

describe('the visible zoom-out limit (owner ruling 4)', () => {
  it('stops at the spec default of 40% and says so on the button', () => {
    render(<BoardCanvas items={notes(1)} savedLayout={{}} savedView={view} />);
    const out = screen.getByLabelText('Zoom out');
    expect(out.getAttribute('aria-disabled')).toBeNull();
    for (let i = 0; i < 8; i++) fireEvent.click(out);
    expect(screen.getByLabelText(/Zoom: 40%/)).toBeTruthy();
    expect(out.getAttribute('aria-disabled')).toBe('true');
    expect(out.getAttribute('title')).toContain('40%');
    expect(out.getAttribute('title')).toContain('Settings');
    expect(document.querySelector('.board-canvas__root')?.getAttribute('data-min-zoom')).toBe('40');
  });

  it('honours a lower limit from Settings and lifts the view when the limit is raised', () => {
    const { rerender } = render(<BoardCanvas items={notes(1)} savedLayout={{}} savedView={view} minZoom={20} />);
    const out = screen.getByLabelText('Zoom out');
    for (let i = 0; i < 10; i++) fireEvent.click(out);
    expect(screen.getByLabelText(/Zoom: 20%/)).toBeTruthy();
    expect(out.getAttribute('aria-disabled')).toBe('true');

    rerender(<BoardCanvas items={notes(1)} savedLayout={{}} savedView={view} minZoom={30} />);
    expect(screen.getByLabelText(/Zoom: 30%/)).toBeTruthy();
  });

  it('coerces an unsupported persisted value to the default', () => {
    render(<BoardCanvas items={notes(1)} savedLayout={{}} savedView={view} minZoom={7} />);
    expect(document.querySelector('.board-canvas__root')?.getAttribute('data-min-zoom')).toBe('40');
  });
});
