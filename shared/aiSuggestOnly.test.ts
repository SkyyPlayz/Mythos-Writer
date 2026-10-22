import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_TEXT_APPLY_ENABLED } from './aiSuggestOnly.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'out') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('AI_TEXT_APPLY_ENABLED (T14)', () => {
  it('is the compile-time constant false, with no setter', () => {
    expect(AI_TEXT_APPLY_ENABLED).toBe(false);
    const src = fs.readFileSync(path.join(repoRoot, 'shared/aiSuggestOnly.ts'), 'utf8');
    expect(src).toContain('= false as const');
    expect(src).not.toMatch(/export\s+(let|function|var)\b/);
    expect(src).not.toMatch(/process\.env|localStorage|settings|ipc/i);
  });

  it('is imported only by main.ts outside tests', () => {
    const roots = [path.join(repoRoot, 'frontend/src'), path.join(repoRoot, 'electron-main/src')];
    const offenders: string[] = [];
    for (const file of roots.flatMap((dir) => walk(dir))) {
      const base = path.basename(file);
      if (/\.test\.(ts|tsx)$/.test(base)) continue;
      if (base === 'main.ts') continue;
      const text = fs.readFileSync(file, 'utf8');
      if (text.includes('aiSuggestOnly')) offenders.push(path.relative(repoRoot, file));
    }
    expect(offenders).toEqual([]);

    const main = fs.readFileSync(path.join(repoRoot, 'electron-main/src/main.ts'), 'utf8');
    expect(main).toContain("from '@mythos-writer/shared/aiSuggestOnly'");
    const reads = main.match(/!AI_TEXT_APPLY_ENABLED/g) ?? [];
    expect(reads).toHaveLength(2);
  });
});
