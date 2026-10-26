/**
 * ARCH-SYNTH S03 TYPES-2 — lock `Window['api']` against the preload bridge.
 *
 * Compares member paths of `interface Window { api: ... }` in global.d.ts
 * with member paths of `contextBridge.exposeInMainWorld('api', ...)` in
 * preload.ts. A member whose value is an object (`jobs`, `outline`,
 * `agentSessions`, `agentIndex`) is walked, so a nested key on only one
 * side is drift too.
 *
 * The allowlists are today's gaps and may only shrink (S05a / S05b).
 * Adding a name is a loosening. Exact equality is the lock: a new ghost
 * type, a new preload key with no type, or putting the 13 deleted ghosts
 * back all fail.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../..');
const GLOBAL_DTS = resolve(REPO_ROOT, 'frontend/src/global.d.ts');
const PRELOAD_TS = resolve(REPO_ROOT, 'electron-main/src/preload.ts');
const DESKTOP_SHELL = resolve(REPO_ROOT, 'frontend/src/DesktopShell.tsx');

/**
 * Typed methods the File menu still calls (`DesktopShell.tsx`) with no
 * preload twin. Shrink by deleting the type in the same change.
 */
const TYPE_WITHOUT_PRELOAD_ALLOWLIST = ['newStory', 'openVault'] as const;

/**
 * Preload methods with no `Window['api']` twin (A2:97). Shrink by adding
 * the type or removing the preload key in the same change.
 */
const PRELOAD_WITHOUT_TYPE_ALLOWLIST = [
  'checkVaultIntegrity',
  'cleanUninstall',
  'createBlankVault',
  'getPresets',
  'getQualityRubric',
  'getRefinementSuggestions',
  'importVaultCommit',
  'importVaultDryRun',
  'obsidianPickFolderByPath',
  'onboardingDetectMythosVault',
  'onboardingGetSuggestedPaths',
  'onboardingOpenExistingVault',
  'onboardingValidatePath',
  'rebuildVaultManifest',
  'sceneSave',
  'suggestionsBatchAction',
  'suggestionsIgnore',
  'suggestionsSearch',
  'suggestionsUnifiedList',
] as const;

/** Blank comments and string/template literals without moving indexes. */
function stripCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      out += '  ';
      i += 2;
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && next === '*') {
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
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += ' ';
      i++;
      while (i < src.length) {
        if (src[i] === '\\') {
          out += '  ';
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          out += ' ';
          i++;
          break;
        }
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function isIdentStart(c: string): boolean {
  return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_' || c === '$';
}

function isIdentPart(c: string): boolean {
  return isIdentStart(c) || (c >= '0' && c <= '9');
}

/**
 * Member paths of the object literal / object type whose `{` is at
 * `openBraceIdx`. A member whose value starts with `{` is a nested
 * namespace and is walked.
 */
function collectMemberPaths(src: string, openBraceIdx: number, prefix: string, out: string[]): void {
  let depth = 0;
  let paren = 0;
  let i = openBraceIdx;
  while (i < src.length) {
    const c = src[i];
    if (c === '{') {
      depth++;
      i++;
      continue;
    }
    if (c === '}') {
      depth--;
      if (depth === 0) return;
      i++;
      continue;
    }
    if (c === '(') {
      paren++;
      i++;
      continue;
    }
    if (c === ')') {
      paren--;
      i++;
      continue;
    }
    if (depth === 1 && paren === 0 && isIdentStart(c)) {
      let k = i - 1;
      while (k >= 0 && (src[k] === ' ' || src[k] === '\t')) k--;
      const boundary = k < 0 || src[k] === '\n' || src[k] === ';' || src[k] === '{';
      const start = i;
      i++;
      while (i < src.length && isIdentPart(src[i])) i++;
      if (!boundary) continue;
      const name = src.slice(start, i);
      let j = i;
      while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j++;
      if (src[j] === '?') {
        j++;
        while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j++;
      }
      if (src[j] !== ':') continue;
      j++;
      while (j < src.length && (src[j] === ' ' || src[j] === '\t' || src[j] === '\n')) j++;
      const path = prefix.length > 0 ? `${prefix}.${name}` : name;
      out.push(path);
      if (src[j] === '{') collectMemberPaths(src, j, path, out);
      continue;
    }
    i++;
  }
}

function windowApiPaths(raw: string): string[] {
  const stripped = stripCommentsAndStrings(raw);
  const windowAt = raw.indexOf('interface Window');
  if (windowAt < 0) throw new Error('global.d.ts: interface Window not found');
  const apiAt = raw.indexOf('\n  api:', windowAt);
  if (apiAt < 0) throw new Error('global.d.ts: Window.api not found');
  const brace = raw.indexOf('{', apiAt);
  const paths: string[] = [];
  collectMemberPaths(stripped, brace, '', paths);
  return [...new Set(paths)].sort();
}

function preloadApiPaths(raw: string): string[] {
  const stripped = stripCommentsAndStrings(raw);
  const marker = "contextBridge.exposeInMainWorld('api'";
  const at = raw.indexOf(marker);
  if (at < 0) throw new Error('preload.ts: contextBridge api expose not found');
  const brace = raw.indexOf('{', at);
  const paths: string[] = [];
  collectMemberPaths(stripped, brace, '', paths);
  return [...new Set(paths)].sort();
}

function onlyIn(left: readonly string[], right: readonly string[]): string[] {
  const have = new Set(right);
  return left.filter((name) => !have.has(name));
}

describe('Window api surface ↔ preload (S03)', () => {
  const globalSrc = readFileSync(GLOBAL_DTS, 'utf8');
  const preloadSrc = readFileSync(PRELOAD_TS, 'utf8');
  const typePaths = windowApiPaths(globalSrc);
  const preloadPaths = preloadApiPaths(preloadSrc);
  const typeWithoutPreload = onlyIn(typePaths, preloadPaths);
  const preloadWithoutType = onlyIn(preloadPaths, typePaths);

  it('parses both api surfaces', () => {
    expect(typePaths.length).toBeGreaterThan(400);
    expect(preloadPaths.length).toBeGreaterThan(400);
  });

  it('types with no preload twin are exactly the allowlist (may only shrink)', () => {
    expect(typeWithoutPreload).toEqual([...TYPE_WITHOUT_PRELOAD_ALLOWLIST]);
  });

  it('preload methods missing from the type are exactly the allowlist (may only shrink)', () => {
    expect(preloadWithoutType).toEqual([...PRELOAD_WITHOUT_TYPE_ALLOWLIST]);
  });

  it('keeps newStory and openVault because the File menu still calls them', () => {
    const shell = readFileSync(DESKTOP_SHELL, 'utf8');
    expect(shell).toContain('window.api?.newStory?.()');
    expect(shell).toContain('window.api?.openVault?.()');
  });
});
