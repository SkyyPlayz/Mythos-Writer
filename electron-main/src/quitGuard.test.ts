import { describe, expect, it } from 'vitest';
import { shouldQuitOnWindowAllClosed } from './quitGuard.js';

describe('shouldQuitOnWindowAllClosed', () => {
  it('darwin without a pending quit stays in the dock', () => {
    expect(shouldQuitOnWindowAllClosed('darwin', false)).toBe(false);
  });

  it('darwin with a pending quit lets the quit through (SKY-10995)', () => {
    expect(shouldQuitOnWindowAllClosed('darwin', true)).toBe(true);
  });

  it('linux quits regardless of quitRequested', () => {
    expect(shouldQuitOnWindowAllClosed('linux', false)).toBe(true);
    expect(shouldQuitOnWindowAllClosed('linux', true)).toBe(true);
  });

  it('win32 quits regardless of quitRequested', () => {
    expect(shouldQuitOnWindowAllClosed('win32', false)).toBe(true);
    expect(shouldQuitOnWindowAllClosed('win32', true)).toBe(true);
  });
});
