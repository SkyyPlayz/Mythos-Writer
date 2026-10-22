'use strict';

// Fail the build if GPL phonemizer code, speech-dispatcher, or a non-English
// phonemize chunk is about to ship. JSON is loaded with readFileSync +
// JSON.parse, never require(). Node built-ins only. This hook does not write
// the packaged app.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCRIPT_RANGE_NAMES = ['kana', 'hangul', 'cyrillic', 'cjk'];

function defaultConfigPaths() {
  return {
    allowlist: path.join(__dirname, '..', 'scripts', 'deny-allowlist.json'),
    markers: path.join(__dirname, '..', 'scripts', 'deny-markers.json'),
  };
}

function readDenyJson(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath);
  } catch (err) {
    const code = err && err.code ? err.code : '';
    if (code === 'ENOENT') {
      throw new Error(`deny check: missing ${label} (${filePath})`);
    }
    throw new Error(`deny check: unreadable ${label} (${filePath}): ${code || err.message}`);
  }
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Error(`deny check: invalid JSON in ${label} (${filePath})`);
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function validateAllowlist(parsed, label) {
  if (!Array.isArray(parsed)) {
    throw new Error(`deny check: invalid ${label}: expected an array`);
  }
  const seen = new Set();
  const entries = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`deny check: invalid ${label}: entry must be an object`);
    }
    const entryPath = entry.path;
    if (!isNonEmptyString(entryPath) || entryPath.startsWith('/') || entryPath.includes('\\') || entryPath.split('/').includes('..')) {
      throw new Error(`deny check: invalid ${label}: path must be a relative forward-slash path`);
    }
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new Error(`deny check: invalid ${label}: sha256 must be 64 lowercase hex characters`);
    }
    if (!isNonEmptyString(entry.reason)) {
      throw new Error(`deny check: invalid ${label}: reason must be a non-empty string`);
    }
    if (seen.has(entryPath)) {
      throw new Error(`deny check: invalid ${label}: duplicate path ${entryPath}`);
    }
    seen.add(entryPath);
    entries.push({ path: entryPath, sha256: entry.sha256, reason: entry.reason });
  }
  return entries;
}

function validateMarkers(parsed, label) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`deny check: invalid ${label}: expected an object`);
  }
  if (!Array.isArray(parsed.byteMarkers) || parsed.byteMarkers.length === 0 || !parsed.byteMarkers.every(isNonEmptyString)) {
    throw new Error(`deny check: invalid ${label}: byteMarkers must be a non-empty array of strings`);
  }
  if (!Array.isArray(parsed.packageNameMarkers) || !parsed.packageNameMarkers.every(isNonEmptyString)) {
    throw new Error(`deny check: invalid ${label}: packageNameMarkers must be an array of strings`);
  }
  const ranges = parsed.scriptRanges;
  if (!ranges || typeof ranges !== 'object' || Array.isArray(ranges)) {
    throw new Error(`deny check: invalid ${label}: scriptRanges must be an object`);
  }
  const names = Object.keys(ranges);
  if (names.length !== SCRIPT_RANGE_NAMES.length || SCRIPT_RANGE_NAMES.some((name) => !Object.prototype.hasOwnProperty.call(ranges, name))) {
    throw new Error(`deny check: invalid ${label}: scriptRanges must be exactly ${SCRIPT_RANGE_NAMES.join(', ')}`);
  }
  const scriptRanges = {};
  for (const name of SCRIPT_RANGE_NAMES) {
    const range = ranges[name];
    if (!range || typeof range !== 'object') {
      throw new Error(`deny check: invalid ${label}: scriptRanges.${name} must be an object`);
    }
    for (const key of ['start', 'end', 'ceiling']) {
      if (!Number.isInteger(range[key])) {
        throw new Error(`deny check: invalid ${label}: scriptRanges.${name}.${key} must be an integer`);
      }
    }
    if (range.start < 0 || range.end < range.start || range.ceiling < 0) {
      throw new Error(`deny check: invalid ${label}: scriptRanges.${name} bounds are out of range`);
    }
    scriptRanges[name] = { start: range.start, end: range.end, ceiling: range.ceiling };
  }
  return {
    byteMarkers: parsed.byteMarkers.slice(),
    packageNameMarkers: parsed.packageNameMarkers.slice(),
    scriptRanges,
  };
}

