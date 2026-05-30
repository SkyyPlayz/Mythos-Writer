// Brainstorm Agent — unit tests.
// All side effects are injected; no Electron, no real filesystem, no network.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  parseFacts,
  writeFacts,
  validateVaultPath,
  parseAliasHints,
  type BrainstormAgentDeps,
  type ParsedFact,
  type WrittenEntity,
} from './brainstormAgent.js';
import {
  openDb,
  closeDb,
  upsertSuggestion,
  getSuggestion,
  listSuggestions,
  type DbSuggestion,
} from './db.js';
import { parseFrontmatter } from './vault.js';

// ─── Helpers ───

function makeDeps(
  tmpDir: string,
  overrides: Partial<BrainstormAgentDeps> = {},
): BrainstormAgentDeps & { written: Array<{ path: string; content: string }>; persisted: DbSuggestion[] } {
  const written: Array<{ path: string; content: string }> = [];
  const persisted: DbSuggestion[] = [];
  return {
    writeVaultNote: (relativePath, content) => {
      written.push({ path: relativePath, content });
      const fullPath = path.join(tmpDir, relativePath);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf-8');
    },
    persistSuggestion: (s) => persisted.push(s),
    written,
    persisted,
    ...overrides,
  };
}

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-brainstorm-'));
}

// ─── parseFacts ───

describe('parseFacts', () => {
  it('parses a character fact', () => {
    const facts = parseFacts('[FACT:character|Aria|A fierce warrior from the north]');
    expect(facts).toHaveLength(1);
    expect(facts[0].type).toBe('character');
    expect(facts[0].name).toBe('Aria');
    expect(facts[0].description).toBe('A fierce warrior from the north');
  });

  it('parses a location fact', () => {
    const facts = parseFacts('[FACT:location|The Iron Gate|A massive fortress at the border]');
    expect(facts).toHaveLength(1);
    expect(facts[0].type).toBe('location');
    expect(facts[0].name).toBe('The Iron Gate');
  });

  it('parses an item fact', () => {
    const facts = parseFacts('[FACT:item|Moonblade|A sword that glows under starlight]');
    expect(facts).toHaveLength(1);
    expect(facts[0].type).toBe('item');
  });

  it('parses a note fact', () => {
    const facts = parseFacts('[FACT:note|Magic System|Magic costs life force to cast]');
    expect(facts).toHaveLength(1);
    expect(facts[0].type).toBe('note');
  });

  it('extracts multiple facts from a single response', () => {
    const text = `Let me suggest a few ideas.

[FACT:character|King Aldric|An aging ruler haunted by past choices]

[FACT:location|The Shattered Keep|Ruins of an ancient citadel]

[FACT:item|The Seal of Binding|An artifact that traps souls]`;
    const facts = parseFacts(text);
    expect(facts).toHaveLength(3);
    expect(facts.map((f) => f.type)).toEqual(['character', 'location', 'item']);
    expect(facts.map((f) => f.name)).toEqual(['King Aldric', 'The Shattered Keep', 'The Seal of Binding']);
  });

  it('returns empty array for text with no fact tags', () => {
    expect(parseFacts('Great ideas! Let me think about the plot arc.')).toHaveLength(0);
  });

  it('returns empty array for empty string', () => {
    expect(parseFacts('')).toHaveLength(0);
  });

  it('ignores malformed tags that are missing the pipe separators', () => {
    expect(parseFacts('[FACT:character|OnlyName]')).toHaveLength(0);
  });

  it('ignores unknown fact types', () => {
    const facts = parseFacts('[FACT:organization|The Guild|A secret society]');
    expect(facts).toHaveLength(0);
  });

  it('trims whitespace from name and description', () => {
    const facts = parseFacts('[FACT:character|  Zira  |  A rogue mage  ]');
    expect(facts[0].name).toBe('Zira');
    expect(facts[0].description).toBe('A rogue mage');
  });
});

// ─── writeFacts ───

