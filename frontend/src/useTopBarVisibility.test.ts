import { act, renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useTopBarVisibility, TOPBAR_HIDE_EVENT } from './useTopBarVisibility';

describe('useTopBarVisibility', () => {
  it('dispatches hide event with hidden=true', () => {
    const events: boolean[] = [];
    const listener = (e: Event) => {
      events.push((e as CustomEvent<{ hidden: boolean }>).detail.hidden);
    };
    window.addEventListener(TOPBAR_HIDE_EVENT, listener);

    const { result } = renderHook(() => useTopBarVisibility());
    act(() => { result.current.setTopBarHidden(true); });

    expect(events).toEqual([true]);
    window.removeEventListener(TOPBAR_HIDE_EVENT, listener);
  });

  it('dispatches hide event with hidden=false', () => {
    const events: boolean[] = [];
    const listener = (e: Event) => {
      events.push((e as CustomEvent<{ hidden: boolean }>).detail.hidden);
    };
    window.addEventListener(TOPBAR_HIDE_EVENT, listener);

    const { result } = renderHook(() => useTopBarVisibility());
    act(() => { result.current.setTopBarHidden(false); });

    expect(events).toEqual([false]);
    window.removeEventListener(TOPBAR_HIDE_EVENT, listener);
  });

  it('multiple calls dispatch separate events', () => {
    const events: boolean[] = [];
    const listener = (e: Event) => {
      events.push((e as CustomEvent<{ hidden: boolean }>).detail.hidden);
    };
    window.addEventListener(TOPBAR_HIDE_EVENT, listener);

    const { result } = renderHook(() => useTopBarVisibility());
    act(() => { result.current.setTopBarHidden(true); });
    act(() => { result.current.setTopBarHidden(false); });
    act(() => { result.current.setTopBarHidden(true); });

    expect(events).toEqual([true, false, true]);
    window.removeEventListener(TOPBAR_HIDE_EVENT, listener);
  });
});
