import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadWindowState,
  saveWindowState,
  isBoundsOnScreen,
  type WindowBounds,
  type DisplayRect,
} from './windowState.js';

describe('isBoundsOnScreen', () => {
  const display: DisplayRect = { x: 0, y: 0, width: 1920, height: 1080 };

  it('returns true when center falls inside the only display', () => {
    const bounds: WindowBounds = { x: 100, y: 100, width: 1200, height: 800, isMaximized: false };
    expect(isBoundsOnScreen(bounds, [display])).toBe(true);
  });

  it('returns false when displays array is empty', () => {
    const bounds: WindowBounds = { x: 0, y: 0, width: 1200, height: 800, isMaximized: false };
    expect(isBoundsOnScreen(bounds, [])).toBe(false);
  });

  it('returns false when window center is off the right edge', () => {
    // x=1800, width=1200 → center x=2400, past the 1920-wide display
    const bounds: WindowBounds = { x: 1800, y: 0, width: 1200, height: 800, isMaximized: false };
    expect(isBoundsOnScreen(bounds, [display])).toBe(false);
  });

  it('returns false when window center is off the bottom edge', () => {
    const bounds: WindowBounds = { x: 0, y: 900, width: 1200, height: 800, isMaximized: false };
    expect(isBoundsOnScreen(bounds, [display])).toBe(false);
  });

  it('returns false when position is far off-screen (disconnected display)', () => {
    const bounds: WindowBounds = { x: 5000, y: 0, width: 1200, height: 800, isMaximized: false };
    expect(isBoundsOnScreen(bounds, [display])).toBe(false);
  });

  it('returns true when center lands on a secondary display to the right', () => {
    const secondary: DisplayRect = { x: 1920, y: 0, width: 1920, height: 1080 };
    const bounds: WindowBounds = { x: 1920, y: 100, width: 1200, height: 800, isMaximized: false };
    expect(isBoundsOnScreen(bounds, [display, secondary])).toBe(true);
  });

  it('returns true when center lands on a display with negative origin (display to the left)', () => {
    const leftDisplay: DisplayRect = { x: -1920, y: 0, width: 1920, height: 1080 };
    const bounds: WindowBounds = { x: -1800, y: 100, width: 1200, height: 800, isMaximized: false };
    expect(isBoundsOnScreen(bounds, [leftDisplay])).toBe(true);
  });

  it('handles isMaximized=true with a valid position', () => {
    const bounds: WindowBounds = { x: 0, y: 0, width: 1920, height: 1080, isMaximized: true };
    expect(isBoundsOnScreen(bounds, [display])).toBe(true);
  });
});

describe('loadWindowState / saveWindowState', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no state file exists', () => {
    expect(loadWindowState(tmpDir)).toBeNull();
  });

  it('round-trips a normal bounds object', () => {
    const bounds: WindowBounds = { x: 50, y: 60, width: 1400, height: 900, isMaximized: false };
    saveWindowState(tmpDir, bounds);
    expect(loadWindowState(tmpDir)).toEqual(bounds);
  });

  it('round-trips with isMaximized=true', () => {
    const bounds: WindowBounds = { x: 0, y: 0, width: 1920, height: 1080, isMaximized: true };
    saveWindowState(tmpDir, bounds);
    expect(loadWindowState(tmpDir)).toEqual(bounds);
  });

  it('returns null for corrupt JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'window-state.json'), 'not json', 'utf-8');
    expect(loadWindowState(tmpDir)).toBeNull();
  });

  it('returns null when JSON is missing required fields', () => {
    fs.writeFileSync(path.join(tmpDir, 'window-state.json'), JSON.stringify({ x: 0, y: 0 }), 'utf-8');
    expect(loadWindowState(tmpDir)).toBeNull();
  });

  it('returns null when a field has the wrong type', () => {
    const bad = { x: '100', y: 0, width: 1200, height: 800, isMaximized: false };
    fs.writeFileSync(path.join(tmpDir, 'window-state.json'), JSON.stringify(bad), 'utf-8');
    expect(loadWindowState(tmpDir)).toBeNull();
  });

  it('overwrites an existing state file on save', () => {
    const first: WindowBounds = { x: 0, y: 0, width: 1200, height: 800, isMaximized: false };
    const second: WindowBounds = { x: 200, y: 300, width: 1400, height: 900, isMaximized: true };
    saveWindowState(tmpDir, first);
    saveWindowState(tmpDir, second);
    expect(loadWindowState(tmpDir)).toEqual(second);
  });
});
