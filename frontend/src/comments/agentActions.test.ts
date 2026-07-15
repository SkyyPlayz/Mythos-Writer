// Beta 3 M11 — agent actions: availability tiers and the archive:confirm
// IPC dispatch (with local resolve on success).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AGENT_ACTIONS,
  GUTTER_AGENT_ACTIONS,
  AGENT_ACTION_SUCCESS_TOAST,
  agentActionAvailability,
  runAgentAction,
} from './agentActions';
import { commentsStore } from './store';
import type { StoryComment } from './types';

const archiveConfirm = vi.fn();

function mkComment(over: Partial<StoryComment> = {}): StoryComment {
  return {
    id: 'c1',
    storyId: 'story-1',
    sceneId: 's1',
    anchor: 'the lantern',
    author: 'Archive Agent',
    kind: 'archive',
    text: 'Continuity: …',
    createdAt: '2026-07-07T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  commentsStore.reset();
  archiveConfirm.mockReset();
  archiveConfirm.mockResolvedValue({ ok: true });
  Object.defineProperty(window, 'api', {
    value: { archiveConfirm },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  commentsStore.reset();
  delete (window as { api?: unknown }).api;
});

describe('metadata', () => {
  it('exposes the three prototype actions in order', () => {
    expect(AGENT_ACTIONS.map((a) => a.action)).toEqual([
      'match_archive',
      'suggest_story_change',
      'ignore',
    ]);
    expect(AGENT_ACTIONS.map((a) => a.label)).toEqual([
      'Edit notes to match',
      'Suggest story change',
      'Ignore',
    ]);
  });

  it('exposes the compact v2 gutter row: the two archive verbs, short labels', () => {
    expect(GUTTER_AGENT_ACTIONS.map((a) => a.action)).toEqual([
      'match_archive',
      'suggest_story_change',
    ]);
    expect(GUTTER_AGENT_ACTIONS.map((a) => a.label)).toEqual(['Edit notes', 'Suggest change']);
  });

  it('has toast copy for the two visible actions and silence for ignore', () => {
    expect(AGENT_ACTION_SUCCESS_TOAST.match_archive).toBeTruthy();
    // Beta 4 M9 (v2 prototype 6772): the agent is the Writing Coach now.
    expect(AGENT_ACTION_SUCCESS_TOAST.suggest_story_change).toBe(
      'Suggested edit drafted — see Writing Coach'
    );
    expect(AGENT_ACTION_SUCCESS_TOAST.ignore).toBeNull();
  });
});

describe('agentActionAvailability', () => {
  it('is live for archive comments with a suggestionId', () => {
    expect(agentActionAvailability(mkComment({ suggestionId: 'sug-1' }))).toBe('live');
  });

  it('is disabled for archive comments without a suggestion (pre-M23)', () => {
    expect(agentActionAvailability(mkComment())).toBe('disabled');
  });

  it('is none for user / writing / beta comments', () => {
    expect(agentActionAvailability(mkComment({ kind: 'user' }))).toBe('none');
    expect(agentActionAvailability(mkComment({ kind: 'writing' }))).toBe('none');
    expect(agentActionAvailability(mkComment({ kind: 'beta', suggestionId: 'sug-1' }))).toBe(
      'none'
    );
  });
});

describe('runAgentAction', () => {
  it('dispatches archive:confirm and resolves the comment on success', async () => {
    const created = commentsStore.create({
      storyId: 'story-1',
      sceneId: 's1',
      anchor: 'the lantern',
      text: 'Continuity: …',
      kind: 'archive',
      suggestionId: 'sug-1',
    });
    const res = await runAgentAction(created, 'match_archive');
    expect(res).toEqual({ ok: true });
    expect(archiveConfirm).toHaveBeenCalledWith('sug-1', 'match_archive');
    expect(commentsStore.list('story-1')).toEqual([]);
  });

  it('fails without a suggestionId and does not touch the IPC', async () => {
    const res = await runAgentAction(mkComment(), 'ignore');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/No linked suggestion/);
    expect(archiveConfirm).not.toHaveBeenCalled();
  });

  it('fails gracefully when the bridge is missing', async () => {
    delete (window as { api?: unknown }).api;
    const res = await runAgentAction(mkComment({ suggestionId: 'sug-1' }), 'ignore');
    expect(res.ok).toBe(false);
  });

  it('propagates an { error } result and keeps the comment', async () => {
    const created = commentsStore.create({
      storyId: 'story-1',
      sceneId: 's1',
      anchor: 'the lantern',
      text: 'Continuity: …',
      kind: 'archive',
      suggestionId: 'sug-1',
    });
    archiveConfirm.mockResolvedValue({ error: 'suggestion already resolved' });
    const res = await runAgentAction(created, 'suggest_story_change');
    expect(res).toEqual({ ok: false, error: 'suggestion already resolved' });
    expect(commentsStore.list('story-1')).toHaveLength(1);
  });

  it('propagates a rejected IPC call and keeps the comment', async () => {
    const created = commentsStore.create({
      storyId: 'story-1',
      sceneId: 's1',
      anchor: 'the lantern',
      text: 'Continuity: …',
      kind: 'archive',
      suggestionId: 'sug-1',
    });
    archiveConfirm.mockRejectedValue(new Error('ipc down'));
    const res = await runAgentAction(created, 'ignore');
    expect(res).toEqual({ ok: false, error: 'ipc down' });
    expect(commentsStore.list('story-1')).toHaveLength(1);
  });
});
