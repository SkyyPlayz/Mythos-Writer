// SKY-11214 — Brainstorm agent activity store.

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  setBrainstormActivity,
  brainstormActivitySnapshot,
  useBrainstormActivity,
  resetBrainstormActivityForTests,
  IDLE_BRAINSTORM_ACTIVITY,
} from './brainstormActivity';

beforeEach(() => {
  resetBrainstormActivityForTests();
});

describe('brainstormActivitySnapshot', () => {
  it('is idle by default', () => {
    expect(brainstormActivitySnapshot()).toEqual(IDLE_BRAINSTORM_ACTIVITY);
  });

  it('reflects the last reported snapshot', () => {
    setBrainstormActivity({ active: true, factsCount: 2, lastActionText: 'Filed "Kael"', hasError: false });
    expect(brainstormActivitySnapshot()).toEqual({
      active: true, factsCount: 2, lastActionText: 'Filed "Kael"', hasError: false,
    });
  });
});

describe('useBrainstormActivity', () => {
  it('re-renders with the live value as the session progresses', () => {
    const { result } = renderHook(() => useBrainstormActivity());
    expect(result.current).toEqual(IDLE_BRAINSTORM_ACTIVITY);

    act(() => {
      setBrainstormActivity({ active: true, factsCount: 0, lastActionText: null, hasError: false });
    });
    expect(result.current.active).toBe(true);
    expect(result.current.factsCount).toBe(0);

    act(() => {
      setBrainstormActivity({ active: true, factsCount: 1, lastActionText: 'Detected 1 fact — filing to your vault', hasError: false });
    });
    expect(result.current.factsCount).toBe(1);

    act(() => {
      setBrainstormActivity(IDLE_BRAINSTORM_ACTIVITY);
    });
    expect(result.current).toEqual(IDLE_BRAINSTORM_ACTIVITY);
  });
});
