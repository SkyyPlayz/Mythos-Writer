// Unit + (asset-gated) integration tests for the Kokoro offline TTS engine.
//
// The pure helpers (tokenization, PCM conversion, id parsing) and real
// phonemization run everywhere. The full model inference runs only when the
// bundled weights are present on disk (dev / a checkout that ran the build-time
// fetch) — CI without the 86MB model skips it, exactly like voice-real-binary.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import {
  isKokoroVoice,
  kokoroVoiceKey,
  floatToPcm16,
  kokoroWasmPathPrefix,
  tokenizePhonemes,
  phonemizeText,
  synthesizeKokoro,
  __resetKokoroEngine,
  KOKORO_SAMPLE_RATE,
  type KokoroAssets,
} from './kokoro.js';

const KOKORO_DIR =
  process.env.MYTHOS_KOKORO_DIR ?? path.join(__dirname, '..', 'resources', 'kokoro');
const MODEL_PATH = path.join(KOKORO_DIR, 'model_q8f16.onnx');
const WASM_DIR = path.join(KOKORO_DIR, 'wasm');
const HAS_MODEL = fs.existsSync(MODEL_PATH);

const ASSETS: KokoroAssets = {
  modelPath: MODEL_PATH,
  voicesDir: path.join(KOKORO_DIR, 'voices'),
  tokenizerPath: path.join(KOKORO_DIR, 'tokenizer.json'),
  // SKY-11887: exercise the *packaged* configuration — a bundled wasm dir, which
  // is the only shape that goes through `kokoroWasmPathPrefix`. Before the fix
  // the real-model tests always used onnxruntime-web's own node_modules-relative
  // resolution, so nothing ever ran the branch that broke on Windows.
  wasmDir: fs.existsSync(WASM_DIR) ? WASM_DIR : undefined,
};

describe('isKokoroVoice / kokoroVoiceKey', () => {
  it('recognizes kokoro: ids only', () => {
    expect(isKokoroVoice('kokoro:nicole')).toBe(true);
    expect(isKokoroVoice('kokoro:sky')).toBe(true);
    expect(isKokoroVoice('piper:amy')).toBe(false);
    expect(isKokoroVoice('alloy')).toBe(false);
    expect(isKokoroVoice(undefined)).toBe(false);
    expect(isKokoroVoice(null)).toBe(false);
  });
  it('extracts the voice key', () => {
    expect(kokoroVoiceKey('kokoro:nicole')).toBe('nicole');
    expect(kokoroVoiceKey('kokoro:sky')).toBe('sky');
    expect(kokoroVoiceKey('piper:amy')).toBeUndefined();
  });
});

describe('floatToPcm16', () => {
  it('maps the full-scale range to signed 16-bit LE (symmetric ±32767)', () => {
    const buf = floatToPcm16([0, 1, -1, 0.5]);
    expect(buf.length).toBe(8);
    expect(buf.readInt16LE(0)).toBe(0);
    expect(buf.readInt16LE(2)).toBe(32767);
    expect(buf.readInt16LE(4)).toBe(-32767);
    expect(buf.readInt16LE(6)).toBe(Math.round(0.5 * 32767));
  });
  it('clamps out-of-range samples instead of wrapping', () => {
    const buf = floatToPcm16([2, -2, 1.0001, -1.0001]);
    expect(buf.readInt16LE(0)).toBe(32767);
    expect(buf.readInt16LE(2)).toBe(-32767);
    expect(buf.readInt16LE(4)).toBe(32767);
    expect(buf.readInt16LE(6)).toBe(-32767);
  });
  it('produces an empty buffer for empty input', () => {
    expect(floatToPcm16([]).length).toBe(0);
  });
});

