// Shared plumbing for the fidelity harness (SKY-9257, PLAN.md §3 P0.2).
// Everything here is repo-relative — no host paths, no pre-started servers.
//
// ── HARNESS RULES, learned the hard way (PLAN.md P0.2 — do not relearn these) ──
// 1. NEVER click selectors matching `Close` / `aria-label*="lose"` — they hit the
//    window chrome and kill the Electron window mid-capture.
// 2. Dismiss the vault-format modal (`Not now`) before the first navigation.
// 3. Verify navigation landed via the `--active` class, never a timing guess.
// 4. Don't pipe the runner through `head` — it must exit cleanly on its own.
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Built app entry (electron-vite output). App-capture scripts need `npm run build:electron` first.
export const mainJs = path.join(repoRoot, 'out', 'main', 'main.js');

export function requireBuild() {
  if (!fs.existsSync(mainJs)) {
    console.error(`Missing ${mainJs} — run \`npm run build:electron\` first (fidelity:app does this for you).`);
    process.exit(1);
  }
}

// Per-script output dir: e2e/fidelity/output/<script-name>/ (gitignored).
export function outDir(name) {
  const dir = path.join(repoRoot, 'e2e', 'fidelity', 'output', name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Default is Playwright's bundled Chromium so a clean checkout works with nothing but
// `npx playwright install chromium`. FIDELITY_CHROME=/path/to/chrome overrides it, and
// when the bundled browser simply isn't installed (playwright refuses to install on
// some host OSes, e.g. ubuntu 26.04) we fall back to the system Chrome channel.
export function chromiumLaunchOptions(extraArgs = []) {
  const opts = { args: ['--no-sandbox', '--disable-dev-shm-usage', ...extraArgs] };
  if (process.env.FIDELITY_CHROME) {
    opts.executablePath = process.env.FIDELITY_CHROME;
  } else if (!fs.existsSync(chromium.executablePath())) {
    console.warn('[fidelity] bundled Chromium not installed; falling back to system Chrome channel');
    opts.channel = 'chrome';
  }
  return opts;
}

const PROTO_DIR = path.join(repoRoot, 'plans', 'design-handoff', 'v2', 'prototype');
const PROTO_HTML = 'Mythos Writer - Liquid Neon.dc.html';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

// Serve the prototype-of-record directory on an ephemeral 127.0.0.1 port so the
// harness never depends on a manually started server. Returns { url, close }.
export function serveProto() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || PROTO_HTML;
    const file = path.normalize(path.join(PROTO_DIR, rel));
    if (!file.startsWith(PROTO_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/${encodeURIComponent(PROTO_HTML)}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
