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

// jsdom does not implement layout, so getClientRects is missing on Element/Range.
// ProseMirror's scrollToSelection path calls it asynchronously after transactions
// (surfaces as an unhandled TypeError in editor tests, SKY-5423/SKY-3209). Stub it
// to return a single zero rect — an empty list would push ProseMirror onto a
// getBoundingClientRect fallback that jsdom also lacks on Range/Text targets.
const zeroRect = () => ({
  x: 0, y: 0, top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0,
  toJSON: () => ({}),
}) as DOMRect;
const zeroRectList = () => [zeroRect()] as unknown as DOMRectList;
if (!Element.prototype.getClientRects) {
  Element.prototype.getClientRects = zeroRectList;
}
if (typeof Range !== 'undefined') {
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = zeroRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = zeroRect;
}

// jsdom does not implement ResizeObserver; stub it so components that use it don't throw.
// Tests that need to exercise resize callbacks should override this with vi.stubGlobal.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(window, 'ResizeObserver', { value: ResizeObserverStub, writable: true, configurable: true });
