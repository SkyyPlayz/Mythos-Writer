import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const requireFromRoot = createRequire(path.join(repoRoot, 'package.json'));
const asar = requireFromRoot('@electron/asar') as {
  createPackageWithOptions: (
    src: string,
    dest: string,
    options: { unpack?: string },
  ) => Promise<void>;
};
const deny = requireFromRoot('./build/afterPack-deny.cjs') as {
  loadDenyConfig: (allowlistPath?: string, markersPath?: string) => DenyConfig;
  scanBundle: (bundleDir: string, config: DenyConfig) => ScanResult;
  scanAppOut: (appOutDir: string, config: DenyConfig) => ScanResult;
  (context: { appOutDir: string }): Promise<void>;
};

interface DenyConfig {
  allowlist: { path: string; sha256: string; reason: string }[];
  byteMarkers: string[];
  packageNameMarkers: string[];
  scriptRanges: Record<string, { start: number; end: number; ceiling: number }>;
}

interface ScanResult {
  problems: string[];
  totals: { kana: number; hangul: number; cyrillic: number; cjk: number };
}

const FORBIDDEN_NAME = /^(phonemizer|kokoro-js|sherpa-onnx.*|.*espeak.*)$/;
const INSTALL_SCRIPT_ALLOWLIST = ['electron-winstaller', 'esbuild', 'fsevents', 'protobufjs'];
const BYTE_MARKERS = [
  'eSpeakNG',
  'espeak-ng',
  'espeak_ng',
  'piper-phonemize',
  'sherpa-onnx',
  'libspeechd',
  'enable-speech-dispatcher',
];
const PACKAGE_NAME_MARKERS = ['kokoro-js', 'phonemizer'];
const SCRIPT_RANGES = {
  kana: { start: 12352, end: 12543 },
  hangul: { start: 44032, end: 55215 },
  cyrillic: { start: 1024, end: 1279 },
  cjk: { start: 19968, end: 40959 },
};

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mythos-deny-'));
  temps.push(dir);
  return dir;
}

function markersJson(ceilings: { kana?: number; hangul?: number; cyrillic?: number; cjk?: number } = {}) {
  return {
    byteMarkers: BYTE_MARKERS,
    packageNameMarkers: PACKAGE_NAME_MARKERS,
    scriptRanges: {
      kana: { ...SCRIPT_RANGES.kana, ceiling: ceilings.kana ?? 0 },
      hangul: { ...SCRIPT_RANGES.hangul, ceiling: ceilings.hangul ?? 0 },
      cyrillic: { ...SCRIPT_RANGES.cyrillic, ceiling: ceilings.cyrillic ?? 0 },
      cjk: { ...SCRIPT_RANGES.cjk, ceiling: ceilings.cjk ?? 0 },
    },
  };
}

function writeConfig(
  dir: string,
  allowlist: unknown,
  ceilings?: { kana?: number; hangul?: number; cyrillic?: number; cjk?: number },
): { allowPath: string; markPath: string; config: DenyConfig } {
  const allowPath = path.join(dir, 'deny-allowlist.json');
  const markPath = path.join(dir, 'deny-markers.json');
  writeFileSync(allowPath, JSON.stringify(allowlist));
  writeFileSync(markPath, JSON.stringify(markersJson(ceilings)));
  return { allowPath, markPath, config: deny.loadDenyConfig(allowPath, markPath) };
}

function packageNameFromLockKey(key: string, entry: { name?: string }): string {
  if (typeof entry.name === 'string' && entry.name.length > 0) return entry.name;
  const nested = key.split('node_modules/').pop() ?? key;
  return nested;
}

function dependencyNames(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const names: string[] = [];
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const deps = record[field];
    if (deps && typeof deps === 'object') names.push(...Object.keys(deps as Record<string, unknown>));
  }
  return names;
}

function specifiersInSource(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /^\s*import\s+(?:type\s+)?(?:[^'"`;]*?\sfrom\s+)?['"]([^'"]+)['"]/,
    /^\s*export\s+(?:type\s+)?[^'"`;]*?\sfrom\s+['"]([^'"]+)['"]/,
    /^\s*import\s*\(\s*['"]([^'"]+)['"]\s*\)/,
    /require\(\s*['"]([^'"]+)['"]\s*\)/,
  ];
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    for (const pattern of patterns) {
      const match = pattern.exec(line);
      if (match?.[1]) specs.push(match[1]);
    }
  }
  return specs;
}

