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
 *   - `.ts` / `.tsx` (and `.js` / `.jsx`, should any appear): `fontSize` /
 *     `font-size` / `font` keys in object literals, computed string keys
 *     included (inline styles, `CSSProperties` consts); `fontSize` JSX
 *     attributes (SVG); assignments such as `el.style.fontSize = …`,
 *     `el.style['font-size'] += …` and `ctx.font = …`;
 *     `setProperty('font-size' | 'font', …)` and `setAttribute('font-size', …)`;
 *     and CSS written inside string and template literals: inline `cssText`,
 *     injected `<style>` sheets, and `style="…"` / `font-size="…"` in markup.
 *     Template holes count as unknown values. A TS `font` that carries no
 *     size (`{ font: 'Lora' }`) is a family choice, not a shorthand, so it is
 *     skipped.
 *
 * A value is ON the scale only when it is `var(--text-<step>)` (a fallback
 * inside the `var()` is fine — the token is always defined), where `<step>`
 * is a `--text-*` token `tokens.css` gives a length. `--text-header`,
 * `--text-muted` and the other colour tokens are not steps. A shorthand
 * `font:` is judged by its size slot (`600 var(--text-sm)/1.4 …` is on;
 * `13px/var(--text-sm) …` is off). CSS-wide keywords (`inherit`, `unset`, …)
 * and the system-font keywords of the `font` shorthand set no size, so they
 * are not counted at all. Everything else is OFF the scale: px/rem/em/%
 * literals, `calc()`, any other custom property, numbers, and expressions the
 * scanner cannot prove are a step.
 *
 * The scale itself must not be redefined: declaring `--text-<step>`,
 * `--leading-<step>` or `--weight-<step>` anywhere but `tokens.css` (a CSS
 * rule, an inline style, `setProperty`) is red, because it would let a
 * `var(--text-sm)` quietly render 13px again.
 *
 * ## The two ledgers
 *
 *   - `typeScale.allowlist.json` — sanctioned exceptions that stay off the
 *     scale on purpose: story page fonts, which #1773 leaves alone (sizes
 *     that come from, or are em-relative to, the user's page font, and the
 *     page's rune decorations). Keyed by file + selector + property, never by
 *     line number, each with a reason. Its `count` is pinned: growth is red,
 *     and so is a drop (pin the new, lower count, or delete the entry when it
 *     reaches zero).
 *   - `typeScale.baseline.json` — every other off-scale usage, as a count per
 *     file at T0. A file may never exceed its count; a file that is not
 *     listed may have none. Counts only fall: when a file drops below its
 *     count the guard asks for the lower number, so the slack can't be spent
 *     again later.
 *
 * The ledgers at T0 are pinned in this file: their totals (`T0`) and each
 * file's baseline count (`T0_CEILINGS`). baseline.json may never put a file
 * above its T0 ceiling (a new file's ceiling is 0), so raising a count or
 * adding a file can't land as a data-only edit to the JSON, not even when a
 * cut elsewhere keeps the totals level.
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

const SCANNED_EXT = /\.(css|[cm]?[jt]sx?)$/;
const EXCLUDED_FILE = /\.(test|spec)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/;
const EXCLUDED_DIRS = new Set(['node_modules', '__fixtures__', '__mocks__']);

/** Joins the scopes of a selector key; `>>` is not valid CSS, so it can't collide with a combinator. */
const SCOPE_JOIN = ' >> ';
/** Stands in for a template-literal hole. No braces, quotes or `;`, so it can't change how CSS text splits. */
const HOLE = '⟨expr⟩';

const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const SYSTEM_FONT_KEYWORDS = new Set(['caption', 'icon', 'menu', 'message-box', 'small-caption', 'status-bar']);
/** Tokens that can precede the size in a `font` shorthand (style, variant, weight, stretch). */
const FONT_PREFIX_KEYWORDS = new Set([
  'normal', 'italic', 'oblique', 'small-caps', 'bold', 'bolder', 'lighter',
  'ultra-condensed', 'extra-condensed', 'condensed', 'semi-condensed',
  'semi-expanded', 'expanded', 'extra-expanded', 'ultra-expanded',
]);
/** Custom properties that make up the scale; declaring one outside tokens.css redefines a step. */
const SCALE_PROPERTY = /^--(text|leading|weight)-[\w-]+$/;

/** `redefine`: a scale step declared somewhere other than tokens.css. */
type Verdict = 'on' | 'off' | 'neutral' | 'redefine';

interface Usage {
  /** Path relative to `frontend/src`, always with `/`. */
  file: string;
  selector: string;
  /** `font-size`, `font`, or a scale custom property. TS `fontSize` keys are reported as `font-size`. */
  property: string;
  value: string;
  /** 1-based; for failure messages only, never part of a key. */
  line: number;
  verdict: Verdict;
}

// ── Scale ────────────────────────────────────────────────────────────────────

/**
 * Blanks CSS comments, keeping newlines so line numbers hold. A `/*` inside a
 * quoted string is text, not a comment, and a string ends at a newline (as in
 * CSS), so quoted delimiters can't hide the declarations between them.
 */
function stripCssComments(css: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < css.length) out += css[++i];
      else if (ch === quote || ch === '\n') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; continue; }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end < 0 ? css.length : end + 2;
      out += css.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/** The `--text-*` tokens tokens.css gives a length — the steps of the scale. */
function scaleSteps(): string[] {
  const css = stripCssComments(readFileSync(TOKENS_CSS, 'utf-8'));
  const steps = new Set<string>();
  for (const m of css.matchAll(/--text-([a-z0-9-]+)\s*:\s*[\d.]+(?:px|rem)\s*;/g)) steps.add(m[1]);
  return [...steps];
}

/** Splits a value on top-level whitespace, `/` and `,` (kept as tokens); parentheses and quotes stay whole. */
function topLevelTokens(value: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let depth = 0;
  let quote: string | null = null;
  const push = () => { if (cur) tokens.push(cur); cur = ''; };
  for (const ch of value) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && /[\s/,]/.test(ch)) { push(); if (ch === '/' || ch === ',') tokens.push(ch); continue; }
    cur += ch;
  }
  push();
  return tokens;
}

