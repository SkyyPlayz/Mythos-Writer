/**
 * #1773 T0 — the `--text-*` type scale in tokens.css is the one #1773 builds
 * on, and nothing else redefines it.
 *
 * typeScale.guard.test.ts measures every font size against these steps, and
 * later #1773 slices move UI text onto them (13px → `--text-sm`). Neither of
 * those means anything if a step quietly changes value, a new step appears,
 * or a theme, density block or theme.ts starts overriding one at runtime. This
 * pins the scale as it stands at T0. A step redeclared in any other source
 * file is caught by typeScale.guard.test.ts, which already walks the tree.
 *
 * A size step is any `--text-*` token whose value is not a colour, whatever
 * form it takes (`14px`, `calc(…)`, `clamp(…)`, `var(--text-lg)`), so a new
 * step can't slip in by avoiding a plain length. theme.ts is read as a
 * TypeScript AST: no string in it may name a step, and no setProperty name,
 * however it is built, may be able to produce one.
 *
 * Read-only: it reads tokens.css and theme.ts and never writes to them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const SRC = resolve(__dirname);
/** Drops CSS comments, but not a `/*` inside a quoted string (a string ends at a newline, as in CSS). */
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
      i = end < 0 ? css.length : end + 1;
      continue;
    }
    out += ch;
  }
  return out;
}
const tokensCss = stripCssComments(readFileSync(join(SRC, 'tokens.css'), 'utf-8'));
const themeTs = readFileSync(join(SRC, 'theme.ts'), 'utf-8');

/** The approved scale, smallest first: [step, px, line-height, weight]. */
const SCALE = [
  ['xs', 12, 1.4, 400],
  ['sm', 14, 1.5, 400],
  ['base', 16, 1.6, 400],
  ['lg', 18, 1.4, 600],
  ['xl', 20, 1.3, 600],
  ['2xl', 24, 1.25, 600],
  ['3xl', 28, 1.2, 700],
] as const;

interface Decl {
  name: string;
  value: string;
  /** Every enclosing rule and at-rule from the top level down, joined with ` >> ` (`@media (…) >> :root`). */
  rule: string;
}

/**
 * Every custom-property declaration in tokens.css with its enclosing rule.
 * Quotes (with escapes) and parentheses are honoured, so a `}` or `;` inside
 * `"…"` or `url(…)` can't end a rule early.
 */
function customProperties(css: string): Decl[] {
  const out: Decl[] = [];
  const stack: string[] = [];
  let buf = '';
  let quote: string | null = null;
  let parens = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      buf += ch;
      if (ch === '\\' && i + 1 < css.length) buf += css[++i];
      else if (ch === quote || ch === '\n') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '(') parens++;
    if (ch === ')') parens = Math.max(0, parens - 1);
    if (parens > 0) { buf += ch; continue; }
    if (ch === '{') { stack.push(buf.replace(/\s+/g, ' ').trim()); buf = ''; continue; }
    if (ch === ';' || ch === '}') {
      const m = /^\s*(--[\w-]+)\s*:\s*([\s\S]*?)\s*$/.exec(buf);
      if (m && stack.length) out.push({ name: m[1], value: m[2], rule: stack.join(' >> ') });
      buf = '';
      if (ch === '}') stack.pop();
      continue;
    }
    buf += ch;
  }
  return out;
}

const decls = customProperties(tokensCss);
const stepNames: string[] = SCALE.flatMap(([step]) => [`--text-${step}`, `--leading-${step}`, `--weight-${step}`]);
const declsOf = (name: string) => decls.filter((d) => d.name === name);

