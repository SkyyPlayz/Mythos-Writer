// SKY-1530 — regression guard: duplicate IPC channel registration crashes Electron.
//
// GH#444 / BugHunter finding: calling ipcMain.handle for the same channel twice
// throws "Attempted to register a second handler" before the first window opens.
// Playwright E2E then hits a 30s firstWindow timeout.
//
// Invariants under test:
//   1. IPC_CHANNELS has no duplicate string values. A typo or copy-paste that
//      assigns the same channel string to two constants would let two handlers
//      compete for the same channel, crashing the process at startup.
//   2. setupIpcMain calls ipcMain.handle exactly once per key in the passed
//      handlers object — calling it twice for the same channel is the original
//      crash pattern.
//   3. vault:validate-path specifically is guarded (the channel named in GH#444).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  ipcRenderer: {
    invoke: vi.fn(),
  },
}));

import { IPC_CHANNELS, setupIpcMain } from './ipc.js';
import { ipcMain } from 'electron';

const mockHandle = vi.mocked(ipcMain.handle);

function topFrameEvent() {
  const frame = {};
  Object.assign(frame, { top: frame });
  return { senderFrame: frame };
}

// ─── IPC_CHANNELS uniqueness ──────────────────────────────────────────────────

describe('IPC_CHANNELS — channel string uniqueness', () => {
  it('no two constants share the same channel string', () => {
    const entries = Object.entries(IPC_CHANNELS) as [string, string][];
    const seen = new Map<string, string>();
    const dupes: string[] = [];

    for (const [key, val] of entries) {
      if (seen.has(val)) {
        dupes.push(`"${val}" is used by both ${seen.get(val)} and ${key}`);
      } else {
        seen.set(val, key);
      }
    }

    expect(dupes, `Duplicate channel strings:\n${dupes.join('\n')}`).toHaveLength(0);
    expect(seen.size).toBe(entries.length);
  });
});

// ─── setupIpcMain single-registration invariant ───────────────────────────────

describe('setupIpcMain — single-registration invariant', () => {
  beforeEach(() => {
    mockHandle.mockClear();
  });

  it('registers each channel exactly once for a multi-channel handlers object', () => {
    const handlers = {
      'vault:read': vi.fn(),
      'vault:write': vi.fn(),
      [IPC_CHANNELS.VAULT_VALIDATE_PATH]: vi.fn(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setupIpcMain(handlers as any);

    const registered = mockHandle.mock.calls.map((c) => c[0] as string);

    expect(registered).toHaveLength(Object.keys(handlers).length);
    for (const channel of Object.keys(handlers)) {
      const count = registered.filter((c) => c === channel).length;
      expect(count, `"${channel}" should be registered exactly once, got ${count}`).toBe(1);
    }
  });

  it('vault:validate-path specifically is registered exactly once (GH#444 regression)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setupIpcMain({ [IPC_CHANNELS.VAULT_VALIDATE_PATH]: vi.fn() } as any);

    const matchingCalls = mockHandle.mock.calls.filter(
      (c) => c[0] === IPC_CHANNELS.VAULT_VALIDATE_PATH,
    );
    expect(matchingCalls).toHaveLength(1);
  });

  it('calling setupIpcMain twice for the same channel set triggers handle twice — demonstrates why single-call discipline matters', () => {
    const handlers = {
      [IPC_CHANNELS.VAULT_VALIDATE_PATH]: vi.fn(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setupIpcMain(handlers as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setupIpcMain(handlers as any);

    const calls = mockHandle.mock.calls.filter(
      (c) => c[0] === IPC_CHANNELS.VAULT_VALIDATE_PATH,
    );
    // Two calls = what the crash looks like in production. This test documents
    // the failure mode so any future duplicate-registration regression is obvious.
    expect(calls).toHaveLength(2);
  });

  it('SKY-11865: a channel already claimed by an external caller does not abort registration of the rest', () => {
    // Real Electron ipcMain.handle() throws synchronously ("Attempted to
    // register a second handler") when a channel is already registered —
    // exactly what happens when a Playwright E2E harness stubs a channel via
    // app.evaluate() before boot reaches setupIpcMain(). The mock here throws
    // for one channel to reproduce that, since the plain vi.fn() elsewhere in
    // this file never throws and so can't catch this failure mode.
    const handlers = {
      'a:before': vi.fn(),
      [IPC_CHANNELS.VAULT_VALIDATE_PATH]: vi.fn(),
      'z:after': vi.fn(),
    };

    mockHandle.mockImplementation((channel: string) => {
      if (channel === IPC_CHANNELS.VAULT_VALIDATE_PATH) {
        throw new Error(`Attempted to register a second handler for '${channel}'`);
      }
    });

    expect(() => setupIpcMain(handlers as any)).not.toThrow();

    const registered = mockHandle.mock.calls.map((c) => c[0] as string);
    // The conflicting channel was attempted (and rejected by the mock), but
    // 'z:after' — listed after it in the handlers object — must still have
    // been registered. Pre-fix, the thrown error aborted the whole for-loop
    // and 'z:after' was never reached.
    expect(registered).toContain('a:before');
    expect(registered).toContain(IPC_CHANNELS.VAULT_VALIDATE_PATH);
    expect(registered).toContain('z:after');

    mockHandle.mockReset();
  });

  it('registers settings get/set/testConnection with the standard IPC envelope', async () => {
    const handlers = {
      [IPC_CHANNELS.SETTINGS_GET]: vi.fn(() => ({ theme: 'dark' })),
      [IPC_CHANNELS.SETTINGS_SET]: vi.fn(() => ({ saved: true })),
      [IPC_CHANNELS.SETTINGS_TEST_CONNECTION]: vi.fn(() => ({ ok: true, latencyMs: 4 })),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setupIpcMain(handlers as any);

    for (const channel of Object.keys(handlers)) {
      const registered = mockHandle.mock.calls.find((c) => c[0] === channel);
      expect(registered).toBeDefined();
      const result = await registered![1](topFrameEvent() as never, undefined);
      expect(result).toMatchObject({ ok: true, data: expect.any(Object) });
    }
  });
});
