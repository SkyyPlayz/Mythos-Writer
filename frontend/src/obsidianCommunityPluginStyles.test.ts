import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

function readOptional(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

const css = readOptional(join(here, 'obsidianCommunityPluginStyles.css'));
const main = readFileSync(join(here, 'main.tsx'), 'utf8');

describe('Obsidian community plugin Liquid Neon CSS', () => {
  it('is globally loaded by the renderer', () => {
    expect(main).toContain("import './obsidianCommunityPluginStyles.css';");
  });

  it('styles Dataview tables, inline fields, errors, stack traces, and callouts', () => {
    const requiredSelectors = [
      /\.dataview\.table-view-table/,
      /\.dataview\s+tbody\s+tr:nth-child\(odd\)/,
      /\.dataview\s+:is\(\.inline-field,\s*\.dataview-inline-field\)/,
      /:is\(\.dataview-error,\s*\.block-language-dataviewjs\s+\.error,\s*\.block-language-dataview\s+\.error\)/,
      /:is\(\.dataview-error,\s*\.block-language-dataviewjs\s+\.error,\s*\.block-language-dataview\s+\.error\)\s+pre/,
      /\.callout\[data-callout="info"\]/,
      /\.callout\[data-callout="warning"\]/,
      /\.callout\[data-callout="error"\]/,
    ];

    for (const selector of requiredSelectors) {
      expect(css).toMatch(selector);
    }
  });

  it('uses Liquid Neon tokens instead of raw Obsidian theme colors', () => {
    // W0.5 (PERFORMANCE §2): --lg-blur left this list when the dataview/callout
    // backdrop-filters were removed — panels are faked glass over the
    // pre-blurred wallpaper now, so the blur token is legitimately unused here.
    for (const token of ['--lg-neon', '--glass-fill', '--lg-glass']) {
      expect(css).toContain(`var(${token}`);
    }

    expect(css).not.toMatch(/--interactive-accent|--background-primary|--background-secondary|--text-normal/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(css).toMatch(/color:\s*var\(--text-body\)/);
  });
});
