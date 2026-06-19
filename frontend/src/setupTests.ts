import '@testing-library/jest-dom';
import { afterEach, beforeEach, vi } from 'vitest';

const originalConsoleError = console.error.bind(console);
let consoleErrorSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const message = args.map((arg) => String(arg)).join(' ');
    if (message.includes('not wrapped in act')) {
      throw new Error(`Unexpected React act() warning: ${message}`);
    }
    originalConsoleError(...args);
  });
});

afterEach(() => {
  consoleErrorSpy?.mockRestore();
  consoleErrorSpy = undefined;
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
