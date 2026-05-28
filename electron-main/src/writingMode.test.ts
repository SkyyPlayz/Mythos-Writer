/**
 * writingMode.test.ts (MYT-347)
 *
 * Unit tests for per-project writing mode state:
 *   §1  Default state
 *   §2  Mode transitions + persistence
 *   §3  Focus flag persistence
 *   §4  Edit mode config persistence
 *   §5  Combined updates
 *   §6  Validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb, closeDb } from './db.js';
import { getWritingModeState, setWritingModeState } from './writingMode.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wm-'));
  openDb(tmpDir);
});

afterEach(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── §1 Default state ──────────────────────────────────────────────────────────

describe('getWritingModeState defaults (§1)', () => {
  it('returns normal mode on a fresh vault', () => {
    expect(getWritingModeState().mode).toBe('normal');
  });

  it('returns default focus flags (sidebar=false, wordCount=true)', () => {
    const { focusFlags } = getWritingModeState();
    expect(focusFlags.sidebar).toBe(false);
    expect(focusFlags.toolbar).toBe(false);
    expect(focusFlags.wordCount).toBe(true);
    expect(focusFlags.minimap).toBe(false);
  });

  it('returns default edit config with all layers enabled', () => {
    const { editConfig } = getWritingModeState();
    expect(editConfig.showWritingAssistant).toBe(true);
    expect(editConfig.showArchive).toBe(true);
    expect(editConfig.showBetaRead).toBe(true);
  });
});

// ─── §2 Mode transitions + persistence ────────────────────────────────────────

describe('mode transitions + persistence (§2)', () => {
  it('transitions normal → focus', () => {
    const state = setWritingModeState({ mode: 'focus' });
    expect(state.mode).toBe('focus');
  });

  it('transitions focus → edit', () => {
    setWritingModeState({ mode: 'focus' });
    const state = setWritingModeState({ mode: 'edit' });
    expect(state.mode).toBe('edit');
  });

  it('transitions edit → normal', () => {
    setWritingModeState({ mode: 'edit' });
    const state = setWritingModeState({ mode: 'normal' });
    expect(state.mode).toBe('normal');
  });

  it('persists mode so a subsequent get returns the same value', () => {
    setWritingModeState({ mode: 'focus' });
    expect(getWritingModeState().mode).toBe('focus');
  });

  it('can set mode back to normal after focus', () => {
    setWritingModeState({ mode: 'focus' });
    setWritingModeState({ mode: 'normal' });
    expect(getWritingModeState().mode).toBe('normal');
  });
});

// ─── §3 Focus flag persistence ─────────────────────────────────────────────────

describe('focus flag persistence (§3)', () => {
  it('updates a single focus flag', () => {
    setWritingModeState({ focusFlags: { sidebar: true } });
    expect(getWritingModeState().focusFlags.sidebar).toBe(true);
  });

  it('leaves other flags at their defaults after a partial update', () => {
    setWritingModeState({ focusFlags: { sidebar: true } });
    const { focusFlags } = getWritingModeState();
    expect(focusFlags.toolbar).toBe(false);
    expect(focusFlags.wordCount).toBe(true);
    expect(focusFlags.minimap).toBe(false);
  });

  it('persists multiple focus flags in one call', () => {
    setWritingModeState({ focusFlags: { toolbar: true, minimap: true } });
    const { focusFlags } = getWritingModeState();
    expect(focusFlags.toolbar).toBe(true);
    expect(focusFlags.minimap).toBe(true);
  });

  it('overwrites previously saved focus flags on second call', () => {
    setWritingModeState({ focusFlags: { sidebar: true } });
    setWritingModeState({ focusFlags: { sidebar: false } });
    expect(getWritingModeState().focusFlags.sidebar).toBe(false);
  });
});

// ─── §4 Edit mode config persistence ─────────────────────────────────────────

describe('edit mode config persistence (§4)', () => {
  it('disables a single edit layer', () => {
    setWritingModeState({ editConfig: { showBetaRead: false } });
    expect(getWritingModeState().editConfig.showBetaRead).toBe(false);
  });

  it('leaves other layers at their defaults after a partial update', () => {
    setWritingModeState({ editConfig: { showBetaRead: false } });
    const { editConfig } = getWritingModeState();
    expect(editConfig.showWritingAssistant).toBe(true);
    expect(editConfig.showArchive).toBe(true);
  });

  it('persists disabling multiple edit layers', () => {
    setWritingModeState({ editConfig: { showArchive: false, showBetaRead: false } });
    const { editConfig } = getWritingModeState();
    expect(editConfig.showArchive).toBe(false);
    expect(editConfig.showBetaRead).toBe(false);
  });

  it('re-enables a previously disabled layer', () => {
    setWritingModeState({ editConfig: { showWritingAssistant: false } });
    setWritingModeState({ editConfig: { showWritingAssistant: true } });
    expect(getWritingModeState().editConfig.showWritingAssistant).toBe(true);
  });
});

// ─── §5 Combined updates ───────────────────────────────────────────────────────

describe('combined updates (§5)', () => {
  it('sets mode and focusFlags in a single call', () => {
    const state = setWritingModeState({ mode: 'focus', focusFlags: { sidebar: true } });
    expect(state.mode).toBe('focus');
    expect(state.focusFlags.sidebar).toBe(true);
  });

  it('sets mode, focusFlags, and editConfig in a single call', () => {
    const state = setWritingModeState({
      mode: 'edit',
      focusFlags: { wordCount: false },
      editConfig: { showBetaRead: false },
    });
    expect(state.mode).toBe('edit');
    expect(state.focusFlags.wordCount).toBe(false);
    expect(state.editConfig.showBetaRead).toBe(false);
  });

  it('no-op payload leaves state unchanged', () => {
    setWritingModeState({ mode: 'focus' });
    const before = getWritingModeState();
    setWritingModeState({});
    const after = getWritingModeState();
    expect(after.mode).toBe(before.mode);
  });
});

// ─── §6 Validation ─────────────────────────────────────────────────────────────

describe('validation (§6)', () => {
  it('throws on an invalid mode string', () => {
    expect(() => setWritingModeState({ mode: 'distraction-free' as never })).toThrow(
      /invalid writingMode/i,
    );
  });

  it('leaves the existing mode unchanged after a rejected set', () => {
    setWritingModeState({ mode: 'edit' });
    try { setWritingModeState({ mode: 'bad' as never }); } catch { /* expected */ }
    expect(getWritingModeState().mode).toBe('edit');
  });
});
