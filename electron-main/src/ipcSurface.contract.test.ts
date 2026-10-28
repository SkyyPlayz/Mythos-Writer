// S04 — preload ↔ main IPC surface lock.
//
// Scans source text (never db.ts) and freezes today's drift. The allowlist is
// 3 + 2 + 4 = 9:
//   3 renderer requests with no main handler (1 invoke + 2 sends)
//   2 renderer listeners with no main push
//   4 main pushes with no renderer listener
//
// Push counter: unique channels among resolved `.send` arguments in main
// (string literal, same-file const, or imported CONST.PROP). That is the
// 56-count. Following a same-file helper that `.send`s its parameter
// (ai-activity update/terminal) is the other method and yields 58. Listeners
// for those two helper channels are matched. push-without-listener walks the
// combined set (direct sends ∪ helper sends), so dropping either listener is
// a new gap.
//
// Census counts are a summary. The lock is the exact sorted name lists
// (IPC channel values, handlers, main listeners, push channels), the sorted
// exposeInMainWorld key → channel snapshot, and the handler ↔ preload invoke
// map in both directions.
//
// Exact equality: a new gap fails, and an allowlist entry whose gap was fixed
// fails until this list shrinks. Paired channels do not need a new test file;
// update the frozen lists when the surface grows without a new gap.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

const PUSH_COUNTER = 'resolved-send-arguments' as const;

type GapKind =
  | 'preload-invoke-without-handler'
  | 'preload-send-without-handler'
  | 'listener-without-push'
  | 'push-without-listener';

interface Gap {
  kind: GapKind;
  channel: string;
}

/** Frozen at main d90cbd05. Order is kind, then channel. */
const ALLOWLIST: readonly Gap[] = [
  { kind: 'listener-without-push', channel: 'stt:result' },
  { kind: 'listener-without-push', channel: 'vault:obsidian:import:progress' },
  { kind: 'preload-invoke-without-handler', channel: 'writing-assistant:set-active-scene' },
  { kind: 'preload-send-without-handler', channel: 'stt:start' },
  { kind: 'preload-send-without-handler', channel: 'stt:stop' },
  { kind: 'push-without-listener', channel: 'agent:archive:chunk' },
  { kind: 'push-without-listener', channel: 'agent:archive:error' },
  { kind: 'push-without-listener', channel: 'agent:archive:stream-start' },
  { kind: 'push-without-listener', channel: 'vault:changed' },
];

const CENSUS = {
  pushCounter: PUSH_COUNTER,
  ipcChannelKeys: 414,
  handlerChannels: 393,
  mainListenerChannels: 10,
  directSendChannels: 56,
  helperSendChannels: 58,
  allowlist: 9,
} as const;

interface SourceFile {
  rel: string;
  text: string;
}

interface Surface {
  opened: string[];
  gaps: Gap[];
  census: {
    pushCounter: typeof PUSH_COUNTER;
    ipcChannelKeys: number;
    handlerChannels: number;
    mainListenerChannels: number;
    directSendChannels: number;
    helperSendChannels: number;
    allowlist: number;
  };
  /** Exact sorted channel-name lists. Counts above are the lengths (pushes = combined). */
  names: {
    ipcChannels: string[];
    handlers: string[];
    mainListeners: string[];
    pushChannels: string[];
  };
  /** `world key channels|NON_IPC`, sorted. One line per exposeInMainWorld key. */
  exposed: string[];
  /**
   * Handler → preload invoke, both directions, sorted.
   * `channel <- key,key` or `channel <- NONE` for every ipcMain handler.
   * `channel -> HANDLER` or `channel -> NO_HANDLER` for every preload invoke.
   */
  handlerToInvoke: string[];
  invokeToHandler: string[];
}

const NON_IPC = 'NON_IPC';

function gapKey(gap: Gap): string {
  switch (gap.kind) {
    case 'listener-without-push':
    case 'preload-invoke-without-handler':
    case 'preload-send-without-handler':
    case 'push-without-listener':
      return `${gap.kind} ${gap.channel}`;
    default: {
      const neverKind: never = gap.kind;
      return neverKind;
    }
  }
}

function driftReport(found: readonly Gap[], allowlist: readonly Gap[]): string[] {
  const foundKeys = new Set(found.map(gapKey));
  const allowKeys = new Set(allowlist.map(gapKey));
  const lines: string[] = [];
  for (const key of [...foundKeys].sort()) {
    if (!allowKeys.has(key)) lines.push(`new gap not in allowlist: ${key}`);
  }
  for (const key of [...allowKeys].sort()) {
    if (!foundKeys.has(key)) lines.push(`allowlist entry whose gap was fixed: ${key}`);
  }
  return lines;
}

function isSkippedSource(rel: string): boolean {
  const base = path.basename(rel);
  if (base === 'db.ts') return true;
  if (base.endsWith('.d.ts')) return true;
  if (base.includes('.test.') || base.includes('.spec.') || base.includes('.bench.')) return true;
  return false;
}

