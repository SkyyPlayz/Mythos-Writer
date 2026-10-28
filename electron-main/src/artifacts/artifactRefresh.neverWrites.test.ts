// S3.2 — refresh proposes text and never writes. AI_TEXT_APPLY_ENABLED is not read here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { REFRESH_CALLS_PER_ACTION, REFRESH_OUTPUT_TOKEN_CAP, refreshArtifact, resetRefreshAction } from './artifactRefresh.js';

const ARTIFACT = '4a1b0c2d-e3f4-4123-8abc-1234567890ab';
const DIR = path.dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  resetRefreshAction();
  vi.restoreAllMocks();
});

describe('artifact refresh never writes (S3.2)', () => {
  it('returns a proposal and does not call a write API', () => {
    const writeFile = vi.spyOn(fs, 'writeFileSync');
    const append = vi.spyOn(fs, 'appendFileSync');
    const result = refreshArtifact({
      artifactId: ARTIFACT,
      outputTokens: 10,
      usage: { used: 0, cap: 100 },
      propose: () => 'a proposal, not a write',
    });
    expect(result).toEqual({
      ok: true,
      proposal: { artifactId: ARTIFACT, text: 'a proposal, not a write', outputTokens: 10 },
    });
    expect(writeFile).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('stops at three calls, refuses a self-trigger, and enforces both token caps', () => {
    for (let i = 0; i < REFRESH_CALLS_PER_ACTION; i += 1) {
      expect(refreshArtifact({
        artifactId: ARTIFACT,
        outputTokens: 1,
        usage: { used: 0, cap: 100 },
        propose: () => 'ok',
      }).ok).toBe(true);
    }
    expect(refreshArtifact({
      artifactId: ARTIFACT,
      outputTokens: 1,
      usage: { used: 0, cap: 100 },
      propose: () => 'over',
    })).toMatchObject({ ok: false, error: 'call_cap' });
    expect(refreshArtifact({
      artifactId: '4a1b0c2d-e3f4-4123-8abc-1234567890ac',
      selfTrigger: true,
      outputTokens: 1,
      usage: { used: 0, cap: 100 },
      propose: () => 'no',
    })).toMatchObject({ ok: false, error: 'self_trigger' });
    expect(refreshArtifact({
      artifactId: '4a1b0c2d-e3f4-4123-8abc-1234567890ad',
      outputTokens: REFRESH_OUTPUT_TOKEN_CAP + 1,
      usage: { used: 0, cap: 100_000 },
      propose: () => 'too big',
    })).toMatchObject({ ok: false, error: 'output_cap' });
    expect(refreshArtifact({
      artifactId: '4a1b0c2d-e3f4-4123-8abc-1234567890ae',
      outputTokens: 5,
      usage: { used: 8, cap: 10 },
      propose: () => 'over cap',
    })).toMatchObject({ ok: false, error: 'usage_cap' });
  });

  it('does not mention AI_TEXT_APPLY_ENABLED under artifacts/', () => {
    const files = fs.readdirSync(DIR).filter((name) => name.endsWith('.ts') && !name.includes('.test.'));
    for (const name of files) {
      expect(fs.readFileSync(path.join(DIR, name), 'utf8')).not.toContain('AI_TEXT_APPLY_ENABLED');
    }
  });
});
