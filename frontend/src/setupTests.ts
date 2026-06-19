import '@testing-library/jest-dom';
import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vitest';

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
const originalConsoleError = console.error;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    originalConsoleError(...args);
  });
});

afterEach(async () => {
  await act(async () => {});

  const actWarnings = (consoleErrorSpy.mock.calls as unknown[][]).filter((args: unknown[]) =>
    args.some((arg: unknown) => String(arg).includes('was not wrapped in act')),
  );

  consoleErrorSpy.mockRestore();
  cleanup();
  expect(actWarnings).toEqual([]);
});

// jsdom's built-in localStorage is incomplete in some environments; provide a
// full in-memory implementation so tests can call getItem/setItem/removeItem/clear.
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string): string | null => store[key] ?? null,
    setItem: (key: string, value: string): void => { store[key] = String(value); },
    removeItem: (key: string): void => { delete store[key]; },
    clear: (): void => { store = {}; },
    get length(): number { return Object.keys(store).length; },
    key: (index: number): string | null => Object.keys(store)[index] ?? null,
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });

// jsdom does not implement scrollIntoView; stub it so components that call it don't throw.
Element.prototype.scrollIntoView = () => {};