function walkSources(dir: string, relDir: string, out: string[]): void {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = relDir ? path.join(relDir, ent.name) : ent.name;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkSources(abs, rel, out);
      continue;
    }
    if (!ent.isFile() || !ent.name.endsWith('.ts')) continue;
    if (path.basename(rel) === 'db.ts') continue;
    if (isSkippedSource(rel)) continue;
    out.push(rel);
  }
}

function readProductionSources(root: string): SourceFile[] {
  const rels: string[] = [];
  walkSources(root, '', rels);
  return rels.map((rel) => {
    if (path.basename(rel) === 'db.ts') {
      throw new Error('ipc surface scan must not open db.ts');
    }
    return { rel, text: fs.readFileSync(path.join(root, rel), 'utf8') };
  });
}

function newlinePositions(src: string): number[] {
  const newlines: number[] = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\n') newlines.push(i);
  }
  return newlines;
}

/** 1-based line of `index`. `newlines` holds every `\n` index in the same source. */
function lineAt(newlines: readonly number[], index: number): number {
  let lo = 0;
  let hi = newlines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (newlines[mid] < index) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}

function skipString(src: string, i: number): number {
  const quote = src[i];
  i++;
  if (quote === '`') {
    while (i < src.length) {
      if (src[i] === '\\') {
        i += 2;
        continue;
      }
      if (src[i] === '`') return i + 1;
      if (src[i] === '$' && src[i + 1] === '{') {
        i += 2;
        let depth = 1;
        while (i < src.length && depth > 0) {
          const c = src[i];
          if (c === "'" || c === '"' || c === '`') {
            i = skipString(src, i);
            continue;
          }
          if (c === '{') depth++;
          else if (c === '}') depth--;
          if (depth > 0) i++;
          else i++;
        }
        continue;
      }
      i++;
    }
    return i;
  }
  while (i < src.length) {
    if (src[i] === '\\') {
      i += 2;
      continue;
    }
    if (src[i] === quote) return i + 1;
    i++;
  }
  return i;
}

/** Comments become spaces; strings and newlines stay so indexes still line up. */
function maskComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "'" || c === '"' || c === '`') {
      const end = skipString(src, i);
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && n === '*') {
      out += '  ';
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < src.length) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

type Resolved =
  | { kind: 'string'; value: string }
  | { kind: 'strings'; values: string[] }
  | { kind: 'object'; props: Map<string, string> }
  | { kind: 'unresolved' };

interface Binding {
  line: number;
  value: Resolved;
}

interface ModuleInfo {
  rel: string;
  src: string;
  newlines: number[];
  strings: Map<string, Binding[]>;
  objects: Map<string, Binding[]>;
  imports: Map<string, { from: string; exported: string }>;
}

function resolveModule(fromRel: string, spec: string, byRel: Map<string, ModuleInfo>): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.normalize(path.join(path.dirname(fromRel), spec));
  const candidates = [base, `${base}.ts`, path.join(base, 'index.ts')];
  for (const candidate of candidates) {
    const rel = candidate.split(path.sep).join('/');
    if (byRel.has(rel)) return rel;
    const ts = rel.endsWith('.js') ? `${rel.slice(0, -3)}.ts` : null;
    if (ts && byRel.has(ts)) return ts;
  }
  // spec './ipc.js' → dirname + ipc.ts, path.normalize may keep .js
  const noExt = base.replace(/\.js$/, '');
  const asTs = `${noExt}.ts`.split(path.sep).join('/');
  if (byRel.has(asTs)) return asTs;
  return null;
}

function parseStringLiteral(text: string): string | null {
  const trimmed = text.trim().replace(/\s+as\s+const\s*$/, '').trim();
  const single = trimmed.match(/^'([^'\\]|\\.)*'$/);
  const double = trimmed.match(/^"([^"\\]|\\.)*"$/);
  const matched = single ?? double;
  if (!matched) return null;
  const body = trimmed.slice(1, -1);
  return body.replace(/\\(.)/g, '$1');
}

function readBalanced(src: string, openIndex: number, open: string, close: string): string | null {
  if (src[openIndex] !== open) return null;
  let depth = 0;
  for (let i = openIndex; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(src, i) - 1;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return src.slice(openIndex, i + 1);
    }
  }
  return null;
}

function objectProps(body: string, lookup: (name: string) => string | null): Map<string, string> {
  const props = new Map<string, string>();
  let i = 0;
  let depth = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(body, i);
      continue;
    }
    if (c === '{') {
      depth++;
      i++;
      continue;
    }
    if (c === '}') {
      depth--;
      i++;
      continue;
    }
    if (depth === 1 && /[A-Za-z_$]/.test(c)) {
      const start = i;
      while (i < body.length && /[A-Za-z0-9_$]/.test(body[i])) i++;
      const name = body.slice(start, i);
      while (i < body.length && /\s/.test(body[i])) i++;
      if (body[i] !== ':') continue;
      i++;
      while (i < body.length && /\s/.test(body[i])) i++;
      const valueStart = i;
      let valueDepth = 0;
      while (i < body.length) {
        const ch = body[i];
        if (ch === "'" || ch === '"' || ch === '`') {
          i = skipString(body, i);
          continue;
        }
        if (ch === '{' || ch === '(' || ch === '[') valueDepth++;
        else if (ch === '}' || ch === ')' || ch === ']') {
          if (valueDepth === 0) break;
          valueDepth--;
        } else if (ch === ',' && valueDepth === 0) break;
        i++;
      }
      const raw = body.slice(valueStart, i).trim().replace(/\s+as\s+const\s*$/, '').trim();
      const literal = parseStringLiteral(raw);
      const ident = raw.match(/^[A-Za-z_$][A-Za-z0-9_$]*$/);
      const resolved = literal ?? (ident ? lookup(ident[0]) : null);
      if (resolved != null) props.set(name, resolved);
      continue;
    }
    i++;
  }
  return props;
}