/** The size slot of a `font` shorthand: the token before `/line-height`, else the first after style/variant/weight/stretch (weight tokens included). */
function fontShorthandSize(value: string): string | undefined {
  const tokens = topLevelTokens(value);
  const slash = tokens.indexOf('/');
  if (slash > 0) return tokens[slash - 1];
  return tokens.find((t) =>
    !FONT_PREFIX_KEYWORDS.has(t.toLowerCase()) && !/^\d+$/.test(t) && !/^-?[\d.]+deg$/.test(t) && !/^var\(\s*--weight-[\w-]+\s*[,)]/.test(t));
}

/** A TS value named `font` is only a shorthand when it carries a size or a keyword; `{ font: 'Lora' }` is a family pick. */
const looksLikeFontShorthand = (value: string) =>
  CSS_WIDE_KEYWORDS.has(value.trim().toLowerCase()) || SYSTEM_FONT_KEYWORDS.has(value.trim().toLowerCase()) ||
  new RegExp(`(\\d|${HOLE})(px|rem|em|%|pt|pc|vh|vw|vmin|vmax|ch|ex|q|mm|cm|in)(?![\\w-])|(^|[\\s/])0(?=[\\s/]|$)|var\\(|calc\\(|min\\(|max\\(|clamp\\(|\\b(xx?-small|small|medium|large|xx?-large|xxx-large|larger|smaller)\\b`, 'i').test(value);

function classify(property: string, rawValue: string, steps: readonly string[]): Verdict | undefined {
  if (property.startsWith('--')) {
    // A computed name (`--text-⟨expr⟩`) redefines a step if any step could fill the hole.
    const name = new RegExp(`^--(?:text|leading|weight)-(${property.split(HOLE).map((p) => p.replace(/^--(?:text|leading|weight)-/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*')})$`);
    return /^--(?:text|leading|weight)-/.test(property) && steps.some((s) => name.test(`--text-${s}`) || name.test(`--leading-${s}`) || name.test(`--weight-${s}`))
      ? 'redefine' : undefined;
  }
  const value = rawValue.replace(/!\s*important\s*$/i, '').trim();
  const lower = value.toLowerCase();
  if (CSS_WIDE_KEYWORDS.has(lower)) return 'neutral';
  if (property === 'font' && SYSTEM_FONT_KEYWORDS.has(lower)) return 'neutral';
  const step = `(?:${steps.map((s) => s.replace(/[-]/g, '\\-')).join('|')})`;
  const onScale = new RegExp(`^var\\(\\s*--text-${step}\\s*(,[\\s\\S]*)?\\)$`);
  const size = property === 'font' ? fontShorthandSize(value) : value;
  return size !== undefined && onScale.test(size) ? 'on' : 'off';
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
 * Every `font-size` / `font` / scale custom-property declaration in `css`,
 * with its rule context. `declarationList` scans an inline `style`/`cssText`
 * string, where declarations sit outside any block. Strings, comments and
 * parentheses are honoured, so a `;` or `{` inside `url(…)` or quotes can't
 * split a rule.
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
    // `${base}font-size:12px`: a hole right before a name ends the interpolated declarations, not the name.
    const property = (text.slice(0, colon).split(HOLE).pop() ?? '').trim().toLowerCase();
    if (property !== 'font-size' && property !== 'font' && !SCALE_PROPERTY.test(property)) return;
    out.push({ selector: stack.join(SCOPE_JOIN), property, value: collapse(text.slice(colon + 1)), line: bufLine });
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (buf.trim() === '' && !/\s/.test(ch)) bufLine = line;
    if (ch === '\n') line++;
    if (quote) {
      if (ch === '\\') { buf += ch + (src[i + 1] ?? ''); i++; continue; }
      if (ch === quote || ch === '\n') quote = null;
      buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '(') parens++;
    if (ch === ')') parens = Math.max(0, parens - 1);
    if (parens > 0) { buf += ch; continue; }
    if (ch === '{') {
      const prelude = collapse(buf);
      // `@property --text-sm { inherits: false; initial-value: 13px }` re-registers a step: descendants stop inheriting :root's value.
      const registered = /^@property\s+(--[\w-]+)$/i.exec(prelude)?.[1];
      if (registered && SCALE_PROPERTY.test(registered)) {
        out.push({ selector: [...stack, prelude].join(SCOPE_JOIN), property: registered, value: '@property', line: bufLine });
      }
      stack.push(prelude);
      buf = '';
      continue;
    }
    if (ch === ';') { flushDecl(); continue; }
    if (ch === '}') { flushDecl(); stack.pop(); continue; }
    buf += ch;
  }
  flushDecl();
  return out;
}

// ── TypeScript scanner ───────────────────────────────────────────────────────

/** Strips syntax that doesn't change a value: `(…)`, `as T`, `satisfies T`, `<T>…`, `…!`. */
function unwrap(node: ts.Node): ts.Node {
  while (
    ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)
  ) node = node.expression;
  return node;
}

/** Text of a string-ish expression (wrappers stripped), with HOLE standing in for template holes. */
function literalText(expr: ts.Node): string | undefined {
  const node = unwrap(expr);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((s) => HOLE + s.literal.text).join('');
  return undefined;
}

function nameOf(node: ts.Node): string | undefined {
  const name = (node as { name?: ts.Node }).name;
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return literalText(name.expression) ?? `[${name.expression.getText()}]`;
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

/** A style property name as written in TS (`fontSize`, `'font-size'`, `font`, `'--text-sm'`) → its CSS name, if it is one we track. */
function cssPropertyOf(name: string | undefined): string | undefined {
  if (name === 'fontSize' || name === 'font-size') return 'font-size';
  if (name === 'font') return 'font';
  if (name && (SCALE_PROPERTY.test(name) || /^--(?:text|leading|weight)-/.test(name))) return name;
  return undefined;
}

const isAssignment = (k: ts.SyntaxKind) => k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment;

/**
 * A custom-property name built with `+` or a template: literal parts are kept and every unknown part becomes
 * HOLE (`'--text-' + step` → `--text-⟨expr⟩`). Only a name that starts with a scale family is returned, so a
 * name that is entirely unknown (`setProperty(k, v)`) is left alone rather than flagged.
 */
function foldedName(expr: ts.Node): string | undefined {
  const fold = (n: ts.Node): string => {
    const e = unwrap(n);
    const text = literalText(e);
    if (text !== undefined) return text;
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) return fold(e.left) + fold(e.right);
    return HOLE;
  };
  const name = fold(expr);
  return /^--(?:text|leading|weight)-/.test(name) ? name : undefined;
}

