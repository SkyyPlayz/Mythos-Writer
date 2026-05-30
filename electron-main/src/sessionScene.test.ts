/**
 * sessionScene.test.ts (SKY-130)
 *
 * Unit tests for last-opened-scene settings round-trip:
 *   §1  LastOpenedScene serialises and deserialises cleanly through JSON
 *   §2  loadAppSettings / saveAppSettings preserve lastOpenedScene intact
 *   §3  Missing lastOpenedScene field handled gracefully (undefined)
 *   §4  SESSION_SCENE_SAVE payload shape matches AppSettings.lastOpenedScene
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { LastOpenedScene, SessionSaveScenePayload, AppSettings } from './ipc.js';

let tmpDir: string;
let settingsFile: string;

const BASE_AGENT_BUDGET = {
  autoApply: false,
  confidenceThreshold: 0.85,
  maxTokensPerHour: 100_000,
  maxSuggestionsPerHour: 50,
  heartbeatIntervalMinutes: 5,
  maxTokensPerDay: 500_000,
};

// Minimal settings object that satisfies the required AppSettings fields
function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    apiKey: '',
    agents: {
      writingAssistant: { enabled: true, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, ...BASE_AGENT_BUDGET },
      brainstorm: { enabled: true, model: 'claude-sonnet-4-6', ...BASE_AGENT_BUDGET },
      archive: { enabled: true, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, ...BASE_AGENT_BUDGET },
    },
    theme: 'dark',
    ...overrides,
  };
}

// Inline implementations mirroring main.ts loadAppSettings / saveAppSettings for isolation
function saveSettings(filePath: string, settings: AppSettings): void {
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
}

function loadSettings(filePath: string, defaults: AppSettings): AppSettings {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return { ...defaults };
  }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-session-'));
  settingsFile = path.join(tmpDir, 'app-settings.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── §1 JSON serialisation ────────────────────────────────────────────────────

describe('LastOpenedScene JSON round-trip (§1)', () => {
  it('serialises all required fields', () => {
    const scene: LastOpenedScene = {
      sceneId: 'abc-123',
      scenePath: 'stories/s1/chapters/c1/scenes/abc-123.md',
      scrollTop: 0,
      cursorLine: 42,
    };
    const json = JSON.stringify(scene);
    const parsed = JSON.parse(json) as LastOpenedScene;
    expect(parsed.sceneId).toBe('abc-123');
    expect(parsed.scenePath).toBe('stories/s1/chapters/c1/scenes/abc-123.md');
    expect(parsed.scrollTop).toBe(0);
    expect(parsed.cursorLine).toBe(42);
  });

  it('preserves large cursorLine values', () => {
    const scene: LastOpenedScene = { sceneId: 'x', scenePath: 'p', scrollTop: 0, cursorLine: 99_999 };
    const parsed = JSON.parse(JSON.stringify(scene)) as LastOpenedScene;
    expect(parsed.cursorLine).toBe(99_999);
  });
});

// ─── §2 Save / load round-trip ────────────────────────────────────────────────

describe('settings file round-trip (§2)', () => {
  it('persists lastOpenedScene and loads it back', () => {
    const scene: LastOpenedScene = {
      sceneId: 'scene-7',
      scenePath: 'stories/book1/chapters/ch2/scenes/scene-7.md',
      scrollTop: 0,
      cursorLine: 128,
    };
    const settings = makeSettings({ lastOpenedScene: scene });
    saveSettings(settingsFile, settings);

    const loaded = loadSettings(settingsFile, makeSettings());
    expect(loaded.lastOpenedScene).toBeDefined();
    expect(loaded.lastOpenedScene?.sceneId).toBe('scene-7');
    expect(loaded.lastOpenedScene?.cursorLine).toBe(128);
    expect(loaded.lastOpenedScene?.scenePath).toBe('stories/book1/chapters/ch2/scenes/scene-7.md');
  });

  it('preserves existing settings fields when writing lastOpenedScene', () => {
    const base = makeSettings({ theme: 'high-contrast' });
    saveSettings(settingsFile, base);

    const loaded = loadSettings(settingsFile, makeSettings());
    const updated = { ...loaded, lastOpenedScene: { sceneId: 'x', scenePath: 'p', scrollTop: 0, cursorLine: 0 } };
    saveSettings(settingsFile, updated);

    const reloaded = loadSettings(settingsFile, makeSettings());
    expect(reloaded.theme).toBe('high-contrast');
    expect(reloaded.lastOpenedScene?.sceneId).toBe('x');
  });

  it('can overwrite lastOpenedScene on scene change', () => {
    const first: LastOpenedScene = { sceneId: 'a', scenePath: 'p/a', scrollTop: 0, cursorLine: 10 };
    const second: LastOpenedScene = { sceneId: 'b', scenePath: 'p/b', scrollTop: 0, cursorLine: 55 };

    saveSettings(settingsFile, makeSettings({ lastOpenedScene: first }));
    saveSettings(settingsFile, makeSettings({ lastOpenedScene: second }));

    const loaded = loadSettings(settingsFile, makeSettings());
    expect(loaded.lastOpenedScene?.sceneId).toBe('b');
    expect(loaded.lastOpenedScene?.cursorLine).toBe(55);
  });
});

// ─── §3 Missing field graceful handling ──────────────────────────────────────

describe('missing lastOpenedScene (§3)', () => {
  it('returns undefined when field absent from settings file', () => {
    saveSettings(settingsFile, makeSettings());
    const loaded = loadSettings(settingsFile, makeSettings());
    expect(loaded.lastOpenedScene).toBeUndefined();
  });

  it('returns undefined on a fresh empty settings file', () => {
    const loaded = loadSettings(settingsFile, makeSettings());
    expect(loaded.lastOpenedScene).toBeUndefined();
  });
});

// ─── §4 Payload shape compatibility ──────────────────────────────────────────

describe('SessionSaveScenePayload shape (§4)', () => {
  it('payload fields match LastOpenedScene fields 1-to-1', () => {
    const payload: SessionSaveScenePayload = {
      sceneId: 'sc-1',
      scenePath: 'stories/s1/scenes/sc-1.md',
      scrollTop: 0,
      cursorLine: 7,
    };
    // Assign to LastOpenedScene — TypeScript would error at compile time if shapes diverge
    const asSaved: LastOpenedScene = payload;
    expect(asSaved.sceneId).toBe(payload.sceneId);
    expect(asSaved.cursorLine).toBe(7);
  });
});
