import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mythos-writer/shared/aiSuggestOnly', () => ({
  AI_TEXT_APPLY_ENABLED: true,
}));

const db = vi.hoisted(() => {
  const bag: Record<string, ReturnType<typeof vi.fn>> = {};
  return new Proxy(bag, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'then') return undefined;
      if (!target[prop]) target[prop] = vi.fn();
      return target[prop];
    },
  });
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    disableHardwareAcceleration: vi.fn(),
    whenReady: () => new Promise(() => {}),
    on: vi.fn(),
    once: vi.fn(),
    getPath: () => '/tmp/mythos-ai-suggest-only-flag-true',
    getAppPath: () => '/workspace',
    getVersion: () => '0.0.0-test',
    getName: () => 'Mythos Writer',
    requestSingleInstanceLock: () => true,
    quit: vi.fn(),
    exit: vi.fn(),
    setPath: vi.fn(),
    commandLine: { appendSwitch: vi.fn() },
  },
  BrowserWindow: { getAllWindows: () => [] },
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

vi.mock('./jobs/jobService.js', () => ({
  initJobService: vi.fn(),
  shutdownJobService: vi.fn(),
  getJobQueue: vi.fn(),
}));

vi.mock('./db.js', () => db);

import { handlers, resolveContinuityItemById } from './main.js';
import { IPC_CHANNELS } from './ipc.js';

const AI_SENTENCE = 'Change the manuscript to say the bridge is daylight only.';

describe('suggest_story_change reaches the old path when the flag is true (T3)', () => {
  beforeEach(() => {
    db.upsertSuggestion.mockClear();
    db.updateContinuityIssueStatus.mockClear();
    db.insertArchiveAuditLog.mockReset();
    db.getContinuityIssue.mockReset();
    db.getContinuityIssue.mockReturnValue({
      id: 'flag-1',
      scope: 'story_vault',
      category: 'factual_contradiction',
      severity: 'high',
      manuscript_scene_id: 'stories/scene.md',
      manuscript_offset: 0,
      manuscript_excerpt: 'She crossed at night.',
      vault_note_path: 'locations/bridge.md',
      vault_line: 1,
      vault_excerpt: 'daylight only',
      rationale: 'Night versus day.',
      proposed_match_archive: 'daylight',
      proposed_suggest_story: AI_SENTENCE,
      status: 'open',
      resolved_at: null,
      resolved_action: null,
      created_at: '2026-10-19T00:00:00.000Z',
    });
  });

  it('archive:confirm does not refuse suggest_only when the flag is true', () => {
    db.getSuggestion.mockReturnValue({
      id: 'sug-1',
      source_agent: 'archive',
      confidence: 0.8,
      rationale: 'Vault and scene disagree.',
      target_kind: 'manuscript',
      target_path: 'stories/scene.md',
      target_anchor: 'dark hair',
      payload_json: JSON.stringify({ kind: 'inconsistency', entityId: 'e1', propKey: 'hair', scenePhrase: 'dark hair' }),
      status: 'proposed',
      created_at: '2026-10-19T00:00:00.000Z',
      applied_at: null,
      applied_run_id: null,
      budget_exceeded: 0,
      category: 'other',
    });
    const result = handlers[IPC_CHANNELS.ARCHIVE_CONFIRM]({
      suggestionId: 'sug-1',
      action: 'suggest_story_change',
    }) as { ok?: boolean; reason?: string; newSuggestionId?: string };
    expect(result.reason).not.toBe('suggest_only');
    expect(result.ok).toBe(true);
    expect(result.newSuggestionId).toEqual(expect.any(String));
    expect(db.upsertSuggestion).toHaveBeenCalled();
    const row = db.upsertSuggestion.mock.calls.at(-1)?.[0] as { payload_json: string };
    expect(row.payload_json).toContain('story-change');
  });

  it('upserts a continuity_story_change row instead of refusing', () => {
    const result = resolveContinuityItemById('flag-1', 'suggest_story_change', AI_SENTENCE);
    expect(result).toEqual({ ok: true });
    expect(result).not.toMatchObject({ reason: 'suggest_only' });
    expect(db.upsertSuggestion).toHaveBeenCalledTimes(1);
    const row = db.upsertSuggestion.mock.calls[0][0] as { payload_json: string; rationale: string };
    expect(row.rationale).toBe(AI_SENTENCE);
    expect(row.payload_json).toContain('continuity_story_change');
    expect(row.payload_json).toContain(AI_SENTENCE);
    expect(db.updateContinuityIssueStatus).toHaveBeenCalled();
  });
});