function collectModules(files: readonly SourceFile[]): Map<string, ModuleInfo> {
  const byRel = new Map<string, ModuleInfo>();
  for (const file of files) {
    const src = maskComments(file.text);
    const info: ModuleInfo = {
      rel: file.rel.split(path.sep).join('/'),
      src,
      newlines: newlinePositions(src),
      strings: new Map(),
      objects: new Map(),
      imports: new Map(),
    };
    const decl = /(?:^|\n)\s*(export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=]+)?=\s*/g;
    let match: RegExpExecArray | null;
    while ((match = decl.exec(src))) {
      const name = match[2];
      const at = match.index + match[0].length;
      const line = lineAt(info.newlines, match.index);
      if (src[at] === "'" || src[at] === '"') {
        const end = skipString(src, at);
        const literal = parseStringLiteral(src.slice(at, end));
        if (literal == null) continue;
        const list = info.strings.get(name) ?? [];
        list.push({ line, value: { kind: 'string', value: literal } });
        info.strings.set(name, list);
      } else if (src[at] === '{') {
        const body = readBalanced(src, at, '{', '}');
        if (!body) continue;
        const list = info.objects.get(name) ?? [];
        list.push({ line, value: { kind: 'object', props: new Map() } });
        info.objects.set(name, list);
        // props filled after string consts in this file exist
        const binding = list[list.length - 1];
        binding.value = {
          kind: 'object',
          props: objectProps(body, (ident) => {
            const hits = info.strings.get(ident);
            if (!hits || hits.length === 0) return null;
            const prior = hits.filter((hit) => hit.line <= line);
            const chosen = (prior.length > 0 ? prior : hits)[prior.length > 0 ? prior.length - 1 : hits.length - 1];
            return chosen.value.kind === 'string' ? chosen.value.value : null;
          }),
        };
      }
    }
    const importRe = /import\s+(type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
    while ((match = importRe.exec(src))) {
      if (match[1]) continue;
      const spec = match[3];
      for (const part of match[2].split(',')) {
        const piece = part.trim();
        if (!piece || piece.startsWith('type ')) continue;
        const alias = piece.match(/^(?:type\s+)?([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?$/);
        if (!alias) continue;
        const exported = alias[1];
        const local = alias[2] ?? alias[1];
        info.imports.set(local, { from: spec, exported });
      }
    }
    byRel.set(info.rel, info);
  }
  return byRel;
}

function bindingValue(info: ModuleInfo, name: string, line: number, byRel: Map<string, ModuleInfo>, depth: number): Resolved {
  if (depth > 6) return { kind: 'unresolved' };
  const strings = (info.strings.get(name) ?? []).filter((hit) => hit.line <= line);
  const objects = (info.objects.get(name) ?? []).filter((hit) => hit.line <= line);
  const stringHit = strings.length > 0 ? strings[strings.length - 1] : undefined;
  const objectHit = objects.length > 0 ? objects[objects.length - 1] : undefined;
  if (stringHit && (!objectHit || stringHit.line >= objectHit.line)) return stringHit.value;
  if (objectHit) return objectHit.value;
  const imported = info.imports.get(name);
  if (!imported) return { kind: 'unresolved' };
  const targetRel = resolveModule(info.rel, imported.from, byRel);
  if (!targetRel) return { kind: 'unresolved' };
  const target = byRel.get(targetRel);
  if (!target) return { kind: 'unresolved' };
  return bindingValue(target, imported.exported, Number.MAX_SAFE_INTEGER, byRel, depth + 1);
}

function forOfStrings(src: string, name: string, at: number): string[] | null {
  const upto = src.slice(0, at);
  const re = new RegExp(`for\\s*\\(\\s*const\\s+${name}\\s+of\\s*\\[([\\s\\S]*?)\\]\\s*(?:as\\s+const\\s*)?\\)`, 'g');
  let match: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((match = re.exec(upto))) last = match;
  if (!last) return null;
  const values = [...last[1].matchAll(/'([^'\\]*)'|"([^"\\]*)"/g)].map((hit) => hit[1] ?? hit[2] ?? '');
  return values.length > 0 ? values : null;
}

function resolveArg(info: ModuleInfo, arg: string, at: number, byRel: Map<string, ModuleInfo>): string[] | null {
  const trimmed = arg.trim().replace(/\s+as\s+const\s*$/, '').trim();
  const literal = parseStringLiteral(trimmed);
  if (literal != null) return [literal];
  const member = trimmed.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)$/);
  if (member) {
    const obj = bindingValue(info, member[1], lineAt(info.newlines, at), byRel, 0);
    if (obj.kind === 'object') {
      const value = obj.props.get(member[2]);
      if (value != null) return [value];
    }
    return null;
  }
  const ident = trimmed.match(/^([A-Za-z_$][A-Za-z0-9_$]*)$/);
  if (!ident) return null;
  const loop = forOfStrings(info.src, ident[1], at);
  if (loop) return loop;
  const bound = bindingValue(info, ident[1], lineAt(info.newlines, at), byRel, 0);
  if (bound.kind === 'string') return [bound.value];
  if (bound.kind === 'strings') return bound.values;
  return null;
}

