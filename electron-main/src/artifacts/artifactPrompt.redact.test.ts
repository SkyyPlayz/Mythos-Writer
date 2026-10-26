// S3.3 — share-as-prompt strips paths, usernames, and keys.
import { describe, expect, it } from 'vitest';
import { AI_DISABLED_MESSAGE } from '../provider.js';
import { redactPromptText, shareArtifactPrompt } from './artifactPrompt.js';

describe('artifact prompt redaction (S3.3)', () => {
  it('strips paths, usernames, and keys from the source', () => {
    const raw = [
      'See /home/skyy/notes/Hero.md and /Users/skyy/Desktop/x.md',
      'key sk-abcdefghijklmnop',
      'ghp_abcdefghijklmnop',
      'Bearer abc.def-ghi',
      'api_key=super-secret',
    ].join('\n');
    const redacted = redactPromptText(raw);
    expect(redacted).not.toContain('/home/skyy');
    expect(redacted).not.toContain('/Users/skyy');
    expect(redacted).not.toContain('sk-abcdefghijklmnop');
    expect(redacted).not.toContain('ghp_abcdefghijklmnop');
    expect(redacted).not.toContain('abc.def-ghi');
    expect(redacted).not.toContain('super-secret');
    expect(redacted).toContain('[redacted]');
  });

  it('returns a prompt card, and the AI-off gate refuses before building one', () => {
    const card = shareArtifactPrompt({ body: 'A scene in the rain.', dataSchema: { mood: 'wet' } });
    expect(card).toEqual({
      ok: true,
      card: { type: 'prompt-card', source: 'A scene in the rain.', dataSchema: { mood: 'wet' } },
    });
    expect(shareArtifactPrompt({ body: 'no', dataSchema: {} }, () => false)).toEqual({
      ok: false,
      error: AI_DISABLED_MESSAGE,
    });
  });
});
