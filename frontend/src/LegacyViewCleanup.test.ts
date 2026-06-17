import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = join(__dirname);
const LEGACY_VIEW_TYPE = ['App', 'View'].join('');

function productionSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) return productionSourceFiles(path);
    if (!/\.(ts|tsx|d\.ts)$/.test(name)) return [];
    if (/\.(test|spec)\.(ts|tsx)$/.test(name)) return [];
    return [path];
  });
}

describe('legacy view cleanup', () => {
  it('removes the legacy top-level view type from production source', () => {
    const offenders = productionSourceFiles(SRC_DIR)
      .filter((file) => readFileSync(file, 'utf8').includes(LEGACY_VIEW_TYPE))
      .map((file) => relative(SRC_DIR, file));

    expect(offenders).toEqual([]);
  });
});