/** `x.cssText` / `x['cssText']` → `cssText`. */
const accessName = (n: ts.Node) =>
  ts.isPropertyAccessExpression(n) ? n.name.text : ts.isElementAccessExpression(n) ? literalText(n.argumentExpression) : undefined;

/** Whether `text` has a `{` (a sheet) or a `;` (a declaration list) outside quotes and parentheses. */
function cssStructure(text: string): { block: boolean; separated: boolean } {
  let quote: string | null = null;
  let parens = 0;
  let block = false;
  let separated = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote || ch === '\n') quote = null; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') parens++;
    else if (ch === ')') parens = Math.max(0, parens - 1);
    else if (parens === 0 && ch === '{') block = true;
    else if (parens === 0 && ch === ';') separated = true;
  }
  return { block, separated };
}

/**
 * `font-size` / `font` / scale declarations written as CSS text inside a string
 * or template. `cssDestination`: the string is assigned to `cssText` or passed
 * to `setAttribute('style', …)`, so it is CSS whatever it looks like.
 */
function scanCssText(text: string, scope: string, line: number, cssDestination = false): CssDecl[] {
  // CSS by construction: markup style attributes, sheets, `;`-separated lists and CSS destinations.
  const out: CssDecl[] = [];
  // A lone `font:` in plain text may be prose (`Font: Lora`), so it only counts when it carries a size.
  const loose: CssDecl[] = [];
  let rest = text;
  // Markup only where a real tag can start (`<div`, `</`, `<!`), and never in a string bound for cssText or a
  // style attribute: a quoted "<" … ">" in CSS is text, and stripping it as a tag would delete the CSS between.
  if (!cssDestination && /<[a-zA-Z!/?]/.test(rest)) {
    // Markup: style="…" attributes are declaration lists; SVG font-size="…" is a size; <style> bodies are sheets.
    rest = rest.replace(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi, (_, _q, body: string) => {
      for (const d of scanCss(body, true, line)) out.push({ ...d, selector: scope + SCOPE_JOIN + 'style=""' });
      return ' ';
    });
    rest = rest.replace(/\bfont-size\s*=\s*(["'])([^"']*)\1/gi, (_, _q, value: string) => {
      out.push({ selector: scope + SCOPE_JOIN + 'font-size=""', property: 'font-size', value, line });
      return ' ';
    });
    rest = rest.replace(/<[a-zA-Z!/?][^>]*>/g, ' ');
  }
  if (/font(-size)?\s*:|--(text|leading|weight)-[\w-]+\s*:|@property/i.test(rest)) {
    // Comments go first, so a `{` or `;` inside one can't pick the scan mode.
    rest = stripCssComments(rest);
    const { block, separated } = cssStructure(rest);
    for (const d of scanCss(rest, !block, line)) {
      (cssDestination || block || separated ? out : loose).push({ ...d, selector: d.selector ? scope + SCOPE_JOIN + d.selector : scope });
    }
  }
  return [...out, ...loose.filter((d) => d.property !== 'font' || looksLikeFontShorthand(d.value))];
}

function scanTs(file: string, source: string): CssDecl[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : /\.[cm]?jsx$/.test(file) ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const out: CssDecl[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const valueText = (n: ts.Node) => literalText(n) ?? unwrap(n).getText(sf);
  /** `objectKey`: the value sits under a `font` key in an object literal, which may be data rather than a style. */
  const push = (at: ts.Node, property: string, valueNode: ts.Node | undefined, fallback = '', objectKey = false) => {
    const value = valueNode ? valueText(valueNode) : fallback;
    // `font` is also a common name for a family choice ({ font: 'Lora' }); under an object key, only a value with a
    // size is a shorthand. `el.style.font`, `ctx.font` and setProperty('font', …) always take one, so they always count.
    if (property === 'font' && objectKey && (!valueNode || literalText(valueNode) === undefined || !looksLikeFontShorthand(value))) return;
    out.push({ selector: scopeChain(at), property, value, line: lineOf(at) });
  };

  const visit = (node: ts.Node): void => {
    // { fontSize: … } / { 'font-size': … } / { ['fontSize']: … } / { fontSize } / { font: '…' } / { '--text-sm': … }
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const property = cssPropertyOf(nameOf(node));
      if (property) {
        if (ts.isPropertyAssignment(node)) push(node, property, node.initializer, '', true);
        else if (property === 'font-size') push(node, property, undefined, node.name.text);
      }
    }
    // <text fontSize={12}> / <text font-size="12">
    else if (ts.isJsxAttribute(node) && cssPropertyOf(node.name.getText(sf)) === 'font-size') {
      const init = node.initializer;
      const expr = init && ts.isJsxExpression(init) ? init.expression : init;
      out.push({ selector: scopeChain(node.name), property: 'font-size', value: expr ? valueText(expr) : '', line: lineOf(node) });
    }
    // el.style.fontSize = … / el.style['font-size'] = … / ctx.font = … (any assignment operator)
    else if (ts.isBinaryExpression(node) && isAssignment(node.operatorToken.kind)) {
      const property = cssPropertyOf(accessName(node.left));
      if (property) push(node, property, node.right);
    }
    // setProperty('font-size' | 'font' | '--text-sm', …) / setAttribute('font-size', …) / setAttributeNS(ns, 'font-size', …)
    else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const at = method === 'setAttributeNS' ? 1 : 0;
      const name = node.arguments.length > at + 1 ? literalText(node.arguments[at]) ?? foldedName(node.arguments[at]) : undefined;
      const property = cssPropertyOf(name);
      if (property && (method === 'setProperty' || ((method === 'setAttribute' || method === 'setAttributeNS') && property === 'font-size'))) {
        push(node, property, node.arguments[at + 1]);
      }
      // CSS.registerProperty({ name: '--text-sm', inherits: false, initialValue: '13px' }) re-registers a step.
      const spec = node.arguments[0] && unwrap(node.arguments[0]);
      if (method === 'registerProperty' && spec && ts.isObjectLiteralExpression(spec)) {
        const nameProp = spec.properties.find((p) => ts.isPropertyAssignment(p) && nameOf(p) === 'name');
        const registered = nameProp && ts.isPropertyAssignment(nameProp) ? literalText(nameProp.initializer) : undefined;
        if (registered && SCALE_PROPERTY.test(registered)) {
          out.push({ selector: scopeChain(node), property: registered, value: 'registerProperty', line: lineOf(node) });
        }
      }
    }
    // 'font-size:12px;…' / `top:${y}px;font-size:12px` / '<span style="font-size:9px">' inside a string or template
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      // Climb through `(…)` / `as` / `satisfies` / `!` so a wrapped value still finds its CSS destination.
      let value: ts.Node = node;
      while (unwrap(value.parent) !== value.parent || ts.isParenthesizedExpression(value.parent)) value = value.parent;
      const parent = value.parent;
      const cssDestination =
        (ts.isBinaryExpression(parent) && parent.right === value && isAssignment(parent.operatorToken.kind) && accessName(parent.left) === 'cssText') ||
        (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression) && parent.expression.name.text === 'setAttribute' &&
          parent.arguments[1] === value && literalText(parent.arguments[0]) === 'style');
      out.push(...scanCssText(literalText(node) ?? '', scopeChain(node), lineOf(node), cssDestination));
    }
    // Template spans are TemplateMiddle/Tail nodes, never re-scanned as strings, so visiting children can't double count.
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
  return decls.flatMap((d) => {
    const verdict = classify(d.property, d.value, steps);
    return verdict ? [{ file, ...d, verdict }] : [];
  });
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

