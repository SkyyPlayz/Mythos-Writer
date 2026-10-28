// S3.2 — refresh and share-as-prompt refuse when the master AI switch is off.
import { afterEach, describe, expect, it } from 'vitest';
import { AI_DISABLED_MESSAGE, setAiMasterGate } from '../provider.js';
import { handleArtifactRefresh, handleArtifactSharePrompt } from './artifactStore.js';

const ARTIFACT = '4a1b0c2d-e3f4-4123-8abc-1234567890ab';

afterEach(() => {
  setAiMasterGate(() => true);
});

describe('artifact AI-off gate (S3.2)', () => {
  it('returns the master AI message and does not fall through to the engine flag', () => {
    setAiMasterGate(() => false);
    expect(handleArtifactRefresh({
      artifactId: ARTIFACT,
      outputTokens: 1,
      usage: { used: 0, cap: 10 },
      proposal: 'no',
    })).toEqual({ ok: false, error: AI_DISABLED_MESSAGE });
    expect(handleArtifactSharePrompt({ body: 'secret', dataSchema: { a: 1 } })).toEqual({
      ok: false,
      error: AI_DISABLED_MESSAGE,
    });
  });
});
