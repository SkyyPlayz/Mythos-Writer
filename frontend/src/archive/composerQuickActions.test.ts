// M12.B3 (SKY-10738) — Archive Agent composer quick-action chips.

import { describe, expect, it } from 'vitest';
import type { InconsistencyItem } from '../InconsistencyCard';
import { generateQuickActionChips, topicPhrase } from './composerQuickActions';

function mkItem(overrides: Partial<InconsistencyItem> = {}): InconsistencyItem {
  return {
    id: 'ic-1',
    scope: 'story_vault',
    category: 'factual_contradiction',
    severity: 'high',
    manuscriptAnchor: { sceneId: 'sc-1', offset: 42, excerpt: 'entering the Gate at high tide' },
    vaultAnchor: { notePath: 'Places/SunkenGate.md', line: 4, excerpt: 'opens only at low tide' },
    rationale: 'Scene 4 enters the Gate at high tide, but the note says the inner passage opens only at low tide',
    proposedResolution: { matchArchiveToStory: '', suggestStoryChange: '' },
    status: 'open',
    resolvedAt: null,
    resolvedAction: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('generateQuickActionChips', () => {
  it('returns only the global "Run full scan" chip when there are no open flags', () => {
    const chips = generateQuickActionChips([]);
    expect(chips).toEqual([{ id: 'run-full-scan', label: 'Run full scan', kind: 'scan' }]);
  });

  it('excludes resolved/ignored flags from the context-specific chips', () => {
    const chips = generateQuickActionChips([mkItem({ status: 'resolved' }), mkItem({ id: 'ic-2', status: 'ignored' })]);
    expect(chips).toHaveLength(1);
  });

  it('generates one global chip plus two context-specific chips from the highest-severity open flag', () => {
    const chips = generateQuickActionChips([
      mkItem({ id: 'low-1', severity: 'low' }),
      mkItem({ id: 'critical-1', severity: 'critical' }),
    ]);
    expect(chips).toHaveLength(3);
    expect(chips[0]).toEqual({ id: 'run-full-scan', label: 'Run full scan', kind: 'scan' });
    expect(chips[1].id).toBe('explain-critical-1');
    expect(chips[1].label).toBe('Explain flag #1');
    expect(chips[2].id).toBe('suggest-fix-critical-1');
    expect(chips[2].kind).toBe('chat');
    expect(chips[2].label).toMatch(/^Suggest a fix for the /);
  });

  it('is dynamic — regenerating from a different flag set changes the chips (not static)', () => {
    const first = generateQuickActionChips([mkItem({ id: 'a', rationale: 'tide rule conflict' })]);
    const second = generateQuickActionChips([mkItem({ id: 'b', rationale: 'lantern colour drift', category: 'character_attribute_drift' })]);
    expect(first[1].id).not.toBe(second[1].id);
    expect(first[2].label).not.toBe(second[2].label);
  });
});

describe('topicPhrase', () => {
  it('derives a short topic phrase from the rationale, suffixed by category', () => {
    const item = mkItem({ category: 'factual_contradiction', rationale: 'Scene 4 enters the Gate at high tide, but the note says low tide' });
    expect(topicPhrase(item)).toMatch(/conflict$/);
  });

  it('falls back to the category label when neither rationale nor excerpt has usable words', () => {
    const item = mkItem({
      category: 'location_attribute_mismatch',
      rationale: '',
      manuscriptAnchor: { sceneId: 'sc-1', offset: 0, excerpt: '' },
    });
    expect(topicPhrase(item)).toBe('location attribute mismatch mismatch');
  });
});