function loadDenyConfig(allowlistPath, markersPath) {
  const defaults = defaultConfigPaths();
  const allowPath = allowlistPath || defaults.allowlist;
  const markPath = markersPath || defaults.markers;
  const allowlist = validateAllowlist(readDenyJson(allowPath, 'deny-allowlist.json'), 'deny-allowlist.json');
  const markers = validateMarkers(readDenyJson(markPath, 'deny-markers.json'), 'deny-markers.json');
  return {
    allowlist,
    byteMarkers: markers.byteMarkers,
    packageNameMarkers: markers.packageNameMarkers,
    scriptRanges: markers.scriptRanges,
  };
}

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function relativePosix(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function emptyTotals() {
  return { kana: 0, hangul: 0, cyrillic: 0, cjk: 0 };
}

function countScripts(bytes, scriptRanges) {
  const text = bytes.toString('utf8');
  const totals = emptyTotals();
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    for (const name of SCRIPT_RANGE_NAMES) {
      const range = scriptRanges[name];
      if (code >= range.start && code <= range.end) totals[name] += 1;
    }
  }
  return totals;
}

function addTotals(into, extra) {
  for (const name of SCRIPT_RANGE_NAMES) into[name] += extra[name];
}

function allowlistDecision(rel, bytes, allowlist) {
  const entry = allowlist.find((item) => item.path === rel);
  if (!entry) return { listed: false, match: false };
  return { listed: true, match: sha256Hex(bytes) === entry.sha256 };
}

function packageNamesInPath(rel, packageNameMarkers) {
  const parts = rel.split('/');
  const found = [];
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (parts[i] === 'node_modules' && packageNameMarkers.includes(parts[i + 1])) {
      found.push(parts[i + 1]);
    }
  }
  return found;
}

function forbiddenJsonKeys(bytes, packageNameMarkers) {
  const names = new Set(packageNameMarkers);
  const found = new Set();
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    const text = bytes.toString('utf8');
    for (const name of packageNameMarkers) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`"${escaped}"\\s*:`).test(text)) found.add(name);
    }
    return [...found];
  }
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (names.has(key)) found.add(key);
      visit(child);
    }
  };
  visit(parsed);
  return [...found];
}

function recordMarker(problems, seen, rel, marker, mismatched) {
  const key = `${rel}\0${marker}`;
  if (seen.has(key)) return;
  seen.add(key);
  const suffix = mismatched ? ' (allowlist sha256 mismatch)' : '';
  problems.push(`deny check: marker ${JSON.stringify(marker)} in ${rel}${suffix}`);
}

function checkFileMarkers(rel, bytes, config, problems, seen) {
  const decision = allowlistDecision(rel, bytes, config.allowlist);
  if (decision.match) return;
  const mismatched = decision.listed;
  for (const marker of config.byteMarkers) {
    if (bytes.includes(Buffer.from(marker, 'utf8'))) {
      recordMarker(problems, seen, rel, marker, mismatched);
    }
  }
  for (const name of packageNamesInPath(rel, config.packageNameMarkers)) {
    recordMarker(problems, seen, rel, `node_modules/${name}`, mismatched);
  }
  if (rel === 'package.json' || rel.endsWith('/package.json')) {
    for (const name of forbiddenJsonKeys(bytes, config.packageNameMarkers)) {
      recordMarker(problems, seen, rel, name, mismatched);
    }
  }
}

function ceilingProblems(totals, scriptRanges, where) {
  const problems = [];
  for (const name of SCRIPT_RANGE_NAMES) {
    if (totals[name] > scriptRanges[name].ceiling) {
      problems.push(
        `deny check: ${name} count ${totals[name]} exceeds ceiling ${scriptRanges[name].ceiling} in ${where}`,
      );
    }
  }
  return problems;
}

