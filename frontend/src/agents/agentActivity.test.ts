// Beta 3 M22 — agent activity store: the live busy signal behind the
// workspace tab strip's "Agents working / All agents idle" chip.

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  beginAgentActivity,
  agentsActiveSnapshot,
  useAgentsActive,
  useAgentActivity,
  resetAgentActivityForTests,
} from './agentActivity';

beforeEach(() => {
  resetAgentActivityForTests();
});

describe('beginAgentActivity', () => {
  it('is idle by default', () => {
    expect(agentsActiveSnapshot()).toBe(false);
  });

  it('goes active on begin and idle on release', () => {
    const release = beginAgentActivity();
    expect(agentsActiveSnapshot()).toBe(true);
    release();
    expect(agentsActiveSnapshot()).toBe(false);
  });

  it('stays active while any of several requests is still running', () => {
    const a = beginAgentActivity();
    const b = beginAgentActivity();
    a();
    expect(agentsActiveSnapshot()).toBe(true);
    b();
    expect(agentsActiveSnapshot()).toBe(false);
  });

  it('double-release is a no-op (never goes negative)', () => {
    const a = beginAgentActivity();
    const b = beginAgentActivity();
    a();
    a();
    expect(agentsActiveSnapshot()).toBe(true);
    b();
    expect(agentsActiveSnapshot()).toBe(false);
  });
});

describe('useAgentsActive', () => {
  it('re-renders with the live value', () => {
    const { result } = renderHook(() => useAgentsActive());
    expect(result.current).toBe(false);

    let release: () => void = () => {};
    act(() => { release = beginAgentActivity(); });
    expect(result.current).toBe(true);

    act(() => { release(); });
    expect(result.current).toBe(false);
  });
});

describe('useAgentActivity', () => {
  it('tracks a busy boolean declaratively', () => {
    const { rerender, unmount } = renderHook(({ busy }) => useAgentActivity(busy), {
      initialProps: { busy: false },
    });
    expect(agentsActiveSnapshot()).toBe(false);

    rerender({ busy: true });
    expect(agentsActiveSnapshot()).toBe(true);

    rerender({ busy: false });
    expect(agentsActiveSnapshot()).toBe(false);

    rerender({ busy: true });
    unmount();
    expect(agentsActiveSnapshot()).toBe(false);
  });
});
