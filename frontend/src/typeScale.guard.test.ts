/**
 * #1773 T0 — type-scale ratchet: font sizes outside the `--text-*` scale may
 * only shrink.
 *
 * #1773 moves every UI font size onto the scale in `tokens.css`
 * (`--text-xs` … `--text-3xl`). T0 changes no UI: it counts what is off the
 * scale today and fails the build the moment that number grows, so each later
 * slice can only pay the debt down.
 *
 * ## What counts as a usage
 *
 * Production source under `frontend/src` (test/spec files and `__fixtures__`
 * / `__mocks__` excluded):
 *
 *   - `.css`: every `font-size` and `font` declaration, comments stripped.
 *   - `.ts` / `.tsx`: `fontSize` / `font-size` keys in object literals (inline
 *     styles, `CSSProperties` consts), `fontSize` JSX attributes (SVG),
 *     `el.style.fontSize = …`, `setProperty('font-size', …)`, and
 *     `font-size:` / `font:` declarations inside string and template literals
 *     (inline `cssText`, injected `<style>`).
 *
 * A value is ON the scale only when it is `var(--text-<step>)` (a fallback
 * inside the `var()` is fine — the token is always defined), where `<step>`
 * is a `--text-*` token `tokens.css` gives a length. `--text-header`,
 * `--text-muted` and the other colour tokens are not steps. A shorthand
 * `font:` is on the scale when it carries a step. CSS-wide keywords
 * (`inherit`, `unset`, …) and the system-font keywords of the `font`
 * shorthand set no size, so they are not counted at all. Everything else is
 * OFF the scale: px/rem/em/% literals, `calc()`, any other custom property,
 * numbers, and expressions the scanner cannot prove are a step.
 *
 * ## The two ledgers
 *
 *   - `typeScale.allowlist.json` — sanctioned exceptions that stay off the
 *     scale on purpose (story page fonts, which #1773 leaves alone). Keyed
 *     by file + selector + property, never by line number, each with a
 *     reason. Its `count` is pinned: growth is red, and so is a drop (pin the
 *     new, lower count, or delete the entry when it reaches zero).
 *   - `typeScale.baseline.json` — every other off-scale usage, as a count per
 *     file at T0. A file may never exceed its count; a file that is not
 *     listed may have none. Counts only fall: when a file drops below its
 *     count the guard asks for the lower number, so the slack can't be spent
 *     again later.
 *
 * "Selector" is the CSS rule's selector with its enclosing at-rules
 * (`@media (…) >> .foo`). For TypeScript it is the chain of named scopes
 * around the value plus the JSX element it styles
 * (`ManuscriptView >> sheetWrapStyle`, `PageModeRunes >> <div style>`).
 *
 * Read-only: nothing here writes to the source tree.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const SRC = resolve(__dirname);
const TOKENS_CSS = join(SRC, 'tokens.css');
const BASELINE_FILE = join(SRC, 'typeScale.baseline.json');
const ALLOWLIST_FILE = join(SRC, 'typeScale.allowlist.json');

const SCANNED_EXT = /\.(css|tsx?)$/;
const EXCLUDED_FILE = /\.(test|spec)\.tsx?$|\.d\.ts$/;
const EXCLUDED_DIRS = new Set(['node_modules', '__fixtures__', '__mocks__']);

/** Joins the scopes of a selector key; `>>` is not valid CSS, so it can't collide with a combinator. */
const SCOPE_JOIN = ' >> ';

const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const SYSTEM_FONT_KEYWORDS = new Set(['caption', 'icon', 'menu', 'message-box', 'small-caption', 'status-bar']);

type Verdict = 'on' | 'off' | 'neutral';

interface Usage {
  /** Path relative to `frontend/src`, always with `/`. */
  file: string;
  selector: string;
  /** `font-size` or `font`. TS `fontSize` keys are reported as `font-size`. */
  property: string;
  value: string;
  /** 1-based; for failure messages only, never part of a key. */
  line: number;
  verdict: Verdict;
}

// ── Scale ────────────────────────────────────────────────────────────────────

const stripCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));

