// Probe/Critic H4 — Ctrl/Cmd + wheel density hook.
// Covers: real canvas-root selectors, defaultPrevented short-circuit, and a
// wheel burst stepping multiple times off the pending preview/commit value
// (not the stale registered/committed density).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useCtrlScrollDensity, isCanvasZoomTarget } from './useCtrlScrollDensity';
import {
  registerDensityBridge,
  resetDensityControlForTests,
  getPendingOrRegisteredDensity,
} from '../lib/uiDensity';
import { LIQUID_NEON_V2_DEFAULTS, type LiquidNeonV2Settings } from '../theme/liquidNeonEngine';

function dispatchCtrlWheel(target: EventTarget, deltaY: number, extra: Partial<WheelEventInit> = {}): WheelEvent {
  const evt = new WheelEvent('wheel', {
    deltaY,
    ctrlKey: true,
    cancelable: true,
    bubbles: true,
    ...extra,
  });
  target.dispatchEvent(evt);
  return evt;
}

function makeBridgeSettings(): LiquidNeonV2Settings {
  return { ...LIQUID_NEON_V2_DEFAULTS, slots: [...LIQUID_NEON_V2_DEFAULTS.slots] as LiquidNeonV2Settings['slots'] };
}

describe('useCtrlScrollDensity (H4)', () => {
  afterEach(() => {
    cleanup();
    resetDensityControlForTests();
    document.body.innerHTML = '';
  });

  describe('isCanvasZoomTarget', () => {
    it('matches the real canvas roots and not other elements', () => {
      const ax = document.createElement('div');
      ax.className = 'ax-root';
      const board = document.createElement('div');
      board.className = 'board-canvas__root';
      const vgv = document.createElement('div');
      vgv.className = 'vgv-root';
      const msv = document.createElement('div');
      msv.className = 'msv-sheet';
      const plain = document.createElement('div');
      plain.className = 'not-a-canvas';
      for (const el of [ax, board, vgv, msv, plain]) document.body.appendChild(el);

      expect(isCanvasZoomTarget(ax)).toBe(true);
      expect(isCanvasZoomTarget(board)).toBe(true);
      expect(isCanvasZoomTarget(vgv)).toBe(true);
      expect(isCanvasZoomTarget(msv)).toBe(true);
      expect(isCanvasZoomTarget(plain)).toBe(false);
      expect(isCanvasZoomTarget(null)).toBe(false);
    });

    it('no longer matches the removed dead selectors', () => {
      const dead = document.createElement('div');
      dead.className = 'timeline2-root vault-graph-view board-canvas brainstorm-board';
      dead.setAttribute('data-timeline-canvas', '');
      dead.setAttribute('data-realm-canvas', '');
      dead.setAttribute('data-boards-canvas', '');
      document.body.appendChild(dead);
      expect(isCanvasZoomTarget(dead)).toBe(false);
    });

    it('matches a descendant of a canvas root via closest()', () => {
      const root = document.createElement('div');
      root.className = 'vgv-root';
      const child = document.createElement('span');
      root.appendChild(child);
      document.body.appendChild(root);
      expect(isCanvasZoomTarget(child)).toBe(true);
    });
  });

  it('skips density entirely when the wheel event is already defaultPrevented', () => {
    const commit = vi.fn();
    registerDensityBridge({ getSettings: makeBridgeSettings, cosmicBgUrl: '', commit });
    renderHook(() => useCtrlScrollDensity());

    const before = getPendingOrRegisteredDensity();
    // A canvas zoom handler (capture phase, in real usage) already calls
    // preventDefault before our bubble-phase listener runs — simulate that by
    // marking the event canceled before it is dispatched.
    const evt = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true, bubbles: true });
    evt.preventDefault();
    document.body.dispatchEvent(evt);
    const secondEvt = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true, bubbles: true });
    secondEvt.preventDefault();
    document.body.dispatchEvent(secondEvt);

    expect(getPendingOrRegisteredDensity()).toBe(before);
    expect(commit).not.toHaveBeenCalled();
  });

  it('skips density when the wheel target is inside a canvas root', () => {
    const commit = vi.fn();
    registerDensityBridge({ getSettings: makeBridgeSettings, cosmicBgUrl: '', commit });
    renderHook(() => useCtrlScrollDensity());

    const canvas = document.createElement('div');
    canvas.className = 'board-canvas__root';
    document.body.appendChild(canvas);

    const before = getPendingOrRegisteredDensity();
    dispatchCtrlWheel(canvas, -100);
    expect(getPendingOrRegisteredDensity()).toBe(before);
    expect(commit).not.toHaveBeenCalled();
  });

  it('ignores range-input targets while focused (does not steal browser zoom)', () => {
    const commit = vi.fn();
    registerDensityBridge({ getSettings: makeBridgeSettings, cosmicBgUrl: '', commit });
    renderHook(() => useCtrlScrollDensity());

    const range = document.createElement('input');
    range.type = 'range';
    document.body.appendChild(range);

    const before = getPendingOrRegisteredDensity();
    dispatchCtrlWheel(range, -100);
    expect(getPendingOrRegisteredDensity()).toBe(before);
  });

  it('does nothing without the ctrl/meta modifier', () => {
    const commit = vi.fn();
    registerDensityBridge({ getSettings: makeBridgeSettings, cosmicBgUrl: '', commit });
    renderHook(() => useCtrlScrollDensity());

    const before = getPendingOrRegisteredDensity();
    const evt = new WheelEvent('wheel', { deltaY: -100, cancelable: true, bubbles: true });
    document.body.dispatchEvent(evt);
    expect(getPendingOrRegisteredDensity()).toBe(before);
  });

  it('a wheel burst steps multiple times off the pending value, not the stale registered one', () => {
    const commit = vi.fn();
    registerDensityBridge({ getSettings: makeBridgeSettings, cosmicBgUrl: '', commit });
    renderHook(() => useCtrlScrollDensity());

    const start = getPendingOrRegisteredDensity();
    // deltaY < 0 (scroll "up") steps density up by .02 per notch (densFromWheelDelta).
    dispatchCtrlWheel(document.body, -100);
    const afterOne = getPendingOrRegisteredDensity();
    expect(afterOne).toBeCloseTo(start + 0.02, 5);

    dispatchCtrlWheel(document.body, -100);
    const afterTwo = getPendingOrRegisteredDensity();
    expect(afterTwo).toBeCloseTo(start + 0.04, 5);

    dispatchCtrlWheel(document.body, -100);
    const afterThree = getPendingOrRegisteredDensity();
    expect(afterThree).toBeCloseTo(start + 0.06, 5);

    // Commit hasn't fired yet (idle debounce) — the burst advanced purely via
    // the pending preview/commit value, confirming the H4 fix is load-bearing.
    expect(commit).not.toHaveBeenCalled();
  });
});
