// SKY-20: Brainstorm routing memory + destination resolution — unit tests.
// No Electron, no IPC. fs is the only side effect: each test mints its own
// temp userData dir so settings load/save round-trip on a clean disk.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadBrainstormSettings,
  saveBrainstormSettings,
  setCategoryRouting,
  resolveDestination,
  defaultLayoutDirFor,
  normalizeRoutingDestination,
  listNotesVaultFolders,
  getBrainstormSettingsPath,
  BLANK_MODE_STAGING_DIR,
} from './brainstormRouting.js';

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-brainstorm-routing-'));
}

describe('brainstormSettings persistence', () => {
  let userData: string;

  beforeEach(() => { userData = makeTmp(); });
  afterEach(() => { fs.rmSync(userData, { recursive: true, force: true }); });

  it('returns defaults when no settings file exists', () => {
    const s = loadBrainstormSettings(userData);
    expect(s).toEqual({ v: 1, notesRouting: {} });
    expect(fs.existsSync(getBrainstormSettingsPath(userData))).toBe(false);
  });

  it('falls back to defaults on a corrupt file', () => {
    fs.writeFileSync(getBrainstormSettingsPath(userData), 'not-json{', 'utf-8');
    const s = loadBrainstormSettings(userData);
    expect(s).toEqual({ v: 1, notesRouting: {} });
  });

  it('round-trips notesRouting through save + load', () => {
    saveBrainstormSettings(userData, {
      notesRouting: { character: 'Worldbuilding/People' },
    });
    const s = loadBrainstormSettings(userData);
    expect(s.notesRouting).toEqual({ character: 'Worldbuilding/People' });
    expect(s.v).toBe(1);
  });

  it('save merges new keys without clobbering existing ones', () => {
    saveBrainstormSettings(userData, { notesRouting: { character: 'Chars' } });
    saveBrainstormSettings(userData, { notesRouting: { location: 'Places' } });
    const s = loadBrainstormSettings(userData);
    expect(s.notesRouting).toEqual({ character: 'Chars', location: 'Places' });
  });

  it('setCategoryRouting persists a single category', () => {
    const after = setCategoryRouting(userData, 'character', 'Chars');
    expect(after.notesRouting).toEqual({ character: 'Chars' });
    // Round-trip — value survives a fresh load.
    expect(loadBrainstormSettings(userData).notesRouting.character).toBe('Chars');
  });

  it('setCategoryRouting(null) clears just that category', () => {
    setCategoryRouting(userData, 'character', 'Chars');
    setCategoryRouting(userData, 'location', 'Places');
    const after = setCategoryRouting(userData, 'character', null);
    expect(after.notesRouting).toEqual({ location: 'Places' });
  });

  it('normalizeRoutingDestination strips leading/trailing slashes and backslashes', () => {
    expect(normalizeRoutingDestination('/Chars/')).toBe('Chars');
    expect(normalizeRoutingDestination('Worldbuilding\\People\\')).toBe('Worldbuilding/People');
    expect(normalizeRoutingDestination('')).toBe('');
    expect(normalizeRoutingDestination('   ')).toBe('');
  });

  it('normalizeRoutingDestination rejects path-traversal segments', () => {
    expect(() => normalizeRoutingDestination('../escape')).toThrow();
    expect(() => normalizeRoutingDestination('Chars/../escape')).toThrow();
    expect(() => normalizeRoutingDestination('./Chars')).toThrow();
  });

  it('saveBrainstormSettings normalizes nothing automatically — caller responsibility', () => {
    // setCategoryRouting goes through normalize; saveBrainstormSettings does
    // not. This split keeps the low-level save path cheap and lets the
    // category setter be the single normalization chokepoint.
    saveBrainstormSettings(userData, { notesRouting: { character: '/dirty/' } });
    expect(loadBrainstormSettings(userData).notesRouting.character).toBe('/dirty/');
  });
});

