// SKY-207: unit tests for custom field schema persistence
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readFieldDefs, writeFieldDefs } from './customFields.js';
import type { CustomFieldDef } from './ipc.js';
import { createRequire } from 'node:module';

// Static import of ../test-utils would pull that .d.ts under tsconfig rootDir
// (src) and break `tsc`. require() keeps the helper outside the program.
const require = createRequire(import.meta.url);
const { makeTestTmp, cleanupTestTmp } = require('../test-utils/tmpdir.mjs') as {
  makeTestTmp: (name: string) => string;
  cleanupTestTmp: () => void;
};

function tmpVault(): string {
  return makeTestTmp('cf-test');
}

describe('customFields', () => {
  let vaultRoot: string;

  beforeEach(() => {
    vaultRoot = tmpVault();
  });

  afterEach(() => {
    cleanupTestTmp();
  });

  it('returns [] when fields.json is missing', () => {
    expect(readFieldDefs(vaultRoot)).toEqual([]);
  });

  it('round-trips field definitions', () => {
    const defs: CustomFieldDef[] = [
      { id: 'abc', name: 'mood', type: 'select', options: ['calm', 'tense'] },
      { id: 'def', name: 'tension', type: 'number' },
      { id: 'ghi', name: 'weather', type: 'text' },
    ];
    writeFieldDefs(vaultRoot, defs);
    expect(readFieldDefs(vaultRoot)).toEqual(defs);
  });

  it('creates .mythos/ directory if absent', () => {
    const defs: CustomFieldDef[] = [{ id: '1', name: 'pov', type: 'text' }];
    writeFieldDefs(vaultRoot, defs);
    expect(fs.existsSync(path.join(vaultRoot, '.mythos', 'fields.json'))).toBe(true);
  });

  it('overwrites existing definitions without losing unrelated vault files', () => {
    const mythosDir = path.join(vaultRoot, '.mythos');
    fs.mkdirSync(mythosDir, { recursive: true });
    fs.writeFileSync(path.join(mythosDir, 'manifest.json'), '{}');

    const defs: CustomFieldDef[] = [{ id: '1', name: 'mood', type: 'text' }];
    writeFieldDefs(vaultRoot, defs);
    writeFieldDefs(vaultRoot, [{ id: '2', name: 'weather', type: 'text' }]);

    expect(readFieldDefs(vaultRoot)).toEqual([{ id: '2', name: 'weather', type: 'text' }]);
    expect(fs.existsSync(path.join(mythosDir, 'manifest.json'))).toBe(true);
  });

  it('returns [] on corrupted JSON', () => {
    const mythosDir = path.join(vaultRoot, '.mythos');
    fs.mkdirSync(mythosDir, { recursive: true });
    fs.writeFileSync(path.join(mythosDir, 'fields.json'), 'NOT_JSON');
    expect(readFieldDefs(vaultRoot)).toEqual([]);
  });
});