function isOutMainJs(rel) {
  return rel.startsWith('out/main/') && rel.endsWith('.js');
}

function isBundleMainJs(rel) {
  return rel.startsWith('main/') && rel.endsWith('.js');
}

function readDirents(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    const code = err && err.code ? err.code : err.message;
    throw new Error(`deny check: unreadable directory (${dir}): ${code}`);
  }
}

function walkFiles(dir, onFile, skipDirectory) {
  for (const ent of readDirents(dir)) {
    if (ent.isSymbolicLink()) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (skipDirectory && skipDirectory(full, ent.name)) continue;
      walkFiles(full, onFile, skipDirectory);
      continue;
    }
    if (ent.isFile()) onFile(full);
  }
}

function readFileOrProblem(filePath, problems) {
  try {
    return fs.readFileSync(filePath);
  } catch (err) {
    const code = err && err.code ? err.code : err.message;
    problems.push(`deny check: unreadable file (${filePath}): ${code}`);
    return null;
  }
}

function scanBundle(bundleDir, config) {
  const problems = [];
  const totals = emptyTotals();
  let stat;
  try {
    stat = fs.statSync(bundleDir);
  } catch (err) {
    const code = err && err.code ? err.code : '';
    if (code === 'ENOENT') {
      return { problems: [`deny check: missing bundle directory (${bundleDir})`], totals };
    }
    return { problems: [`deny check: unreadable bundle directory (${bundleDir}): ${code || err.message}`], totals };
  }
  if (!stat.isDirectory()) {
    return { problems: [`deny check: unreadable bundle directory (${bundleDir}): not a directory`], totals };
  }
  const seen = new Set();
  walkFiles(bundleDir, (filePath) => {
    const rel = relativePosix(bundleDir, filePath);
    const bytes = readFileOrProblem(filePath, problems);
    if (!bytes) return;
    checkFileMarkers(rel, bytes, config, problems, seen);
    if (isBundleMainJs(rel)) addTotals(totals, countScripts(bytes, config.scriptRanges));
  });
  problems.push(...ceilingProblems(totals, config.scriptRanges, bundleDir));
  return { problems, totals };
}

function readAsarHeader(archivePath) {
  const fd = fs.openSync(archivePath, 'r');
  try {
    const sizeBuf = Buffer.alloc(8);
    if (fs.readSync(fd, sizeBuf, 0, 8, 0) !== 8) {
      throw new Error('short asar size pickle');
    }
    if (sizeBuf.readUInt32LE(0) !== 4) {
      throw new Error('unexpected asar size pickle');
    }
    const headerPickleSize = sizeBuf.readUInt32LE(4);
    if (headerPickleSize < 8 || headerPickleSize > 200 * 1024 * 1024) {
      throw new Error('asar header size out of range');
    }
    const headerBuf = Buffer.alloc(headerPickleSize);
    if (fs.readSync(fd, headerBuf, 0, headerPickleSize, 8) !== headerPickleSize) {
      throw new Error('short asar header');
    }
    const jsonLen = headerBuf.readUInt32LE(4);
    if (jsonLen < 2 || 8 + jsonLen > headerBuf.length) {
      throw new Error('asar header json length out of range');
    }
    const header = JSON.parse(headerBuf.subarray(8, 8 + jsonLen).toString('utf8'));
    return { header, headerSize: headerPickleSize };
  } finally {
    fs.closeSync(fd);
  }
}

function collectAsarFiles(node, prefix, out) {
  const files = node && node.files;
  if (!files || typeof files !== 'object') return;
  for (const name of Object.keys(files)) {
    const child = files[name];
    const rel = prefix ? `${prefix}/${name}` : name;
    if (child && child.files) collectAsarFiles(child, rel, out);
    else if (child && typeof child.size === 'number') out.push({ path: rel, info: child });
  }
}

