// English grapheme-to-phoneme for Kokoro. Imports `phonemize/en-g2p` only
// (MIT). The package root is also English-only; `phonemize/all` pulls in
// ja/zh/ko/ru and must not be imported. The bundler inlines this entry's JSON
// lexicons; non-English chunks are rejected by scripts/check-denied-deps.mjs.
// phonemize@2.0.1 points `types` at dist/en-g2p.d.ts, which the tarball omits.
// @ts-expect-error TS7016 missing declaration file in the published package
import EnglishG2P from 'phonemize/en-g2p';

/**
 * Misaki/Kokoro diphthong tokens (the read-aloud brief's map). Each target is
 * one character in the Kokoro tokenizer vocab; the two-character IPA is not
 * how this model was trained.
 */
const DIPHTHONGS: ReadonlyArray<readonly [string, string]> = [
  ['eɪ', 'A'],
  ['aɪ', 'I'],
  ['ɔɪ', 'Y'],
  ['oʊ', 'O'],
  ['əʊ', 'Q'],
  ['aʊ', 'W'],
];

/** Function-word tags. Passing any other tag makes EnglishG2P strip stress. */
const FUNCTION_POS = /^(DT|IN|CC|PRP|MD|AUX|WP|WDT|WRB|TO|EX)$/;

interface EnglishProcessor {
  preProcess(text: string): string;
  tagWord(word: string, context?: { prev?: string; next?: string }): { pos: string };
  predict(word: string, language?: string, pos?: string): string | null;
}

const english = new (EnglishG2P as unknown as new () => EnglishProcessor)();

function languageTag(lang: 'a' | 'b'): 'en-US' | 'en-GB' {
  switch (lang) {
    case 'a':
      return 'en-US';
    case 'b':
      return 'en-GB';
    default: {
      const unexpected: never = lang;
      return unexpected;
    }
  }
}

/** Map phonemize IPA onto the Kokoro vocab. Does not drop unknown characters. */
function mapToKokoro(ipa: string): string {
  let mapped = ipa;
  for (const [from, to] of DIPHTHONGS) {
    if (mapped.includes(from)) mapped = mapped.split(from).join(to);
  }
  // ɝ (r-colored vowel) and ɫ (dark l) are not in the Kokoro vocab.
  if (mapped.includes('ɝ')) mapped = mapped.split('ɝ').join('ɜɹ');
  if (mapped.includes('ɫ')) mapped = mapped.split('ɫ').join('l');
  return mapped;
}

function phonemizeWord(word: string, lang: 'a' | 'b', prev?: string, next?: string): string {
  const language = languageTag(lang);
  const tag = english.tagWord(word, { prev, next });
  const pos = FUNCTION_POS.test(tag.pos) ? tag.pos : undefined;
  const ipa = english.predict(word, language, pos);
  return ipa ? mapToKokoro(ipa) : '';
}

/**
 * Phonemize an English prose segment (punctuation already split off by the
 * caller). `lang` `'a'` is American English; `'b'` is British English.
 */
export function phonemizeEnglish(text: string, lang: 'a' | 'b' = 'a'): string {
  const processed = english.preProcess(text);
  const parts = processed.split(/(\s+)/);
  const words = parts.filter((part) => part.length > 0 && !/^\s+$/.test(part));
  let index = 0;
  let out = '';
  for (const part of parts) {
    if (part.length === 0 || /^\s+$/.test(part)) {
      out += part;
      continue;
    }
    const prev = index > 0 ? words[index - 1] : undefined;
    const next = index + 1 < words.length ? words[index + 1] : undefined;
    index += 1;
    out += phonemizeWord(part, lang, prev, next);
  }
  return out;
}