/** The `--text-*` tokens tokens.css gives a length — the steps of the scale. */
function scaleSteps(): string[] {
  const css = stripCssComments(readFileSync(TOKENS_CSS, 'utf-8'));
  const steps = new Set<string>();
  for (const m of css.matchAll(/--text-([a-z0-9-]+)\s*:\s*[\d.]+(?:px|rem)\s*;/g)) steps.add(m[1]);
  return [...steps];
}

function classify(property: string, rawValue: string, steps: readonly string[]): Verdict {
  const value = rawValue.replace(/!\s*important\s*$/i, '').trim();
  const lower = value.toLowerCase();
  if (CSS_WIDE_KEYWORDS.has(lower)) return 'neutral';
  if (property === 'font' && SYSTEM_FONT_KEYWORDS.has(lower)) return 'neutral';
  const step = `(?:${steps.map((s) => s.replace(/[-]/g, '\\-')).join('|')})`;
  if (property === 'font') {
    return new RegExp(`(^|[\\s/])var\\(\\s*--text-${step}\\s*[,)]`).test(value) ? 'on' : 'off';
  }
  return new RegExp(`^var\\(\\s*--text-${step}\\s*(,[\\s\\S]*)?\\)$`).test(value) ? 'on' : 'off';
}

// ── CSS scanner ──────────────────────────────────────────────────────────────

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

interface CssDecl {
  selector: string;
  property: string;
  value: string;
  line: number;
}

/**
 * Every `font-size` / `font` declaration in `css`, with its rule context.
 * `declarationList` scans an inline `style`/`cssText` string, where
 * declarations sit outside any block. Strings, comments and parentheses are
 * honoured, so a `;` or `{` inside `url(…)` or quotes can't split a rule.
 */
function scanCss(css: string, declarationList = false, firstLine = 1): CssDecl[] {
  const out: CssDecl[] = [];
  const src = stripCssComments(css);
  const stack: string[] = [];
  let buf = '';
  let bufLine = firstLine;
  let line = firstLine;
  let parens = 0;
  let quote: string | null = null;

  const flushDecl = () => {
    const text = buf;
    buf = '';
    if (!declarationList && stack.length === 0) return;
    const colon = text.indexOf(':');
    if (colon < 0) return;
    const property = text.slice(0, colon).trim().toLowerCase();
    if (property !== 'font-size' && property !== 'font') return;
    out.push({ selector: stack.join(SCOPE_JOIN), property, value: collapse(text.slice(colon + 1)), line: bufLine });
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (buf.trim() === '' && !/\s/.test(ch)) bufLine = line;
    if (ch === '\n') line++;
    if (quote) {
      if (ch === '\\') { buf += ch + (src[i + 1] ?? ''); i++; continue; }
      if (ch === quote) quote = null;
      buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '(') parens++;
    if (ch === ')') parens = Math.max(0, parens - 1);
    if (parens > 0) { buf += ch; continue; }
    if (ch === '{') { stack.push(collapse(buf)); buf = ''; continue; }
    if (ch === ';') { flushDecl(); continue; }
    if (ch === '}') { flushDecl(); stack.pop(); continue; }
    buf += ch;
  }
  flushDecl();
  return out;
}

// ── TypeScript scanner ───────────────────────────────────────────────────────

function nameOf(node: ts.Node): string | undefined {
  const name = (node as { name?: ts.Node }).name;
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return `[${name.expression.getText()}]`;
  return undefined;
}

/** Named scopes from the file down to `node`, plus the JSX element whose attribute holds it. */
function scopeChain(node: ts.Node): string {
  const scopes: string[] = [];
  let jsxTag: string | undefined;
  for (let cur: ts.Node | undefined = node.parent; cur; cur = cur.parent) {
    if (!jsxTag && ts.isJsxAttribute(cur)) {
      const el = cur.parent.parent;
      jsxTag = `<${el.tagName.getText()} ${cur.name.getText()}>`;
      continue;
    }
    if (
      ts.isFunctionDeclaration(cur) || ts.isClassDeclaration(cur) || ts.isMethodDeclaration(cur) ||
      ts.isVariableDeclaration(cur) || ts.isPropertyAssignment(cur) || ts.isPropertyDeclaration(cur) ||
      ts.isGetAccessorDeclaration(cur) || ts.isSetAccessorDeclaration(cur) || ts.isModuleDeclaration(cur)
    ) {
      const n = nameOf(cur);
      if (n) scopes.unshift(n);
    }
  }
  if (jsxTag) scopes.push(jsxTag);
  return scopes.length ? scopes.join(SCOPE_JOIN) : '(module)';
}

