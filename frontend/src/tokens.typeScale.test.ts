/**
 * #1773 T0 — the `--text-*` type scale in tokens.css is the one #1773 builds
 * on, and nothing else redefines it.
 *
 * typeScale.guard.test.ts measures every font size against these steps, and
 * later #1773 slices move UI text onto them (13px → `--text-sm`). Neither of
 * those means anything if a step quietly changes value, a new step appears,
 * or a theme, density block or theme.ts starts overriding one at runtime. This
 * pins the scale as it stands at T0.
 *
 * Read-only: it reads tokens.css and theme.ts and never writes to them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname);
const stripCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
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
  /** Selector of the innermost rule the declaration sits in. */
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
      if (m && stack.length) out.push({ name: m[1], value: m[2], rule: stack[stack.length - 1] });
      buf = '';
      if (ch === '}') stack.pop();
      continue;
    }
    buf += ch;
  }
  return out;
}

const decls = customProperties(tokensCss);
const declsOf = (name: string) => decls.filter((d) => d.name === name);
const isLength = (v: string) => /^-?[\d.]+(px|rem|em)$/.test(v);

describe('#1773 tokens.css — the --text-* type scale', () => {
  it('defines exactly the seven size steps, and no other --text-* token is a length', () => {
    const sizeTokens = [...new Set(decls.filter((d) => d.name.startsWith('--text-') && isLength(d.value)).map((d) => d.name))];
    expect(sizeTokens).toEqual(SCALE.map(([step]) => `--text-${step}`));
  });

  it.each(SCALE)('--text-%s is %ipx with line-height %d and weight %i, once, in :root', (step, px, leading, weight) => {
    for (const [name, value] of [[`--text-${step}`, `${px}px`], [`--leading-${step}`, String(leading)], [`--weight-${step}`, String(weight)]]) {
      const found = declsOf(name);
      expect(found.map((d) => d.value), `${name} value`).toEqual([value]);
      expect(found[0].rule, `${name} must live in :root`).toBe(':root');
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
  const stepNames = SCALE.flatMap(([step]) => [`--text-${step}`, `--leading-${step}`, `--weight-${step}`]);

  it('names no --text-/--leading-/--weight- step token anywhere', () => {
    const literals = [...themeTs.matchAll(/['"`](--(?:text|leading|weight)-[\w-]+)['"`]/g)].map((m) => m[1]);
    expect(literals.length, 'theme.ts should still write its --text-* colour tokens').toBeGreaterThan(0);
    expect(literals.filter((name) => stepNames.includes(name))).toEqual([]);
  });
});
