import '@testing-library/jest-dom';
import 'vitest-axe/extend-expect';
import { act } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

let consoleError: typeof console.error;
let actWarnings: string[] = [];

beforeEach(() => {
  actWarnings = [];
  consoleError = console.error;
  console.error = (...args: Parameters<typeof console.error>) => {
    const message = args.map((arg) => String(arg)).join(' ');
    if (message.includes('was not wrapped in act')) {
      actWarnings.push(message);
    }
    consoleError(...args);
  };
});

afterEach(async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  console.error = consoleError;

  if (actWarnings.length > 0) {
    throw new Error(`Unexpected React act(...) warning(s):\n${actWarnings.join('\n---\n')}`);
  }
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

// jsdom does not implement getClientRects; prosemirror-view calls it during scrollToSelection.
// Without this stub, async scroll operations that fire after a test completes produce unhandled
// TypeError exceptions that fail the suite even when all assertions pass.
const emptyDOMRectList = Object.assign([] as DOMRect[], {
  item: (_index: number): DOMRect | null => null,
  [Symbol.iterator]: [][Symbol.iterator],
}) as unknown as DOMRectList;
Element.prototype.getClientRects = () => emptyDOMRectList;
Range.prototype.getClientRects = () => emptyDOMRectList;

// jsdom does not implement ResizeObserver; stub it so components that use it don't throw.
// Tests that need to exercise resize callbacks should override this with vi.stubGlobal.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(window, 'ResizeObserver', { value: ResizeObserverStub, writable: true, configurable: true });