describe('writeFacts', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a vault file for each fact', () => {
    const deps = makeDeps(tmpDir);
    const facts: ParsedFact[] = [
      { type: 'character', name: 'Lyra', description: 'A bard who sees visions' },
      { type: 'location', name: 'Sunken City', description: 'An ancient city under the sea' },
    ];
    writeFacts(facts, 'brainstorm', 'run-1', deps);
    expect(deps.written).toHaveLength(2);
  });

  it('writes files at the correct vault path', () => {
    const deps = makeDeps(tmpDir);
    const facts: ParsedFact[] = [{ type: 'character', name: 'Elara', description: 'A healer' }];
    writeFacts(facts, 'brainstorm', 'run-1', deps);
    expect(deps.written[0].path).toBe('brainstorm/Elara.md');
  });

  it('uses custom vaultSubPath as the folder', () => {
    const deps = makeDeps(tmpDir);
    const facts: ParsedFact[] = [{ type: 'note', name: 'Magic Rules', description: 'Magic requires intent' }];
    writeFacts(facts, 'session_1_notes', 'run-1', deps);
    expect(deps.written[0].path).toBe('session_1_notes/Magic Rules.md');
  });

  it('defaults to "brainstorm" folder when vaultSubPath is empty', () => {
    const deps = makeDeps(tmpDir);
    const facts: ParsedFact[] = [{ type: 'item', name: 'Dragon Orb', description: 'An orb of immense power' }];
    writeFacts(facts, '', 'run-1', deps);
    expect(deps.written[0].path).toBe('brainstorm/Dragon Orb.md');
  });

  it('includes agent: brainstorm in provenance frontmatter', () => {
    const deps = makeDeps(tmpDir);
    const facts: ParsedFact[] = [{ type: 'character', name: 'Thorin', description: 'A dwarf king' }];
    writeFacts(facts, 'brainstorm', 'run-1', deps);
    const { frontmatter } = parseFrontmatter(deps.written[0].content);
    expect(frontmatter['agent']).toBe('brainstorm');
  });

  it('includes runId in provenance frontmatter', () => {
    const deps = makeDeps(tmpDir);
    const facts: ParsedFact[] = [{ type: 'character', name: 'Mira', description: 'A sorceress' }];
    writeFacts(facts, 'brainstorm', 'my-run-id', deps);
    const { frontmatter } = parseFrontmatter(deps.written[0].content);
    expect(frontmatter['runId']).toBe('my-run-id');
  });

  it('includes timestamp in provenance frontmatter', () => {
    const deps = makeDeps(tmpDir);
    const facts: ParsedFact[] = [{ type: 'location', name: 'The Void', description: 'Empty space between worlds' }];
    const before = new Date().toISOString();
    writeFacts(facts, 'brainstorm', 'run-1', deps);
    const after = new Date().toISOString();
    const { frontmatter } = parseFrontmatter(deps.written[0].content);
    const ts = String(frontmatter['timestamp']);
    expect(ts >= before).toBe(true);
    expect(ts <= after).toBe(true);
  });

  it('includes a unique suggestionId in provenance frontmatter', () => {
    const deps = makeDeps(tmpDir);
    const facts: ParsedFact[] = [
      { type: 'character', name: 'Ghost', description: 'A spirit' },
      { type: 'item', name: 'Soul Stone', description: 'Stores a soul' },
    ];
    writeFacts(facts, 'brainstorm', 'run-1', deps);
    const { frontmatter: fm1 } = parseFrontmatter(deps.written[0].content);
    const { frontmatter: fm2 } = parseFrontmatter(deps.written[1].content);
    expect(fm1['suggestionId']).toBeDefined();
    expect(fm2['suggestionId']).toBeDefined();
    expect(fm1['suggestionId']).not.toBe(fm2['suggestionId']);
  });

  it('persists one suggestion per fact with source_agent=brainstorm', () => {
    const deps = makeDeps(tmpDir);
    const facts: ParsedFact[] = [
      { type: 'character', name: 'Soren', description: 'A blind prophet' },
    ];
    writeFacts(facts, 'brainstorm', 'run-1', deps);
    expect(deps.persisted).toHaveLength(1);
    expect(deps.persisted[0].source_agent).toBe('brainstorm');
  });

  it('persists suggestion with target_kind=vault', () => {
    const deps = makeDeps(tmpDir);
    const facts: ParsedFact[] = [{ type: 'note', name: 'Prophecy', description: 'The chosen one will arise' }];
    writeFacts(facts, 'brainstorm', 'run-1', deps);
    expect(deps.persisted[0].target_kind).toBe('vault');
  });

  it('persists suggestion with target_path matching the written file path', () => {
    const deps = makeDeps(tmpDir);
    const facts: ParsedFact[] = [{ type: 'location', name: 'Dark Forest', description: 'A haunted woodland' }];
    const entities = writeFacts(facts, 'brainstorm', 'run-1', deps);
    expect(deps.persisted[0].target_path).toBe(entities[0].path);
    expect(deps.persisted[0].target_path).toBe('brainstorm/Dark Forest.md');
  });

  it('persists suggestion with status=proposed', () => {
    const deps = makeDeps(tmpDir);
    const facts: ParsedFact[] = [{ type: 'character', name: 'Reed', description: 'A scholar of old texts' }];
    writeFacts(facts, 'brainstorm', 'run-1', deps);
    expect(deps.persisted[0].status).toBe('proposed');
  });

  it('suggestion ids match the suggestionId frontmatter field', () => {
    const deps = makeDeps(tmpDir);
    const facts: ParsedFact[] = [{ type: 'item', name: 'Silver Key', description: 'Opens the vault of souls' }];
    writeFacts(facts, 'brainstorm', 'run-1', deps);
    const { frontmatter } = parseFrontmatter(deps.written[0].content);
    expect(deps.persisted[0].id).toBe(String(frontmatter['suggestionId']));
  });

  it('returns written entity metadata', () => {
    const deps = makeDeps(tmpDir);
    const facts: ParsedFact[] = [{ type: 'character', name: 'Nyx', description: 'A shadow dancer' }];
    const entities: WrittenEntity[] = writeFacts(facts, 'brainstorm', 'run-1', deps);
    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe('Nyx');
    expect(entities[0].type).toBe('character');
    expect(entities[0].path).toBe('brainstorm/Nyx.md');
    expect(entities[0].suggestionId).toBeDefined();
  });

  it('returns empty array when no facts are given', () => {
    const deps = makeDeps(tmpDir);
    expect(writeFacts([], 'brainstorm', 'run-1', deps)).toHaveLength(0);
    expect(deps.written).toHaveLength(0);
    expect(deps.persisted).toHaveLength(0);
  });

  it('sanitizes special characters from filenames', () => {
    const deps = makeDeps(tmpDir);
    const facts: ParsedFact[] = [{ type: 'location', name: 'The : Forbidden / Keep', description: 'A dangerous place' }];
    writeFacts(facts, 'brainstorm', 'run-1', deps);
    const filePart = deps.written[0].path.split('/').pop()!;
    expect(filePart).not.toContain(':');
    expect(filePart).not.toContain('/');
    expect(deps.written[0].path).toMatch(/^brainstorm\//);
  });

  it('writes prose body containing the entity description', () => {
    const deps = makeDeps(tmpDir);
    const facts: ParsedFact[] = [{ type: 'character', name: 'Wren', description: 'A thief with a kind heart' }];
    writeFacts(facts, 'brainstorm', 'run-1', deps);
    const { prose } = parseFrontmatter(deps.written[0].content);
    expect(prose).toContain('A thief with a kind heart');
  });
});