const isFontSizeName = (text: string) => text === 'fontSize' || text === 'font-size';

/** Text of a string-ish expression, with `${…}` standing in for template holes. */
function literalText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((s) => '${…}' + s.literal.text).join('');
  return undefined;
}

function scanTs(file: string, source: string): CssDecl[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: CssDecl[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const valueText = (n: ts.Node) => literalText(n) ?? n.getText(sf);

  const visit = (node: ts.Node): void => {
    // { fontSize: … } / { 'font-size': … } / { fontSize }
    if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && isFontSizeName(nameOf(node) ?? '')) {
      const value = ts.isPropertyAssignment(node) ? valueText(node.initializer) : node.name.text;
      out.push({ selector: scopeChain(node), property: 'font-size', value, line: lineOf(node) });
    }
    // <text fontSize={12}>
    else if (ts.isJsxAttribute(node) && isFontSizeName(node.name.getText(sf))) {
      const init = node.initializer;
      const expr = init && ts.isJsxExpression(init) ? init.expression : init;
      out.push({ selector: scopeChain(node.name), property: 'font-size', value: expr ? valueText(expr) : '', line: lineOf(node) });
    }
    // el.style.fontSize = …
    else if (
      ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) && node.left.name.text === 'fontSize'
    ) {
      out.push({ selector: scopeChain(node), property: 'font-size', value: valueText(node.right), line: lineOf(node) });
    }
    // style.setProperty('font-size', …)
    else if (
      ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'setProperty' && node.arguments.length >= 2 &&
      literalText(node.arguments[0]) === 'font-size'
    ) {
      out.push({ selector: scopeChain(node), property: 'font-size', value: valueText(node.arguments[1]), line: lineOf(node) });
    }
    // 'font-size:12px;…' inside a string or template (cssText, injected <style>)
    else {
      const text = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)
        ? literalText(node)
        : undefined;
      if (text !== undefined && /(^|[\s;{"'])font(-size)?\s*:/i.test(text)) {
        const scope = scopeChain(node);
        for (const d of scanCss(text, !text.includes('{'), lineOf(node))) {
          out.push({ ...d, selector: d.selector ? scope + SCOPE_JOIN + d.selector : scope });
        }
        return; // a template's spans are already covered by the text above
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// ── Tree walk ────────────────────────────────────────────────────────────────

const toPosix = (p: string) => p.split(sep).join('/');

function productionFiles(dir = SRC): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) files.push(...productionFiles(abs));
    } else if (SCANNED_EXT.test(entry.name) && !EXCLUDED_FILE.test(entry.name)) {
      files.push(abs);
    }
  }
  return files;
}

function scanFile(file: string, source: string, steps: readonly string[]): Usage[] {
  const decls = file.endsWith('.css') ? scanCss(source) : scanTs(file, source);
  return decls.map((d) => ({ file, ...d, verdict: classify(d.property, d.value, steps) }));
}

function scanTree(steps: readonly string[]): Usage[] {
  return productionFiles()
    .map((abs) => toPosix(relative(SRC, abs)))
    .sort()
    .flatMap((file) => scanFile(file, readFileSync(join(SRC, file), 'utf-8'), steps));
}

// ── Ledgers ──────────────────────────────────────────────────────────────────

interface AllowEntry {
  file: string;
  selector: string;
  property: string;
  count: number;
  reason: string;
}

const keyOf = (u: { file: string; selector: string; property: string }) => `${u.file} | ${u.selector} | ${u.property}`;

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf-8')) as T;
}
const baseline = readJson<{ files: Record<string, number> }>(BASELINE_FILE).files;
const allowlist = readJson<{ entries: AllowEntry[] }>(ALLOWLIST_FILE).entries;

const where = (us: Usage[]) => us.map((u) => `    ${u.file}:${u.line}  ${u.selector}  { ${u.property}: ${u.value} }`).join('\n');

// ── Tests ────────────────────────────────────────────────────────────────────

