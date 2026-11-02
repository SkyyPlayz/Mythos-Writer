// Bundle half of the GPL deny check. `npm run build:electron` runs this
// after electron-vite. JSON is read in build/afterPack-deny.cjs via
// readFileSync + JSON.parse (never require of the JSON files).

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const deny = require(path.join(scriptDir, '..', 'build', 'afterPack-deny.cjs'));

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const flags = { bundle: '', allowlist: '', markers: '' };
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === '--bundle' || arg === '--allowlist' || arg === '--markers') {
    const value = process.argv[i + 1];
    if (!value) fail(`deny check: missing value for ${arg}`);
    flags[arg.slice(2)] = value;
    i += 1;
    continue;
  }
  fail(`deny check: unknown argument ${arg}`);
}

if (!flags.bundle) fail('deny check: missing --bundle <dir>');

let result;
try {
  const config = deny.loadDenyConfig(
    flags.allowlist ? path.resolve(flags.allowlist) : undefined,
    flags.markers ? path.resolve(flags.markers) : undefined,
  );
  result = deny.scanBundle(path.resolve(flags.bundle), config);
} catch (err) {
  fail(err && err.message ? err.message : String(err));
}

if (result.problems.length > 0) {
  fail(result.problems.join('\n'));
}

const totals = result.totals;
process.stdout.write(
  `deny check: passed kana=${totals.kana} hangul=${totals.hangul} cyrillic=${totals.cyrillic} cjk=${totals.cjk}\n`,
);