// ─── parseAliasHints (SKY-191) ───

describe('parseAliasHints', () => {
  it('extracts "also known as" pattern', () => {
    const hints = parseAliasHints('Lyra, also known as the Stranger');
    expect(hints).toHaveLength(1);
    expect(hints[0]).toEqual({ entityName: 'Lyra', alias: 'the Stranger' });
  });

  it('extracts "known as" without "also"', () => {
    const hints = parseAliasHints('Aria known as the Weaver');
    expect(hints).toHaveLength(1);
    expect(hints[0]).toEqual({ entityName: 'Aria', alias: 'the Weaver' });
  });

  it('extracts "aka" pattern', () => {
    const hints = parseAliasHints('Kael, aka the Shadowhand');
    expect(hints).toHaveLength(1);
    expect(hints[0]).toEqual({ entityName: 'Kael', alias: 'the Shadowhand' });
  });

  it('extracts "aka" with parentheses', () => {
    const hints = parseAliasHints('Seren (aka Night Crow) was feared.');
    expect(hints).toHaveLength(1);
    expect(hints[0]).toEqual({ entityName: 'Seren', alias: 'Night Crow' });
  });

  it('extracts "called" pattern', () => {
    const hints = parseAliasHints('Mira, called the Ember Queen');
    expect(hints).toHaveLength(1);
    expect(hints[0]).toEqual({ entityName: 'Mira', alias: 'the Ember Queen' });
  });

  it('extracts "named" pattern', () => {
    const hints = parseAliasHints('Dax named the Iron Fist');
    expect(hints).toHaveLength(1);
    expect(hints[0]).toEqual({ entityName: 'Dax', alias: 'the Iron Fist' });
  });

  it('extracts multi-word entity names', () => {
    const hints = parseAliasHints('King Aldric, also known as the Iron Lord');
    expect(hints).toHaveLength(1);
    expect(hints[0].entityName).toBe('King Aldric');
    expect(hints[0].alias).toBe('the Iron Lord');
  });

  it('extracts multiple hints from a paragraph', () => {
    const text = [
      'Lyra, also known as the Stranger, traveled far.',
      'Kael (aka the Shadowhand) followed.',
    ].join('\n');
    const hints = parseAliasHints(text);
    expect(hints).toHaveLength(2);
    const names = hints.map((h) => h.entityName);
    expect(names).toContain('Lyra');
    expect(names).toContain('Kael');
  });

  it('deduplicates identical hints', () => {
    const text = 'Aria, aka the Weaver. Later: Aria, aka the Weaver.';
    const hints = parseAliasHints(text);
    expect(hints).toHaveLength(1);
  });

  it('strips trailing punctuation from alias', () => {
    const hints = parseAliasHints('Finn, also known as the Wolf.');
    expect(hints[0].alias).toBe('the Wolf');
  });

  it('returns empty array for text with no alias patterns', () => {
    expect(parseAliasHints('She walked into the forest and never returned.')).toHaveLength(0);
  });

  it('returns empty array for empty string', () => {
    expect(parseAliasHints('')).toHaveLength(0);
  });

  it('does not emit a hint when entity name equals alias', () => {
    const hints = parseAliasHints('Lyra also known as Lyra');
    expect(hints).toHaveLength(0);
  });
});

