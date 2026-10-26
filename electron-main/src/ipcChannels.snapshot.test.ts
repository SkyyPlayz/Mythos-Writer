/**
 * S1a IPC channel snapshot. Records today's channel strings from
 * electron-main/src/ipc.ts (IPC_CHANNELS values), electron-main/src/preload.ts
 * (literal ipcRenderer / invokeEnvelope arguments), and ipcMain.handle / ipcMain.on
 * registrations under electron-main/src. Adding, removing, or renaming a channel
 * fails this file's equality check. A non-literal channel argument throws.
 * No channel is added here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.join(SRC_DIR, '__snapshots__', 'ipcChannels.json');

interface IpcChannelSnapshot {
  ipcChannels: string[];
  preloadChannels: string[];
  ipcMainChannels: string[];
  onlyInIpc: string[];
  onlyInPreload: string[];
}

interface MainSource {
  rel: string;
  src: string;
}

/** Code-unit order. localeCompare follows the runner locale and would reshuffle this lock. */
function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
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
          i++;
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

function staticStringValue(raw: string): string | null {
  const text = raw.trim().replace(/\s+as\s+const\s*$/, '').trim();
  if (text.length < 2) return null;
  const quote = text[0];
  if ((quote !== "'" && quote !== '"' && quote !== '`') || text[text.length - 1] !== quote) return null;
  if (quote === '`' && text.includes('${')) return null;
  return text.slice(1, -1).replace(/\\(.)/g, '$1');
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

/** Index of the `{` that opens a function body, after its parameter list and return type. */
function functionBodyOpen(src: string, from: number): number {
  let angle = 0;
  let brace = 0;
  let paren = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(src, i) - 1;
      continue;
    }
    if (c === '<') angle++;
    else if (c === '>' && angle > 0) angle--;
    else if (c === '(') paren++;
    else if (c === ')') paren--;
    else if (c === '{') {
      if (angle === 0 && paren === 0) return i;
      brace++;
    } else if (c === '}' && brace > 0) brace--;
  }
  return -1;
}

function readNthArg(src: string, openParen: number, index: number): string | null {
  let at = openParen + 1;
  for (let n = 0; n <= index; n++) {
    const slice = src.slice(at);
    const arg = callArgs(`_(${slice}`, /_\(\s*/g)[0];
    if (!arg) return null;
    if (n === index) return arg.arg;
    at += arg.arg.length;
    while (at < src.length && /\s/.test(src[at])) at++;
    if (src[at] !== ',') return null;
    at++;
  }
  return null;
}

function parseIpcChannelMap(ipcSrc: string): Map<string, string> {
  const start = ipcSrc.indexOf('export const IPC_CHANNELS = {');
  const end = ipcSrc.indexOf('} as const;', start);
  if (start < 0 || end < 0) throw new Error('IPC_CHANNELS object not found in ipc.ts');
  const map = new Map<string, string>();
  for (const match of ipcSrc.slice(start, end).matchAll(/([A-Za-z0-9_]+)\s*:\s*'([^']+)'/g)) {
    map.set(match[1] ?? '', match[2] ?? '');
  }
  return map;
}

const PRELOAD_CALL = /(?:ipcRenderer\.(?:sendSync|removeListener|invoke|once|send|on)|invokeEnvelope)\(\s*/g;

/** Literal channels passed into a function that forwards `ident` to ipcRenderer. */
function forwardedChannels(src: string, callAt: number, ident: string): string[] | null {
  const fnRe = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = fnRe.exec(src))) {
    const name = match[1];
    const params = match[2].split(',').map((param) => param.trim().split(/[?:=]/)[0]?.trim() ?? '');
    const index = params.indexOf(ident);
    if (index < 0) continue;
    const open = functionBodyOpen(src, match.index + match[0].length);
    if (open < 0) continue;
    const body = readBalanced(src, open, '{', '}');
    if (!body) continue;
    const bodyEnd = open + body.length;
    if (callAt < open || callAt > bodyEnd) continue;
    const callRe = new RegExp(`(?:^|[^A-Za-z0-9_$])${name}\\(`, 'g');
    const found: string[] = [];
    let call: RegExpExecArray | null;
    while ((call = callRe.exec(src))) {
      const paren = call.index + call[0].length - 1;
      const nameStart = paren - name.length;
      if (/\bfunction\s*$/.test(src.slice(Math.max(0, nameStart - 16), nameStart))) continue;
      if (paren > open && paren < bodyEnd) continue;
      const arg = readNthArg(src, paren, index);
      const literal = arg == null ? null : staticStringValue(arg);
      if (literal == null) {
        throw new Error(`non-literal channel argument passed to ${name}: ${(arg ?? '').trim()}`);
      }
      found.push(literal);
    }
    if (found.length === 0) throw new Error(`non-literal channel argument '${ident}' has no literal call site`);
    return found;
  }
  return null;
}