const COLOUR_VALUE = /^(#[0-9a-f]{3,8}|(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(.*\)|transparent|currentcolor|black|white)$/i;

/**
 * Whether a token's value is a colour: a colour literal or function, or a
 * `var()` whose target is a colour everywhere tokens.css defines it. A `var()`
 * to a token tokens.css doesn't define can't be proved a colour.
 */
function isColour(value: string, all: readonly Decl[], seen: ReadonlySet<string> = new Set()): boolean {
  const v = value.replace(/!\s*important\s*$/i, '').trim();
  if (COLOUR_VALUE.test(v)) return true;
  const ref = /^var\(\s*(--[\w-]+)\s*(?:,[\s\S]*)?\)$/.exec(v)?.[1];
  if (!ref || seen.has(ref)) return false;
  const targets = all.filter((d) => d.name === ref);
  return targets.length > 0 && targets.every((d) => isColour(d.value, all, new Set([...seen, ref])));
}

/** The `--text-*` tokens that are sizes: every one whose value is not a colour, in first-declared order. */
const sizeTokenNames = (all: readonly Decl[]) =>
  [...new Set(all.filter((d) => d.name.startsWith('--text-') && !isColour(d.value, all)).map((d) => d.name))];

/**
 * A theme.ts write that names, or could name, a scale step: a string or
 * template whose text contains a step name, or a `setProperty` whose name,
 * folded from literals, `+`, templates and same-file `const` strings, could
 * produce one (an unknown part matches anything).
 */
function scaleWrites(file: string, source: string, steps: readonly string[]): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const consts = new Map<string, ts.Expression>();
  const found: string[] = [];
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const stepIn = new RegExp(`(${steps.map((n) => n.replace(/[-]/g, '\\-')).join('|')})(?![\\w-])`);

  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
      ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const)) {
      consts.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collect);
  };
  /** The name as a pattern: literal text, with `null` for any part that can't be known statically. */
  const fold = (expr: ts.Expression, depth = 0): Array<string | null> => {
    let e = expr;
    while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
    if (ts.isTemplateExpression(e)) {
      return [e.head.text, ...e.templateSpans.flatMap((sp) => [...fold(sp.expression, depth + 1), sp.literal.text])];
    }
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return [...fold(e.left, depth + 1), ...fold(e.right, depth + 1)];
    }
    if (ts.isIdentifier(e) && consts.has(e.text) && depth < 8) return fold(consts.get(e.text)!, depth + 1);
    return [null];
  };
  const canName = (parts: Array<string | null>) => {
    const re = new RegExp(`^${parts.map((p) => (p === null ? '[\\s\\S]*' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')}$`);
    return steps.filter((n) => re.test(n));
  };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const hit = stepIn.exec(node.text)?.[1];
      if (hit) found.push(`${file}:${line(node)} names ${hit}`);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'setProperty' && node.arguments.length > 0) {
      const parts = fold(node.arguments[0]);
      const could = canName(parts);
      // A plain string literal is already reported above; anything built can be caught only here.
      if (could.length && !ts.isStringLiteralLike(node.arguments[0])) {
        found.push(`${file}:${line(node)} setProperty(${node.arguments[0].getText(sf)}) could set ${could.join(', ')}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  collect(sf);
  visit(sf);
  return found;
}

describe('#1773 tokens.css — the --text-* type scale', () => {
  it('records the full rule ancestry, so a step inside @media is not mistaken for :root', () => {
    expect(customProperties('@media (prefers-color-scheme: dark) { :root { --text-sm: 14px; } } :root { --text-xs: 12px; }')).toEqual([
      { name: '--text-sm', value: '14px', rule: '@media (prefers-color-scheme: dark) >> :root' },
      { name: '--text-xs', value: '12px', rule: ':root' },
    ]);
  });

  it('does not let a quoted } or ; end a rule, so a step after it is still seen in :root', () => {
    expect(customProperties(':root { --marker: "}"; --sep: url(a;b); --text-sm: 13px; }'))
      .toEqual([
        { name: '--marker', value: '"}"', rule: ':root' },
        { name: '--sep', value: 'url(a;b)', rule: ':root' },
        { name: '--text-sm', value: '13px', rule: ':root' },
      ]);
  });

  it('does not mistake a quoted /* or */ for a comment, so a step between them is still seen', () => {
    expect(customProperties(stripCssComments(':root { --open: "/*"; --text-sm: 13px; --close: "*/"; } /* gone */')).map((d) => [d.name, d.value]))
      .toEqual([['--open', '"/*"'], ['--text-sm', '13px'], ['--close', '"*/"']]);
  });

  it('no step is re-registered with @property, which would stop descendants inheriting it from :root', () => {
    const registrations = (css: string) =>
      [...css.matchAll(/@property\s+(--(?:text|leading|weight)-[\w-]+)/gi)].map((m) => m[1]).filter((name) => stepNames.includes(name));
    expect(registrations('@property --text-sm { syntax: "<length>"; inherits: false; initial-value: 13px; } @property --glow { syntax: "*"; inherits: false; }'))
      .toEqual(['--text-sm']);
    expect(registrations(tokensCss)).toEqual([]);
  });

  it('defines exactly the seven size steps: every other --text-* token is a colour', () => {
    expect(sizeTokenNames(decls)).toEqual(SCALE.map(([step]) => `--text-${step}`));
  });

  it('a new step hidden after a quoted } still counts against the seven', () => {
    expect(sizeTokenNames(customProperties(':root { --icon: "}"; --text-4xl: 32px }'))).toEqual(['--text-4xl']);
  });

  it('a step defined with calc(), clamp(), min() or var() still counts as a size; only colours are exempt', () => {
    expect(sizeTokenNames(customProperties(`:root {
      --text-xs: 12px; --text-4xl: calc(var(--text-3xl) + 4px); --text-5xl: clamp(32px, 4vw, 40px);
      --text-6xl: min(48px, 5vw); --text-7xl: var(--text-3xl); --text-8xl: var(--not-in-tokens);
      --text-muted: #8a9bb0; --text-hint: var(--text-muted); --text-link: rgb(0 240 255); --text-on: transparent;
    }`))).toEqual(['--text-xs', '--text-4xl', '--text-5xl', '--text-6xl', '--text-7xl', '--text-8xl']);
  });

  it.each(SCALE)('--text-%s is %ipx with line-height %d and weight %i, once, in :root', (step, px, leading, weight) => {
    for (const [name, value] of [[`--text-${step}`, `${px}px`], [`--leading-${step}`, String(leading)], [`--weight-${step}`, String(weight)]]) {
      const found = declsOf(name);
      expect(found.map((d) => d.value), `${name} value`).toEqual([value]);
      expect(found[0].rule, `${name} must live in a top-level, unconditional :root`).toBe(':root');
    }
  });

  it('is strictly ascending, and app text (--text-sm) is 14px', () => {
    const px = SCALE.map(([, size]) => size);
    expect([...px].sort((a, b) => a - b)).toEqual(px);
    expect(new Set(px).size).toBe(px.length);
    expect(declsOf('--text-sm').map((d) => d.value)).toEqual(['14px']);
  });

  it('the colour tokens that share the --text- prefix are not mistaken for steps', () => {
    for (const name of ['--text-header', '--text-body', '--text-muted', '--text-faint', '--text-link']) {
      expect(declsOf(name).length, name).toBeGreaterThan(0);
      expect(declsOf(name).every((d) => isColour(d.value, decls)), name).toBe(true);
    }
  });
});

describe('#1773 theme.ts — never writes the type scale at runtime', () => {
  it('names no --text-/--leading-/--weight- step token anywhere', () => {
    const literals = [...themeTs.matchAll(/['"`](--(?:text|leading|weight)-[\w-]+)['"`]/g)].map((m) => m[1]);
    expect(literals.length, 'theme.ts should still write its --text-* colour tokens').toBeGreaterThan(0);
    expect(literals.filter((name) => stepNames.includes(name))).toEqual([]);
  });

  it('no string, cssText or setProperty name in theme.ts can write a step, however the name is built', () => {
    const writes = scaleWrites('theme.ts', themeTs, stepNames);
    expect(writes, writes.join('\n')).toEqual([]);
  });

  it('catches step writes built from templates, concatenation, consts, loops and cssText', () => {
    expect(scaleWrites('fixture.ts', `
      const PREFIX = '--text-';
      const SIZE = PREFIX + 'sm';
      export function apply(root: HTMLElement, step: string, name: string) {
        root.style.setProperty(\`--text-\${step}\`, '13px');
        root.style.setProperty('--text-' + step, '13px');
        root.style.setProperty(SIZE, '13px');
        ['xs', 'sm'].forEach((s) => root.style.setProperty(PREFIX + s, '13px'));
        root.style.cssText += '--leading-sm: 1;';
        root.style.setProperty(name, '13px');
        root.style.setProperty(\`--neon-\${step}\`, '#fff');
        root.style.setProperty('--text-' + 'header', '#fff');
      }
    `, stepNames).map((w) => w.replace(/^fixture\.ts:(\d+) /, 'L$1 ').replace(/ could set .*/, ' could set …'))).toEqual([
      'L5 setProperty(`--text-${step}`) could set …',
      'L6 setProperty(\'--text-\' + step) could set …',
      'L7 setProperty(SIZE) could set …',
      'L8 setProperty(PREFIX + s) could set …',
      'L9 names --leading-sm',
      'L10 setProperty(name) could set …',
    ]);
  });
});
