// English grapheme-to-phoneme for Kokoro. Loads `phonemize/en-g2p` only (MIT).
// The package root is also English-only; `phonemize/all` pulls in ja/zh/ko/ru
// and must not be imported.
//
// Production calls a static `import('phonemize/en-g2p')` so electron-vite inlines
// the English lexicon and its JSON. A `require()` of the same specifier is left
// external, and the packaged app does not ship node_modules, so that path is
// tests-only. The ESM entry's JSON imports omit the type attribute, and
// Vitest's Node loader throws ERR_IMPORT_ATTRIBUTE_MISSING. Tests take the
// CJS entry. Non-English chunks are rejected by scripts/check-denied-deps.mjs.
import { createRequire } from 'node:module';

/** Function-word tags. Passing any other tag makes EnglishG2P strip stress. */
const FUNCTION_POS = /^(DT|IN|CC|PRP|MD|AUX|WP|WDT|WRB|TO|EX)$/;

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

interface EnglishProcessor {
  preProcess(text: string): string;
  tagWord(word: string, context?: { prev?: string; next?: string }): { pos: string };
  predict(word: string, language?: string, pos?: string): string | null;
}

const require = createRequire(import.meta.url);

function loadCjs(): EnglishProcessor {
  const loaded = require('phonemize/en-g2p') as { default?: new () => EnglishProcessor };
  const EnglishG2P = loaded.default ?? (loaded as unknown as new () => EnglishProcessor);
  return new EnglishG2P();
}

async function loadBundled(): Promise<EnglishProcessor> {
  // phonemize@2.0.1 publishes types at dist/en/g2p.d.ts, not dist/en-g2p.d.ts.
  // @ts-expect-error TS7016 — no declaration file for 'phonemize/en-g2p'
  const loaded = (await import('phonemize/en-g2p')) as { default: new () => EnglishProcessor };
  return new loaded.default();
}

let pending: Promise<EnglishProcessor> | null = null;

function loadEnglish(): Promise<EnglishProcessor> {
  if (!pending) {
    pending = process.env.VITEST === 'true' ? Promise.resolve(loadCjs()) : loadBundled();
  }
  return pending;
}

// Parse the English lexicon while main.js is still loading, before
// app.whenReady. Playwright's electron `evaluate` holds the result promise
// with a weak V8 inspector handle. Leaving this 3.5 MB chunk unloaded made
// the first boot GC collect that promise ("Resulting promise was garbage
// collected") in vault specs that evaluate immediately after launch.
// Vitest never evaluates this: the ESM entry's JSON imports lack the type
// attribute and throw ERR_IMPORT_ATTRIBUTE_MISSING. The CJS path stays tests-only.
if (process.env.VITEST !== 'true') {
  pending = loadBundled();
}

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

function phonemizeWord(
  english: EnglishProcessor,
  word: string,
  lang: 'a' | 'b',
  prev?: string,
  next?: string,
): string {
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
export async function phonemizeEnglish(text: string, lang: 'a' | 'b' = 'a'): Promise<string> {
  const english = await loadEnglish();
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
    out += phonemizeWord(english, part, lang, prev, next);
  }
  return out;
}