describe('#1773 type-scale guard — scanner', () => {
  const steps = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl'];
  const css = (src: string) => scanFile('x.css', src, steps).map((u) => [u.selector, u.property, u.value, u.verdict]);
  const tsx = (src: string) => scanFile('x.tsx', src, steps).map((u) => [u.selector, u.value, u.verdict]);

  it('reads the steps from tokens.css: the size tokens, not the colour ones', () => {
    const real = scaleSteps();
    expect(real).toEqual(expect.arrayContaining(['xs', 'sm', 'base']));
    expect(real).not.toContain('header');
    expect(real).not.toContain('muted');
  });

  it('classifies CSS values', () => {
    expect(css(`
      .a { font-size: var(--text-sm); }
      .b { font-size: var(--text-xs, 11px) !important; }
      .c { font-size: 13px; }
      .d { font-size: var(--text-muted); }
      .e { font-size: calc(var(--text-sm) - 1px); }
      .f { font-size: var(--story-page-font-size, 1rem); }
      .g { font-size: inherit; }
      .h { font: inherit; }
      .i { font: 600 var(--text-sm)/1.4 var(--font-sans); }
      .j { font: 600 13px/1.4 var(--font-sans); }
      .k { font-size: 0.9em; }
    `)).toEqual([
      ['.a', 'font-size', 'var(--text-sm)', 'on'],
      ['.b', 'font-size', 'var(--text-xs, 11px) !important', 'on'],
      ['.c', 'font-size', '13px', 'off'],
      ['.d', 'font-size', 'var(--text-muted)', 'off'],
      ['.e', 'font-size', 'calc(var(--text-sm) - 1px)', 'off'],
      ['.f', 'font-size', 'var(--story-page-font-size, 1rem)', 'off'],
      ['.g', 'font-size', 'inherit', 'neutral'],
      ['.h', 'font', 'inherit', 'neutral'],
      ['.i', 'font', '600 var(--text-sm)/1.4 var(--font-sans)', 'on'],
      ['.j', 'font', '600 13px/1.4 var(--font-sans)', 'off'],
      ['.k', 'font-size', '0.9em', 'off'],
    ]);
  });

  it('keeps at-rule context, ignores comments, custom properties and look-alike properties', () => {
    expect(css(`
      /* .gone { font-size: 99px; } */
      :root { --fs-ui: 13px; font-size-adjust: 0.5; font-family: x; font-weight: 600; }
      @media (max-width: 600px) {
        .a,
        .b:hover { font-size: 11px }
      }
      .c { background: url("data:image/svg+xml;utf8,<svg>{}</svg>"); font-size: 12px; }
      .d { & .e { font-size: 10px; } }
    `)).toEqual([
      ['@media (max-width: 600px) >> .a, .b:hover', 'font-size', '11px', 'off'],
      ['.c', 'font-size', '12px', 'off'],
      ['.d >> & .e', 'font-size', '10px', 'off'],
    ]);
  });

  it('reports CSS line numbers for messages', () => {
    expect(scanFile('x.css', '.a {\n  color: red;\n  font-size: 9px;\n}', steps)[0].line).toBe(3);
  });

  it('finds TS/TSX font sizes and names their scope', () => {
    expect(tsx(`
      const box: CSSProperties = { fontSize: 12, color: 'red' };
      export function Card({ fontSize }: { fontSize: number }) {
        const styles = { title: { 'font-size': '13px' }, body: { fontSize: 'var(--text-sm)' } };
        el.style.fontSize = '11px';
        el.style.setProperty('font-size', 'var(--text-xs)');
        return (
          <div style={{ fontSize }}>
            <svg><text fontSize={9} /></svg>
            <span style={{ ...box, fontSize: \`\${size}px\` }} />
          </div>
        );
      }
      const toast = 'color:#fff;font-size:12px;';
      const sheet = \`.x { font: 600 var(--text-sm)/1 sans; }\`;
      const notASize = { fontFamily: 'serif', fontWeight: 700, fontSizePx: 16 };
    `)).toEqual([
      ['box', '12', 'off'],
      ['Card >> styles >> title', '13px', 'off'],
      ['Card >> styles >> body', 'var(--text-sm)', 'on'],
      ['Card', '11px', 'off'],
      ['Card', 'var(--text-xs)', 'on'],
      ['Card >> <div style>', 'fontSize', 'off'],
      ['Card >> <text fontSize>', '9', 'off'],
      ['Card >> <span style>', '${…}px', 'off'],
      ['toast', '12px', 'off'],
      ['sheet >> .x', '600 var(--text-sm)/1 sans', 'on'],
    ]);
  });
});

