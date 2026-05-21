/// <reference types="vite/client" />

interface Window {
  mythosIPC: {
    generateStory: (payload: { prompt: string; genre?: string; length?: string }) => Promise<unknown>;
    abortStory: () => Promise<unknown>;
    getStoryStatus: () => Promise<unknown>;
    readVaultFile: (path: string) => Promise<unknown>;
    writeVaultFile: (path: string, content: string) => Promise<unknown>;
    listVaultFiles: (root?: string) => Promise<unknown>;
    deleteVaultFile: (path: string) => Promise<unknown>;
    readManifest: () => Promise<unknown>;
    writeManifest: (manifest: unknown) => Promise<unknown>;
    getAppInfo: () => Promise<unknown>;
    getSystemInfo: () => Promise<unknown>;
  };
}
