import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { phonemizeEnglish } from './phonemizeEn.js';

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'kokoro-vocab.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { vocab: Record<string, number> };
const vocabChars = new Set(Object.keys(fixture.vocab));

const SAMPLE = [
  'The bird and the nurse walked through the quiet world before dawn while the little river still held a thin sheet of ice',
  'Hello she said and the word felt warm against the cold air',
  'People say a high wind can howl like a boy calling his dog home so they go carefully along the bank',
  'Time now to face the day the doctor told them and schedule nothing that the heart cannot keep',
  'A quick brown fox jumps over the lazy dog near the old mill then sits about the butter and the pixel of sun on the water',
  'Boxes of tea and maps of Asia wait in the cabin while thin smoke rises from the stove',
  'Jump is not how the lunch pail reached the merchant ship',
  'Ask for information about the hundred and ninety steps to the harbor',
  'Kokoro reads the page aloud so the story can travel without a network and yeah the voice stays on the machine',
  'The heron watches her shadow while the nurse counts each bird again',
  'Say the names clearly Nicole and Sky and the small dog that learned to howl on cue',
  'Go back to the high road before the boy',
].join(' ');

function words(text: string): string[] {
  return text.match(/[A-Za-z0-9']+/g) ?? [];
}

function expectInVocab(word: string, phones: string): void {
  expect(phones.length, word).toBeGreaterThan(0);
  for (const ch of phones) {
    expect(vocabChars.has(ch), `${word} → ${phones} contains ${JSON.stringify(ch)}`).toBe(true);
  }
}

describe('phonemizeEnglish', () => {
  it('phonemizes a 200-word sample into the Kokoro vocab', async () => {
    const list = words(SAMPLE);
    expect(list).toHaveLength(200);
    for (const word of list) {
      expectInVocab(word, await phonemizeEnglish(word, 'a'));
    }
  });

  it('maps r-colored vowels and dark l onto vocab phones', async () => {
    for (const word of ['world', 'bird']) {
      const phones = await phonemizeEnglish(word, 'a');
      expect(phones, word).not.toContain('ɝ');
      expect(phones, word).not.toContain('ɫ');
      expect(phones, word).toContain('ɜ');
    }
    expect(await phonemizeEnglish('world', 'a')).toContain('l');
    expectInVocab('bird-gb', await phonemizeEnglish('bird', 'b'));
  });

  it('maps diphthongs to single Kokoro tokens', async () => {
    const say = await phonemizeEnglish('say', 'a');
    const high = await phonemizeEnglish('high', 'a');
    const how = await phonemizeEnglish('how', 'a');
    const boy = await phonemizeEnglish('boy', 'a');
    const go = await phonemizeEnglish('go', 'a');
    expect(say).toContain('A');
    expect(say).not.toContain('eɪ');
    expect(high).toContain('I');
    expect(high).not.toContain('aɪ');
    expect(how).toContain('W');
    expect(how).not.toContain('aʊ');
    expect(boy).toContain('Y');
    expect(boy).not.toContain('ɔɪ');
    expect(go).toContain('O');
    expect(go).not.toContain('oʊ');
    expect(go).not.toContain('əʊ');
  });
});