describe('#1773 type-scale guard — ledgers are well-formed', () => {
  it('every allowlist entry names a real file, a selector, a property, a positive count and a reason', () => {
    for (const e of allowlist) {
      const label = keyOf(e);
      expect(existsSync(join(SRC, e.file)), `${label}: file not found`).toBe(true);
      expect(e.selector.trim(), label).not.toBe('');
      expect(['font-size', 'font'], label).toContain(e.property);
      expect(Number.isInteger(e.count) && e.count > 0, `${label}: count must be a positive integer`).toBe(true);
      expect(e.reason.trim().length, `${label}: reason is required`).toBeGreaterThanOrEqual(20);
      expect(e as unknown as Record<string, unknown>, `${label}: keys are file+selector+property only — no line numbers`).not.toHaveProperty('line');
    }
  });

  it('allowlist keys are unique', () => {
    const keys = allowlist.map(keyOf);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });

  it('baseline counts are positive integers with posix paths', () => {
    for (const [file, n] of Object.entries(baseline)) {
      expect(Number.isInteger(n) && n > 0, `${file}: ${n}`).toBe(true);
      expect(file, 'use / in baseline paths').not.toContain('\\');
    }
  });
});

describe('#1773 type-scale guard — off-scale font sizes may only fall', () => {
  const usages = scanTree(scaleSteps());
  const off = usages.filter((u) => u.verdict === 'off');
  const allowKeys = new Map(allowlist.map((e) => [keyOf(e), e]));
  const allowed = off.filter((u) => allowKeys.has(keyOf(u)));
  const debt = off.filter((u) => !allowKeys.has(keyOf(u)));

  it('allowlisted usages match their pinned counts exactly', () => {
    const problems: string[] = [];
    for (const e of allowlist) {
      const hits = allowed.filter((u) => keyOf(u) === keyOf(e));
      if (hits.length > e.count) {
        problems.push(`GREW  ${keyOf(e)}: pinned ${e.count}, found ${hits.length}. Use a --text-* token instead:\n${where(hits)}`);
      } else if (hits.length < e.count) {
        problems.push(
          hits.length === 0
            ? `GONE  ${keyOf(e)}: no longer found — delete this entry from typeScale.allowlist.json.`
            : `FELL  ${keyOf(e)}: pinned ${e.count}, found ${hits.length} — lower its count to ${hits.length}.`,
        );
      }
    }
    expect(problems, problems.join('\n\n')).toEqual([]);
  });

  it('no file has more off-scale font sizes than its baseline', () => {
    const byFile = new Map<string, Usage[]>();
    for (const u of debt) byFile.set(u.file, [...(byFile.get(u.file) ?? []), u]);
    const grew = [...byFile].filter(([file, us]) => us.length > (baseline[file] ?? 0));
    const message = grew
      .map(([file, us]) =>
        `${file}: baseline ${baseline[file] ?? 0}, found ${us.length}. ` +
        'Use var(--text-xs|sm|base|lg|xl|2xl|3xl) from tokens.css; do not raise the baseline.\n' + where(us))
      .join('\n\n');
    expect(grew.map(([file]) => file), message).toEqual([]);
  });

  it('baseline is tight: a file that dropped below its count must lower it', () => {
    const found = new Map<string, number>();
    for (const u of debt) found.set(u.file, (found.get(u.file) ?? 0) + 1);
    const stale = Object.entries(baseline)
      .filter(([file, n]) => (found.get(file) ?? 0) < n)
      .map(([file, n]) => {
        const now = found.get(file) ?? 0;
        return now === 0
          ? `${file}: baseline ${n}, found 0 — delete the entry from typeScale.baseline.json.`
          : `${file}: baseline ${n}, found ${now} — lower it to ${now}.`;
      });
    expect(stale, `Off-scale font sizes fell — lock the gain in:\n${stale.join('\n')}`).toEqual([]);
  });
});
