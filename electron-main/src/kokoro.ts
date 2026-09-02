// Kokoro-82M offline neural TTS engine (SKY-11243 / SKY-11230 Part 2).
//
// Runs the Kokoro-82M model fully offline, in-process, via onnxruntime-web's
// WASM backend + the pure-JS `phonemizer` grapheme-to-phoneme package. This is
// the merge-safe "Option B" path chosen in SKY-11277: unlike kokoro-js /
// @huggingface/transformers, it drags in NO `sharp` (unfixable high-sev CVEs),
// NO native `onnxruntime-node`, and spawns NO child process — so the MYT-788
// spawn-trust gate (voiceGate.ts) is irrelevant here.
//
// Weights: onnx-community/Kokoro-82M-v1.0-ONNX — Apache-2.0 (see
// electron-main/resources/kokoro/LICENSE). Bundled in the installer.
//
// The text-normalization, phonemization and tokenization below are ported from
// kokoro-js (Apache-2.0, © 2024 Hugging Face) so this path produces byte-for-
// byte the same phoneme token stream the upstream library feeds the model.
//
// Output is 16-bit signed little-endian mono PCM at KOKORO_SAMPLE_RATE, matching
// the Piper `--output-raw` contract the renderer already decodes (useTtsPlayer).

import fs from 'fs';
import path from 'path';
import * as ort from 'onnxruntime-web';
import { phonemize } from 'phonemizer';

/** Kokoro always renders 24 kHz audio. */
export const KOKORO_SAMPLE_RATE = 24000;

/**
 * The style table shipped in each voice `.bin` is float32 [510, 256] — one
 * 256-d style vector per phoneme-token-count bucket. Longer utterances are
 * split so a single inference never exceeds this.
 */
const MAX_PHONEME_TOKENS = 510;
const STYLE_DIM = 256;

/**
 * Catalog voice id (`kokoro:<key>`) → bundled voice pack + language.
 * `lang: 'a'` = American English (af_*), `'b'` = British English (bf_*).
 * Only the two Beta-4 voices are wired; the pack ships more we can expose later.
 */
export const KOKORO_VOICES: Record<string, { file: string; lang: 'a' | 'b' }> = {
  nicole: { file: 'af_nicole', lang: 'a' },
  sky: { file: 'af_sky', lang: 'a' },
};

/** True for a `kokoro:*` picker/voice id — routes to this engine. */
export function isKokoroVoice(voiceId: string | undefined | null): voiceId is string {
  return typeof voiceId === 'string' && voiceId.startsWith('kokoro:');
}

/** The voice key after the `kokoro:` prefix, or undefined if not a kokoro id. */
export function kokoroVoiceKey(voiceId: string | undefined | null): string | undefined {
  if (!isKokoroVoice(voiceId)) return undefined;
  return voiceId.slice('kokoro:'.length);
}

/** Filesystem locations of the bundled model assets (resolved by the caller). */
export interface KokoroAssets {
  /** Absolute path to the ONNX model (`model_q8f16.onnx`). */
  modelPath: string;
  /** Directory containing the per-voice `<file>.bin` style packs. */
  voicesDir: string;
  /** Absolute path to `tokenizer.json` (its `model.vocab` is the char→id map). */
  tokenizerPath: string;
  /**
   * Directory holding onnxruntime-web's `.wasm` runtime files. Only needed in a
   * packaged app where the default (node_modules-relative) resolution fails;
   * omit in dev / tests to use onnxruntime-web's own resolution.
   */
  wasmDir?: string;
}

export interface KokoroSynthesizeOptions {
  /** onnxruntime-web WASM thread count. Defaults to 1 (deterministic, no SAB). */
  numThreads?: number;
}

/** Thrown for any Kokoro-specific failure so callers can categorize it. */
export class KokoroEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KokoroEngineError';
  }
}

// ─── Text normalization (ported from kokoro-js, Apache-2.0) ───────────────────

