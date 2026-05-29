import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useFocusMode } from './useFocusMode';

function pressKey(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

describe('useFocusMode', () => {
  it('initialises as inactive', () => {
    const { result } = renderHook(() => useFocusMode());
    expect(result.current.distractionFree).toBe(false);
  });

  it('toggle activates focus mode', () => {
    const { result } = renderHook(() => useFocusMode());
    act(() => { result.current.toggle(); });
    expect(result.current.distractionFree).toBe(true);
  });

  it('toggle twice returns to inactive', () => {
    const { result } = renderHook(() => useFocusMode());
    act(() => { result.current.toggle(); });
    act(() => { result.current.toggle(); });
    expect(result.current.distractionFree).toBe(false);
  });

  it('exit deactivates focus mode', () => {
    const { result } = renderHook(() => useFocusMode());
    act(() => { result.current.toggle(); });
    act(() => { result.current.exit(); });
    expect(result.current.distractionFree).toBe(false);
  });

  it('exit is a no-op when already inactive', () => {
    const { result } = renderHook(() => useFocusMode());
    act(() => { result.current.exit(); });
    expect(result.current.distractionFree).toBe(false);
  });

  it('F11 key enters focus mode', () => {
    const { result } = renderHook(() => useFocusMode());
    act(() => { pressKey('F11'); });
    expect(result.current.distractionFree).toBe(true);
  });

  it('F11 key exits focus mode when already active', () => {
    const { result } = renderHook(() => useFocusMode());
    act(() => { pressKey('F11'); });
    act(() => { pressKey('F11'); });
    expect(result.current.distractionFree).toBe(false);
  });

  it('Escape key exits focus mode when active', () => {
    const { result } = renderHook(() => useFocusMode());
    act(() => { result.current.toggle(); });
    act(() => { pressKey('Escape'); });
    expect(result.current.distractionFree).toBe(false);
  });

  it('Escape key is a no-op when focus mode is inactive', () => {
    const { result } = renderHook(() => useFocusMode());
    act(() => { pressKey('Escape'); });
    expect(result.current.distractionFree).toBe(false);
  });
});
