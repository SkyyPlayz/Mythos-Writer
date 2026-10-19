import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const bag: Record<string, ReturnType<typeof vi.fn>> = {};
  const proxy = new Proxy(bag, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'then') return undefined;
      if (!target[prop]) target[prop] = vi.fn();
      return target[prop];
    },
  });
  return proxy;
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    disableHardwareAcceleration: vi.fn(),
    whenReady: () => new Promise(() => {}),
    on: vi.fn(),
    once: vi.fn(),
    getPath: () => '/tmp/mythos-ai-suggest-only',
    getAppPath: () => '/workspace',
    getVersion: () => '0.0.0-test',
    getName: () => 'Mythos Writer',
    requestSingleInstanceLock: () => true,
    quit: vi.fn(),
    exit: vi.fn(),
    setPath: vi.fn(),
    commandLine: { appendSwitch: vi.fn() },
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn(), on: vi.fn() },
  dialog: { showErrorBox: vi.fn(), showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
  shell: { openExternal: vi.fn(), trashItem: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: vi.fn(), decryptString: vi.fn() },
  screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 800, height: 600 } }) },
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
}));

vi.mock('./jobs/jobWorker?nodeWorker', () => ({
  default: () => ({ postMessage() {}, terminate() {}, on() {}, once() {} }),
}));

vi.mock('./db.js', () => db);

import { handlers, resolveContinuityItemById } from './main.js';
import { IPC_CHANNELS } from './ipc.js';

describe('suggest_story_change is refused (T3, T23)', () => {
  beforeEach(() => {
    db.upsertSuggestion.mockClear();
    db.updateSuggestionStatus.mockClear();
    db.updateContinuityIssueStatus.mockClear();
    db.getContinuityIssue.mockClear();
    db.getSuggestion.mockClear();
  });

  it('archive:confirm returns suggest_only and does not write', () => {
    const result = handlers[IPC_CHANNELS.ARCHIVE_CONFIRM]({
      suggestionId: 'missing-comment',
      action: 'suggest_story_change',
    });
    expect(result).toEqual({ ok: false, reason: 'suggest_only' });
    expect(db.upsertSuggestion).not.toHaveBeenCalled();
    expect(db.updateSuggestionStatus).not.toHaveBeenCalled();
    expect(db.getSuggestion).not.toHaveBeenCalled();
  });

  it('resolveContinuityItemById returns suggest_only before lookup', () => {
    const result = resolveContinuityItemById('missing-flag', 'suggest_story_change', 'AI wrote this.');
    expect(result).toEqual({ ok: false, reason: 'suggest_only' });
    expect(db.getContinuityIssue).not.toHaveBeenCalled();
    expect(db.upsertSuggestion).not.toHaveBeenCalled();
    expect(db.updateContinuityIssueStatus).not.toHaveBeenCalled();
  });
});