function phonemizeSpecifierProblems(dir: string): string[] {
  const problems: string[] = [];
  const walk = (current: string) => {
    for (const ent of readdirSync(current, { withFileTypes: true })) {
      if (ent.isSymbolicLink()) continue;
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!ent.isFile() || !ent.name.endsWith('.ts')) continue;
      const source = readFileSync(full, 'utf8');
      for (const spec of specifiersInSource(source)) {
        if (spec === 'phonemizer' || spec.startsWith('phonemizer/')) {
          problems.push(`${full} imports ${spec}`);
        }
        if (spec === 'phonemize' || (spec.startsWith('phonemize/') && spec !== 'phonemize/en-g2p')) {
          problems.push(`${full} imports ${spec}`);
        }
      }
    }
  };
  walk(dir);
  return problems;
}

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'check-denied-deps.mjs'), ...args], {
      encoding: 'utf8',
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const failure = err as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ? String(failure.stdout) : '',
      stderr: failure.stderr ? String(failure.stderr) : '',
    };
  }
}

describe('dependency deny list', () => {
  it('rejects phonemizer, kokoro-js, sherpa-onnx, and espeak in the lock and workspace manifests', () => {
    const lock = JSON.parse(readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { name?: string; hasInstallScript?: boolean }>;
    };
    const names = new Set<string>();
    const installScripts = new Set<string>();
    for (const [key, entry] of Object.entries(lock.packages)) {
      const name = packageNameFromLockKey(key, entry);
      if (name) names.add(name);
      for (const depName of dependencyNames(entry)) names.add(depName);
      if (entry.hasInstallScript) installScripts.add(name);
    }
    for (const manifest of ['package.json', 'frontend/package.json', 'electron-main/package.json', 'shared/package.json']) {
      const parsed = JSON.parse(readFileSync(path.join(repoRoot, manifest), 'utf8')) as unknown;
      for (const depName of dependencyNames(parsed)) names.add(depName);
    }
    const forbidden = [...names].filter((name) => FORBIDDEN_NAME.test(name)).sort();
    expect(forbidden).toEqual([]);
    expect([...installScripts].sort()).toEqual([...INSTALL_SCRIPT_ALLOWLIST].sort());
  });

  it('imports phonemize/en-g2p and no other phonemize or phonemizer specifier', () => {
    expect(phonemizeSpecifierProblems(path.join(repoRoot, 'electron-main', 'src'))).toEqual([]);
    const dir = tempDir();
    const badAll = path.join(dir, 'bad-all.ts');
    const badLegacy = path.join(dir, 'bad-legacy.ts');
    const good = path.join(dir, 'good.ts');
    const specifier = ['phonemize', 'all'].join('/');
    writeFileSync(badAll, `import g2p from ${JSON.stringify(specifier)};\n`);
    writeFileSync(badLegacy, 'import legacy from "phonemizer";\n');
    writeFileSync(good, "import EnglishG2P from 'phonemize/en-g2p';\n");
    expect(phonemizeSpecifierProblems(dir).some((line) => line.includes('bad-all.ts'))).toBe(true);
    expect(phonemizeSpecifierProblems(dir).some((line) => line.includes('bad-legacy.ts'))).toBe(true);
    expect(phonemizeSpecifierProblems(dir).some((line) => line.includes('good.ts'))).toBe(false);
  });

  it('keeps an empty allowlist and the exact marker table', () => {
    const allowlist = JSON.parse(readFileSync(path.join(repoRoot, 'scripts', 'deny-allowlist.json'), 'utf8'));
    expect(allowlist).toEqual([]);
    const markers = JSON.parse(readFileSync(path.join(repoRoot, 'scripts', 'deny-markers.json'), 'utf8')) as {
      byteMarkers: string[];
      packageNameMarkers: string[];
      scriptRanges: Record<string, { start: number; end: number; ceiling: number }>;
    };
    expect(markers.byteMarkers).toEqual(BYTE_MARKERS);
    expect(markers.packageNameMarkers).toEqual(PACKAGE_NAME_MARKERS);
    for (const [name, range] of Object.entries(SCRIPT_RANGES)) {
      expect(markers.scriptRanges[name]?.start).toBe(range.start);
      expect(markers.scriptRanges[name]?.end).toBe(range.end);
      expect(Number.isInteger(markers.scriptRanges[name]?.ceiling)).toBe(true);
      expect(markers.scriptRanges[name]?.ceiling).toBeGreaterThanOrEqual(0);
    }
  });

  it('reads deny JSON with readFileSync and stays on node built-ins', () => {
    const hook = readFileSync(path.join(repoRoot, 'build', 'afterPack-deny.cjs'), 'utf8');
    const cli = readFileSync(path.join(repoRoot, 'scripts', 'check-denied-deps.mjs'), 'utf8');
    expect(hook).toContain('readFileSync');
    expect(hook).toContain('JSON.parse');
    expect(hook).not.toMatch(/require\([^)]*\.json/);
    expect(hook).not.toContain('@electron/asar');
    expect(hook).not.toMatch(/\b(writeFile|appendFile|unlink|mkdir|rmdir|rmSync|copyFile|rename|chmod|symlink|truncate)\b/);
    const required = [...hook.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]);
    expect(required).toEqual(['node:fs', 'node:path', 'node:crypto']);
    expect(cli).not.toMatch(/require\([^)]*\.json/);
    expect(cli).toContain('loadDenyConfig');
    expect(hook).toContain('loadDenyConfig');
  });
});

