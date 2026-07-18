// SKY-7379 — Timeline-scoped Archive Agent flag contract.

import { describe, expect, it } from 'vitest';
import type { InconsistencyItem } from '../InconsistencyCard';
import { continuityItemsToTimelineFlags } from './timelineFlags';

function mkItem(overrides: Partial<InconsistencyItem> = {}): InconsistencyItem {
  return {
    id: 'ic-1',
    category: 'character_attribute_drift',
    severity: 'high',
    manuscriptAnchor: { sceneId: 'sc-1', offset: 42, excerpt: 'her blonde hair caught the light' },
    vaultAnchor: { notePath: 'Characters/Mira.md', line: 4, excerpt: 'Hair: dark brown' },
    rationale: "Mira's vault entry states hair: \"dark brown\" but scene contains \"blonde hair\"",
    proposedResolution: { matchArchiveToStory: '', suggestStoryChange: '' },
    status: 'open',
    resolvedAt: null,
    resolvedAction: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('continuityItemsToTimelineFlags', () => {
  it('projects an open continuity flag onto its scene as a contradiction TimelineFlag', () => {
    const item = mkItem();
    const flags = continuityItemsToTimelineFlags([item], new Set(['sc-1']));
    expect(flags).toEqual([
      {
        id: 'ic-1',
        kind: 'contradiction',
        description: item.rationale,
        anchor: 'her blonde hair caught the light',
        affectedItemId: 'sc-1',
      },
    ]);
  });

  it('drops flags whose scene is not on this timeline', () => {
    const item = mkItem({ manuscriptAnchor: { sceneId: 'sc-other', offset: 0, excerpt: 'x' } });
    expect(continuityItemsToTimelineFlags([item], new Set(['sc-1']))).toEqual([]);
  });

  it('drops resolved and ignored flags', () => {
    const resolved = mkItem({ id: 'ic-2', status: 'resolved' });
    const ignored = mkItem({ id: 'ic-3', status: 'ignored' });
    expect(continuityItemsToTimelineFlags([resolved, ignored], new Set(['sc-1']))).toEqual([]);
  });
});