function callArgs(src: string, pattern: RegExp): { arg: string; at: number }[] {
  const out: { arg: string; at: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(src))) {
    const at = match.index + match[0].length;
    let i = at;
    let paren = 0;
    let brace = 0;
    let bracket = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === "'" || c === '"' || c === '`') {
        i = skipString(src, i);
        continue;
      }
      if (c === '(') paren++;
      else if (c === ')') {
        if (paren === 0 && brace === 0 && bracket === 0) break;
        paren--;
      } else if (c === '{') brace++;
      else if (c === '}') brace--;
      else if (c === '[') bracket++;
      else if (c === ']') bracket--;
      else if (c === ',' && paren === 0 && brace === 0 && bracket === 0) break;
      i++;
    }
    out.push({ arg: src.slice(at, i), at });
  }
  return out;
}

function addResolved(target: Set<string>, values: string[] | null): void {
  if (!values) return;
  for (const value of values) target.add(value);
}

function handlerObjectChannels(info: ModuleInfo, byRel: Map<string, ModuleInfo>): Set<string> {
  const channels = new Set<string>();
  // Regexes inside handler bodies contain `{` / `}`, so a brace walk of this
  // object does not close. Every handlers-table key is a column-indented
  // `[CONST.PROP]` line, and the table itself ends at the next column-0 `};`.
  const marker = /const\s+handlers\s*:\s*IpcHandlers\s*=\s*\{/;
  const found = marker.exec(info.src);
  if (!found) return channels;
  const end = info.src.indexOf('\n};', found.index);
  if (end < 0) return channels;
  const region = info.src.slice(found.index, end);
  const keyRe = /^\s*\[([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)\]/gm;
  let match: RegExpExecArray | null;
  while ((match = keyRe.exec(region))) {
    const at = found.index + match.index;
    addResolved(channels, resolveArg(info, `${match[1]}.${match[2]}`, at, byRel));
  }
  return channels;
}

function readArg(src: string, at: number): string {
  let i = at;
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(src, i);
      continue;
    }
    if (c === '(') paren++;
    else if (c === ')') {
      if (paren === 0 && brace === 0 && bracket === 0) break;
      paren--;
    } else if (c === '{') brace++;
    else if (c === '}') brace--;
    else if (c === '[') bracket++;
    else if (c === ']') bracket--;
    else if (c === ',' && paren === 0 && brace === 0 && bracket === 0) break;
    i++;
  }
  return src.slice(at, i);
}

function firstCallArg(src: string, openParen: number): { arg: string; at: number } | null {
  if (src[openParen] !== '(') return null;
  return { arg: readArg(src, openParen + 1), at: openParen + 1 };
}

function helperSendChannels(info: ModuleInfo, byRel: Map<string, ModuleInfo>): Set<string> {
  const extra = new Set<string>();
  const fnRe = /function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
  let match: RegExpExecArray | null;
  while ((match = fnRe.exec(info.src))) {
    const name = match[1];
    const param = match[2];
    const open = info.src.indexOf('{', match.index + match[0].length);
    if (open < 0) continue;
    const body = readBalanced(info.src, open, '{', '}');
    if (!body) continue;
    const sendsParam = new RegExp(`\\.send\\(\\s*${param}\\b`).test(body);
    if (!sendsParam) continue;
    const bodyEnd = open + body.length;
    const callRe = new RegExp(`(?:^|[^A-Za-z0-9_$])${name}\\(`, 'g');
    let call: RegExpExecArray | null;
    while ((call = callRe.exec(info.src))) {
      const openParen = call.index + call[0].length - 1;
      const argAt = openParen + 1;
      if (argAt > open && argAt < bodyEnd) continue;
      const parsed = firstCallArg(info.src, openParen);
      if (!parsed) continue;
      addResolved(extra, resolveArg(info, parsed.arg, parsed.at, byRel));
    }
  }
  return extra;
}

function sortedSet(values: Iterable<string>): string[] {
  return [...values].sort();
}