describe('deny config fails closed', () => {
  const cases = [
    ['allowlist', 'missing'],
    ['allowlist', 'unreadable'],
    ['allowlist', 'invalid JSON'],
    ['markers', 'missing'],
    ['markers', 'unreadable'],
    ['markers', 'invalid JSON'],
  ] as const;

  it.each(cases)('loadDenyConfig rejects a %s file that is %s', (which, mode) => {
    const dir = tempDir();
    const validAllow = path.join(dir, 'ok-allow.json');
    const validMarkers = path.join(dir, 'ok-markers.json');
    writeFileSync(validAllow, '[]');
    writeFileSync(validMarkers, JSON.stringify(markersJson()));
    const broken = path.join(dir, 'broken');
    if (mode === 'unreadable') mkdirSync(broken);
    else if (mode === 'invalid JSON') writeFileSync(broken, '{');
    const allowPath = which === 'allowlist' ? (mode === 'missing' ? path.join(dir, 'absent.json') : broken) : validAllow;
    const markPath = which === 'markers' ? (mode === 'missing' ? path.join(dir, 'absent.json') : broken) : validMarkers;
    const message = mode === 'missing' ? /missing/ : mode === 'unreadable' ? /unreadable/ : /invalid JSON/;
    expect(() => deny.loadDenyConfig(allowPath, markPath)).toThrow(message);
  });

  it.each(cases)('check-denied-deps.mjs exits non-zero when %s is %s', (which, mode) => {
    const dir = tempDir();
    const bundle = path.join(dir, 'out');
    mkdirSync(bundle);
    const validAllow = path.join(dir, 'ok-allow.json');
    const validMarkers = path.join(dir, 'ok-markers.json');
    writeFileSync(validAllow, '[]');
    writeFileSync(validMarkers, JSON.stringify(markersJson()));
    const broken = path.join(dir, 'broken');
    if (mode === 'unreadable') mkdirSync(broken);
    else if (mode === 'invalid JSON') writeFileSync(broken, '{');
    const allowPath = which === 'allowlist' ? (mode === 'missing' ? path.join(dir, 'absent.json') : broken) : validAllow;
    const markPath = which === 'markers' ? (mode === 'missing' ? path.join(dir, 'absent.json') : broken) : validMarkers;
    const result = runCli(['--bundle', bundle, '--allowlist', allowPath, '--markers', markPath]);
    expect(result.status).not.toBe(0);
    const combined = `${result.stderr}\n${result.stdout}`;
    if (mode === 'missing') expect(combined).toMatch(/missing/);
    else if (mode === 'unreadable') expect(combined).toMatch(/unreadable/);
    else expect(combined).toMatch(/invalid JSON/);
  });
});