function collectPreloadChannels(preloadSrc: string): string[] {
  const src = maskComments(preloadSrc);
  const channels: string[] = [];
  for (const call of callArgs(src, PRELOAD_CALL)) {
    const trimmed = call.arg.trim();
    const literal = staticStringValue(trimmed);
    if (literal != null) {
      channels.push(literal);
      continue;
    }
    const ident = trimmed.match(/^([A-Za-z_$][\w$]*)$/);
    if (ident) {
      const forwarded = forwardedChannels(src, call.at, ident[1]);
      if (forwarded) {
        channels.push(...forwarded);
        continue;
      }
    }
    throw new Error(`non-literal channel argument: ${trimmed.slice(0, 80)}`);
  }
  return uniqueSorted(channels);
}

function stringConsts(src: string): Map<string, string> {
  const map = new Map<string, string>();
  const decl = /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*/g;
  let match: RegExpExecArray | null;
  while ((match = decl.exec(src))) {
    const name = match[1];
    const at = match.index + match[0].length;
    if (!name || (src[at] !== "'" && src[at] !== '"' && src[at] !== '`')) continue;
    const literal = staticStringValue(src.slice(at, skipString(src, at)));
    if (literal != null) map.set(name, literal);
  }
  return map;
}

function objectStringConsts(src: string): Map<string, Map<string, string>> {
  const map = new Map<string, Map<string, string>>();
  const decl = /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*/g;
  let match: RegExpExecArray | null;
  while ((match = decl.exec(src))) {
    const name = match[1];
    const at = match.index + match[0].length;
    if (!name || src[at] !== '{') continue;
    const body = readBalanced(src, at, '{', '}');
    if (!body) continue;
    const props = new Map<string, string>();
    let i = 1;
    let depth = 1;
    while (i < body.length - 1) {
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
        const key = body.slice(start, i);
        while (i < body.length && /\s/.test(body[i])) i++;
        if (body[i] !== ':') continue;
        i++;
        while (i < body.length && /\s/.test(body[i])) i++;
        if (body[i] === "'" || body[i] === '"' || body[i] === '`') {
          const end = skipString(body, i);
          const literal = staticStringValue(body.slice(i, end));
          if (literal != null) props.set(key, literal);
          i = end;
          continue;
        }
      }
      i++;
    }
    map.set(name, props);
  }
  return map;
}

function forOfStrings(src: string, name: string, at: number): string[] | null {
  const upto = src.slice(0, at);
  const re = new RegExp(`for\\s*\\(\\s*const\\s+${name}\\s+of\\s*\\[([\\s\\S]*?)\\]\\s*(?:as\\s+const\\s*)?\\)`, 'g');
  let match: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((match = re.exec(upto))) last = match;
  if (!last) return null;
  const body = last[1] ?? '';
  if (body.includes('${')) throw new Error(`non-literal channel argument in for-of ${name}`);
  const values = [...body.matchAll(/'([^'\\]*)'|"([^"\\]*)"|`([^`\\]*)`/g)].map((hit) => hit[1] ?? hit[2] ?? hit[3] ?? '');
  if (values.length === 0) throw new Error(`non-literal channel argument in for-of ${name}`);
  return values;
}