function channelsIn(value: string): string[] {
  const found = new Set<string>();
  const re = /(?:ipcRenderer\.(?:invoke|send|on)|invokeEnvelope)\(\s*(['"])([^'"\\]*)\1/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value))) found.add(match[2]);
  return [...found].sort();
}

/** One sorted line per key of each contextBridge.exposeInMainWorld object. */
function exposedLines(src: string): string[] {
  const lines: string[] = [];
  const callRe = /contextBridge\.exposeInMainWorld\(\s*/g;
  let match: RegExpExecArray | null;
  while ((match = callRe.exec(src))) {
    const nameArg = readArg(src, match.index + match[0].length);
    const world = parseStringLiteral(nameArg);
    if (!world) continue;
    const afterName = match.index + match[0].length + nameArg.length;
    const brace = src.indexOf('{', afterName);
    if (brace < 0) continue;
    const body = readBalanced(src, brace, '{', '}');
    if (!body) continue;
    collectExposedKeys(body, world, '', lines);
  }
  lines.sort();
  return lines;
}

function collectExposedKeys(body: string, world: string, prefix: string, lines: string[]): void {
  let i = 1;
  const end = body.length - 1;
  while (i < end) {
    while (i < end && /[\s,]/.test(body[i])) i++;
    if (i >= end) break;
    let key = '';
    if (body[i] === "'" || body[i] === '"') {
      const keyEnd = skipString(body, i);
      key = parseStringLiteral(body.slice(i, keyEnd)) ?? '';
      i = keyEnd;
    } else if (/[A-Za-z_$]/.test(body[i])) {
      const start = i;
      while (i < end && /[A-Za-z0-9_$]/.test(body[i])) i++;
      key = body.slice(start, i);
    } else {
      i++;
      continue;
    }
    while (i < end && /\s/.test(body[i])) i++;
    if (body[i] !== ':') continue;
    i++;
    while (i < end && /\s/.test(body[i])) i++;
    const valueStart = i;
    let depth = 0;
    let angle = 0;
    while (i < end) {
      const ch = body[i];
      if (ch === "'" || ch === '"' || ch === '`') {
        i = skipString(body, i);
        continue;
      }
      if (ch === '{' || ch === '(' || ch === '[') depth++;
      else if (ch === '}' || ch === ')' || ch === ']') {
        if (depth === 0) break;
        depth--;
      } else if (ch === '<') {
        if (body[i - 1] !== '=') angle++;
      } else if (ch === '>') {
        if (body[i - 1] !== '=' && angle > 0) angle--;
      } else if (ch === ',' && depth === 0 && angle === 0) break;
      i++;
    }
    const value = body.slice(valueStart, i);
    const pathKey = prefix ? `${prefix}.${key}` : key;
    const trimmed = value.trim();
    if (trimmed.startsWith('{')) {
      const nested = readBalanced(value, value.indexOf('{'), '{', '}');
      if (nested && nested.trim() === trimmed) {
        collectExposedKeys(nested, world, pathKey, lines);
        continue;
      }
    }
    const channels = channelsIn(value);
    lines.push(channels.length === 0 ? `${world} ${pathKey} ${NON_IPC}` : `${world} ${pathKey} ${channels.join(',')}`);
  }
}

function exposedKeysByChannel(exposed: readonly string[]): Map<string, string[]> {
  const byChannel = new Map<string, string[]>();
  for (const line of exposed) {
    const parts = line.split(' ');
    if (parts.length !== 3 || parts[2] === NON_IPC) continue;
    const key = `${parts[0]}.${parts[1]}`;
    for (const channel of parts[2].split(',')) {
      const list = byChannel.get(channel) ?? [];
      list.push(key);
      byChannel.set(channel, list);
    }
  }
  for (const list of byChannel.values()) list.sort();
  return byChannel;
}

function handlerInvokeLines(handlers: readonly string[], exposed: readonly string[]): string[] {
  const byChannel = exposedKeysByChannel(exposed);
  return handlers.map((channel) => {
    const keys = byChannel.get(channel) ?? [];
    return keys.length > 0 ? `${channel} <- ${keys.join(',')}` : `${channel} <- NONE`;
  });
}

function invokeHandlerLines(invokes: readonly string[], handlers: ReadonlySet<string>): string[] {
  return invokes.map((channel) => `${channel} -> ${handlers.has(channel) ? 'HANDLER' : 'NO_HANDLER'}`);
}

function scanSources(files: readonly SourceFile[]): Surface {
  for (const file of files) {
    if (path.basename(file.rel) === 'db.ts' || file.rel.split(path.sep).join('/').endsWith('/db.ts')) {
      throw new Error('ipc surface scan must not open db.ts');
    }
  }
  const byRel = collectModules(files);
  const preload = byRel.get('preload.ts');
  if (!preload) throw new Error('preload.ts missing from ipc surface scan');

  const invokes = new Set<string>();
  const preloadSends = new Set<string>();
  const listeners = new Set<string>();
  for (const call of callArgs(preload.src, /ipcRenderer\.invoke\(\s*/g)) {
    addResolved(invokes, resolveArg(preload, call.arg, call.at, byRel));
  }
  for (const call of callArgs(preload.src, /invokeEnvelope\(\s*/g)) {
    addResolved(invokes, resolveArg(preload, call.arg, call.at, byRel));
  }
  for (const call of callArgs(preload.src, /ipcRenderer\.send\(\s*/g)) {
    addResolved(preloadSends, resolveArg(preload, call.arg, call.at, byRel));
  }
  for (const call of callArgs(preload.src, /ipcRenderer\.on\(\s*/g)) {
    addResolved(listeners, resolveArg(preload, call.arg, call.at, byRel));
  }

  const handlers = new Set<string>();
  const mainListeners = new Set<string>();
  const directPushes = new Set<string>();
  const helperPushes = new Set<string>();
  const ipcChannelNames: string[] = [];
  let ipcChannelKeys = 0;

  for (const info of byRel.values()) {
    if (info.rel === 'preload.ts') continue;
    for (const call of callArgs(info.src, /ipcMain\.handle\(\s*/g)) {
      addResolved(handlers, resolveArg(info, call.arg, call.at, byRel));
    }
    for (const call of callArgs(info.src, /ipcMain\.on\(\s*/g)) {
      addResolved(mainListeners, resolveArg(info, call.arg, call.at, byRel));
    }
    for (const call of callArgs(info.src, /ipcMain\.once\(\s*/g)) {
      addResolved(mainListeners, resolveArg(info, call.arg, call.at, byRel));
    }
    for (const call of callArgs(info.src, /\.send\(\s*/g)) {
      addResolved(directPushes, resolveArg(info, call.arg, call.at, byRel));
    }
    for (const channel of handlerObjectChannels(info, byRel)) handlers.add(channel);
    for (const channel of helperSendChannels(info, byRel)) helperPushes.add(channel);
    const ipcChannels = info.objects.get('IPC_CHANNELS');
    if (ipcChannels) {
      for (const binding of ipcChannels) {
        if (binding.value.kind === 'object') {
          ipcChannelKeys += binding.value.props.size;
          for (const value of binding.value.props.values()) ipcChannelNames.push(value);
        }
      }
    }
  }

  const pushCoverage = new Set<string>([...directPushes, ...helperPushes]);
  const gaps: Gap[] = [];
  for (const channel of [...invokes].sort()) {
    if (!handlers.has(channel)) gaps.push({ kind: 'preload-invoke-without-handler', channel });
  }
  for (const channel of [...preloadSends].sort()) {
    if (!mainListeners.has(channel)) gaps.push({ kind: 'preload-send-without-handler', channel });
  }
  for (const channel of [...listeners].sort()) {
    if (!pushCoverage.has(channel)) gaps.push({ kind: 'listener-without-push', channel });
  }
  // Combined set: direct `.send` arguments and helper sends (ai-activity:*).
  for (const channel of [...pushCoverage].sort()) {
    if (!listeners.has(channel)) gaps.push({ kind: 'push-without-listener', channel });
  }
  gaps.sort((a, b) => gapKey(a).localeCompare(gapKey(b)));

  const handlerNames = sortedSet(handlers);
  const invokeNames = sortedSet(invokes);
  const exposed = exposedLines(preload.src);
  ipcChannelNames.sort();

  return {
    opened: [...byRel.keys()].sort(),
    gaps,
    census: {
      pushCounter: PUSH_COUNTER,
      ipcChannelKeys,
      handlerChannels: handlers.size,
      mainListenerChannels: mainListeners.size,
      directSendChannels: directPushes.size,
      helperSendChannels: pushCoverage.size,
      allowlist: gaps.length,
    },
    names: {
      ipcChannels: ipcChannelNames,
      handlers: handlerNames,
      mainListeners: sortedSet(mainListeners),
      pushChannels: sortedSet(pushCoverage),
    },
    exposed,
    handlerToInvoke: handlerInvokeLines(handlerNames, exposed),
    invokeToHandler: invokeHandlerLines(invokeNames, handlers),
  };
}

function loadSurface(): Surface {
  return scanSources(readProductionSources(SRC_DIR));
}

interface SurfaceFreeze {
  names: Surface['names'];
  exposed: string[];
  handlerToInvoke: string[];
  invokeToHandler: string[];
}

const FREEZE = JSON.parse(
  fs.readFileSync(path.join(SRC_DIR, 'ipcSurface.contract.freeze.json'), 'utf8'),
) as SurfaceFreeze;

function productionCopies(): SourceFile[] {
  return readProductionSources(SRC_DIR).map((file) => ({ rel: file.rel, text: file.text }));
}

function sourceFile(files: readonly SourceFile[], relSuffix: string): SourceFile {
  const rel = relSuffix.split(path.sep).join('/');
  const found = files.find((file) => {
    const posix = file.rel.split(path.sep).join('/');
    return posix === rel || posix.endsWith(`/${rel}`);
  });
  if (!found) throw new Error(`${relSuffix} missing from ipc surface scan`);
  return found;
}

function swapQuoted(text: string, left: string, right: string): string {
  const token = '\u0000swap\u0000';
  return text.split(left).join(token).split(right).join(left).split(token).join(right);
}

const surface = loadSurface();

describe('ipc surface contract', () => {
  it('does not open db.ts', () => {
    expect(surface.opened.some((rel) => rel === 'db.ts' || rel.endsWith('/db.ts'))).toBe(false);
    expect(surface.opened).toContain('preload.ts');
    expect(surface.opened).toContain('main.ts');
    expect(() => scanSources([{ rel: 'db.ts', text: "ipcRenderer.invoke('nope')" }])).toThrow(/must not open db\.ts/);
  });

  it('counts resolved .send arguments (56), not the helper-following count (58)', () => {
    expect(surface.census).toEqual(CENSUS);
  });

  it('freezes the 3 + 2 + 4 allowlist', () => {
    const unhandled = surface.gaps.filter(
      (gap) => gap.kind === 'preload-invoke-without-handler' || gap.kind === 'preload-send-without-handler',
    );
    expect(unhandled).toHaveLength(3);
    expect(surface.gaps.filter((gap) => gap.kind === 'listener-without-push')).toHaveLength(2);
    expect(surface.gaps.filter((gap) => gap.kind === 'push-without-listener')).toHaveLength(4);
    expect(driftReport(surface.gaps, ALLOWLIST)).toEqual([]);
    expect(surface.gaps.map(gapKey)).toEqual(ALLOWLIST.map(gapKey));
  });

  it('a preload invoke with no handler is a new gap', () => {
    const files = readProductionSources(SRC_DIR);
    const preload = files.find((file) => file.rel.split(path.sep).join('/') === 'preload.ts');
    if (!preload) throw new Error('preload.ts missing');
    preload.text += "\nipcRenderer.invoke('mutant:no-handler');\n";
    const mutated = scanSources(files);
    expect(driftReport(mutated.gaps, ALLOWLIST)).toEqual([
      'new gap not in allowlist: preload-invoke-without-handler mutant:no-handler',
    ]);
  });

  it('pins exposed keys, channel names, and the handler ↔ invoke map', () => {
    expect(surface.names).toEqual(FREEZE.names);
    expect(surface.exposed).toEqual(FREEZE.exposed);
    expect(surface.handlerToInvoke).toEqual(FREEZE.handlerToInvoke);
    expect(surface.invokeToHandler).toEqual(FREEZE.invokeToHandler);
    expect(surface.names.ipcChannels).toHaveLength(surface.census.ipcChannelKeys);
    expect(surface.names.handlers).toHaveLength(surface.census.handlerChannels);
    expect(surface.names.mainListeners).toHaveLength(surface.census.mainListenerChannels);
    expect(surface.names.pushChannels).toHaveLength(surface.census.helperSendChannels);
    expect(surface.census.directSendChannels).toBe(56);
    expect(surface.exposed.filter((line) => line.endsWith(` ${NON_IPC}`))).toEqual(['api isPackaged NON_IPC']);
  });

  it('goes red when a new exposeInMainWorld key aliases an existing channel', () => {
    const files = productionCopies();
    const preload = sourceFile(files, 'preload.ts');
    const anchor = "isPackaged: process.env.MYTHOS_IS_PACKAGED === '1',";
    expect(preload.text.includes(anchor)).toBe(true);
    preload.text = preload.text.replace(
      anchor,
      `aliasRead: () => ipcRenderer.invoke('vault:read', { path: '' }),\n  ${anchor}`,
    );
    const mutated = scanSources(files);
    const added = mutated.exposed.filter((line) => !surface.exposed.includes(line));
    expect(mutated.exposed).not.toEqual(FREEZE.exposed);
    expect(added).toEqual(['api aliasRead vault:read']);
    console.log(`[mutant alias] RED ${added.join(', ')}`);
  });

  it("goes red when an exposeInMainWorld key is not IPC, such as require('fs')", () => {
    const files = productionCopies();
    const preload = sourceFile(files, 'preload.ts');
    const anchor = "isPackaged: process.env.MYTHOS_IS_PACKAGED === '1',";
    preload.text = preload.text.replace(anchor, `fs: require('fs'),\n  ${anchor}`);
    const mutated = scanSources(files);
    const added = mutated.exposed.filter((line) => !surface.exposed.includes(line));
    expect(mutated.exposed).not.toEqual(FREEZE.exposed);
    expect(added).toEqual([`api fs ${NON_IPC}`]);
    console.log(`[mutant fs] RED ${added.join(', ')}`);
  });

  it('goes red when a channel is renamed even though the counts stay the same', () => {
    const files = productionCopies();
    const ipc = sourceFile(files, 'ipc.ts');
    const from = "VAULT_READ: 'vault:read'";
    expect(ipc.text.includes(from)).toBe(true);
    ipc.text = ipc.text.replace(from, "VAULT_READ: 'vault:read-renamed'");
    const mutated = scanSources(files);
    expect(mutated.census.ipcChannelKeys).toBe(surface.census.ipcChannelKeys);
    expect(mutated.census.handlerChannels).toBe(surface.census.handlerChannels);
    expect(mutated.names.ipcChannels).not.toEqual(FREEZE.names.ipcChannels);
    expect(mutated.names.handlers).not.toEqual(FREEZE.names.handlers);
    expect(mutated.names.ipcChannels).toContain('vault:read-renamed');
    expect(mutated.names.ipcChannels).not.toContain('vault:read');
    expect(mutated.names.handlers).toContain('vault:read-renamed');
    expect(mutated.names.handlers).not.toContain('vault:read');
    console.log('[mutant rename] RED vault:read -> vault:read-renamed in ipc channel names and handlers; counts unchanged');
  });

  it('goes red when a handler channel and a push channel are swapped', () => {
    const files = productionCopies();
    for (const file of files) file.text = swapQuoted(file.text, "'vault:read'", "'vault:changed'");
    const mutated = scanSources(files);
    expect(mutated.census.ipcChannelKeys).toBe(surface.census.ipcChannelKeys);
    expect(mutated.census.handlerChannels).toBe(surface.census.handlerChannels);
    expect(mutated.census.helperSendChannels).toBe(surface.census.helperSendChannels);
    expect(mutated.census.mainListenerChannels).toBe(surface.census.mainListenerChannels);
    expect(mutated.names.handlers).not.toEqual(FREEZE.names.handlers);
    expect(mutated.names.pushChannels).not.toEqual(FREEZE.names.pushChannels);
    expect(mutated.names.handlers).toContain('vault:changed');
    expect(mutated.names.handlers).not.toContain('vault:read');
    expect(mutated.names.pushChannels).toContain('vault:read');
    expect(mutated.names.pushChannels).not.toContain('vault:changed');
    console.log('[mutant swap] RED handlers lost vault:read gained vault:changed; pushes lost vault:changed gained vault:read; counts unchanged');
  });

  it('goes red when the ai-activity:update preload listener is removed', () => {
    const files = productionCopies();
    const preload = sourceFile(files, 'preload.ts');
    const needle = "ipcRenderer.on('ai-activity:update', handler);";
    expect(preload.text.includes(needle)).toBe(true);
    preload.text = preload.text.replace(needle, '/* listener removed */;');
    const mutated = scanSources(files);
    const report = driftReport(mutated.gaps, ALLOWLIST);
    expect(report).toEqual([
      'new gap not in allowlist: push-without-listener ai-activity:update',
    ]);
    console.log(`[mutant ai-activity:update] RED ${report.join('; ')}`);
  });

  it('goes red when the ai-activity:terminal preload listener is removed', () => {
    const files = productionCopies();
    const preload = sourceFile(files, 'preload.ts');
    const needle = "ipcRenderer.on('ai-activity:terminal', handler);";
    expect(preload.text.includes(needle)).toBe(true);
    preload.text = preload.text.replace(needle, '/* listener removed */;');
    const mutated = scanSources(files);
    const report = driftReport(mutated.gaps, ALLOWLIST);
    expect(report).toEqual([
      'new gap not in allowlist: push-without-listener ai-activity:terminal',
    ]);
    console.log(`[mutant ai-activity:terminal] RED ${report.join('; ')}`);
  });

  it('goes red when an ipcMain handler has no matching preload invoke', () => {
    const files = productionCopies();
    const preload = sourceFile(files, 'preload.ts');
    const needle = "ipcRenderer.invoke('vault:read'";
    expect(preload.text.split(needle).length - 1).toBe(2);
    preload.text = preload.text.split(needle).join("ipcRenderer.invoke('vault:read-removed'");
    const mutated = scanSources(files);
    expect(surface.handlerToInvoke).toContain('vault:read <- api.readVault,mythosIPC.readVaultFile');
    expect(surface.invokeToHandler).toContain('vault:read -> HANDLER');
    expect(mutated.handlerToInvoke).toContain('vault:read <- NONE');
    expect(mutated.handlerToInvoke).not.toEqual(FREEZE.handlerToInvoke);
    expect(mutated.invokeToHandler).not.toContain('vault:read -> HANDLER');
    expect(mutated.invokeToHandler).toContain('vault:read-removed -> NO_HANDLER');
    expect(mutated.invokeToHandler).not.toEqual(FREEZE.invokeToHandler);
    console.log("[mutant vault:read] RED handler 'vault:read <- NONE' (was api.readVault,mythosIPC.readVaultFile); invoke 'vault:read -> HANDLER' gone; 'vault:read-removed -> NO_HANDLER'");
  });

  it('an allowlist entry whose gap was fixed must shrink the list', () => {
    const files = readProductionSources(SRC_DIR);
    const main = files.find((file) => file.rel.split(path.sep).join('/') === 'main.ts');
    if (!main) throw new Error('main.ts missing');
    const before = main.text;
    main.text = main.text.split(".send('vault:changed'").join(".send('vault:file-changed'");
    expect(main.text).not.toBe(before);
    const mutated = scanSources(files);
    expect(mutated.gaps.some((gap) => gap.channel === 'vault:changed')).toBe(false);
    expect(driftReport(mutated.gaps, ALLOWLIST)).toEqual([
      'allowlist entry whose gap was fixed: push-without-listener vault:changed',
    ]);
  });
});