/**
 * The ledgers as they stood at T0 (main cc8df81). The per-file and per-entry
 * checks below compare the tree against the JSON; this pins the JSON itself,
 * so a raised count or a new key can't ride in on a data-only edit.
 */
const T0 = { baselineTotal: 1999, baselineFiles: 176, allowlistTotal: 18, allowlistEntries: 16 } as const;

type Counts = Readonly<Record<string, number>>;

/**
 * Per-file ceilings: typeScale.baseline.json as it stood at T0 (main cc8df81).
 * baseline.json may never put a file above its ceiling, and a file missing
 * here has ceiling 0, so a raised count or a new file can't land as a
 * data-only JSON edit, not even when a cut elsewhere keeps the totals level.
 * Lower an entry when its debt is paid down (delete it at 0); raising one
 * needs the owner's sign-off.
 */
const T0_CEILINGS: Counts = {
  'AccountModal.css': 2,
  'AgentHubPanel.css': 39,
  'App.css': 13,
  'AppNavRail.css': 16,
  'ArchiveConfirmDialog.css': 4,
  'ArchivePanel.css': 13,
  'Backlinks.css': 6,
  'BetaReadMargin.css': 5,
  'BlockEditor.css': 11,
  'BottomBar.css': 5,
  'BrainstormPage.css': 90,
  'ConcurrentSessionModal.css': 3,
  'ContinuityPanel.css': 2,
  'DesktopShell.css': 39,
  'DocHeader.css': 7,
  'DockedTabBar.css': 7,
  'DraftHistoryPanel.css': 10,
  'EmbeddedSpanPreview.css': 1,
  'EntityBrowser.css': 22,
  'EntityDetail.css': 35,
  'EntityMention.css': 3,
  'EntriesPanel.css': 18,
  'ExportDialog.css': 19,
  'FloatingPanelApp.css': 5,
  'FocusModePrefsDialog.css': 4,
  'FormatToolbar.css': 3,
  'GlobalRightSidebar.css': 9,
  'GlobalSearchPanel.css': 19,
  'InconsistencyCard.css': 3,
  'KanbanBoard.css': 24,
  'KeyboardShortcutsDialog.css': 8,
  'LayoutManagerDialog.css': 14,
  'LayoutPicker.css': 8,
  'LeftRail.css': 25,
  'ManuscriptStructureView.css': 4,
  'MarginRuler.css': 1,
  'MoveVaultWizard.css': 11,
  'NoteProperties.css': 11,
  'NoteSplitPane.css': 2,
  'NoteViewer.css': 34,
  'NotesTabPanel.css': 15,
  'NotificationCenter.tsx': 5,
  'OutlinePlanningPanel.css': 6,
  'PageChromeToolbar.css': 6,
  'PageRuler.css': 1,
  'PageSetupPopover.css': 11,
  'PaneTip.css': 3,
  'PanelDragContext.css': 3,
  'ProgressDashboard.css': 18,
  'ProjectSwitcher.css': 5,
  'PromptHistoryPanel.css': 18,
  'ReferencesPanel.css': 1,
  'SceneEditorEmptyState.css': 1,
  'SceneHistory.css': 19,
  'SceneNotesPanel.css': 7,
  'ScenePreviewPanel.css': 5,
  'ScenePropertiesPanel.css': 1,
  'SearchBar.css': 7,
  'SettingsPanel.css': 83,
  'SplitEditorPane.css': 9,
  'StoryNavigator.css': 14,
  'StorySubViewBar.css': 5,
  'StoryTimeline.css': 14,
  'StructuralBreadcrumb.css': 1,
  'SuggestionDetailPane.css': 26,
  'SuggestionReview.css': 34,
  'TabBar.css': 3,
  'TagInput.css': 4,
  'ThemeContrastSlider.css': 5,
  'TimelineBlock.css': 6,
  'TimelineCharacterPresenceTable.css': 3,
  'TimelineHeader.css': 7,
  'TimelinePicker.css': 10,
  'TimelinePlotlines.css': 10,
  'TimelineRelationships.css': 4,
  'TimelineRoot.css': 33,
  'TimelineSpreadsheet.css': 6,
  'TimelineSubway.css': 8,
  'TimelineSubwayTableToggle.css': 2,
  'TimelineTension.css': 3,
  'TimestampEditor.css': 5,
  'TrackTimeline.css': 8,
  'UpdateBanner.css': 6,
  'VaultGraphView.css': 41,
  'VaultSidebar.css': 37,
  'WelcomeOverlay.css': 7,
  'WikiLinkHoverPreview.css': 4,
  'WikiLinkPicker.css': 3,
  'WorkspaceSplitDropZones.css': 1,
  'WorkspaceSplitPane.css': 3,
  'WorkspaceTabBar.css': 6,
  'WritingApp.css': 2,
  'WritingAssistantPanel.css': 48,
  'beta/BetaReaderPage.css': 43,
  'canvas/CanvasBoard.css': 7,
  'coach/CoachPage.css': 27,
  'components/AgentSessionPicker.css': 8,
  'components/AiActivityIndicator/AiActivityIndicator.css': 2,
  'components/BoardIconPicker/BoardIconPicker.css': 4,
  'components/BrainstormBoard/BrainstormBoard.css': 23,
  'components/BrainstormCard/IdeaCard.css': 1,
  'components/BrainstormCard/IdeaDetailDrawer.css': 3,
  'components/BrainstormCard/ProposalCard.css': 1,
  'components/ComposerQuickActions.css': 1,
  'components/ContinuityPanel/ContinuityPanel.css': 14,
  'components/EmptyState/EmptyState.css': 3,
  'components/IconPicker/IconPicker.css': 11,
  'components/ManuscriptStructure/BeatSheetSidebar.css': 8,
  'components/ManuscriptStructure/ListView.css': 11,
  'components/ManuscriptStructure/SceneCard.css': 6,
  'components/ManuscriptStructure/SceneGrid.css': 12,
  'components/ManuscriptStructure/ViewToggle.css': 1,
  'components/MigrationBanner/MigrationBanner.css': 6,
  'components/NewStoryModal.css': 7,
  'components/NoteCoverBadge.css': 2,
  'components/NoteTemplateDialog/NoteTemplateDialog.css': 7,
  'components/NoteThumbnail.css': 1,
  'components/PresetBrowser.css': 9,
  'components/PresetEditor.css': 9,
  'components/PresetSelector.css': 7,
  'components/QualityRubric.css': 10,
  'components/RefinementChips.css': 2,
  'components/SceneHistoryPane/SceneHistoryPane.css': 5,
  'components/SettingsPanel/sections/AboutSection.tsx': 3,
  'components/SettingsPanel/sections/AccountProfileSection.tsx': 7,
  'components/SettingsPanel/sections/AddVaultDialog.css': 11,
  'components/SettingsPanel/sections/AgentsVaultSection.tsx': 8,
  'components/SettingsPanel/sections/EditorManuscriptSection.tsx': 13,
  'components/SettingsPanel/sections/EditorSettingsSection.tsx': 3,
  'components/SettingsPanel/sections/LiquidNeonAppearanceSection.css': 1,
  'components/SettingsPanel/sections/LiquidNeonAppearanceSection.tsx': 32,
  'components/SettingsPanel/sections/M24Controls.tsx': 5,
  'components/SettingsPanel/sections/M24Sections.css': 4,
  'components/SettingsPanel/sections/MythosVaultsSection.tsx': 12,
  'components/SettingsPanel/sections/NotesBoardSection.tsx': 1,
  'components/SettingsPanel/sections/ShortcutsSection.tsx': 2,
  'components/SettingsPanel/sections/SyncBackupSection.tsx': 8,
  'components/SettingsPanel/sections/VaultCreateModePicker.css': 3,
  'components/SettingsPanel/sections/VaultLinkingColumns.tsx': 12,
  'components/SettingsPanel/sections/VaultOverflowMenu.tsx': 1,
  'components/SettingsPanel/sections/liquidNeonControls.tsx': 6,
  'components/StoryVaultPicker.css': 2,
  'components/TagPane/TagPane.css': 5,
  'components/Toast/Toast.css': 3,
  'components/VaultBrowser/VaultBrowser.css': 24,
  'components/VaultNotFoundScreen/VaultNotFoundScreen.css': 3,
  'components/ui/Dialog.css': 1,
  'components/ui/VaultIconAvatar.css': 3,
  'components/ui/WindowChrome.css': 12,
  'drafts/DraftDiffView.css': 9,
  'drafts/DraftsCompareSplit.css': 11,
  'drafts/DraftsPopover.css': 13,
  'index.css': 1,
  'migration/MythosBootMigrationNotice.css': 4,
  'migration/MythosMigration.css': 7,
  'pages/Boards/BoardCanvas.css': 17,
  'pages/Boards/BoardsTabPanel.css': 21,
  'pages/Boards/BrainstormBoardPage.css': 14,
  'pages/Boards/RecentlyDeletedPanel.css': 7,
  'pages/SceneCrafter/SceneCrafterPage.css': 55,
  'partner/ModelKeysSection.css': 26,
  'partner/PartnerCallChrome.css': 8,
  'partner/QuestionsForYou.css': 12,
  'partner/WritingPartnerSection.css': 25,
  'story/BookPreview.css': 23,
  'story/CommentsGutter.css': 17,
  'story/ManuscriptView.css': 14,
  'story/ReaderBar.css': 11,
  'story/TitleRow.css': 9,
  'theme/lnToast.ts': 1,
  'timeline2/AxisView.css': 32,
  'timeline2/DualStampChips.css': 1,
  'timeline2/SyncLineOverlay.css': 4,
  'timeline2/Timeline2Modals.css': 15,
  'timeline2/TimelineWikiText.css': 1,
  'timeline2/panel/TimelineRightPanel.css': 57,
};