describe('kokoroWasmPathPrefix (SKY-11887)', () => {
  // The exact resolution onnxruntime-web performs on `env.wasm.wasmPaths`: build
  // `<prefix>ort-wasm-simd-threaded.mjs` as a URL, fall back to concatenation
  // when the prefix is not a usable base, then `import()` the result. Node's ESM
  // loader only accepts the file/data/node schemes, so anything that does not
  // come out as a `file:` URL is a load failure — which is what shipped.
  const ORT_RUNTIME = 'ort-wasm-simd-threaded.mjs';
  const resolveLikeOrt = (prefix: string): string => {
    try {
      return new URL(ORT_RUNTIME, prefix).href;
    } catch {
      return prefix + ORT_RUNTIME;
    }
  };

  it('returns a slash-terminated file: URL that round-trips to the directory', () => {
    const dir = path.join(os.tmpdir(), 'mythos-kokoro-wasm');
    const prefix = kokoroWasmPathPrefix(dir);
    expect(prefix.startsWith('file://')).toBe(true);
    expect(prefix.endsWith('/')).toBe(true);
    expect(fileURLToPath(prefix)).toBe(dir + path.sep);
  });

  it('does not double the separator when the directory already ends in one', () => {
    const dir = path.join(os.tmpdir(), 'mythos-kokoro-wasm') + path.sep;
    expect(kokoroWasmPathPrefix(dir).endsWith('//')).toBe(false);
    expect(kokoroWasmPathPrefix(dir)).toBe(kokoroWasmPathPrefix(dir.slice(0, -1)));
  });

  it('percent-encodes an install directory containing spaces', () => {
    // The Windows default install dir is `…\Programs\Mythos Writer\…`.
    const prefix = kokoroWasmPathPrefix(path.join(os.tmpdir(), 'Mythos Writer', 'wasm'));
    expect(prefix).toContain('Mythos%20Writer');
    expect(prefix).not.toContain('Mythos Writer');
  });

  it("resolves to a file: URL Node's ESM loader accepts", () => {
    const resolved = resolveLikeOrt(kokoroWasmPathPrefix(path.join(os.tmpdir(), 'wasm')));
    expect(new URL(resolved).protocol).toBe('file:');
    expect(resolved.endsWith(`/${ORT_RUNTIME}`)).toBe(true);
  });

  // Regression guard for the shipped bug. These assertions are platform-
  // independent: `new URL()` parses a drive-letter path as scheme `c:` on Linux
  // and macOS too, so this fails on any runner if the prefix ever goes back to
  // a bare filesystem path. Note the forward-slash variant is *also* broken —
  // normalizing separators alone would not have fixed it.
  it.each([
    ['backslashes (the shipped `wasmDir + path.sep`)', 'C:\\Program Files\\Mythos Writer\\resources\\kokoro\\wasm\\'],
    ['forward slashes', 'C:/Program Files/Mythos Writer/resources/kokoro/wasm/'],
  ])('a bare Windows prefix with %s resolves to the unsupported `c:` scheme', (_label, raw) => {
    expect(new URL(resolveLikeOrt(raw)).protocol).toBe('c:');
  });
});

describe('tokenizePhonemes', () => {
  const vocab = { a: 1, b: 2, c: 3, ' ': 16 } as Record<string, number>;
  it('maps known chars and drops unknown ones', () => {
    expect(tokenizePhonemes('abc', vocab)).toEqual([1, 2, 3]);
    expect(tokenizePhonemes('a x b', vocab)).toEqual([1, 16, 16, 2]); // x dropped, spaces kept
    expect(tokenizePhonemes('zzz', vocab)).toEqual([]);
    expect(tokenizePhonemes('', vocab)).toEqual([]);
  });
});

describe('phonemizeText', () => {
  it('produces a non-empty IPA string for real prose', async () => {
    const ipa = await phonemizeText('Hello, this is a test.', 'a');
    expect(ipa.length).toBeGreaterThan(0);
    // eSpeak IPA for "hello" contains the l-sound; sanity that it is phonemes,
    // not the raw text.
    expect(ipa).not.toContain('Hello');
  });
  it('keeps punctuation and normalizes to phonemes only', async () => {
    const ipa = await phonemizeText('Nicole!', 'a');
    expect(ipa.endsWith('!')).toBe(true);
  });
});

describe.skipIf(!HAS_MODEL)('synthesizeKokoro (real model)', () => {
  beforeAll(() => {
    __resetKokoroEngine();
  });

  it('renders clearly non-silent 24kHz PCM for kokoro:nicole', async () => {
    const chunks: Buffer[] = [];
    const ac = new AbortController();
    await synthesizeKokoro(
      'Hello, this is Nicole reading your manuscript.',
      'nicole',
      ASSETS,
      ac.signal,
      (pcm) => chunks.push(pcm),
    );
    const pcm = Buffer.concat(chunks);
    expect(pcm.length).toBeGreaterThan(2000);
    // int16 LE → RMS in [-1,1]; speech should be well above the ~0.005 floor.
    const samples = pcm.length / 2;
    let sum = 0;
    for (let i = 0; i < samples; i++) sum += (pcm.readInt16LE(i * 2) / 32768) ** 2;
    const rms = Math.sqrt(sum / samples);
    expect(rms).toBeGreaterThan(0.01);
    // Roughly the right duration (KOKORO_SAMPLE_RATE Hz, 16-bit mono).
    expect(samples / KOKORO_SAMPLE_RATE).toBeGreaterThan(0.5);
  }, 60_000);

  it('renders kokoro:sky and honors an already-aborted signal', async () => {
    const chunks: Buffer[] = [];
    const okAc = new AbortController();
    await synthesizeKokoro('And this is Sky.', 'sky', ASSETS, okAc.signal, (p) => chunks.push(p));
    expect(Buffer.concat(chunks).length).toBeGreaterThan(1000);

    const aborted = new AbortController();
    aborted.abort();
    const none: Buffer[] = [];
    await synthesizeKokoro('Should not speak.', 'sky', ASSETS, aborted.signal, (p) => none.push(p));
    expect(none.length).toBe(0);
  }, 60_000);

  it('rejects an unknown voice key', async () => {
    const ac = new AbortController();
    await expect(
      synthesizeKokoro('x', 'nobody', ASSETS, ac.signal, () => {}),
    ).rejects.toThrow(/unknown Kokoro voice/);
  });
});