function readAsarEntry(archivePath, headerSize, entry, problems) {
  const info = entry.info;
  if (info.unpacked) {
    const unpackedPath = path.join(`${archivePath}.unpacked`, ...entry.path.split('/'));
    return readFileOrProblem(unpackedPath, problems);
  }
  if (info.size === 0) return Buffer.alloc(0);
  if (info.offset === undefined || info.offset === null) {
    problems.push(`deny check: missing asar offset for ${entry.path}`);
    return null;
  }
  const offset = 8 + headerSize + Number.parseInt(String(info.offset), 10);
  if (!Number.isFinite(offset) || offset < 0) {
    problems.push(`deny check: bad asar offset for ${entry.path}`);
    return null;
  }
  const buf = Buffer.alloc(info.size);
  const fd = fs.openSync(archivePath, 'r');
  try {
    const n = fs.readSync(fd, buf, 0, info.size, offset);
    if (n !== info.size) {
      problems.push(`deny check: short asar read for ${entry.path}`);
      return null;
    }
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

function findAsars(appOutDir) {
  const asars = [];
  walkFiles(
    appOutDir,
    (filePath) => {
      if (path.basename(filePath) === 'app.asar') asars.push(filePath);
    },
    (_full, name) => name === 'app.asar.unpacked',
  );
  return asars;
}

function findResourceDirs(appOutDir) {
  const candidates = [
    path.join(appOutDir, 'resources'),
    path.join(appOutDir, 'Contents', 'Resources'),
  ];
  for (const ent of readDirents(appOutDir)) {
    if (ent.isSymbolicLink() || !ent.isDirectory()) continue;
    candidates.push(path.join(appOutDir, ent.name, 'resources'));
    candidates.push(path.join(appOutDir, ent.name, 'Contents', 'Resources'));
  }
  const found = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      if (fs.statSync(candidate).isDirectory()) found.push(candidate);
    } catch {
      // Other platform layouts are absent. That is not a failure.
    }
  }
  return found;
}

function scanUnpackedMarkers(archivePath, appOutDir, config, problems, seen) {
  const unpacked = `${archivePath}.unpacked`;
  let stat;
  try {
    stat = fs.statSync(unpacked);
  } catch (err) {
    if (err && err.code === 'ENOENT') return;
    const code = err && err.code ? err.code : err.message;
    problems.push(`deny check: unreadable directory (${unpacked}): ${code}`);
    return;
  }
  if (!stat.isDirectory()) return;
  walkFiles(unpacked, (filePath) => {
    const rel = relativePosix(appOutDir, filePath);
    const bytes = readFileOrProblem(filePath, problems);
    if (!bytes) return;
    checkFileMarkers(rel, bytes, config, problems, seen);
  });
}

function scanResourceMarkers(resourceDir, appOutDir, config, problems, seen) {
  walkFiles(
    resourceDir,
    (filePath) => {
      if (path.basename(filePath) === 'app.asar') return;
      const rel = relativePosix(appOutDir, filePath);
      const bytes = readFileOrProblem(filePath, problems);
      if (!bytes) return;
      checkFileMarkers(rel, bytes, config, problems, seen);
    },
    (_full, name) => name === 'app.asar.unpacked',
  );
}

