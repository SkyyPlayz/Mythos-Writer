import { act } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vitest';

export function installActWarningGuard(): void {
  const originalConsoleError = console.error;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorMessages: string[] = [];

  beforeEach(() => {
    consoleErrorMessages = [];
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleErrorMessages.push(args.map(String).join(' '));
      originalConsoleError(...args);
    });
  });

  afterEach(async () => {
    await act(async () => {});
    const actWarnings = consoleErrorMessages.filter((message) => message.includes('not wrapped in act'));
    consoleErrorSpy.mockRestore();
    expect(actWarnings).toEqual([]);
  });
}
