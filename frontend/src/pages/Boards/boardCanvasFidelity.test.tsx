/**
 * SKY-11501 — Boards canvas fidelity against the owner mockup (BD-1/2/3).
 *
 * The three regressions this locks down, from
 * docs/fidelity/SKY-11480-liquid-neon-gap-list.md:
 *
 *   BD-1  the canvas painted a solid slab, so the wallpaper died at its rim
 *         while the mockup runs it through at 42%.
 *   BD-2  the dot grid was a fixed 26px at a fixed origin, so it stayed put
 *         while the world panned and scaled away underneath it.
 *   BD-3  every tile wore the full-alpha slot rim at rest, which is the
 *         mockup's *selection* affordance — so nothing read as selected.
 *
 * BD-1 and the static half of BD-3 are painted values, and jsdom does not
 * apply the imported stylesheet, so those are asserted against the CSS text
 * the same way boardsThemeTokens.test.ts does. The pan/zoom binding and the
 * selection state are behaviour, so those are driven through the component.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import BoardCanvas from './BoardCanvas';
import type { BoardItem } from './BoardCanvas';

const css = readFileSync(resolve(__dirname, 'BoardCanvas.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The `{ … }` body of the first rule whose selector list contains `selector`. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|[,}])[^{}]*${escaped}\\s*(?:,[^{}]*)?\\{([^}]*)\\}`, 'm'));
  if (!match) throw new Error(`no rule found for ${selector}`);
  return match[1];
}

const ITEMS: BoardItem[] = [
  { path: 'Boards/Act One', kind: 'folder', name: 'Act One', childBoards: 1, childCards: 2 },
  { path: 'Boards/Opening.md', kind: 'note', name: 'Opening', excerpt: 'The ship fell.' },
];

const renderCanvas = (view = { zoom: 100, panX: 0, panY: 0 }) =>
  render(<BoardCanvas items={ITEMS} savedLayout={{}} savedView={view} />);

const gridStyle = (container: HTMLElement) =>
  (container.querySelector('.board-canvas__scroll-area') as HTMLElement).style;

const tile = (name: string) => screen.getByLabelText(new RegExp(name)) as HTMLElement;

describe('BD-1 — the canvas is a translucent backdrop, not a slab', () => {
  const root = ruleBody('.board-canvas__root');

  it('lets the wallpaper through at the mockup\'s 42%', () => {
    expect(root).toMatch(/background-color:\s*rgb\(8 10 18 \/ 0\.42\)/);
    // The old solid fill is what made the starfield stop at the canvas rim.
    expect(root).not.toMatch(/--bg-canvas/);
  });

  it('rims itself with a neutral hairline, leaving the neon to the cards', () => {
    expect(root).toMatch(/border:\s*var\(--bw, 1px\) solid rgb\(255 255 255 \/ 0\.07\)/);
    // Mockup `bdCanvasSt` gives the container no glow at all.
    expect(root).not.toMatch(/box-shadow/);
  });

  it('uses the mockup radius', () => {
    expect(root).toMatch(/border-radius:\s*16px/);
  });
});

describe('BD-2 — the dot grid tracks pan and zoom', () => {
  it('binds size and position to the same state the world transform reads', () => {
    const scrollArea = ruleBody('.board-canvas__scroll-area');
    expect(scrollArea).toMatch(/background-size:\s*var\(--board-grid-size/);
    expect(scrollArea).toMatch(/background-position:\s*var\(--board-grid-x, 0px\) var\(--board-grid-y, 0px\)/);
    // `local` folds the scroll offset in, so a tall board cannot tear the grid
    // away from the world.
    expect(scrollArea).toMatch(/background-attachment:\s*local/);
  });

  it('translates with pan', () => {
    const { container } = renderCanvas({ zoom: 100, panX: -140, panY: -76 });
    expect(gridStyle(container).getPropertyValue('--board-grid-x')).toBe('-140px');
    expect(gridStyle(container).getPropertyValue('--board-grid-y')).toBe('-76px');
  });

  it('scales with zoom, at the same pitch items snap to', () => {
    const { container } = renderCanvas({ zoom: 150, panX: 0, panY: 0 });
    // GRID_SNAP (20) × 1.5
    expect(gridStyle(container).getPropertyValue('--board-grid-size')).toBe('30px');

    fireEvent.click(screen.getByRole('button', { name: /zoom out/i }));
    expect(gridStyle(container).getPropertyValue('--board-grid-size')).toBe('28px');
  });
});

describe('BD-3 — the slot rim marks selection, not existence', () => {
  it('rests on a neutral hairline and a plain depth shadow', () => {
    const rest = ruleBody('.board-canvas__item');
    expect(rest).toMatch(/border:\s*var\(--bw, 1px\) solid rgb\(255 255 255 \/ 0\.1\)/);
    expect(rest).toMatch(/box-shadow:\s*0 8px 22px rgb\(3 5 12 \/ 0\.45\)/);
    // The rest state must paint no slot colour at all — that is the whole gap.
    // (The `--board-item-*` locals are *declared* in this rule; what matters is
    // that nothing painted here reads one.)
    const painted = rest.replace(/--board-item-[\w-]+\s*:[^;]*;/g, '');
    expect(painted).not.toMatch(/var\(--board-item-/);
  });

  it('spends the near-full-alpha slot rim on the selected tile', () => {
    const selected = ruleBody('.board-canvas__item--selected');
    expect(selected).toMatch(/border-color:\s*color-mix\(in srgb, var\(--board-item-n\) 95%, transparent\)/);
    expect(selected).toMatch(/0 0 0 1px color-mix\(in srgb, var\(--board-item-n\) 45%, transparent\)/);
    expect(selected).toMatch(/0 0 24px -6px color-mix\(in srgb, var\(--board-item-g\) 65%, transparent\)/);
  });

  it('keeps hover between rest and selected instead of at full strength', () => {
    // --b*/--g* are alpha 1 at the default Glow intensity, so reading them raw
    // would make hover as loud as selection. The ladder has to be mixed down.
    const hover = ruleBody('.board-canvas__item:hover');
    expect(hover).toMatch(/border-color:\s*color-mix\(in srgb, var\(--board-item-n\) 60%, transparent\)/);
    expect(hover).not.toMatch(/var\(--b[1-6]\b/);
  });

  it('starts with nothing selected', () => {
    const { container } = renderCanvas();
    expect(container.querySelectorAll('.board-canvas__item--selected')).toHaveLength(0);
  });

  it('selects one tile at a time on press', () => {
    const { container } = renderCanvas();
    fireEvent.mouseDown(tile('Act One'), { button: 0 });
    expect(tile('Act One')).toHaveClass('board-canvas__item--selected');
    expect(tile('Act One')).toHaveAttribute('aria-current', 'true');

    fireEvent.mouseDown(tile('Opening'), { button: 0 });
    expect(tile('Opening')).toHaveClass('board-canvas__item--selected');
    expect(container.querySelectorAll('.board-canvas__item--selected')).toHaveLength(1);
  });

  it('selects on keyboard focus, so Tab and click agree', () => {
    renderCanvas();
    fireEvent.focus(tile('Opening'));
    expect(tile('Opening')).toHaveClass('board-canvas__item--selected');
  });

  it('deselects on a bare-canvas press and on Escape', () => {
    const { container } = renderCanvas();
    const root = container.querySelector('.board-canvas__root') as HTMLElement;

    fireEvent.mouseDown(tile('Act One'), { button: 0 });
    fireEvent.mouseDown(root, { button: 0 });
    expect(container.querySelectorAll('.board-canvas__item--selected')).toHaveLength(0);

    fireEvent.mouseDown(tile('Act One'), { button: 0 });
    fireEvent.keyDown(tile('Act One'), { key: 'Escape' });
    expect(container.querySelectorAll('.board-canvas__item--selected')).toHaveLength(0);
  });

  it('drops a selection that points at a tile the board no longer has', () => {
    const { container, rerender } = renderCanvas();
    fireEvent.mouseDown(tile('Act One'), { button: 0 });

    rerender(
      <BoardCanvas
        items={[ITEMS[1]]}
        savedLayout={{}}
        savedView={{ zoom: 100, panX: 0, panY: 0 }}
      />,
    );
    expect(container.querySelectorAll('.board-canvas__item--selected')).toHaveLength(0);
  });
});
