import { describe, expect, it } from 'vitest';
import { extractBodyHashtags, setNoteTagsWithBodySync, syncBodyHashtagLines } from './noteTagSync';

describe('noteTagSync (PLAN-058 L6)', () => {
  it('extracts standalone body hashtags', () => {
    expect(extractBodyHashtags('#character\n\nProse.')).toEqual(['character']);
  });

  it('mirrors frontmatter tags as body hashtag lines', () => {
    const next = setNoteTagsWithBodySync('---\ntitle: Mira\n---\n\nBody.', ['character', 'pov']);
    expect(next).toContain('tags: [character, pov]');
    expect(next).toContain('#character');
    expect(next).toContain('#pov');
  });

  it('removes stale body hashtag lines when tags shrink', () => {
    const body = syncBodyHashtagLines('#character\n#old\n\nProse', ['character']);
    expect(body).toContain('#character');
    expect(body).not.toContain('#old');
  });
});