function splitNum(match: string): string {
  if (match.includes('.')) return match;
  if (match.includes(':')) {
    const [h, m] = match.split(':').map(Number);
    if (m === 0) return `${h} o'clock`;
    if (m < 10) return `${h} oh ${m}`;
    return `${h} ${m}`;
  }
  const year = parseInt(match.slice(0, 4), 10);
  if (year < 1100 || year % 1000 < 10) return match;
  const left = match.slice(0, 2);
  const right = parseInt(match.slice(2, 4), 10);
  const s = match.endsWith('s') ? 's' : '';
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) return `${left} hundred${s}`;
    if (right < 10) return `${left} oh ${right}${s}`;
  }
  return `${left} ${right}${s}`;
}

function flipMoney(match: string): string {
  const bill = match[0] === '$' ? 'dollar' : 'pound';
  if (isNaN(Number(match.slice(1)))) return `${match.slice(1)} ${bill}s`;
  if (!match.includes('.')) {
    const s = match.slice(1) === '1' ? '' : 's';
    return `${match.slice(1)} ${bill}${s}`;
  }
  const [whole, frac] = match.slice(1).split('.');
  const cents = parseInt(frac.padEnd(2, '0'), 10);
  const coin = match[0] === '$' ? (cents === 1 ? 'cent' : 'cents') : cents === 1 ? 'penny' : 'pence';
  return `${whole} ${bill}${whole === '1' ? '' : 's'} and ${cents} ${coin}`;
}

function pointNum(match: string): string {
  const [whole, frac] = match.split('.');
  return `${whole} point ${frac.split('').join(' ')}`;
}

function normalizeText(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/«/g, '“')
    .replace(/»/g, '”')
    .replace(/[“”]/g, '"')
    .replace(/\(/g, '«')
    .replace(/\)/g, '»')
    .replace(/、/g, ', ')
    .replace(/。/g, '. ')
    .replace(/！/g, '! ')
    .replace(/，/g, ', ')
    .replace(/：/g, ': ')
    .replace(/；/g, '; ')
    .replace(/？/g, '? ')
    .replace(/[^\S \n]/g, ' ')
    .replace(/  +/g, ' ')
    .replace(/(?<=\n) +(?=\n)/g, '')
    .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor')
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister')
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss')
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs')
    .replace(/\betc\.(?! [A-Z])/gi, 'etc')
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, splitNum)
    .replace(/(?<=\d),(?=\d)/g, '')
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, flipMoney)
    .replace(/\d*\.\d+/g, pointNum)
    .replace(/(?<=\d)-(?=\d)/g, ' to ')
    .replace(/(?<=\d)S/g, ' S')
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, 's')
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, '-'))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-')
    .trim();
}

const PUNCT = ';:,.!?¡¿—…"«»“”(){}[]\'';
const PUNCT_SPLIT = new RegExp(
  `(\\s*[${PUNCT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]+\\s*)+`,
  'g',
);

/** Split into alternating text / punctuation-run segments (kokoro-js `split`). */
function segmentByPunctuation(text: string): { match: boolean; text: string }[] {
  const out: { match: boolean; text: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(PUNCT_SPLIT)) {
    const chunk = m[0];
    const idx = m.index ?? 0;
    if (last < idx) out.push({ match: false, text: text.slice(last, idx) });
    if (chunk.length > 0) out.push({ match: true, text: chunk });
    last = idx + chunk.length;
  }
  if (last < text.length) out.push({ match: false, text: text.slice(last) });
  return out;
}

/**
 * Phonemize `text` to the eSpeak-style IPA string Kokoro's tokenizer expects.
 * Ported from kokoro-js `phonemize()` (Apache-2.0): normalize → keep punctuation
 * verbatim, phonemize prose via the `phonemizer` package → IPA fixups.
 */
export async function phonemizeText(text: string, lang: 'a' | 'b' = 'a'): Promise<string> {
  const normalized = normalizeText(text);
  const segments = segmentByPunctuation(normalized);
  const langCode = lang === 'a' ? 'en-us' : 'en';
  const parts = await Promise.all(
    segments.map(async ({ match, text: seg }) =>
      match ? seg : (await phonemize(seg, langCode)).join(' '),
    ),
  );
  let out = parts
    .join('')
    .replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ')
    .replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ')
    .replace(/ʲ/g, 'j')
    .replace(/r/g, 'ɹ')
    .replace(/x/g, 'k')
    .replace(/ɬ/g, 'l')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ')
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z');
  if (lang === 'a') out = out.replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di');
  return out.trim();
}

