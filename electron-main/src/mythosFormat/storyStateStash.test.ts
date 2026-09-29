import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { restoreStoryState, stashStoryState } from './storyStateStash.js';

describe('storyStateStash (02 §4)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stash-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('round-trips stash for the same vault/story', () => {
    stashStoryState(tmp, {
      vaultId: 'v1',
      storyId: 's1',
      lanes: { plotlineIds: ['pl-a', 'pl-b'] },
      manuscriptTabs: { open: ['t1'] },
    });
    const entry = restoreStoryState(tmp, 'v1', 's1', ['pl-a']);
    expect(entry?.lanes?.plotlineIds).toEqual(['pl-a', 'pl-b']);
    expect(entry?.manuscriptTabs).toEqual({ open: ['t1'] });
  });

  it('discards lanes when stash plotlines do not intersect seed (no cross-story inject)', () => {
    stashStoryState(tmp, {
      vaultId: 'v1',
      storyId: 's1',
      lanes: { plotlineIds: ['other-world-pl'] },
      selectedEventId: 'ev-x',
    });
    const entry = restoreStoryState(tmp, 'v1', 's1', ['seed-pl-1']);
    expect(entry?.lanes).toBeUndefined();
    expect(entry?.selectedEventId).toBeNull();
  });
});