// ─── validateVaultPath / writeFacts vaultPath validation (MYT-185 / F10) ───

describe('validateVaultPath', () => {
  it('accepts a simple alphanumeric segment', () => {
    expect(validateVaultPath('brainstorm')).toBe('brainstorm');
  });

  it('accepts segments with underscores and hyphens', () => {
    expect(validateVaultPath('session_1-notes')).toBe('session_1-notes');
  });

  it('accepts mixed-case segments (case-insensitive)', () => {
    expect(validateVaultPath('Brainstorm')).toBe('Brainstorm');
  });

  it('defaults to "brainstorm" when value is empty', () => {
    expect(validateVaultPath('')).toBe('brainstorm');
  });

  it('defaults to "brainstorm" when value is undefined', () => {
    expect(validateVaultPath(undefined)).toBe('brainstorm');
  });

  it('defaults to "brainstorm" when value is null', () => {
    expect(validateVaultPath(null)).toBe('brainstorm');
  });

  it('rejects .mythos prefix exactly', () => {
    expect(() => validateVaultPath('.mythos')).toThrow(/Invalid vaultPath/);
  });

  it('rejects .mythos/suggestion-snapshots', () => {
    expect(() => validateVaultPath('.mythos/suggestion-snapshots')).toThrow(/Invalid vaultPath/);
  });

  it('rejects .MYTHOS (case-insensitive prefix check)', () => {
    expect(() => validateVaultPath('.MYTHOS')).toThrow(/Invalid vaultPath/);
  });

  it('rejects values containing "/"', () => {
    expect(() => validateVaultPath('session/notes')).toThrow(/Invalid vaultPath/);
  });

  it('rejects values containing "\\"', () => {
    expect(() => validateVaultPath('session\\notes')).toThrow(/Invalid vaultPath/);
  });

  it('rejects values containing ".."', () => {
    expect(() => validateVaultPath('..')).toThrow(/Invalid vaultPath/);
  });

  it('rejects path traversal segments', () => {
    expect(() => validateVaultPath('../etc')).toThrow(/Invalid vaultPath/);
  });

  it('rejects leading dot (other than .mythos covered above)', () => {
    expect(() => validateVaultPath('.hidden')).toThrow(/Invalid vaultPath/);
  });

  it('rejects leading underscore', () => {
    expect(() => validateVaultPath('_leading')).toThrow(/Invalid vaultPath/);
  });

  it('rejects leading hyphen', () => {
    expect(() => validateVaultPath('-leading')).toThrow(/Invalid vaultPath/);
  });

  it('rejects values longer than 64 chars', () => {
    expect(() => validateVaultPath('a'.repeat(65))).toThrow(/Invalid vaultPath/);
  });

  it('accepts values exactly 64 chars long', () => {
    const s = 'a'.repeat(64);
    expect(validateVaultPath(s)).toBe(s);
  });

  it('rejects whitespace', () => {
    expect(() => validateVaultPath('has space')).toThrow(/Invalid vaultPath/);
  });

  it('rejects non-string values', () => {
    expect(() => validateVaultPath(123 as unknown as string)).toThrow(/Invalid vaultPath/);
  });
});

