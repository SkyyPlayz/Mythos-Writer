// The artifacts harness is a Playwright fixture. It is not a Vite input and not in the packaged app.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('artifacts harness is absent from the builder file list, the vite inputs, and the main bundle', () => {
  const builder = fs.readFileSync(path.join(ROOT, 'electron-builder.json'), 'utf8');
  const vite = fs.readFileSync(path.join(ROOT, 'electron.vite.config.ts'), 'utf8');
  const main = fs.readFileSync(path.join(ROOT, 'out/main/main.js'), 'utf8');
  expect(builder).not.toContain('artifacts-harness');
  expect(vite).not.toContain('artifacts-harness');
  expect(main).not.toContain('MYTHOS_E2E');
  expect(main).not.toContain('artifacts-harness');
});