describe('resolveDestination', () => {
  it('default-mode characters land in the seeded Universes/Characters folder', () => {
    const r = resolveDestination('character', 'default', {});
    expect(r).toEqual({
      kind: 'resolved',
      relativeDir: defaultLayoutDirFor('character'),
      reason: 'default-layout',
    });
    expect(r.kind === 'resolved' && r.relativeDir).toMatch(/Characters$/);
  });

  it('default-mode notes land in Inbox/', () => {
    const r = resolveDestination('note', 'default', {});
    expect(r).toEqual({
      kind: 'resolved',
      relativeDir: 'Inbox',
      reason: 'default-layout',
    });
  });

  it('default mode ignores any per-category memory the user may have set', () => {
    // A user who switched from blank → default still has memory from before.
    // Default-mode behavior MUST be deterministic per SKY-20 AC4, so memory
    // is ignored and the seeded path wins.
    const r = resolveDestination('character', 'default', { character: 'OldChoice' });
    expect(r.kind).toBe('resolved');
    expect(r.kind === 'resolved' && r.relativeDir).not.toBe('OldChoice');
  });

  it('blank mode + no memory → needs_user_choice', () => {
    const r = resolveDestination('character', 'blank', {});
    expect(r).toEqual({ kind: 'needs_user_choice', category: 'character' });
  });

  it('blank mode + remembered choice → resolved with reason=remembered', () => {
    const r = resolveDestination('character', 'blank', { character: 'Worldbuilding/People' });
    expect(r).toEqual({
      kind: 'resolved',
      relativeDir: 'Worldbuilding/People',
      reason: 'remembered',
    });
  });

  it('imported mode is treated like blank for routing', () => {
    expect(resolveDestination('item', 'imported', {})).toEqual({
      kind: 'needs_user_choice',
      category: 'item',
    });
    expect(resolveDestination('item', 'imported', { item: 'Gear' })).toEqual({
      kind: 'resolved',
      relativeDir: 'Gear',
      reason: 'remembered',
    });
  });

  it('memory per category is independent — a hit on character does not satisfy location', () => {
    const memory = { character: 'Chars' } as const;
    expect(resolveDestination('character', 'blank', memory).kind).toBe('resolved');
    expect(resolveDestination('location', 'blank', memory).kind).toBe('needs_user_choice');
  });
});

describe('listNotesVaultFolders', () => {
  let vault: string;

  beforeEach(() => { vault = makeTmp(); });
  afterEach(() => { fs.rmSync(vault, { recursive: true, force: true }); });

  it('returns the vault root option even when the vault is empty', () => {
    const folders = listNotesVaultFolders(vault);
    expect(folders[0]).toEqual({ path: '', label: '/ (vault root)' });
    expect(folders).toHaveLength(1);
  });

  it('walks nested folders depth-first and sorts alphabetically', () => {
    fs.mkdirSync(path.join(vault, 'B', 'B2'), { recursive: true });
    fs.mkdirSync(path.join(vault, 'A', 'A1'), { recursive: true });
    const folders = listNotesVaultFolders(vault).map((f) => f.path);
    // Vault root first, then A before B (alphabetical), each parent before
    // its children. depth-first DFS within the sort.
    expect(folders).toEqual(['', 'A', 'A/A1', 'B', 'B/B2']);
  });

  it('skips hidden directories — including the brainstorm staging dir', () => {
    fs.mkdirSync(path.join(vault, BLANK_MODE_STAGING_DIR), { recursive: true });
    fs.mkdirSync(path.join(vault, '.git'), { recursive: true });
    fs.mkdirSync(path.join(vault, 'Visible'), { recursive: true });
    const folders = listNotesVaultFolders(vault).map((f) => f.path);
    expect(folders).toContain('Visible');
    expect(folders).not.toContain('.git');
    expect(folders.some((p) => p.startsWith('.brainstorm-staging'))).toBe(false);
  });

  it('respects maxDepth so deep trees stay browseable', () => {
    fs.mkdirSync(path.join(vault, 'a', 'b', 'c', 'd'), { recursive: true });
    const folders = listNotesVaultFolders(vault, 2).map((f) => f.path);
    expect(folders).toContain('a');
    expect(folders).toContain('a/b');
    expect(folders).not.toContain('a/b/c');
  });
});
