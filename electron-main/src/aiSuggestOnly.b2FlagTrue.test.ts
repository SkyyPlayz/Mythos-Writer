/**
 * The write guard does not read AI_TEXT_APPLY_ENABLED.
 * This file mocks the flag true before any import of the apply path.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('@mythos-writer/shared/aiSuggestOnly', () => ({
  AI_TEXT_APPLY_ENABLED: true,
}));

import { AI_TEXT_APPLY_ENABLED } from '@mythos-writer/shared/aiSuggestOnly';
import { applyVaultWrite } from './suggestionApply.js';
import type { DbSuggestion } from './db.js';

const V1_FIXTURE = path.resolve(__dirname, '../../e2e/fixtures/v1-vault-pre-templates-v2');

describe('flag true still refuses a scene write', () => {
  let vaultDir = '';

  afterEach(() => {
    if (vaultDir) fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  it('refuses a vault-kind scene row while the flag module is true', () => {
    expect(AI_TEXT_APPLY_ENABLED).toBe(true);
    const applySrc = fs.readFileSync(path.resolve(__dirname, 'suggestionApply.ts'), 'utf8');
    const guardSrc = fs.readFileSync(path.resolve(__dirname, 'vault/aiWriteGuard.ts'), 'utf8');
    expect(applySrc).not.toContain('AI_TEXT_APPLY_ENABLED');
    expect(guardSrc).not.toContain('AI_TEXT_APPLY_ENABLED');

    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-b2-flag-'));
    fs.cpSync(V1_FIXTURE, vaultDir, { recursive: true });
    const scene = path.join(vaultDir, 'stories/story-1/chapters/chapter-1/scenes/Opening.md');
    const before = fs.readFileSync(scene);
    const row: DbSuggestion = {
      id: 'flag-true-scene',
      source_agent: 'writing-assistant',
      confidence: 0.9,
      rationale: 'flag',
      target_kind: 'vault',
      target_path: 'stories/story-1/chapters/chapter-1/scenes/Opening.md',
      target_anchor: null,
      payload_json: JSON.stringify({ content: 'should not land\n' }),
      status: 'proposed',
      created_at: new Date().toISOString(),
      applied_at: null,
      applied_run_id: null,
      budget_exceeded: 0,
      category: null,
    };
    expect(applyVaultWrite(row, vaultDir, new Date().toISOString())).toEqual({
      ok: false,
      reason: 'manuscript_target',
    });
    expect(fs.readFileSync(scene)).toEqual(before);
  });
});