const sum = (c: Counts) => Object.values(c).reduce((a, n) => a + n, 0);

/** The baseline ledger's totals that exceed T0. */
function baselineTotalsOver(ledger: Counts): string[] {
  const now = { baselineTotal: sum(ledger), baselineFiles: Object.keys(ledger).length };
  return (Object.keys(now) as Array<keyof typeof now>)
    .filter((k) => now[k] > T0[k])
    .map((k) => `TOTAL ${k}: T0 ${T0[k]}, now ${now[k]}`);
}

/** Files baseline.json puts above their T0 ceiling. */
function ceilingProblems(ledger: Counts): string[] {
  return Object.entries(ledger)
    .filter(([file, n]) => n > (T0_CEILINGS[file] ?? 0))
    .map(([file, n]) =>
      `RAISED ${file}: baseline.json says ${n}, T0 ceiling ${T0_CEILINGS[file] ?? 0}. ` +
      'Counts may only fall; move the size onto a --text-* token instead.');
}

/** Every way per-file off-scale counts (`found`) and a baseline ledger break the ratchet. */
function baselineProblems(found: Counts, ledger: Counts): string[] {
  const files = [...new Set([...Object.keys(found), ...Object.keys(ledger)])].sort();
  const counts = files.flatMap((file) => {
    const f = found[file] ?? 0;
    const n = ledger[file] ?? 0;
    return f > n ? [`GREW ${file}: baseline ${n}, found ${f}`] : f < n ? [`FELL ${file}: baseline ${n}, found ${f}`] : [];
  });
  return [...counts, ...ceilingProblems(ledger), ...baselineTotalsOver(ledger)];
}