describe('writeFacts — vaultPath validation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('vaultPath: ".mythos" throws and writes no files', () => {
    const deps = makeDeps(tmpDir);
    const facts: ParsedFact[] = [
      { type: 'character', name: 'Aria', description: 'A bard' },
    ];
    expect(() => writeFacts(facts, '.mythos', 'run-1', deps)).toThrow(/Invalid vaultPath/);
    expect(deps.written).toHaveLength(0);
    expect(deps.persisted).toHaveLength(0);
  });

  it('vaultPath: "brainstorm" succeeds', () => {
    const deps = makeDeps(tmpDir);
    const facts: ParsedFact[] = [
      { type: 'character', name: 'Aria', description: 'A bard' },
    ];
    const result = writeFacts(facts, 'brainstorm', 'run-1', deps);
    expect(result).toHaveLength(1);
    expect(deps.written[0].path).toBe('brainstorm/Aria.md');
  });

  it('vaultPath: ".mythos/suggestion-snapshots" throws and writes no files', () => {
    const deps = makeDeps(tmpDir);
    const facts: ParsedFact[] = [
      { type: 'location', name: 'Keep', description: 'A fortress' },
    ];
    expect(() => writeFacts(facts, '.mythos/suggestion-snapshots', 'run-1', deps)).toThrow(/Invalid vaultPath/);
    expect(deps.written).toHaveLength(0);
    expect(deps.persisted).toHaveLength(0);
  });

  it('vaultPath: "../etc" throws and writes no files', () => {
    const deps = makeDeps(tmpDir);
    const facts: ParsedFact[] = [
      { type: 'item', name: 'Sword', description: 'Sharp' },
    ];
    expect(() => writeFacts(facts, '../etc', 'run-1', deps)).toThrow(/Invalid vaultPath/);
    expect(deps.written).toHaveLength(0);
    expect(deps.persisted).toHaveLength(0);
  });

  it('vaultPath validation runs even when facts array is empty', () => {
    const deps = makeDeps(tmpDir);
    expect(() => writeFacts([], '.mythos', 'run-1', deps)).toThrow(/Invalid vaultPath/);
    expect(deps.written).toHaveLength(0);
    expect(deps.persisted).toHaveLength(0);
  });
});

// ─── writeFacts — real DB persistence ───

describe('writeFacts — real DB persistence', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persisted suggestion is retrievable from the DB', () => {
    const persisted: DbSuggestion[] = [];
    const deps = makeDeps(tmpDir, {
      persistSuggestion: (s) => {
        upsertSuggestion(s);
        persisted.push(s);
      },
    });

    const facts: ParsedFact[] = [{ type: 'character', name: 'Finn', description: 'A young farmer turned hero' }];
    writeFacts(facts, 'brainstorm', 'run-db-test', deps);

    const row = getSuggestion(persisted[0].id);
    expect(row).not.toBeNull();
    expect(row!.source_agent).toBe('brainstorm');
    expect(row!.target_kind).toBe('vault');
    expect(row!.status).toBe('proposed');
  });

  it('brainstorm suggestions are filterable by sourceAgent', () => {
    const deps = makeDeps(tmpDir, {
      persistSuggestion: (s) => upsertSuggestion(s),
    });

    const facts: ParsedFact[] = [
      { type: 'character', name: 'Cora', description: 'A navigator' },
      { type: 'location', name: 'Sea Cliff', description: 'A rocky promontory' },
    ];
    writeFacts(facts, 'brainstorm', 'run-filter-test', deps);

    const rows = listSuggestions(undefined, 'brainstorm');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.source_agent === 'brainstorm')).toBe(true);
  });
});