function scanOneAsar(archivePath, appOutDir, config, problems, seen) {
  const relAsar = relativePosix(appOutDir, archivePath);
  const totals = emptyTotals();
  const raw = readFileOrProblem(archivePath, problems);
  if (!raw) return totals;
  const decision = allowlistDecision(relAsar, raw, config.allowlist);
  if (!decision.match) {
    const mismatched = decision.listed;
    for (const marker of config.byteMarkers) {
      if (raw.includes(Buffer.from(marker, 'utf8'))) {
        recordMarker(problems, seen, relAsar, marker, mismatched);
      }
    }
    for (const name of config.packageNameMarkers) {
      if (raw.includes(Buffer.from(`node_modules/${name}`, 'utf8'))) {
        recordMarker(problems, seen, relAsar, `node_modules/${name}`, mismatched);
      }
    }
  }
  let parsed;
  try {
    parsed = readAsarHeader(archivePath);
  } catch (err) {
    problems.push(`deny check: unreadable asar header (${relAsar}): ${err.message}`);
    return totals;
  }
  const entries = [];
  collectAsarFiles(parsed.header, '', entries);
  for (const entry of entries) {
    const wantsJs = isOutMainJs(entry.path);
    const wantsPkg = entry.path === 'package.json' || entry.path.endsWith('/package.json');
    const pathNames = packageNamesInPath(entry.path, config.packageNameMarkers);
    if (!wantsJs && !wantsPkg && pathNames.length === 0) continue;
    const bytes = readAsarEntry(archivePath, parsed.headerSize, entry, problems);
    if (!bytes) continue;
    if (wantsJs) addTotals(totals, countScripts(bytes, config.scriptRanges));
    if (pathNames.length === 0 && !wantsPkg) continue;
    const entryRel = `${relAsar}!${entry.path}`;
    const entryDecision = allowlistDecision(entryRel, bytes, config.allowlist);
    if (entryDecision.match) continue;
    const mismatched = entryDecision.listed;
    for (const name of pathNames) {
      recordMarker(problems, seen, entryRel, `node_modules/${name}`, mismatched);
    }
    if (wantsPkg) {
      for (const name of forbiddenJsonKeys(bytes, config.packageNameMarkers)) {
        recordMarker(problems, seen, entryRel, name, mismatched);
      }
    }
  }
  return totals;
}

function scanAppOut(appOutDir, config) {
  const problems = [];
  const totals = emptyTotals();
  let stat;
  try {
    stat = fs.statSync(appOutDir);
  } catch (err) {
    const code = err && err.code ? err.code : '';
    if (code === 'ENOENT') {
      return { problems: [`deny check: missing appOutDir (${appOutDir})`], totals };
    }
    return { problems: [`deny check: unreadable appOutDir (${appOutDir}): ${code || err.message}`], totals };
  }
  if (!stat.isDirectory()) {
    return { problems: [`deny check: unreadable appOutDir (${appOutDir}): not a directory`], totals };
  }
  let asars;
  try {
    asars = findAsars(appOutDir);
  } catch (err) {
    return { problems: [err.message], totals };
  }
  if (asars.length === 0) {
    return { problems: [`deny check: missing app.asar under ${appOutDir}`], totals };
  }
  const seen = new Set();
  for (const archivePath of asars) {
    const asarTotals = scanOneAsar(archivePath, appOutDir, config, problems, seen);
    addTotals(totals, asarTotals);
    problems.push(...ceilingProblems(asarTotals, config.scriptRanges, relativePosix(appOutDir, archivePath)));
    scanUnpackedMarkers(archivePath, appOutDir, config, problems, seen);
  }
  let resourceDirs = [];
  try {
    resourceDirs = findResourceDirs(appOutDir);
  } catch (err) {
    problems.push(err.message);
  }
  for (const resourceDir of resourceDirs) {
    try {
      scanResourceMarkers(resourceDir, appOutDir, config, problems, seen);
    } catch (err) {
      problems.push(err.message);
    }
  }
  return { problems, totals };
}

async function afterPack(context) {
  const appOutDir = context && context.appOutDir;
  if (!appOutDir || typeof appOutDir !== 'string') {
    throw new Error('deny check: missing appOutDir');
  }
  const config = loadDenyConfig();
  const result = scanAppOut(appOutDir, config);
  if (result.problems.length > 0) {
    throw new Error(result.problems.join('\n'));
  }
}

module.exports = afterPack;
module.exports.loadDenyConfig = loadDenyConfig;
module.exports.readDenyJson = readDenyJson;
module.exports.scanBundle = scanBundle;
module.exports.scanAppOut = scanAppOut;
module.exports.countScripts = countScripts;
