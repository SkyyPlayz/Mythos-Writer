// Beta 4 M10 — useSceneDrafts: the shared store client for every drafts
// surface. Labeling contract: v2 numbered files (`draft-K`) keep their real
// number; legacy timestamp stems fall back to positional numbering; the live
// editor text is one past the newest stored draft.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  currentDraftLabel,
  draftLabelFor,
  draftNumberFromTs,
  toSceneDraftEntries,
  useSceneDrafts,
} from './useSceneDrafts';

const versionList = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'api', {
    value: { versionList },
    writable: true,
    configurable: true,
  });
});

describe('draftNumberFromTs', () => {
  it('parses v2 tokens and rejects everything else', () => {
    expect(draftNumberFromTs('draft-6')).toBe(6);
    expect(draftNumberFromTs('draft-0')).toBeNull();
    expect(draftNumberFromTs('2026-01-01T00-00-00-000Z_00000001-abcd1234')).toBeNull();
    expect(draftNumberFromTs('draft-')).toBeNull();
  });
});

describe('draftLabelFor / currentDraftLabel', () => {
  it('uses the real file number for v2 drafts', () => {
    expect(draftLabelFor('draft-6', 0, 3)).toBe('Draft 6');
    expect(draftLabelFor('draft-4', 2, 3)).toBe('Draft 4');
  });

  it('falls back to positional numbering for legacy stems (newest first)', () => {
    expect(draftLabelFor('2026-01-01T00-00-00-000Z_00000002-ff', 0, 2)).toBe('Draft 2');
    expect(draftLabelFor('2026-01-01T00-00-00-000Z_00000001-aa', 1, 2)).toBe('Draft 1');
  });

  it('labels the live editor text one past the newest stored draft', () => {
    expect(currentDraftLabel([{ ts: 'draft-6' }, { ts: 'draft-5' }])).toBe('Draft 7');
    expect(currentDraftLabel([{ ts: 'legacy-stamp-b' }, { ts: 'legacy-stamp-a' }])).toBe('Draft 3');
    expect(currentDraftLabel([])).toBe('Draft 1');
  });
});

describe('toSceneDraftEntries', () => {
  it('maps versions to labeled entries with savedAt epoch ms', () => {
    const entries = toSceneDraftEntries([
      { sceneId: 's', ts: 'draft-2', content: 'two', intent: 'save', contentHash: 'h2', savedAt: '2026-07-01T10:00:00.000Z' },
      { sceneId: 's', ts: 'draft-1', content: 'one', intent: 'auto', contentHash: 'h1' },
    ]);
    expect(entries[0]).toEqual({
      ts: 'draft-2',
      label: 'Draft 2',
      content: 'two',
      intent: 'save',
      savedAtMs: Date.parse('2026-07-01T10:00:00.000Z'),
    });
    expect(entries[1].savedAtMs).toBeNull();
  });
});

describe('useSceneDrafts', () => {
  it('fetches the version list and exposes labeled drafts + the current label', async () => {
    versionList.mockResolvedValue({
      versions: [
        { sceneId: 's1', ts: 'draft-2', content: 'two', intent: 'save', contentHash: 'h2' },
        { sceneId: 's1', ts: 'draft-1', content: 'one', intent: 'save', contentHash: 'h1' },
      ],
    });
    const { result } = renderHook(() => useSceneDrafts('s1'));
    await waitFor(() => expect(result.current.drafts).toHaveLength(2));
    expect(versionList).toHaveBeenCalledWith('s1');
    expect(result.current.drafts.map((d) => d.label)).toEqual(['Draft 2', 'Draft 1']);
    expect(result.current.currentLabel).toBe('Draft 3');
    expect(result.current.error).toBeNull();
  });

  it('yields an empty list without a scene', async () => {
    const { result } = renderHook(() => useSceneDrafts(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.drafts).toEqual([]);
    expect(result.current.currentLabel).toBe('Draft 1');
    expect(versionList).not.toHaveBeenCalled();
  });

  it('surfaces fetch failures as error text', async () => {
    versionList.mockRejectedValue(new Error('list boom'));
    const { result } = renderHook(() => useSceneDrafts('s1'));
    await waitFor(() => expect(result.current.error).toContain('list boom'));
    expect(result.current.drafts).toEqual([]);
  });

  it('refresh() re-reads the store', async () => {
    versionList.mockResolvedValue({ versions: [] });
    const { result } = renderHook(() => useSceneDrafts('s1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    versionList.mockResolvedValue({
      versions: [{ sceneId: 's1', ts: 'draft-1', content: 'one', intent: 'save', contentHash: 'h1' }],
    });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.drafts).toHaveLength(1);
  });
});
