// S-1a — select-client-certificate is registered at main.ts module load,
// before app.whenReady() resolves and before the first BrowserWindow.
// On a build with no handler this fails: nothing calls preventDefault, so
// Electron 44 would auto-pick the first certificate.

import { describe, expect, it, vi } from 'vitest';

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

  const browserWindow = vi.fn(function BrowserWindow(this: Record<string, unknown>) {
    this.isDestroyed = () => false;
    this.on = () => this;
    this.webContents = { on: () => {}, send: () => {}, session: {}, id: 1 };
  });
  Object.assign(browserWindow, {
    getAllWindows: () => [],
    getFocusedWindow: () => null,
  });

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
    emit(event: string, ...args: unknown[]) {
      const set = listeners.get(event);
      if (!set || set.size === 0) return false;
      for (const listener of [...set]) listener(...args);
      return true;
    },
    // Never resolves: window creation lives inside whenReady and must not run.
    whenReady: () => new Promise<void>(() => {}),
    disableHardwareAcceleration: () => {},
    getPath: (name: string) => `/tmp/mythos-client-cert-${name}`,
    getVersion: () => '0.0.0-test',
    getName: () => 'Mythos Writer',
    getAppPath: () => '/tmp/mythos-client-cert-app',
    getLocale: () => 'en-US',
    getSystemLocale: () => 'en-US',
    quit: () => {},
    exit: () => {},
    isReady: () => false,
    requestSingleInstanceLock: () => true,
    setAppUserModelId: () => {},
    commandLine: {
      appendSwitch: () => {},
      hasSwitch: () => false,
    },
  };

  const electron = {
    app,
    BrowserWindow: browserWindow,
    ipcMain: {
      handle: () => {},
      on: () => {},
      once: () => {},
      removeListener: () => {},
      removeHandler: () => {},
      removeAllListeners: () => {},
    },
    ipcRenderer: {
      invoke: async () => ({}),
      on: () => {},
      send: () => {},
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] }),
      showSaveDialog: async () => ({ canceled: true, filePath: '' }),
      showMessageBox: async () => ({ response: 0 }),
    },
    shell: {
      openExternal: async () => {},
      showItemInFolder: () => {},
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.from(''),
      decryptString: () => '',
    },
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getAllDisplays: () => [],
      getPrimaryDisplay: () => ({
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        workArea: { x: 0, y: 0, width: 800, height: 600 },
      }),
    },
    Menu: {
      setApplicationMenu: () => {},
      buildFromTemplate: () => ({}),
    },
    nativeImage: { createFromPath: () => ({}) },
    net: {},
  };

  return { app, browserWindow, electron };
});

vi.mock('electron', () => harness.electron);

vi.mock('./jobs/jobWorker?nodeWorker', () => ({
  default: () => ({
    postMessage: () => {},
    terminate: async () => {},
    on: () => {},
    once: () => {},
    off: () => {},
  }),
}));

import './main.js';

describe('S-1a select-client-certificate registration', () => {
  it('declines the only certificate before ready and before the first window', () => {
    // Registered during module init. whenReady never resolves, so no window yet.
    expect(harness.browserWindow).not.toHaveBeenCalled();

    const event = { preventDefault: vi.fn() };
    const callback = vi.fn();
    const list = [{ subjectName: 'CN=only-cert', data: 'cert-bytes' }];
    harness.app.emit(
      'select-client-certificate',
      event,
      null,
      'https://mtls.example/private/path?token=secret',
      list,
      callback,
    );

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]).toEqual([]);
    expect(harness.app.listenerCount('select-client-certificate')).toBe(1);
  });
});
