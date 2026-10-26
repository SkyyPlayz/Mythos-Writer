// S3.3 — artifact IPC rejects a subframe and a message that is not the edit schema.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  ipcRenderer: {
    invoke: vi.fn(),
  },
}));

import { ipcMain } from 'electron';
import { setupIpcMain, UNTRUSTED_FRAME_REJECTION } from '../ipc.js';
import { parseArtifactEditMsg } from './artifactSchema.js';

const mockHandle = vi.mocked(ipcMain.handle);
const ARTIFACT = '4a1b0c2d-e3f4-4123-8abc-1234567890ab';

function topFrame() {
  const frame: { top?: unknown } = {};
  frame.top = frame;
  return { senderFrame: frame };
}

function subFrame() {
  const top: { top?: unknown } = {};
  top.top = top;
  return { senderFrame: { top } };
}

describe('artifact sender frame (S3.3)', () => {
  beforeEach(() => {
    mockHandle.mockClear();
    setupIpcMain({} as never);
  });

  it('rejects a subframe before the handler runs', async () => {
    const registered = mockHandle.mock.calls.find((call) => call[0] === 'artifacts:writeBack');
    expect(registered).toBeTruthy();
    const handler = registered?.[1] as (event: unknown, payload: unknown) => Promise<unknown>;
    const result = await handler(subFrame(), {
      type: 'edit',
      artifactId: ARTIFACT,
      origin: 'user',
      text: 'from a frame',
      kind: 'note',
    });
    expect(result).toEqual(UNTRUSTED_FRAME_REJECTION);
  });

  it('refuses a payload that is not the closed edit schema', async () => {
    expect(parseArtifactEditMsg({
      type: 'edit',
      artifactId: ARTIFACT,
      origin: 'user',
      text: 'ok',
      extra: true,
    })).toEqual({ ok: false, reason: 'bad_schema' });
    expect(parseArtifactEditMsg({
      type: 'edit',
      artifactId: ARTIFACT,
      origin: 'agent',
      text: 'no',
    })).toEqual({ ok: false, reason: 'bad_schema' });

    const registered = mockHandle.mock.calls.find((call) => call[0] === 'artifacts:writeBack');
    const handler = registered?.[1] as (event: unknown, payload: unknown) => Promise<unknown>;
    const result = await handler(topFrame(), {
      type: 'edit',
      artifactId: '../x',
      origin: 'user',
      text: 'no',
      kind: 'note',
    });
    expect(result).toEqual({ ok: false, reason: 'bad_schema' });
  });
});
