import { describe, expect, it } from 'vitest';
import { MAX_FACTS_PER_SCENE, validateClassifyOutput, validateOutput } from './validateOutput.js';

const FACT = {
  entity: 'Brannoc',
  attribute: 'beard',
  value: 'braided',
  quote: 'his braided beard',
  contextBefore: 'The smith tugged at ',
  contextAfter: ' and laughed.',
};

describe('validateOutput (N9)', () => {
  it('passes valid contract JSON', () => {
    expect(validateOutput(JSON.stringify({ facts: [FACT] }))).toEqual({ facts: [FACT] });
    expect(validateOutput('  {"facts":[]}\n')).toEqual({ facts: [] });
    expect(validateOutput(JSON.stringify({ facts: [{ ...FACT, contextBefore: '', contextAfter: '' }] }))).not.toBeNull();
  });

  it.each([
    ['plain prose', 'Brannoc has a braided beard.'],
    ['JSON cut off mid-array', '{"facts":[{"entity":"Brannoc","attribute":"beard","value":"braided","quote":"his br'],
    ['a refusal sentence', "I'm sorry, but I can't help with that request."],
    ['an empty string', ''],
    ['whitespace only', '  \n'],
    ['{}', '{}'],
    ['a code fence', '```json\n{"facts":[]}\n```'],
    ['a bare array', JSON.stringify([FACT])],
    ['null', 'null'],
    ['a number', '42'],
    ['an extra top-level key', JSON.stringify({ facts: [], note: 'x' })],
    ['facts not an array', JSON.stringify({ facts: FACT })],
    ['a missing quote', JSON.stringify({ facts: [{ ...FACT, quote: undefined }] })],
    ['a non-string value', JSON.stringify({ facts: [{ ...FACT, value: 7 }] })],
    ['a null context', JSON.stringify({ facts: [{ ...FACT, contextAfter: null }] })],
    ['an extra fact key', JSON.stringify({ facts: [{ ...FACT, confidence: 0.9 }] })],
    ['a blank quote', JSON.stringify({ facts: [{ ...FACT, quote: '   ' }] })],
    ['a blank entity', JSON.stringify({ facts: [{ ...FACT, entity: '' }] })],
    ['a fact that is a string', JSON.stringify({ facts: ['Brannoc: braided beard'] })],
    ['one bad fact among good ones', JSON.stringify({ facts: [FACT, { ...FACT, attribute: false }] })],
    ['too many facts', JSON.stringify({ facts: Array.from({ length: MAX_FACTS_PER_SCENE + 1 }, () => FACT) })],
    ['an oversized field', JSON.stringify({ facts: [{ ...FACT, quote: 'q'.repeat(2001) }] })],
  ])('returns null with no throw for %s', (_label, raw) => {
    expect(() => validateOutput(raw)).not.toThrow();
    expect(validateOutput(raw)).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(validateOutput(undefined)).toBeNull();
    expect(validateOutput(null)).toBeNull();
    expect(validateOutput({ facts: [] })).toBeNull();
  });

  it('returns only the six contract fields', () => {
    const out = validateOutput(JSON.stringify({ facts: [FACT] }));
    expect(Object.keys(out!.facts[0]).sort()).toEqual(
      ['attribute', 'contextAfter', 'contextBefore', 'entity', 'quote', 'value'],
    );
  });
});

describe('validateClassifyOutput', () => {
  const LABELS = ['shown', 'stated', 'implied', 'absent'] as const;

  it('passes a label from the set with p in 0..1', () => {
    expect(validateClassifyOutput('{"top_label":"stated","p":0.8}', LABELS)).toEqual({ label: 'stated', p: 0.8 });
    expect(validateClassifyOutput('{"top_label":"absent","p":0}', LABELS)).toEqual({ label: 'absent', p: 0 });
  });

  it.each([
    ['prose', 'stated'],
    ['an off-set label', '{"top_label":"critical","p":0.9}'],
    ['p above 1', '{"top_label":"shown","p":1.5}'],
    ['p negative', '{"top_label":"shown","p":-0.1}'],
    ['p as a string', '{"top_label":"shown","p":"0.9"}'],
    ['a missing p', '{"top_label":"shown"}'],
    ['an extra key', '{"top_label":"shown","p":0.9,"why":"x"}'],
    ['{}', '{}'],
    ['empty', ''],
  ])('returns null for %s', (_label, raw) => {
    expect(validateClassifyOutput(raw, LABELS)).toBeNull();
  });
});