// ─── Tokenization ─────────────────────────────────────────────────────────────

let vocabCache: Record<string, number> | null = null;
let vocabCacheKey: string | null = null;

function loadVocab(tokenizerPath: string): Record<string, number> {
  if (vocabCache && vocabCacheKey === tokenizerPath) return vocabCache;
  let parsed: { model?: { vocab?: Record<string, number> } };
  try {
    parsed = JSON.parse(fs.readFileSync(tokenizerPath, 'utf-8'));
  } catch (err) {
    throw new KokoroEngineError(`failed to read Kokoro tokenizer: ${(err as Error).message}`);
  }
  const vocab = parsed?.model?.vocab;
  if (!vocab || typeof vocab !== 'object') {
    throw new KokoroEngineError('Kokoro tokenizer.json is missing model.vocab');
  }
  vocabCache = vocab;
  vocabCacheKey = tokenizerPath;
  return vocab;
}

/**
 * Map a phoneme string to model token ids. Characters outside the vocab are
 * dropped (the upstream normalizer strips them). Callers wrap the result with
 * the `$`=0 boundary tokens the model's post-processor expects.
 */
export function tokenizePhonemes(phonemes: string, vocab: Record<string, number>): number[] {
  const ids: number[] = [];
  for (const ch of phonemes) {
    const id = vocab[ch];
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

/** Split a token-id list into ≤MAX_PHONEME_TOKENS windows (long-text safety). */
function windowTokens(ids: number[]): number[][] {
  if (ids.length <= MAX_PHONEME_TOKENS) return ids.length > 0 ? [ids] : [];
  const windows: number[][] = [];
  for (let i = 0; i < ids.length; i += MAX_PHONEME_TOKENS) {
    windows.push(ids.slice(i, i + MAX_PHONEME_TOKENS));
  }
  return windows;
}

/**
 * Sentence-ish split so each inference carries natural prosody boundaries and
 * stays well under the token cap. Falls back to the whole string.
 */
function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?…]+[.!?…]+[\])'"”’]*\s*|[^.!?…]+$/g);
  const sentences = (matches ?? [text]).map((s) => s.trim()).filter((s) => s.length > 0);
  return sentences.length > 0 ? sentences : [];
}

// ─── PCM conversion ───────────────────────────────────────────────────────────

/**
 * Convert model output (float32 in [-1, 1]) to 16-bit signed little-endian PCM,
 * matching the Piper `--output-raw` bytes the renderer's `format:'pcm'` path
 * decodes. Exported for unit testing.
 */
