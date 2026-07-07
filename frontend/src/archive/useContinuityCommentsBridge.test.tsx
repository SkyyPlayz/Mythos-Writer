// Beta 3 M23 — live bridge hook: list-on-open, scan-result stream, and
// cont-item-resolved wiring. Mocks window.api per the existing agent tests.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { commentsStore } from '../comments';
import type { InconsistencyItem } from '../InconsistencyCard';
import type { Story } from '../types';
import { useContinuityCommentsBridge } from './useContinuityCommentsBridge';

const NOW = '2026-07-07T00:00:00.000Z';

function mkStory(): Story {
  return {
    id: 'story-1',
    title: 'The Broken Gate',
    path: 'stories/s1',
    chapters: [
      {
        id: 'ch-1',
        title: 'Chapter One',
        path: 'stories/s1/ch1',
        order: 0,
        scenes: [
          {
            id: 'scene-a',
            title: 'Scene A',
            path: 'stories/s1/ch1/scene-a.md',
            order: 0,
            blocks: [],
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function mkFlag(id: string, status: InconsistencyItem['status'] = 'open'): InconsistencyItem {
  return {
    id,
    category: 'factual_contradiction',
    severity: 'critical',
    manuscriptAnchor: { sceneId: 'scene-a', offset: 0, excerpt: `excerpt for ${id}` },
    vaultAnchor: { notePath: 'Lore/Gates.md', line: 1, excerpt: 'the gate never opened' },
    rationale: `Rationale for ${id}.`,
    proposedResolution: { matchArchiveToStory: 'a', suggestStoryChange: 'b' },
    status,
    resolvedAt: null,
    resolvedAction: null,
    createdAt: NOW,
  };
}

type ScanResultCb = (data: { sceneId: string; items: InconsistencyItem[]; tokenUsed: number; partial: boolean }) => void;
type ResolvedCb = (data: { itemId: string; sceneId: string; status: 'resolved' | 'ignored'; action: 'ignore' }) => void;

const mockList = vi.fn();
let scanResultCb: ScanResultCb | null = null;
let resolvedCb: ResolvedCb | null = null;
const unsubResult = vi.fn();
const unsubResolved = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  commentsStore.reset();
  scanResultCb = null;
  resolvedCb = null;
  (window as unknown as { api: Record<string, unknown> }).api = {
    archiveListContinuity: mockList,
    onArchiveContScanResult: (cb: ScanResultCb) => {
      scanResultCb = cb;
      return unsubResult;
    },
    onArchiveContItemResolved: (cb: ResolvedCb) => {
      resolvedCb = cb;
      return unsubResolved;
    },
  };
  mockList.mockResolvedValue({ items: [] });
});

describe('useContinuityCommentsBridge', () => {
  it('reconciles persisted open flags into gutter comments on story open', async () => {
    mockList.mockResolvedValue({ items: [mkFlag('flag-1')] });
    renderHook(() => useContinuityCommentsBridge(mkStory(), { archive: 'Custom Archivist' }));

    await waitFor(() => expect(commentsStore.list('story-1')).toHaveLength(1));
    const [c] = commentsStore.list('story-1');
    expect(c.kind).toBe('archive');
    expect(c.suggestionId).toBe('flag-1');
    expect(c.author).toBe('Custom Archivist');
    expect(mockList).toHaveBeenCalledWith({});
  });

  it('surfaces live scan results as comments without duplicating on re-scan', async () => {
    renderHook(() => useContinuityCommentsBridge(mkStory()));
    await waitFor(() => expect(scanResultCb).not.toBeNull());

    act(() => {
      scanResultCb?.({ sceneId: 'scene-a', items: [mkFlag('flag-live')], tokenUsed: 10, partial: false });
    });
    expect(commentsStore.list('story-1')).toHaveLength(1);

    // Re-scan streams the same open set again — dedupe keeps one card.
    act(() => {
      scanResultCb?.({ sceneId: 'scene-a', items: [mkFlag('flag-live')], tokenUsed: 10, partial: false });
    });
    expect(commentsStore.list('story-1')).toHaveLength(1);
  });

  it('drops the card when the flag is resolved anywhere', async () => {
    mockList.mockResolvedValue({ items: [mkFlag('flag-1')] });
    renderHook(() => useContinuityCommentsBridge(mkStory()));
    await waitFor(() => expect(commentsStore.list('story-1')).toHaveLength(1));

    act(() => {
      resolvedCb?.({ itemId: 'flag-1', sceneId: 'scene-a', status: 'ignored', action: 'ignore' });
    });
    expect(commentsStore.list('story-1')).toHaveLength(0);
  });

  it('unsubscribes both event streams on unmount and is a no-op without a story', async () => {
    const { unmount } = renderHook(() => useContinuityCommentsBridge(mkStory()));
    await waitFor(() => expect(scanResultCb).not.toBeNull());
    unmount();
    expect(unsubResult).toHaveBeenCalledTimes(1);
    expect(unsubResolved).toHaveBeenCalledTimes(1);

    mockList.mockClear();
    renderHook(() => useContinuityCommentsBridge(null));
    expect(mockList).not.toHaveBeenCalled();
  });
});
