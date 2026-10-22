// VAULT_OPEN_FOLDER dialog default (S-2). Boots the real main module with a
// fake Electron app whose dialog.showOpenDialog is mocked, then invokes the
// registered handler. Dropping defaultPath from the Open Vault call fails
// the "vault root parent" assertion.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const USER_DATA = path.join(os.tmpdir(), 'mythos-vault-open-dialog-test');

const harness = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  const listeners = new Map<string, Set<Listener>>();
  function add(event: string, listener: Listener): void {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(listener);
  }

  const ipc = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
  const openDialog = vi.fn(async (_options?: { defaultPath?: string }) => ({ canceled: true, filePaths: [] as string[] }));
  const bootError: { current: unknown } = { current: null };
  let releaseReady: () => void = () => {};
  const readyGate = new Promise<void>((resolve) => {
    releaseReady = resolve;
  });

  function stub(): unknown {
    const proxy: object = new Proxy(function stubFn() {}, {
      get(_target, prop) {
        if (prop === 'then') return undefined;
        if (prop === 'id') return 1;
        return proxy;
      },
      apply() {
        return proxy;
      },
      construct() {
        return proxy;
      },
    });
    return proxy;
  }

  const app = {
    isPackaged: false,
    on(event: string, listener: Listener) {
      add(event, listener);
      return app;
    },
    once(event: string, listener: Listener) {
      const wrapped: Listener = (...args) => {
        listeners.get(event)?.delete(wrapped);
        listener(...args);
      };
      add(event, wrapped);
      return app;
    },
    off(event: string, listener: Listener) {
      listeners.get(event)?.delete(listener);
      return app;
    },
    removeListener(event: string, listener: Listener) {
      listeners.get(event)?.delete(listener);
      return app;
    },
    removeAllListeners(event?: string) {
      if (event === undefined) listeners.clear();
      else listeners.delete(event);
      return app;
    },
    listenerCount(event: string) {
      return listeners.get(event)?.size ?? 0;
    },
    whenReady() {
      const promise = readyGate.then(() => undefined);
      const realThen = promise.then.bind(promise);
      promise.then = ((onFulfilled, onRejected) => {
        const next = realThen(onFulfilled, onRejected);
        next.catch((err: unknown) => {
          bootError.current = err;
        });
        return next;
      }) as typeof promise.then;
      return promise;
    },
    disableHardwareAcceleration() {},
    getPath(name: string) {
      if (name === 'home' || name === 'temp' || name === 'tempdir') return os.tmpdir();
      if (name === 'userData' || name === 'appData') return USER_DATA;
      return path.join(USER_DATA, name);
    },
    getVersion: () => '0.0.0-test',
    getName: () => 'Mythos Writer',
    getAppPath: () => USER_DATA,
    getLocale: () => 'en-US',
    getSystemLocale: () => 'en-US',
    quit() {},
    exit() {},
    isReady: () => true,
    requestSingleInstanceLock: () => true,
    setAppUserModelId() {},
    commandLine: { appendSwitch() {}, hasSwitch: () => false },
  };

  const electron = {
    app,
    BrowserWindow: vi.fn(function BrowserWindow() {
      return stub();
    }),
    ipcMain: {
      handle(channel: string, fn: (event: unknown, payload: unknown) => Promise<unknown>) {
        ipc.set(channel, fn);
      },
      on() {},
      once() {},
      removeListener() {},
      removeHandler() {},
      removeAllListeners() {},
    },
    ipcRenderer: { invoke: async () => ({}), on() {}, send() {} },
    dialog: {
      showOpenDialog: openDialog,
      showSaveDialog: async () => ({ canceled: true, filePath: '' }),
      showMessageBox: async () => ({ response: 0 }),
      showMessageBoxSync: () => 0,
    },
    shell: { openExternal: async () => {}, showItemInFolder() {} },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.from(''),
      decryptString: () => '',
    },
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1280, height: 800 } }],
      getPrimaryDisplay: () => ({
        bounds: { x: 0, y: 0, width: 1280, height: 800 },
        workArea: { x: 0, y: 0, width: 1280, height: 800 },
      }),
    },
    Menu: { setApplicationMenu() {}, buildFromTemplate: () => stub() },
    nativeImage: { createFromPath: () => stub() },
    net: {},
  };

  return { app, electron, ipc, openDialog, releaseReady: () => releaseReady(), bootError };
});

vi.mock('electron', () => harness.electron);

vi.mock('./jobs/jobWorker?nodeWorker', () => ({
  default: () => ({
    postMessage() {},
    terminate: async () => {},
    on() {},
    once() {},
    off() {},
  }),
}));

import './main.js';

function topFrameEvent() {
  const frame: { top?: unknown } = {};
  frame.top = frame;
  return { senderFrame: frame };
}

function writeVaultRoot(vaultRoot: string): void {
  fs.writeFileSync(
    path.join(USER_DATA, 'vault-settings.json'),
    JSON.stringify({ vaultRoot }),
    'utf-8',
  );
}

describe('VAULT_OPEN_FOLDER defaultPath', () => {
  beforeAll(async () => {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
    fs.mkdirSync(USER_DATA, { recursive: true });
    writeVaultRoot('');
    harness.releaseReady();
    const deadline = Date.now() + 8_000;
    while (!harness.ipc.has('vault:open-folder') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(
      harness.ipc.has('vault:open-folder'),
      `Open Vault handler was not registered. Boot error: ${String(harness.bootError.current)}`,
    ).toBe(true);
  }, 15_000);

  it('passes undefined when no vault root is set', async () => {
    writeVaultRoot('');
    harness.openDialog.mockClear();
    const handler = harness.ipc.get('vault:open-folder');
    expect(handler).toBeTypeOf('function');
    await handler!(topFrameEvent(), undefined);
    expect(harness.openDialog).toHaveBeenCalledTimes(1);
    const options = harness.openDialog.mock.calls[0][0];
    expect(options?.defaultPath).toBeUndefined();
  });

  it('passes the parent of the current vault root', async () => {
    const root = path.join(os.tmpdir(), 'Stories', 'Novel');
    writeVaultRoot(root);
    harness.openDialog.mockClear();
    const handler = harness.ipc.get('vault:open-folder');
    await handler!(topFrameEvent(), undefined);
    expect(harness.openDialog).toHaveBeenCalledTimes(1);
    const options = harness.openDialog.mock.calls[0][0];
    expect(options?.defaultPath).toBe(path.dirname(root));
  });
});