function handlerTableChannels(src: string, ipcMap: Map<string, string>): string[] {
  const found = /const\s+handlers\s*:\s*IpcHandlers\s*=\s*\{/.exec(src);
  if (!found) throw new Error('IpcHandlers table not found');
  const end = src.indexOf('\n};', found.index);
  if (end < 0) throw new Error('IpcHandlers table does not close');
  const region = src.slice(found.index, end);
  const channels: string[] = [];
  for (const match of region.matchAll(/^\s*\[([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\]/gm)) {
    if (match[1] !== 'IPC_CHANNELS') throw new Error(`non-literal channel argument: ${match[1]}.${match[2]}`);
    const value = ipcMap.get(match[2] ?? '');
    if (value == null) throw new Error(`unresolved IPC_CHANNELS.${match[2]}`);
    channels.push(value);
  }
  if (channels.length === 0) throw new Error('IpcHandlers table has no channels');
  return channels;
}

function objectEntriesChannels(
  src: string,
  ident: string,
  at: number,
  ipcMap: Map<string, string>,
  files: readonly MainSource[],
): string[] | null {
  const upto = src.slice(0, at);
  const re = new RegExp(
    `for\\s*\\(\\s*const\\s*\\[\\s*${ident}\\s*,\\s*[A-Za-z_$][\\w$]*\\s*\\]\\s*of\\s*Object\\.entries\\(\\s*([A-Za-z_$][\\w$]*)\\s*\\)`,
    'g',
  );
  let match: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((match = re.exec(upto))) last = match;
  if (!last) return null;
  const main = files.find((file) => file.rel === 'main.ts');
  if (!main) throw new Error('non-literal channel argument: handlers table is not in main.ts');
  return handlerTableChannels(main.src, ipcMap);
}

function resolveMainArg(
  src: string,
  arg: string,
  at: number,
  ipcMap: Map<string, string>,
  files: readonly MainSource[],
): string[] {
  const trimmed = arg.trim().replace(/\s+as\s+const\s*$/, '').trim();
  const literal = staticStringValue(trimmed);
  if (literal != null) return [literal];
  if (trimmed.startsWith("'") || trimmed.startsWith('"') || trimmed.startsWith('`')) {
    throw new Error(`non-literal channel argument: ${trimmed.slice(0, 80)}`);
  }
  const member = trimmed.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/);
  if (member) {
    if (member[1] === 'IPC_CHANNELS') {
      const value = ipcMap.get(member[2]);
      if (value == null) throw new Error(`unresolved IPC_CHANNELS.${member[2]}`);
      return [value];
    }
    const prop = objectStringConsts(src).get(member[1])?.get(member[2]);
    if (prop == null) throw new Error(`non-literal channel argument: ${trimmed}`);
    return [prop];
  }
  const ident = trimmed.match(/^([A-Za-z_$][\w$]*)$/);
  if (!ident) throw new Error(`non-literal channel argument: ${trimmed.slice(0, 80)}`);
  const name = ident[1];
  const loop = forOfStrings(src, name, at);
  if (loop) return loop;
  const entries = objectEntriesChannels(src, name, at, ipcMap, files);
  if (entries) return entries;
  const constant = stringConsts(src).get(name);
  if (constant != null) return [constant];
  throw new Error(`non-literal channel argument: ${name}`);
}

function readMainFiles(): MainSource[] {
  const out: MainSource[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      const nextPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(nextPath, nextRel);
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts') || entry.name.endsWith('.d.ts')) continue;
      out.push({ rel: nextRel, src: maskComments(readFileSync(nextPath, 'utf8')) });
    }
  };
  walk(SRC_DIR, '');
  return out;
}

function collectIpcMainChannels(ipcMap: Map<string, string>, files: readonly MainSource[]): string[] {
  const channels: string[] = [];
  const callRe = /ipcMain\.(?:handle|on)\(\s*/g;
  for (const file of files) {
    for (const call of callArgs(file.src, callRe)) {
      channels.push(...resolveMainArg(file.src, call.arg, call.at, ipcMap, files));
    }
  }
  return uniqueSorted(channels);
}

function filesWithIpc(ipcSrc: string, files: readonly MainSource[]): MainSource[] {
  const masked = maskComments(ipcSrc);
  return files.map((file) => (file.rel === 'ipc.ts' ? { rel: file.rel, src: masked } : file));
}

function collectIpcChannelSnapshot(
  ipcSrc: string,
  preloadSrc: string,
  files: readonly MainSource[],
): IpcChannelSnapshot {
  const ipcMap = parseIpcChannelMap(ipcSrc);
  const ipcChannels = uniqueSorted([...ipcMap.values()]);
  const preloadChannels = collectPreloadChannels(preloadSrc);
  const ipcMainChannels = collectIpcMainChannels(ipcMap, filesWithIpc(ipcSrc, files));
  return {
    ipcChannels,
    preloadChannels,
    ipcMainChannels,
    onlyInIpc: ipcChannels.filter((channel) => !preloadChannels.includes(channel)),
    onlyInPreload: preloadChannels.filter((channel) => !ipcChannels.includes(channel)),
  };
}

function readLiveSnapshot(): IpcChannelSnapshot {
  return collectIpcChannelSnapshot(
    readFileSync(path.join(SRC_DIR, 'ipc.ts'), 'utf8'),
    readFileSync(path.join(SRC_DIR, 'preload.ts'), 'utf8'),
    readMainFiles(),
  );
}

describe('ipc channel snapshot', () => {
  it('matches the committed ipc.ts, preload.ts, and ipcMain channel lists', () => {
    const committed = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as IpcChannelSnapshot;
    expect(readLiveSnapshot()).toEqual(committed);
  });

  it('reads single-quoted, double-quoted, and template-literal preload channels', () => {
    const src = [
      "ipcRenderer.invoke('single:one');",
      'ipcRenderer.send("double:two");',
      'ipcRenderer.on(`template:three`);',
    ].join('\n');
    expect(collectPreloadChannels(src)).toEqual(['double:two', 'single:one', 'template:three']);
  });

  it('fails on a variable preload channel argument', () => {
    expect(() => collectPreloadChannels('ipcRenderer.invoke(widgetChannel);')).toThrow(/non-literal channel argument/);
  });

  it('fails on a template channel with a substitution', () => {
    expect(() => collectPreloadChannels('ipcRenderer.invoke(`widget:${name}`);')).toThrow(/non-literal channel argument/);
  });

  it('follows a preload wrapper only when every call site passes a literal', () => {
    const src = `
      function wrap(channel: string) {
        return ipcRenderer.invoke(channel);
      }
      wrap('wrapped:one');
      wrap("wrapped:two");
    `;
    expect(collectPreloadChannels(src)).toEqual(['wrapped:one', 'wrapped:two']);
    const variable = `
      function wrap(channel: string) {
        return ipcRenderer.invoke(channel);
      }
      wrap(widgetChannel);
    `;
    expect(() => collectPreloadChannels(variable)).toThrow(/non-literal channel argument/);
  });

  it('goes red when a channel is added', () => {
    const files = readMainFiles();
    const live = readLiveSnapshot();
    const ipcSrc = readFileSync(path.join(SRC_DIR, 'ipc.ts'), 'utf8');
    const end = ipcSrc.indexOf('} as const;', ipcSrc.indexOf('export const IPC_CHANNELS = {'));
    const withFake = `${ipcSrc.slice(0, end)}\n  WIDGET_FAKE: 'widget:not-a-real-channel',\n${ipcSrc.slice(end)}`;
    const mutated = collectIpcChannelSnapshot(
      withFake,
      readFileSync(path.join(SRC_DIR, 'preload.ts'), 'utf8'),
      files,
    );
    expect(mutated.ipcChannels).toContain('widget:not-a-real-channel');
    expect(mutated).not.toEqual(live);
    expect(mutated.ipcChannels.filter((channel) => !live.ipcChannels.includes(channel))).toEqual([
      'widget:not-a-real-channel',
    ]);
  });

  it('goes red when a channel is removed', () => {
    const files = readMainFiles();
    const live = readLiveSnapshot();
    const gone = 'continuity:check';
    const ipcSrc = readFileSync(path.join(SRC_DIR, 'ipc.ts'), 'utf8');
    const start = ipcSrc.indexOf('export const IPC_CHANNELS = {');
    const end = ipcSrc.indexOf('} as const;', start);
    const block = ipcSrc.slice(start, end);
    const needle = `'${gone}'`;
    const at = block.indexOf(needle);
    if (at < 0 || block.indexOf(needle, at + needle.length) !== -1) {
      throw new Error(`${gone} must appear exactly once in IPC_CHANNELS`);
    }
    const withRemoved = `${ipcSrc.slice(0, start)}${block.slice(0, at)}${block.slice(at + needle.length)}${ipcSrc.slice(end)}`;
    expect(live.ipcChannels).toContain(gone);
    expect(parseIpcChannelMap(withRemoved).has('CONTINUITY_CHECK')).toBe(false);
    expect(() =>
      collectIpcChannelSnapshot(withRemoved, readFileSync(path.join(SRC_DIR, 'preload.ts'), 'utf8'), files),
    ).toThrow(/CONTINUITY_CHECK/);
  });
});