export function floatToPcm16(wave: Float32Array | number[]): Buffer {
  const buf = Buffer.allocUnsafe(wave.length * 2);
  for (let i = 0; i < wave.length; i++) {
    // Clamp to [-1, 1] then scale symmetrically by 32767 (round-to-nearest), so
    // the result is inherently within the int16 range [-32767, 32767].
    const s = wave[i] < -1 ? -1 : wave[i] > 1 ? 1 : wave[i];
    buf.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  return buf;
}

// ─── Inference session (loaded once, cached) ──────────────────────────────────

let sessionPromise: Promise<ort.InferenceSession> | null = null;
let sessionKey: string | null = null;
const voicePackCache = new Map<string, Float32Array>();

async function getSession(assets: KokoroAssets, opts?: KokoroSynthesizeOptions): Promise<ort.InferenceSession> {
  if (sessionPromise && sessionKey === assets.modelPath) return sessionPromise;
  // A different model path (tests) invalidates the cached session.
  sessionKey = assets.modelPath;
  if (assets.wasmDir) {
    // onnxruntime-web accepts a path prefix (must end with a separator).
    ort.env.wasm.wasmPaths = assets.wasmDir.endsWith(path.sep) ? assets.wasmDir : assets.wasmDir + path.sep;
  }
  ort.env.wasm.numThreads = Math.max(1, opts?.numThreads ?? 1);
  ort.env.wasm.proxy = false;
  if (!fs.existsSync(assets.modelPath)) {
    sessionPromise = null;
    sessionKey = null;
    throw new KokoroEngineError(`Kokoro model not found at ${assets.modelPath}`);
  }
  sessionPromise = ort.InferenceSession.create(assets.modelPath, { executionProviders: ['wasm'] }).catch((err) => {
    // Reset so a later call can retry after a transient failure.
    sessionPromise = null;
    sessionKey = null;
    throw new KokoroEngineError(`failed to load Kokoro model: ${(err as Error).message}`);
  });
  return sessionPromise;
}

function loadVoicePack(voicesDir: string, file: string): Float32Array {
  const key = path.join(voicesDir, `${file}.bin`);
  const cached = voicePackCache.get(key);
  if (cached) return cached;
  let raw: Buffer;
  try {
    raw = fs.readFileSync(key);
  } catch (err) {
    throw new KokoroEngineError(`Kokoro voice pack not found (${file}): ${(err as Error).message}`);
  }
  // The .bin is a flat float32 [510, 256] table.
  const floats = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
  const copy = Float32Array.from(floats); // detach from the Buffer's pool
  voicePackCache.set(key, copy);
  return copy;
}

async function runInference(
  session: ort.InferenceSession,
  ids: number[],
  voicePack: Float32Array,
): Promise<Float32Array> {
  // Wrap with the `$`=0 boundary tokens the post-processor adds.
  const wrapped = [0, ...ids, 0];
  // Style vector is indexed by the phoneme-token count (excludes boundaries),
  // clamped to the table height.
  const styleIdx = STYLE_DIM * Math.min(Math.max(ids.length, 0), MAX_PHONEME_TOKENS - 1);
  const style = voicePack.slice(styleIdx, styleIdx + STYLE_DIM);
  const feeds: Record<string, ort.Tensor> = {
    input_ids: new ort.Tensor('int64', BigInt64Array.from(wrapped, (v) => BigInt(v)), [1, wrapped.length]),
    style: new ort.Tensor('float32', style, [1, STYLE_DIM]),
    speed: new ort.Tensor('float32', Float32Array.from([1]), [1]),
  };
  const output = await session.run(feeds);
  const waveform = output.waveform;
  if (!waveform || !(waveform.data instanceof Float32Array)) {
    throw new KokoroEngineError('Kokoro model returned no waveform');
  }
  return waveform.data;
}

/**
 * Synthesize `text` in the given Kokoro voice, streaming 16-bit PCM chunks
 * (one per sentence/window) to `onChunk` as each is rendered. Resolves when the
 * whole text is spoken; rejects (KokoroEngineError) on failure. Honors `signal`
 * between chunks for prompt cancellation.
 *
 * `voiceKey` is the id after `kokoro:` (e.g. `nicole`, `sky`).
 */
export async function synthesizeKokoro(
  text: string,
  voiceKey: string,
  assets: KokoroAssets,
  signal: AbortSignal,
  onChunk: (pcm: Buffer) => void,
  opts?: KokoroSynthesizeOptions,
): Promise<void> {
  const voice = KOKORO_VOICES[voiceKey];
  if (!voice) {
    throw new KokoroEngineError(`unknown Kokoro voice: ${voiceKey}`);
  }
  const trimmed = text.trim();
  if (!trimmed) return; // nothing to say — treated as a clean, empty render

  const vocab = loadVocab(assets.tokenizerPath);
  const voicePack = loadVoicePack(assets.voicesDir, voice.file);
  const session = await getSession(assets, opts);

  const sentences = splitSentences(trimmed);
  let emittedAny = false;
  for (const sentence of sentences) {
    if (signal.aborted) return;
    const phonemes = await phonemizeText(sentence, voice.lang);
    const ids = tokenizePhonemes(phonemes, vocab);
    for (const window of windowTokens(ids)) {
      if (signal.aborted) return;
      const wave = await runInference(session, window, voicePack);
      if (signal.aborted) return;
      if (wave.length > 0) {
        onChunk(floatToPcm16(wave));
        emittedAny = true;
      }
    }
  }
  if (!emittedAny) {
    // All input normalized/phonemized to nothing (e.g. pure punctuation) — this
    // is a legitimate empty render, not an error; the caller ends cleanly.
    return;
  }
}

/** Test-only: drop the cached session, vocab and voice packs. */
export function __resetKokoroEngine(): void {
  sessionPromise = null;
  sessionKey = null;
  vocabCache = null;
  vocabCacheKey = null;
  voicePackCache.clear();
}