/** Scale steps declared or registered anywhere but tokens.css, the one file allowed to define them. */
const redefinitionsOutsideTokens = (us: readonly Usage[]) => us.filter((u) => u.verdict === 'redefine' && u.file !== 'tokens.css');

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
      ['Card >> <span style>', `${HOLE}px`, 'off'],
      ['toast', '12px', 'off'],
      ['sheet >> .x', '600 var(--text-sm)/1 sans', 'on'],
    ]);
  });

  it('reads the size slot of a font shorthand, not whatever slot holds a step', () => {
    expect(css(`
      .a { font: 600 13px/var(--text-sm) sans-serif; }
      .b { font: 13px var(--text-sm), sans-serif; }
      .c { font: var(--weight-sm) var(--text-sm)/var(--leading-sm) var(--font-sans); }
      .d { font: italic bold var(--text-lg) serif; }
      .e { font: caption; }
    `)).toEqual([
      ['.a', 'font', '600 13px/var(--text-sm) sans-serif', 'off'],
      ['.b', 'font', '13px var(--text-sm), sans-serif', 'off'],
      ['.c', 'font', 'var(--weight-sm) var(--text-sm)/var(--leading-sm) var(--font-sans)', 'on'],
      ['.d', 'font', 'italic bold var(--text-lg) serif', 'on'],
      ['.e', 'font', 'caption', 'neutral'],
    ]);
  });

  it('finds the size slot after a weight token when there is no line-height', () => {
    expect(css('.a { font: var(--weight-sm) var(--text-sm) sans-serif; } .b { font: var(--weight-sm) 13px sans-serif; }')).toEqual([
      ['.a', 'font', 'var(--weight-sm) var(--text-sm) sans-serif', 'on'],
      ['.b', 'font', 'var(--weight-sm) 13px sans-serif', 'off'],
    ]);
  });

  it('counts a TS font shorthand whose size is a hole, a percentage or a bare zero, but not a family pick', () => {
    expect(tsx(`
      function paint(el: HTMLElement) {
        const o = { a: { font: \`\${size}px serif\` }, b: { font: '0 sans-serif' }, c: { font: '100% sans-serif' }, d: { font: 'Lora' } };
        el.style.cssText = 'font: 100% serif';
      }
    `)).toEqual([
      ['paint >> o >> a', `${HOLE}px serif`, 'off'],
      ['paint >> o >> b', '0 sans-serif', 'off'],
      ['paint >> o >> c', '100% sans-serif', 'off'],
      ['paint', '100% serif', 'off'],
    ]);
  });

  it('does not take a quoted /* or */ for a comment, so declarations between them still count', () => {
    expect(css('.a { --open: "/*"; font-size: 13px; --close: "*/"; } /* .gone { font-size: 9px; } */')).toEqual([
      ['.a', 'font-size', '13px', 'off'],
    ]);
  });

  it('flags a scale step re-registered with @property or CSS.registerProperty', () => {
    expect(css('@property --text-sm { syntax: "<length>"; inherits: false; initial-value: 13px; } @property --glow { syntax: "*"; inherits: false; }')).toEqual([
      ['@property --text-sm', '--text-sm', '@property', 'redefine'],
    ]);
    expect(tsx(`
      function paint() {
        CSS.registerProperty({ name: '--text-sm', syntax: '<length>', inherits: false, initialValue: '13px' });
        CSS.registerProperty({ name: '--glow', syntax: '*', inherits: false });
      }
    `)).toEqual([['paint', 'registerProperty', 'redefine']]);
  });

  it('reads CSS strings by their structure and destination, not by a stray brace or a missing size', () => {
    expect(tsx(`
      function paint(el: HTMLElement) {
        el.style.cssText = 'content: "{"; font-size: 13px;';
        el.style.cssText = \`font: \${size} serif;\`;
        el.style.cssText = \`font: \${size} serif\`;
        el.setAttribute('style', \`font: \${size} serif\`);
        const label = \`Font: \${name}\`;
      }
    `)).toEqual([
      ['paint', '13px', 'off'],
      ['paint', `${HOLE} serif`, 'off'],
      ['paint', `${HOLE} serif`, 'off'],
      ['paint', `${HOLE} serif`, 'off'],
    ]);
  });

  it('sees through parentheses, as const, satisfies and other syntax-only wrappers', () => {
    expect(tsx(`
      function paint(el: HTMLElement) {
        const o = { a: { font: '13px serif' as const }, b: { fontSize: 'var(--text-sm)' as const }, c: { fontSize: (12) } };
        el.style.font = ('13px serif');
        el.style.fontSize = '12px' satisfies string;
        el.style.setProperty('font-size', ('var(--text-xs)' as string)!);
      }
    `)).toEqual([
      ['paint >> o >> a', '13px serif', 'off'],
      ['paint >> o >> b', 'var(--text-sm)', 'on'],
      ['paint >> o >> c', '12', 'off'],
      ['paint', '13px serif', 'off'],
      ['paint', '12px', 'off'],
      ['paint', 'var(--text-xs)', 'on'],
    ]);
  });

  it('counts any value at a CSS font destination; only an object key named font may be a family pick', () => {
    expect(tsx(`
      function paint(el: HTMLElement, ctx: CanvasRenderingContext2D) {
        el.style.setProperty('font', \`\${size} serif\`);
        el.style.font = \`\${size} serif\`;
        ctx.font = fontSpec;
        const prefs = { font: fontName, story: { font: \`\${family}\` } };
      }
    `)).toEqual([
      ['paint', `${HOLE} serif`, 'off'],
      ['paint', `${HOLE} serif`, 'off'],
      ['paint', 'fontSpec', 'off'],
    ]);
  });

  it('finds the CSS destination through (…), as and ! wrappers around the value', () => {
    expect(tsx(`
      function paint(el: HTMLElement) {
        el.style.cssText = (\`font: \${size} serif\` as string);
        el.setAttribute('style', (\`font: \${size} serif\`)!);
      }
    `)).toEqual([
      ['paint', `${HOLE} serif`, 'off'],
      ['paint', `${HOLE} serif`, 'off'],
    ]);
  });

  it('keeps CSS between a quoted < and > and ignores a { inside a comment when choosing the scan mode', () => {
    expect(tsx(`
      function paint(el: HTMLElement) {
        el.style.cssText = '--open: "<"; font-size: 13px; --close: ">";';
        const sheet = '.a::before { content: "<"; } .b { font-size: 12px; } .c::after { content: ">"; }';
        el.style.cssText = '/* panel { */ font-size: 11px;';
        el.innerHTML = '<span style="font-size:10px">x</span>';
      }
    `)).toEqual([
      ['paint', '13px', 'off'],
      ['paint >> sheet >> .b', '12px', 'off'],
      ['paint', '11px', 'off'],
      ['paint >> style=""', '10px', 'off'],
    ]);
  });

  it('does not let quotes, escapes, parentheses or stray top-level text split or invent a rule', () => {
    expect(css(`
      font-size: 7px;
      .f { content: "{"; font-size: 12px; }
      .g { content: "\\""; font-size: 9px; }
      .h { background: url(x{y;z); font-size: 8px; }
    `)).toEqual([
      ['.f', 'font-size', '12px', 'off'],
      ['.g', 'font-size', '9px', 'off'],
      ['.h', 'font-size', '8px', 'off'],
    ]);
  });

  it('finds font sizes in templates with holes, in markup strings and in SVG attributes', () => {
    expect(tsx(`
      function paint(el: HTMLElement, t: SVGTextElement) {
        el.style.cssText = \`color:\${c};font-size:12px\`;
        el.style.cssText = \`font-size:\${n}px\`;
        el.style.cssText = \`\${base}font-size:11px\`;
        el.style.cssText = '/*x*/font-size:10px';
        const sheet = \`.x { font-size: \${n}px; }\`;
        const both = \`font-size:12px;\${on ? \`font-size:13px\` : ''}\`;
        el.innerHTML = \`<span style="font-size:13px">\${x}</span>\`;
        el.innerHTML = '<svg><text font-size="9">A</text></svg>';
        t.setAttribute('font-size', '8');
      }
    `)).toEqual([
      ['paint', '12px', 'off'],
      ['paint', `${HOLE}px`, 'off'],
      ['paint', '11px', 'off'],
      ['paint', '10px', 'off'],
      ['paint >> sheet >> .x', `${HOLE}px`, 'off'],
      ['paint >> both', '12px', 'off'],
      ['paint >> both', '13px', 'off'],
      ['paint >> style=""', '13px', 'off'],
      ['paint >> font-size=""', '9', 'off'],
      ['paint', '8', 'off'],
    ]);
  });

  it('finds element-access, computed-key, compound-assignment and font-shorthand forms', () => {
    expect(tsx(`
      function paint(el: HTMLElement, ctx: CanvasRenderingContext2D) {
        el.style['fontSize'] = '13px';
        el.style['font-size'] += '1px';
        const o = { ['fontSize']: 12, font: '600 11px/1 sans', pick: { font: 'Lora' }, fam: { font: fontName } };
        el.style.font = '10px sans';
        ctx.font = 'bold 9px serif';
        el.style.setProperty('font', 'var(--text-sm) x');
        return <div style={{ font: 'inherit' }} />;
      }
    `)).toEqual([
      ['paint', '13px', 'off'],
      ['paint', '1px', 'off'],
      ['paint >> o', '12', 'off'],
      ['paint >> o', '600 11px/1 sans', 'off'],
      ['paint', '10px sans', 'off'],
      ['paint', 'bold 9px serif', 'off'],
      ['paint', 'var(--text-sm) x', 'on'],
      ['paint >> <div style>', 'inherit', 'neutral'],
    ]);
  });

  it('flags a scale step declared outside tokens.css, and ignores the colour tokens', () => {
    expect(css(':root { --text-sm: 13px; --text-header: #fff; --leading-sm: 1; } .x { --weight-xs: 700; }')).toEqual([
      [':root', '--text-sm', '13px', 'redefine'],
      [':root', '--leading-sm', '1', 'redefine'],
      ['.x', '--weight-xs', '700', 'redefine'],
    ]);
    expect(tsx(`
      function Dense() {
        document.documentElement.style.setProperty('--text-sm', '13px');
        document.documentElement.style.setProperty('--text-header', '#fff');
        return <div style={{ '--text-xs': '11px' } as CSSProperties} />;
      }
    `)).toEqual([
      ['Dense', '13px', 'redefine'],
      ['Dense >> <div style>', '11px', 'redefine'],
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

  it('the ledgers never exceed their T0 totals', () => {
    const baselineTotal = Object.values(baseline).reduce((a, n) => a + n, 0);
    const allowTotal = allowlist.reduce((a, e) => a + e.count, 0);
    const now = { baselineTotal, baselineFiles: Object.keys(baseline).length, allowlistTotal: allowTotal, allowlistEntries: allowlist.length };
    const over = (Object.keys(T0) as Array<keyof typeof T0>).filter((k) => now[k] > T0[k]);
    expect(over, `Ledgers may only shrink. T0 ${JSON.stringify(T0)}, now ${JSON.stringify(now)}. ` +
      'Raising one needs the owner\'s sign-off and an edit to T0 in this file.').toEqual([]);
  });

  it('baseline.json keeps every file at or under its T0 ceiling', () => {
    const raised = ceilingProblems(baseline);
    expect(raised, raised.join('\n')).toEqual([]);
  });

  it('baseline counts are positive integers with posix paths', () => {
    for (const [file, n] of Object.entries(baseline)) {
      expect(Number.isInteger(n) && n > 0, `${file}: ${n}`).toBe(true);
      expect(file, 'use / in baseline paths').not.toContain('\\');
    }
  });
});

describe('#1773 type-scale guard — the scale is defined in tokens.css only', () => {
  const steps = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl'];
  const redefined = (file: string, src: string) =>
    redefinitionsOutsideTokens(scanFile(file, src, steps)).map((u) => [u.file, u.selector, u.property, u.value]);

  it('flags theme.ts writing a step, through setProperty, a style object or cssText', () => {
    expect(redefined('theme.ts', `
      export function applyDensity(root: HTMLElement) {
        root.style.setProperty('--text-sm', '13px');
        Object.assign(root.style, { '--leading-sm': '1.2' });
        root.style.cssText += '--weight-sm: 500;';
        root.style.setProperty('--text-header', '#fff');
      }
    `)).toEqual([
      ['theme.ts', 'applyDensity', '--text-sm', '13px'],
      ['theme.ts', 'applyDensity', '--leading-sm', '1.2'],
      ['theme.ts', 'applyDensity', '--weight-sm', '500'],
    ]);
  });

  it('flags computed step names and wrapped registerProperty options in any file, not just theme.ts', () => {
    expect(redefined('components/Dense.ts', `
      export function dense(root: HTMLElement, step: string, k: string, v: string) {
        root.style.setProperty('--text-' + 'sm', '13px');
        root.style.setProperty(\`--leading-\${step}\`, '1.2');
        root.style.setProperty(('--weight-' + step) as string, '500');
        root.style.setProperty(k, v);
        root.style.setProperty('--neon-' + step, '#fff');
        root.style.setProperty('--text-' + 'header', '#fff');
        CSS.registerProperty(({ name: '--text-sm', syntax: '<length>', inherits: false, initialValue: '13px' } as const));
      }
    `)).toEqual([
      ['components/Dense.ts', 'dense', '--text-sm', '13px'],
      ['components/Dense.ts', 'dense', `--leading-${HOLE}`, '1.2'],
      ['components/Dense.ts', 'dense', `--weight-${HOLE}`, '500'],
      ['components/Dense.ts', 'dense', '--text-sm', 'registerProperty'],
    ]);
  });

  it('flags @property re-registering a step in any stylesheet but tokens.css', () => {
    const rule = '@property --text-sm { syntax: "<length>"; inherits: false; initial-value: 13px; }';
    expect(redefined('components/Dense.css', rule)).toEqual([['components/Dense.css', '@property --text-sm', '--text-sm', '@property']]);
    expect(redefined('theme/inject.ts', `export const sheet = '${rule}';`)).toEqual([['theme/inject.ts', 'sheet >> @property --text-sm', '--text-sm', '@property']]);
    expect(redefined('tokens.css', `:root { --text-sm: 14px; } ${rule}`)).toEqual([]);
  });
});

describe('#1773 type-scale guard — a ledger edit cannot undo the ratchet', () => {
  const tag = (problem: string) => problem.slice(0, problem.indexOf(':'));
  const edit = (ledger: Counts, changes: Record<string, number>) =>
    Object.fromEntries(Object.entries({ ...ledger, ...changes }).filter(([, n]) => n > 0));

  it('the T0 ledger, matched by its tree, has no problems', () => {
    expect(baselineProblems(T0_CEILINGS, T0_CEILINGS)).toEqual([]);
  });

  it('a raise in one file paid for by a cut in another fails, with the totals level', () => {
    // App.css gains a hard-coded size and its count is raised to match; AccountModal.css pays one down.
    const ledger = edit(T0_CEILINGS, { 'App.css': T0_CEILINGS['App.css'] + 1, 'AccountModal.css': T0_CEILINGS['AccountModal.css'] - 1 });
    expect(sum(ledger)).toBe(sum(T0_CEILINGS));
    expect(baselineProblems(ledger, ledger).map(tag)).toEqual(['RAISED App.css']);
  });

  it('a new file with one stray off-scale size fails, whether or not baseline.json lists it', () => {
    const stray = 'components/NewStray.css';
    expect(baselineProblems(edit(T0_CEILINGS, { [stray]: 1 }), T0_CEILINGS).map(tag)).toEqual([`GREW ${stray}`]);
    // Listing it while a one-count file is paid down to zero keeps both totals level, and still fails.
    const ledger = edit(T0_CEILINGS, { [stray]: 1, 'PageRuler.css': 0 });
    expect([sum(ledger), Object.keys(ledger).length]).toEqual([T0.baselineTotal, T0.baselineFiles]);
    expect(baselineProblems(ledger, ledger).map(tag)).toEqual([`RAISED ${stray}`]);
  });
});

describe('#1773 type-scale guard — off-scale font sizes may only fall', () => {
  const usages = scanTree(scaleSteps());

  it('no scale step is declared outside tokens.css', () => {
    const redefined = redefinitionsOutsideTokens(usages);
    expect(redefined, `The --text-*/--leading-*/--weight-* steps live in tokens.css only:\n${where(redefined)}`).toEqual([]);
  });

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
