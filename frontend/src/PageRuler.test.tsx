// GH #842 (Beta 3 M10) — PageRuler component tests: handle a11y, keyboard
// nudging, mouse drags with live preview + commit-on-release, preset snap.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import PageRuler from './PageRuler';
import { STORY_PAGE_DEFAULTS, STORY_PAGE_PRESET_WIDTHS, type StoryPagePrefs } from './theme';

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty('--page-width-story');
  document.documentElement.style.removeProperty('--story-page-pad-horiz');
});

function renderRuler(prefs: Partial<StoryPagePrefs> = {}) {
  const onPrefsChange = vi.fn();
  const merged: StoryPagePrefs = { ...STORY_PAGE_DEFAULTS, ...prefs };
  const utils = render(<PageRuler prefs={merged} onPrefsChange={onPrefsChange} />);
  return { ...utils, onPrefsChange, prefs: merged };
}

describe('PageRuler a11y', () => {
  it('exposes all four handles as keyboard-reachable sliders with value semantics', () => {
    renderRuler(); // letter → 680px, margins 56
    for (const id of ['pgr-edge-l', 'pgr-edge-r']) {
      const h = screen.getByTestId(id);
      expect(h).toHaveAttribute('role', 'slider');
      expect(h).toHaveAttribute('tabindex', '0');
      expect(h).toHaveAttribute('aria-valuemin', '320');
      expect(h).toHaveAttribute('aria-valuemax', '1400');
      expect(h).toHaveAttribute('aria-valuenow', '680');
    }
    for (const id of ['pgr-margin-l', 'pgr-margin-r']) {
      const h = screen.getByTestId(id);
      expect(h).toHaveAttribute('role', 'slider');
      expect(h).toHaveAttribute('aria-valuemin', '0');
      expect(h).toHaveAttribute('aria-valuemax', '120');
      expect(h).toHaveAttribute('aria-valuenow', '56');
    }
  });

  it('sizes the track to the effective width and offsets margin handles', () => {
    renderRuler({ sizePreset: 'custom', customWidthPx: 900, marginHorizPx: 40 });
    const track = screen.getByTestId('page-ruler').firstElementChild as HTMLElement;
    expect(track.style.maxWidth).toBe('900px');
    expect(screen.getByTestId('pgr-margin-l').style.left).toBe('40px');
    expect(screen.getByTestId('pgr-margin-r').style.right).toBe('40px');
  });
});

describe('PageRuler keyboard', () => {
  it('arrow keys nudge the width ±10px as a custom size', () => {
    const { onPrefsChange } = renderRuler();
    fireEvent.keyDown(screen.getByTestId('pgr-edge-r'), { key: 'ArrowRight' });
    expect(onPrefsChange).toHaveBeenCalledWith(
      expect.objectContaining({ sizePreset: 'custom', customWidthPx: 690 })
    );
    fireEvent.keyDown(screen.getByTestId('pgr-edge-l'), { key: 'ArrowLeft' });
    expect(onPrefsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ sizePreset: 'custom', customWidthPx: 670 })
    );
  });

  it('arrow keys nudge the horizontal margins ±4px and clamp at 0–120', () => {
    const { onPrefsChange } = renderRuler({ marginHorizPx: 2 });
    fireEvent.keyDown(screen.getByTestId('pgr-margin-l'), { key: 'ArrowRight' });
    expect(onPrefsChange).toHaveBeenCalledWith(expect.objectContaining({ marginHorizPx: 6 }));
    fireEvent.keyDown(screen.getByTestId('pgr-margin-l'), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByTestId('pgr-margin-l'), { key: 'ArrowLeft' });
    expect(onPrefsChange).toHaveBeenLastCalledWith(expect.objectContaining({ marginHorizPx: 0 }));
  });
});

describe('PageRuler mouse drags', () => {
  it('width drag previews live via --page-width-story and commits custom width on release', () => {
    const { onPrefsChange } = renderRuler(); // 680
    fireEvent.mouseDown(screen.getByTestId('pgr-edge-r'), { clientX: 400 });
    fireEvent.mouseMove(window, { clientX: 500 }); // +100 × 2 = 880
    expect(document.documentElement.style.getPropertyValue('--page-width-story')).toBe('880px');
    expect(screen.getByTestId('pgr-readout')).toHaveTextContent('880px');
    expect(onPrefsChange).not.toHaveBeenCalled(); // live only — no commit yet
    fireEvent.mouseUp(window, { clientX: 500 });
    expect(onPrefsChange).toHaveBeenCalledTimes(1);
    expect(onPrefsChange).toHaveBeenCalledWith(
      expect.objectContaining({ sizePreset: 'custom', customWidthPx: 880 })
    );
  });

  it('snaps onto a preset when released close to it', () => {
    const { onPrefsChange } = renderRuler(); // letter 680; a4 = 720
    fireEvent.mouseDown(screen.getByTestId('pgr-edge-r'), { clientX: 400 });
    // +24 × 2 = 728 → within 14px of a4's 720.
    fireEvent.mouseMove(window, { clientX: 424 });
    expect(document.documentElement.style.getPropertyValue('--page-width-story')).toBe(
      `${STORY_PAGE_PRESET_WIDTHS['a4']}px`
    );
    fireEvent.mouseUp(window, { clientX: 424 });
    expect(onPrefsChange).toHaveBeenCalledWith(
      expect.objectContaining({ sizePreset: 'a4', customWidthPx: STORY_PAGE_PRESET_WIDTHS['a4'] })
    );
  });

  it('margin drag previews via --story-page-pad-horiz and commits marginHorizPx', () => {
    const { onPrefsChange, prefs } = renderRuler(); // 56
    fireEvent.mouseDown(screen.getByTestId('pgr-margin-l'), { clientX: 200 });
    fireEvent.mouseMove(window, { clientX: 230 }); // left handle → right = +30
    expect(document.documentElement.style.getPropertyValue('--story-page-pad-horiz')).toBe('86px');
    fireEvent.mouseUp(window, { clientX: 230 });
    expect(onPrefsChange).toHaveBeenCalledWith(
      expect.objectContaining({ marginHorizPx: 86, marginVertPx: prefs.marginVertPx })
    );
  });
});
