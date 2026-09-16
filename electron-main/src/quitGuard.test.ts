import { describe, expect, it } from 'vitest';
import {
  resolveWillPreventUnloadAction,
  shouldCommitQuitOnWindowClose,
  shouldQuitOnWindowAllClosed,
} from './quitGuard.js';

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

describe('shouldCommitQuitOnWindowClose (0.5.2 P0 quit hang)', () => {
  it('win32 and linux treat window close as quit', () => {
    expect(shouldCommitQuitOnWindowClose('win32')).toBe(true);
    expect(shouldCommitQuitOnWindowClose('linux')).toBe(true);
  });

  it('darwin does not — dock-resident close still prompts', () => {
    expect(shouldCommitQuitOnWindowClose('darwin')).toBe(false);
  });
});

describe('resolveWillPreventUnloadAction', () => {
  it('auto-allows when quit is already committed', () => {
    expect(resolveWillPreventUnloadAction({ quitRequested: true, dialogChoice: 1 })).toBe('allow');
  });

  it('Leave allows; Stay blocks', () => {
    expect(resolveWillPreventUnloadAction({ quitRequested: false, dialogChoice: 0 })).toBe('allow');
    expect(resolveWillPreventUnloadAction({ quitRequested: false, dialogChoice: 1 })).toBe('stay');
  });

  it('dialog failure allows unload — never leave the app unclosable', () => {
    expect(resolveWillPreventUnloadAction({ quitRequested: false, dialogChoice: 'error' })).toBe('allow');
  });
});
