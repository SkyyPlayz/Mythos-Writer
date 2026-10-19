import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflowPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../.github/workflows/carve-out-check.yml',
);

const csonAlternative = String.raw`|^electron-builder\.[jc]son5?$|`;

function releaseConfigSource(text: string): string {
  const marker = "label: 'release-config', re: /";
  const start = text.indexOf(marker);
  if (start < 0) throw new Error('release-config regex missing');
  let i = start + marker.length;
  let source = '';
  let inClass = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      source += ch + (text[i + 1] ?? '');
      i += 2;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === ']' && inClass) inClass = false;
    else if (ch === '/' && !inClass) break;
    source += ch;
    i += 1;
  }
  return source;
}

describe('carve-out release-config keeps the cson alternative', () => {
  const workflow = readFileSync(workflowPath, 'utf8');

  it('matches electron-builder.cson only while that alternative is in the file', () => {
    expect(workflow.includes(csonAlternative)).toBe(true);
    const withCson = new RegExp(releaseConfigSource(workflow), 'i');
    expect(withCson.test('electron-builder.cson')).toBe(true);
    expect(withCson.test('electron-builder.CSON')).toBe(true);

    const removed = workflow.replace(csonAlternative, '|');
    expect(removed.includes(csonAlternative)).toBe(false);
    const withoutCson = new RegExp(releaseConfigSource(removed), 'i');
    expect(withoutCson.test('electron-builder.cson')).toBe(false);
    expect(withoutCson.test('electron-builder.CSON')).toBe(false);
    expect(withoutCson.test('electron-builder.json')).toBe(true);
  });
});
