// M11c (SKY-10608) — AI master toggle gates agent-authored comments.
//
// Surface contract (PLAN.md §4 M11b, "Comments gutter" row): AI off → human
// comments only; agent comments hidden, not deleted; reappear when AI
// returns. The filter lives in useStoryComments so every consumer (editor
// gutter, paragraph rows, TitleRow count, Book Preview) agrees.

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { setAiEnabled, __resetAiEnabledForTests } from '../hooks/useAiEnabled';
import type { Story } from '../types';
import { commentsStore } from './store';
import { useStoryComments } from './useStoryComments';

const NOW = '2026-08-19T00:00:00.000Z';

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

function seedComments(): void {
  commentsStore.create({
    storyId: 'story-1',
    sceneId: 'scene-a',
    anchor: 'gate had not been broken',
    text: 'Nice line.',
    kind: 'user',
  });
  commentsStore.create({
    storyId: 'story-1',
    sceneId: 'scene-a',
    anchor: 'so much as persuaded',
    text: 'Continuity: check gate state in ch.2.',
    kind: 'archive',
  });
}

beforeEach(() => {
  commentsStore.reset();
  __resetAiEnabledForTests();
});

describe('useStoryComments — AI master toggle gate', () => {
  it('shows all comments while AI is enabled', () => {
    seedComments();
    const { result } = renderHook(() => useStoryComments(mkStory()));
    expect(result.current.comments).toHaveLength(2);
    expect(result.current.ordered).toHaveLength(2);
  });

  it('hides agent-authored comments when AI is off, without deleting them', () => {
    seedComments();
    const { result } = renderHook(() => useStoryComments(mkStory()));

    act(() => setAiEnabled(false));
    expect(result.current.comments.map((c) => c.kind)).toEqual(['user']);
    expect(result.current.ordered.map((c) => c.kind)).toEqual(['user']);
    // Hidden, not deleted — the store still holds both for persistence.
    expect(commentsStore.list('story-1')).toHaveLength(2);
  });

  it('agent comments reappear when AI is turned back on', () => {
    seedComments();
    const { result } = renderHook(() => useStoryComments(mkStory()));

    act(() => setAiEnabled(false));
    expect(result.current.comments).toHaveLength(1);
    act(() => setAiEnabled(true));
    expect(result.current.comments).toHaveLength(2);
    expect(result.current.comments.some((c) => c.kind === 'archive')).toBe(true);
  });
});
