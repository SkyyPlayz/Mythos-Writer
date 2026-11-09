import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { locateQuote } from '../quoteCheck.js';
import { createScriptExtractor, extractByScript } from './scriptExtractor.js';
import { PROMPT_VERSION, buildExtractorInput, type ExtractorOutput } from './types.js';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../__fixtures__/factLedger');

function fixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function summary(out: ExtractorOutput): string[] {
  return out.facts.map((f) => `${f.entity} | ${f.attribute} | ${f.value} | ${f.quote}`);
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('./types.js');
});

describe('scriptExtractor fixtures', () => {
  it('lantern-quay: hits with exact spans, and misses the pronoun-only fact', () => {
    const input = buildExtractorInput(fixture('lantern-quay.md'), [
      { name: 'Mara Vell', aliases: ['Mara'] },
      { name: 'Tomas', aliases: [] },
    ]);
    const out = extractByScript(input);
    expect(summary(out)).toEqual(['Mara Vell | hair | dark | dark hair', 'Tomas | eyes | blue | blue eyes']);

    // Expected miss: "He had blue eyes" names no one in its sentence.
    const pronounHit = input.prose.indexOf('He had blue eyes') + 'He had '.length;
    const spans = out.facts.map((f) => locateQuote(input.prose, f.quote, f.contextBefore, f.contextAfter));
    expect(spans.map((s) => s?.start)).not.toContain(pronounHit);
    // Expected miss: the frontmatter's "dark hair" is never seen.
    expect(out.facts.filter((f) => f.quote === 'dark hair')).toHaveLength(1);
    expect(spans[0]!.start).toBe(input.prose.indexOf("Mara's dark hair") + "Mara's ".length);
  });

  it('salt-cave: hits the low tide, misses a phrase before the name and the pronoun', () => {
    const input = buildExtractorInput(fixture('salt-cave.md'), [
      { name: 'Salt Cave', aliases: [] },
      { name: 'Ilse', aliases: [] },
    ]);
    const out = extractByScript(input);
    // Expected misses: "At high tide the Salt Cave" (phrase before the name) and "she" (no gender from pronouns).
    expect(summary(out)).toEqual(['Salt Cave | tide | low | low tide']);
    expect(out.facts.some((f) => f.attribute === 'gender')).toBe(false);
  });

  it('every script fact passes quoteCheck at its own span', () => {
    for (const [file, names] of [
      ['lantern-quay.md', [{ name: 'Mara Vell', aliases: ['Mara'] }, { name: 'Tomas', aliases: [] }]],
      ['salt-cave.md', [{ name: 'Salt Cave', aliases: [] }]],
    ] as const) {
      const input = buildExtractorInput(fixture(file), names);
      for (const fact of extractByScript(input).facts) {
        const span = locateQuote(input.prose, fact.quote, fact.contextBefore, fact.contextAfter);
        expect(span).not.toBeNull();
        expect(input.prose.slice(span!.start, span!.end)).toBe(fact.quote);
      }
    }
  });
});

describe('scriptExtractor rules', () => {
  it('keeps the prose casing in the quote and works with CRLF and astral characters', () => {
    const prose = 'Wren 🌙 smiled.\r\nWren had Red Hair tied with string.\r\nThe stranger had green eyes.\r\n';
    const input = buildExtractorInput(prose, [{ name: 'Wren', aliases: [] }]);
    const out = extractByScript(input);
    // Expected miss: "The stranger" is not a named entity.
    expect(summary(out)).toEqual(['Wren | hair | red | Red Hair']);
    const fact = out.facts[0];
    expect(locateQuote(prose, fact.quote, fact.contextBefore, fact.contextAfter)).toEqual({
      start: prose.indexOf('Red Hair'),
      end: prose.indexOf('Red Hair') + 'Red Hair'.length,
    });
    expect(fact.contextBefore).toBe('Wren 🌙 smiled.\r\nWren had ');
  });

  it('gives a phrase to the nearest name before it in the sentence', () => {
    const prose = 'Ines met Corvo, whose black hair dripped. Corvo stared at Ines, blonde hair and all.';
    const out = extractByScript(
      buildExtractorInput(prose, [
        { name: 'Ines', aliases: [] },
        { name: 'Corvo', aliases: [] },
      ]),
    );
    expect(summary(out)).toEqual(['Corvo | hair | black | black hair', 'Ines | hair | blonde | blonde hair']);
  });

  it('matches whole words only', () => {
    const out = extractByScript(buildExtractorInput('Ines had dark hairpins.', [{ name: 'Ines', aliases: [] }]));
    expect(out.facts).toEqual([]);
    const partial = extractByScript(buildExtractorInput('Inesta had dark hair.', [{ name: 'Ines', aliases: [] }]));
    expect(partial.facts).toEqual([]);
  });

  it('finds nothing without names', () => {
    expect(extractByScript(buildExtractorInput('Someone had red hair.', [])).facts).toEqual([]);
  });

  it('createScriptExtractor reports id script and honours abort', async () => {
    const ex = createScriptExtractor();
    expect(ex.id).toBe('script');
    const input = buildExtractorInput('Ines had red hair.', [{ name: 'Ines', aliases: [] }]);
    expect(await ex.extract(input, new AbortController().signal)).toEqual(extractByScript(input));
    const controller = new AbortController();
    controller.abort();
    await expect(ex.extract(input, controller.signal)).rejects.toThrow();
  });
});

describe('promptVersion (B1)', () => {
  it('comes from PROMPT_VERSION.script', () => {
    expect(createScriptExtractor().promptVersion).toBe(PROMPT_VERSION.script);
    expect(PROMPT_VERSION.script).toBe(1);
  });

  it('a bump to PROMPT_VERSION changes the version the extractor reports', async () => {
    vi.resetModules();
    vi.doMock('./types.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./types.js')>();
      return { ...actual, PROMPT_VERSION: Object.freeze({ ...actual.PROMPT_VERSION, script: 3 }) };
    });
    const bumped = await import('./scriptExtractor.js');
    expect(bumped.createScriptExtractor().promptVersion).toBe(3);
  });
});
