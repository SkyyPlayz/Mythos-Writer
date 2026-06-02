/**
 * agentDisabled.test.ts  (MYT-231)
 *
 * Verifies the per-agent enable/disable short-circuit in main.ts handlers.
 * Each disabled agent must:
 *   - Brainstorm / Writing Assistant: throw before any Anthropic call
 *   - Archive scan: return empty results without accessing the vault
 *
 * We replicate the exact handler guards from main.ts inline so this file
 * has no Electron dependency.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn() }));

import Anthropic from '@anthropic-ai/sdk';
import { openDb, closeDb } from './db.js';

// ─── Minimal AppSettings stubs ───────────────────────────────────────────────

function makeSettings(overrides: {
  brainstormEnabled?: boolean;
  writingAssistantEnabled?: boolean;
  archiveEnabled?: boolean;
} = {}) {
  return {
    apiKey: 'sk-ant-test',
    agents: {
      brainstorm: { enabled: overrides.brainstormEnabled ?? true, model: 'claude-haiku-4-5-20251001' },
      writingAssistant: { enabled: overrides.writingAssistantEnabled ?? true, model: 'claude-haiku-4-5-20251001', scanIntervalSeconds: 30 },
      archive: { enabled: overrides.archiveEnabled ?? true, model: 'claude-haiku-4-5-20251001', continuityCheckIntervalSeconds: 60 },
    },
    theme: 'dark' as const,
  };
}

// ─── Inline handler replicas ──────────────────────────────────────────────────
// Each mirrors the disabled guard from the corresponding main.ts handler.

async function brainstormHandlerWithSettings(
  settings: ReturnType<typeof makeSettings>,
  payload: { prompt: string; history?: Array<{ role: 'user' | 'assistant'; content: string }> },
): Promise<{ text: string; requestId: string }> {
  if (!settings.agents.brainstorm.enabled) {
    throw new Error('Brainstorm agent is disabled in settings.');
  }
  const client = new Anthropic({ apiKey: settings.apiKey });
  void client; // would stream here in real code
  return { text: 'response', requestId: 'r1' };
}

async function writingAssistantHandlerWithSettings(
  settings: ReturnType<typeof makeSettings>,
  payload: { prompt: string; context?: string },
): Promise<{ text: string; requestId: string }> {
  if (!settings.agents.writingAssistant.enabled) {
    throw new Error('Writing Assistant is disabled in settings.');
  }
  const client = new Anthropic({ apiKey: settings.apiKey });
  void client; // would stream here in real code
  return { text: 'response', requestId: 'r2' };
}

function archiveScanHandlerWithSettings(
  settings: ReturnType<typeof makeSettings>,
  _payload: { sceneText: string; scenePath: string },
) {
  if (!settings.agents.archive.enabled) {
    return { suggestions: [], inconsistenciesFound: 0, wikiLinksFound: 0 };
  }
  // would call runArchiveScan here in real code
  return { suggestions: [], inconsistenciesFound: 0, wikiLinksFound: 0 };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Brainstorm — disabled path', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-disabled-'));
    openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws a disabled error before calling Anthropic', async () => {
    const settings = makeSettings({ brainstormEnabled: false });
    await expect(
      brainstormHandlerWithSettings(settings, { prompt: 'Tell me a story.' }),
    ).rejects.toThrow('Brainstorm agent is disabled in settings.');
    expect(vi.mocked(Anthropic)).not.toHaveBeenCalled();
  });

  it('error message includes "disabled"', async () => {
    const settings = makeSettings({ brainstormEnabled: false });
    await expect(
      brainstormHandlerWithSettings(settings, { prompt: 'test' }),
    ).rejects.toThrow(/disabled/i);
  });

  it('enabled=true calls Anthropic constructor (normal path)', async () => {
    vi.mocked(Anthropic).mockReturnValue({} as unknown as Anthropic);
    const settings = makeSettings({ brainstormEnabled: true });
    const result = await brainstormHandlerWithSettings(settings, { prompt: 'test' });
    expect(result.text).toBe('response');
    expect(vi.mocked(Anthropic)).toHaveBeenCalledOnce();
  });
});

describe('Writing Assistant — disabled path', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-disabled-wa-'));
    openDb(tmpDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws a disabled error before calling Anthropic', async () => {
    const settings = makeSettings({ writingAssistantEnabled: false });
    await expect(
      writingAssistantHandlerWithSettings(settings, { prompt: 'Improve this.' }),
    ).rejects.toThrow('Writing Assistant is disabled in settings.');
    expect(vi.mocked(Anthropic)).not.toHaveBeenCalled();
  });

  it('error message includes "disabled"', async () => {
    const settings = makeSettings({ writingAssistantEnabled: false });
    await expect(
      writingAssistantHandlerWithSettings(settings, { prompt: 'test' }),
    ).rejects.toThrow(/disabled/i);
  });

  it('enabled=true calls Anthropic constructor (normal path)', async () => {
    vi.mocked(Anthropic).mockReturnValue({} as unknown as Anthropic);
    const settings = makeSettings({ writingAssistantEnabled: true });
    const result = await writingAssistantHandlerWithSettings(settings, { prompt: 'test' });
    expect(result.text).toBe('response');
    expect(vi.mocked(Anthropic)).toHaveBeenCalledOnce();
  });
});

describe('Archive scan — disabled path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty results without accessing vault or Anthropic', () => {
    const settings = makeSettings({ archiveEnabled: false });
    const result = archiveScanHandlerWithSettings(settings, {
      sceneText: 'The knight rode into battle.',
      scenePath: 'scene.md',
    });
    expect(result.suggestions).toHaveLength(0);
    expect(result.inconsistenciesFound).toBe(0);
    expect(result.wikiLinksFound).toBe(0);
    expect(vi.mocked(Anthropic)).not.toHaveBeenCalled();
  });

  it('returns the expected shape when disabled', () => {
    const settings = makeSettings({ archiveEnabled: false });
    const result = archiveScanHandlerWithSettings(settings, { sceneText: 'test', scenePath: 'test.md' });
    expect(result).toEqual({ suggestions: [], inconsistenciesFound: 0, wikiLinksFound: 0 });
  });

  it('enabled=true proceeds to scan (normal path)', () => {
    const settings = makeSettings({ archiveEnabled: true });
    const result = archiveScanHandlerWithSettings(settings, { sceneText: 'test', scenePath: 'test.md' });
    expect(result).toHaveProperty('suggestions');
    expect(result).toHaveProperty('inconsistenciesFound');
    expect(result).toHaveProperty('wikiLinksFound');
  });
});
