/// <reference types="vite/client" />

declare namespace Electron {
  interface IpcRenderer {
    invoke(channel: string, payload?: unknown): Promise<unknown>;
  }
}

declare module 'electron' {
  export const ipcRenderer: {
    invoke(channel: string, payload?: unknown): Promise<unknown>;
  };
  export const ipcMain: {
    handle(channel: string, handler: (...args: unknown[]) => Promise<unknown>): void;
  };
  export const app: {
    getPath(name: string): string;
    whenReady(): Promise<void>;
    on(event: string, handler: (...args: unknown[]) => void): void;
    quit(): void;
  };
  export const BrowserWindow: {
    new (options: unknown): {
      loadURL(url: string): void;
      loadFile(path: string): void;
      on(event: string, handler: (...args: unknown[]) => void): void;
      getAllWindows(): BrowserWindow[];
    };
  };
  export const contextBridge: {
    exposeInMainWorld(key: string, api: unknown): void;
  };
}
