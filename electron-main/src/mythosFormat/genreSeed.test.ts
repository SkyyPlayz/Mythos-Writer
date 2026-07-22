// Beta 4 M29 — genre starter notes seeded by the Welcome wizard's genre step.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GENRE_SEED_GENRES,
  GENRE_SEED_NOTE_PATHS,
  isGenreSeedGenre,
  writeGenreStarterNotes,
} from './genreSeed.js';
import { notesVaultRootFor } from './mythosJson.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-genre-'));
});

function noteAbs(relPath: string): string {
  return path.join(notesVaultRootFor(tmp), ...relPath.split('/'));
}

describe('isGenreSeedGenre', () => {
  it('accepts exactly the 8 wizard presets and rejects everything else', () => {
    expect(GENRE_SEED_GENRES).toHaveLength(8);
    for (const genre of GENRE_SEED_GENRES) {
      expect(isGenreSeedGenre(genre)).toBe(true);
    }
    expect(isGenreSeedGenre('Western')).toBe(false);
    expect(isGenreSeedGenre('')).toBe(false);
    expect(isGenreSeedGenre(undefined)).toBe(false);
    expect(isGenreSeedGenre(42)).toBe(false);
  });
});

describe('writeGenreStarterNotes', () => {
  it('writes the three starter notes into the Notes Vault', () => {
    const result = writeGenreStarterNotes(tmp, 'Epic Fantasy');

    expect(result.written.sort()).toEqual(Object.values(GENRE_SEED_NOTE_PATHS).sort());
    for (const relPath of Object.values(GENRE_SEED_NOTE_PATHS)) {
      expect(fs.existsSync(noteAbs(relPath))).toBe(true);
    }
  });

  it('tunes each note to the chosen genre', () => {
    writeGenreStarterNotes(tmp, 'Thriller');

    const templates = fs.readFileSync(noteAbs(GENRE_SEED_NOTE_PATHS.templates), 'utf-8');
    const beatSheet = fs.readFileSync(noteAbs(GENRE_SEED_NOTE_PATHS.beatSheet), 'utf-8');
    const personas = fs.readFileSync(noteAbs(GENRE_SEED_NOTE_PATHS.personas), 'utf-8');

    expect(templates).toContain('# Story Templates — Thriller');
    expect(beatSheet).toContain('# Beat Sheet — Thriller');
    expect(beatSheet).toContain('Midpoint');
    expect(personas).toContain('# Agent Personas — Thriller');
    // Frontmatter carries the genre for later tooling.
    for (const content of [templates, beatSheet, personas]) {
      expect(content).toMatch(/^---\n/);
      expect(content).toContain('genre: Thriller');
    }
  });

  it('every genre profile renders all three notes without gaps', () => {
    for (const genre of GENRE_SEED_GENRES) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-genre-all-'));
      const result = writeGenreStarterNotes(dir, genre);
      expect(result.written).toHaveLength(3);
      for (const relPath of result.written) {
        const content = fs.readFileSync(path.join(notesVaultRootFor(dir), ...relPath.split('/')), 'utf-8');
        expect(content.length).toBeGreaterThan(200);
        expect(content).not.toContain('undefined');
      }
    }
  });

  it('never overwrites an existing note (replay / adopted-vault safety)', () => {
    const beatSheetAbs = noteAbs(GENRE_SEED_NOTE_PATHS.beatSheet);
    fs.mkdirSync(path.dirname(beatSheetAbs), { recursive: true });
    fs.writeFileSync(beatSheetAbs, 'my edited beat sheet\n', 'utf-8');

    const result = writeGenreStarterNotes(tmp, 'Romance');

    expect(fs.readFileSync(beatSheetAbs, 'utf-8')).toBe('my edited beat sheet\n');
    expect(result.written).not.toContain(GENRE_SEED_NOTE_PATHS.beatSheet);
    expect(result.written).toContain(GENRE_SEED_NOTE_PATHS.templates);
    expect(result.written).toContain(GENRE_SEED_NOTE_PATHS.personas);
  });
});
