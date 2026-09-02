#!/usr/bin/env node
// SKY-11243 — fetch the bundled Kokoro-82M offline TTS assets at build time.
//
// The model weights (~86 MB) are deliberately NOT committed to git; this script
// downloads them into electron-main/resources/kokoro/ so electron-builder's
// extraResources can bundle them into the installer. It is idempotent (skips
// files already present with the expected size) and is wired ONLY into the
// packaging scripts (dist:* / build / package) — never into `npm ci` or the
// required `ci` job, so ordinary installs and the fast CI lane stay lean.
//
// Assets: onnx-community/Kokoro-82M-v1.0-ONNX (Apache-2.0). See the sibling
// LICENSE in electron-main/resources/kokoro/.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const KOKORO_DIR = path.join(ROOT, 'electron-main', 'resources', 'kokoro');
const VOICES_DIR = path.join(KOKORO_DIR, 'voices');
const WASM_DIR = path.join(KOKORO_DIR, 'wasm');

const HF_BASE =
  'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main';

// Downloads keyed by destination path → { url, minBytes } (minBytes guards a
// truncated / HTML-error download from being treated as a valid asset).
const DOWNLOADS = [
  { dest: path.join(KOKORO_DIR, 'model_q8f16.onnx'), url: `${HF_BASE}/onnx/model_q8f16.onnx`, minBytes: 80_000_000 },
  { dest: path.join(KOKORO_DIR, 'tokenizer.json'), url: `${HF_BASE}/tokenizer.json`, minBytes: 1_000 },
  { dest: path.join(VOICES_DIR, 'af_nicole.bin'), url: `${HF_BASE}/voices/af_nicole.bin`, minBytes: 500_000 },
  { dest: path.join(VOICES_DIR, 'af_sky.bin'), url: `${HF_BASE}/voices/af_sky.bin`, minBytes: 500_000 },
];

function sizeOf(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return -1;
  }
}

function download({ dest, url, minBytes }) {
  if (sizeOf(dest) >= minBytes) {
    console.log(`  ✓ ${path.relative(ROOT, dest)} (cached)`);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.partial`;
  console.log(`  ↓ ${path.relative(ROOT, dest)} …`);
  // curl -L handles HuggingFace's CDN redirects; --fail turns an HTTP error into
  // a non-zero exit instead of writing an HTML error body to disk.
  execFileSync('curl', ['-sL', '--fail', '-o', tmp, url], { stdio: 'inherit' });
  const got = sizeOf(tmp);
  if (got < minBytes) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`downloaded ${url} is too small (${got} < ${minBytes} bytes) — aborting`);
  }
  fs.renameSync(tmp, dest);
}

// Copy onnxruntime-web's WASM runtime next to the model so a packaged build can
// load it (the default node_modules-relative resolution can't reach into the
// asar). Dev/E2E ignore this dir and use onnxruntime-web's own resolution.
function copyOrtWasm() {
  const ortDist = path.join(ROOT, 'node_modules', 'onnxruntime-web', 'dist');
  if (!fs.existsSync(ortDist)) {
    console.warn('  ! onnxruntime-web not installed — skipping WASM copy (packaged voice needs it)');
    return;
  }
  fs.mkdirSync(WASM_DIR, { recursive: true });
  const files = fs.readdirSync(ortDist).filter((f) => f.endsWith('.wasm') || f.endsWith('.mjs'));
  for (const f of files) {
    fs.copyFileSync(path.join(ortDist, f), path.join(WASM_DIR, f));
  }
  console.log(`  ✓ copied ${files.length} onnxruntime-web runtime files → ${path.relative(ROOT, WASM_DIR)}`);
}

console.log('Fetching bundled Kokoro TTS assets (SKY-11243)…');
fs.mkdirSync(KOKORO_DIR, { recursive: true });
for (const d of DOWNLOADS) download(d);
copyOrtWasm();
console.log('Kokoro assets ready.');
