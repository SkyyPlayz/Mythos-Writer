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
 * Read-only: it reads tokens.css and theme.ts and never writes to them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

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

/** Every custom-property declaration in tokens.css with its enclosing rule. */
function customProperties(css: string): Decl[] {
  const out: Decl[] = [];
  const stack: string[] = [];
  let buf = '';
  for (const ch of css) {
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
const isLength = (v: string) => /^-?[\d.]+(px|rem|em)$/.test(v);

describe('#1773 tokens.css — the --text-* type scale', () => {
  it('records the full rule ancestry, so a step inside @media is not mistaken for :root', () => {
    expect(customProperties('@media (prefers-color-scheme: dark) { :root { --text-sm: 14px; } } :root { --text-xs: 12px; }')).toEqual([
      { name: '--text-sm', value: '14px', rule: '@media (prefers-color-scheme: dark) >> :root' },
      { name: '--text-xs', value: '12px', rule: ':root' },
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

  it('defines exactly the seven size steps, and no other --text-* token is a length', () => {
    const sizeTokens = [...new Set(decls.filter((d) => d.name.startsWith('--text-') && isLength(d.value)).map((d) => d.name))];
    expect(sizeTokens).toEqual(SCALE.map(([step]) => `--text-${step}`));
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
    for (const name of ['--text-header', '--text-body', '--text-muted']) {
      expect(declsOf(name).length, name).toBeGreaterThan(0);
      expect(declsOf(name).every((d) => !isLength(d.value)), name).toBe(true);
    }
  });
});

describe('#1773 theme.ts — never writes the type scale at runtime', () => {

  it('names no --text-/--leading-/--weight- step token anywhere', () => {
    const literals = [...themeTs.matchAll(/['"`](--(?:text|leading|weight)-[\w-]+)['"`]/g)].map((m) => m[1]);
    expect(literals.length, 'theme.ts should still write its --text-* colour tokens').toBeGreaterThan(0);
    expect(literals.filter((name) => stepNames.includes(name))).toEqual([]);
  });
});
