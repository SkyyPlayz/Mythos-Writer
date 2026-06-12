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
  estimateTokens,
  selectContext,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  type ContextCandidate,
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

  it('default-mode inbox items land in Inbox/', () => {
    const r = resolveDestination('inbox', 'default', {});
    expect(r).toEqual({
      kind: 'resolved',
      relativeDir: 'Inbox',
      reason: 'default-layout',
    });
  });

  it('default-mode factions land in the Factions folder', () => {
    const r = resolveDestination('faction', 'default', {});
    expect(r.kind).toBe('resolved');
    expect(r.kind === 'resolved' && r.relativeDir).toMatch(/Factions$/);
  });

  it('default-mode scene_cards land in the Scenes folder', () => {
    const r = resolveDestination('scene_card', 'default', {});
    expect(r.kind).toBe('resolved');
    expect(r.kind === 'resolved' && r.relativeDir).toMatch(/Scenes$/);
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

// ─── SKY-196: token estimation + context selection ────────────────────────────

describe('estimateTokens', () => {
  it('returns ceil(length / 4)', () => {
    expect(estimateTokens('1234')).toBe(1);    // exactly 1
    expect(estimateTokens('12345')).toBe(2);   // rounds up
    expect(estimateTokens('')).toBe(0);
  });

  it('is deterministic for the same input', () => {
    const t = estimateTokens('Hello, story world!');
    expect(estimateTokens('Hello, story world!')).toBe(t);
  });
});

describe('selectContext', () => {
  const candidates: ContextCandidate[] = [
    { path: 'chars/aria.md',   name: 'Aria Voss',      type: 'character', content: 'A young sorceress.' },
    { path: 'locs/tarsel.md',  name: 'Tarsel',         type: 'location',  content: 'A city of bells.'   },
    { path: 'items/sword.md',  name: 'Starfall Blade', type: 'item',      content: 'An ancient sword.'  },
  ];

  it('includes all candidates when budget is sufficient', () => {
    const r = selectContext({ candidates, userMessage: '', conversationText: '', tokenBudget: 10_000 });
    expect(r.included).toHaveLength(3);
    expect(r.excluded).toHaveLength(0);
  });

  it('usedTokens equals sum of included estimatedTokens', () => {
    const r = selectContext({ candidates, userMessage: '', conversationText: '', tokenBudget: 10_000 });
    const sum = r.included.reduce((acc, i) => acc + i.estimatedTokens, 0);
    expect(r.usedTokens).toBe(sum);
  });

  it('uses DEFAULT_CONTEXT_TOKEN_BUDGET when tokenBudget is omitted', () => {
    const r = selectContext({ candidates, userMessage: '', conversationText: '' });
    expect(r.budgetTokens).toBe(DEFAULT_CONTEXT_TOKEN_BUDGET);
  });

  it('excludes items that push past the budget and marks them "Budget limit reached"', () => {
    // Budget of 1 token will exclude everything (cheapest item costs ≥ 5 tokens).
    const r = selectContext({ candidates, userMessage: '', conversationText: '', tokenBudget: 1 });
    expect(r.included).toHaveLength(0);
    expect(r.excluded.length).toBeGreaterThan(0);
    expect(r.excluded.every((i) => i.whyIncluded === 'Budget limit reached')).toBe(true);
  });

  it('prioritises items mentioned in the current user message (score 3)', () => {
    const r = selectContext({
      candidates, userMessage: 'Tell me about Tarsel', conversationText: '', tokenBudget: 10_000,
    });
    const tarsel = r.included.find((i) => i.name === 'Tarsel');
    expect(tarsel).toBeDefined();
    expect(tarsel?.whyIncluded).toBe('Mentioned in your message');
    // Tarsel should sort before the others (highest score)
    expect(r.included[0].name).toBe('Tarsel');
  });

  it('gives "Referenced in conversation" to conversation-only mentions (score 2)', () => {
    const r = selectContext({
      candidates, userMessage: 'hello', conversationText: 'Aria Voss appeared in chapter one.', tokenBudget: 10_000,
    });
    const aria = r.included.find((i) => i.name === 'Aria Voss');
    expect(aria?.whyIncluded).toBe('Referenced in conversation');
  });

  it('gives "Background <type> context" to unmentioned items (score 1)', () => {
    const r = selectContext({
      candidates, userMessage: 'hello', conversationText: 'hello', tokenBudget: 10_000,
    });
    const blade = r.included.find((i) => i.name === 'Starfall Blade');
    expect(blade?.whyIncluded).toBe('Background item context');
  });

  it('is deterministic — same input always produces same order', () => {
    const r1 = selectContext({ candidates, userMessage: '', conversationText: '', tokenBudget: 10_000 });
    const r2 = selectContext({ candidates, userMessage: '', conversationText: '', tokenBudget: 10_000 });
    expect(r1.included.map((i) => i.name)).toEqual(r2.included.map((i) => i.name));
  });

  it('returns empty result for empty candidates list', () => {
    const r = selectContext({ candidates: [], userMessage: 'anything', conversationText: '', tokenBudget: 10_000 });
    expect(r.included).toHaveLength(0);
    expect(r.excluded).toHaveLength(0);
    expect(r.usedTokens).toBe(0);
    expect(r.budgetTokens).toBe(10_000);
  });

  it('user-message match takes precedence over conversation match for the same name', () => {
    const r = selectContext({
      candidates, userMessage: 'Tarsel is great', conversationText: 'Tarsel was mentioned before', tokenBudget: 10_000,
    });
    const tarsel = r.included.find((i) => i.name === 'Tarsel');
    expect(tarsel?.whyIncluded).toBe('Mentioned in your message');
  });

  it('orders same-score items by type then name (deterministic tiebreak)', () => {
    // All items unmentioned → score 1 for all. Character < Location < Item by TYPE_ORDER.
    const r = selectContext({ candidates, userMessage: '', conversationText: '', tokenBudget: 10_000 });
    const names = r.included.map((i) => i.name);
    expect(names.indexOf('Aria Voss')).toBeLessThan(names.indexOf('Tarsel'));
    expect(names.indexOf('Tarsel')).toBeLessThan(names.indexOf('Starfall Blade'));
  });
});