describe('deny scan', () => {
  it('flags package-name markers only as a package.json key or node_modules path', () => {
    const dir = tempDir();
    const { config } = writeConfig(dir, []);
    const bundle = path.join(dir, 'bundle');
    mkdirSync(path.join(bundle, 'node_modules', 'phonemizer'), { recursive: true });
    writeFileSync(path.join(bundle, 'node_modules', 'phonemizer', 'index.js'), 'exports.ok = true;\n');
    writeFileSync(path.join(bundle, 'package.json'), JSON.stringify({ dependencies: { 'kokoro-js': '1.0.0' } }));
    writeFileSync(path.join(bundle, 'readme.txt'), 'kokoro-js and phonemizer are words in prose\n');
    const result = deny.scanBundle(bundle, config);
    expect(result.problems.some((line) => line.includes('node_modules/phonemizer'))).toBe(true);
    expect(result.problems.some((line) => line.includes('kokoro-js') && line.includes('package.json'))).toBe(true);
    expect(result.problems.some((line) => line.includes('readme.txt'))).toBe(false);
  });

  it('fails script ceilings and does not let the allowlist bypass them', () => {
    const dir = tempDir();
    const bundle = path.join(dir, 'bundle');
    mkdirSync(path.join(bundle, 'main'), { recursive: true });
    const js = path.join(bundle, 'main', 'main.js');
    const body = `const ch = ${JSON.stringify('\u3042')};\n`;
    writeFileSync(js, body);
    const hash = createHash('sha256').update(body).digest('hex');
    const open = writeConfig(dir, [], { kana: 0 });
    const blocked = deny.scanBundle(bundle, open.config);
    expect(blocked.problems.some((line) => /kana count 1 exceeds ceiling 0/.test(line))).toBe(true);
    const allowed = writeConfig(
      dir,
      [{ path: 'main/main.js', sha256: hash, reason: 'fixture' }],
      { kana: 0 },
    );
    const stillBlocked = deny.scanBundle(bundle, allowed.config);
    expect(stillBlocked.problems.some((line) => /kana count 1 exceeds ceiling 0/.test(line))).toBe(true);
    const raised = writeConfig(dir, [], { kana: 1 });
    expect(deny.scanBundle(bundle, raised.config).problems).toEqual([]);
  });

  it('passes a clean bundle and rejects a missing --bundle flag', () => {
    const dir = tempDir();
    const bundle = path.join(dir, 'out');
    mkdirSync(path.join(bundle, 'main'), { recursive: true });
    writeFileSync(path.join(bundle, 'main', 'main.js'), 'console.log("ok");\n');
    const { allowPath, markPath } = writeConfig(dir, []);
    const ok = runCli(['--bundle', bundle, '--allowlist', allowPath, '--markers', markPath]);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('deny check: passed');
    const missing = runCli([]);
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toMatch(/missing --bundle/);
  });

  it('fails afterPack when resources contain an unlisted espeak-ng file, and honors an exact hash', async () => {
    const dir = tempDir();
    const src = path.join(dir, 'src');
    const appOut = path.join(dir, 'app');
    mkdirSync(path.join(src, 'out', 'main'), { recursive: true });
    writeFileSync(path.join(src, 'out', 'main', 'main.js'), 'const unpacked = "libspeechd";\n');
    writeFileSync(path.join(src, 'out', 'main', 'extra.js'), 'const packed = "eSpeakNG\\u0410";\n');
    const asarPath = path.join(appOut, 'resources', 'app.asar');
    await asar.createPackageWithOptions(src, asarPath, { unpack: 'main.js' });
    const note = path.join(appOut, 'resources', 'kokoro', 'note.txt');
    mkdirSync(path.dirname(note), { recursive: true });
    const original = 'espeak-ng\n';
    writeFileSync(note, original);
    const { config } = writeConfig(dir, []);
    const unlisted = deny.scanAppOut(appOut, config);
    expect(unlisted.problems.some((line) => line.includes('espeak-ng') && line.includes('resources/kokoro/note.txt'))).toBe(true);
    expect(unlisted.problems.some((line) => line.includes('libspeechd') && line.includes('app.asar.unpacked'))).toBe(true);
    expect(unlisted.problems.some((line) => line.includes('"eSpeakNG"') && line.includes('in resources/app.asar') && !line.includes('unpacked'))).toBe(true);

    const hash = createHash('sha256').update(original).digest('hex');
    const listed = writeConfig(dir, [
      { path: 'resources/kokoro/note.txt', sha256: hash, reason: 'fixture' },
    ]);
    const allowed = deny.scanAppOut(appOut, listed.config);
    expect(allowed.problems.some((line) => line.includes('resources/kokoro/note.txt'))).toBe(false);
    expect(allowed.problems.some((line) => line.includes('libspeechd'))).toBe(true);

    const changed = `${original}x`;
    writeFileSync(note, changed);
    const mutated = deny.scanAppOut(appOut, listed.config);
    expect(mutated.problems.some((line) => line.includes('resources/kokoro/note.txt') && line.includes('sha256 mismatch'))).toBe(true);
  });

  it('counts kana in unpacked main.js and cyrillic in packed main js', async () => {
    const dir = tempDir();
    const src = path.join(dir, 'src');
    mkdirSync(path.join(src, 'out', 'main'), { recursive: true });
    writeFileSync(path.join(src, 'out', 'main', 'main.js'), '\u3042');
    writeFileSync(path.join(src, 'out', 'main', 'extra.js'), '\u0410');
    const appOut = path.join(dir, 'app');
    await asar.createPackageWithOptions(path.join(src), path.join(appOut, 'resources', 'app.asar'), {
      unpack: 'main.js',
    });
    const { config } = writeConfig(dir, []);
    const result = deny.scanAppOut(appOut, config);
    expect(result.totals.kana).toBe(1);
    expect(result.totals.cyrillic).toBe(1);
    expect(result.problems.some((line) => /kana count 1 exceeds ceiling 0/.test(line))).toBe(true);
    expect(result.problems.some((line) => /cyrillic count 1 exceeds ceiling 0/.test(line))).toBe(true);
  });

  it('fails when the packaged app has no app.asar', async () => {
    const dir = tempDir();
    const appOut = path.join(dir, 'empty-app');
    mkdirSync(appOut);
    await expect(deny({ appOutDir: appOut })).rejects.toThrow(/missing app\.asar/);
  });
});
