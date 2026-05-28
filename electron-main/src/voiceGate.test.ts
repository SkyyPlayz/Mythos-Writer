// Voice spawn gate tests (MYT-788).
//
// Two layers under test:
//   1. settings:set gate — checkVoiceSettingsUpdate accepts an echoed value,
//      rejects a renderer-driven path change without a token, accepts a
//      tokened change, refuses replay / wrong path / expired tokens.
//   2. spawn-time gate — checkSpawnPath refuses paths absent from the
//      trusted set; seed/record extend the set deterministically.
//
// Also covers shape validation and size caps.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  checkSpawnPath,
  checkVoiceSettingsUpdate,
  MAX_STT_AUDIO_BYTES,
  MAX_TTS_TEXT_BYTES,
  recordTrustedBinary,
  seedTrustedBinariesFromSettings,
  validateSttShape,
  validateTtsShape,
  __resetVoiceGate,
  __trustedBinariesSnapshot,
} from './voiceGate.js';
import {
  __clearRegistrationTokens,
  generateRegistrationToken,
  TOKEN_TTL_MS,
} from './registrationToken.js';
import type { SttSettings, TtsSettings } from './ipc.js';

// ─── Sandbox helpers ─────────────────────────────────────────────────────────

let tmpRoot: string;

beforeEach(() => {
  __resetVoiceGate();
  __clearRegistrationTokens();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-voicegate-'));
});

afterEach(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch { /* non-fatal */ }
});

function makeFile(name: string): string {
  const p = path.join(tmpRoot, name);
  fs.writeFileSync(p, '#!/bin/sh\necho ok\n', { mode: 0o755 });
  return p;
}

function stt(overrides: Partial<SttSettings> = {}): SttSettings {
  return { enabled: false, provider: 'auto', ...overrides };
}

function tts(overrides: Partial<TtsSettings> = {}): TtsSettings {
  return { enabled: false, provider: 'auto', ...overrides };
}

// ─── checkVoiceSettingsUpdate ────────────────────────────────────────────────

describe('checkVoiceSettingsUpdate', () => {
  it('accepts an unchanged settings echo', () => {
    const current = stt({ localBinaryPath: '/usr/bin/whisper' });
    const result = checkVoiceSettingsUpdate(current, current, undefined, undefined, {});
    expect(result.ok).toBe(true);
  });

  it('accepts clearing a previously set localBinaryPath', () => {
    const current = stt({ localBinaryPath: '/usr/bin/whisper' });
    const next = stt({ localBinaryPath: '' });
    const result = checkVoiceSettingsUpdate(next, current, undefined, undefined, {});
    expect(result.ok).toBe(true);
  });

  it('rejects a renderer-driven stt.localBinaryPath change without a token', () => {
    const current = stt();
    const next = stt({ localBinaryPath: '/bin/sh' });
    const result = checkVoiceSettingsUpdate(next, current, undefined, undefined, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/stt\.localBinaryPath.*voice:pickBinary/);
  });

  it('rejects a renderer-driven tts.localBinaryPath change without a token', () => {
    const current = tts();
    const next = tts({ localBinaryPath: '/bin/sh' });
    const result = checkVoiceSettingsUpdate(undefined, undefined, next, current, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/tts\.localBinaryPath.*voice:pickBinary/);
  });

  it('rejects a renderer-driven tts.localModelPath change without a token', () => {
    const current = tts({ localBinaryPath: '/usr/bin/piper' });
    const next = tts({ localBinaryPath: '/usr/bin/piper', localModelPath: '/etc/passwd' });
    const result = checkVoiceSettingsUpdate(undefined, undefined, next, current, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/tts\.localModelPath.*voice:pickBinary/);
  });

  it('accepts a tokened stt.localBinaryPath change and consumes the token', () => {
    const newPath = makeFile('whisper');
    const token = generateRegistrationToken(newPath);
    const next = stt({ localBinaryPath: newPath });
    const result = checkVoiceSettingsUpdate(next, stt(), undefined, undefined, { sttBinaryToken: token });
    expect(result.ok).toBe(true);
    // Replay should now fail (token consumed).
    const result2 = checkVoiceSettingsUpdate(next, stt(), undefined, undefined, { sttBinaryToken: token });
    expect(result2.ok).toBe(false);
  });

  it('rejects a token bound to a different path', () => {
    const realPath = makeFile('whisper');
    const token = generateRegistrationToken(realPath);
    const next = stt({ localBinaryPath: '/bin/sh' });
    const result = checkVoiceSettingsUpdate(next, stt(), undefined, undefined, { sttBinaryToken: token });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/does not match/);
  });

  it('rejects an expired token', () => {
    const newPath = makeFile('whisper');
    const issuedAt = 1_000_000;
    const token = generateRegistrationToken(newPath, issuedAt);
    const next = stt({ localBinaryPath: newPath });
    // Validate at issuedAt + TTL + 1 → expired.
    const result = checkVoiceSettingsUpdate(
      next,
      stt(),
      undefined,
      undefined,
      { sttBinaryToken: token },
      issuedAt + TOKEN_TTL_MS + 1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid or expired/);
  });

  it('does not consume tokens when a later field fails (partial-failure safety)', () => {
    const sttPath = makeFile('whisper');
    const sttToken = generateRegistrationToken(sttPath);
    // STT change is valid; TTS change is renderer-driven without a token → fail.
    const next = { sttNext: stt({ localBinaryPath: sttPath }), ttsNext: tts({ localBinaryPath: '/bin/sh' }) };
    const result = checkVoiceSettingsUpdate(
      next.sttNext,
      stt(),
      next.ttsNext,
      tts(),
      { sttBinaryToken: sttToken },
    );
    expect(result.ok).toBe(false);
    // STT token should still be valid because the whole update was aborted.
    const retry = checkVoiceSettingsUpdate(next.sttNext, stt(), undefined, undefined, { sttBinaryToken: sttToken });
    expect(retry.ok).toBe(true);
  });

  it('records new paths in the trusted set on success', () => {
    const sttPath = makeFile('whisper');
    const ttsBin = makeFile('piper');
    const ttsModel = makeFile('voice.onnx');
    const sttToken = generateRegistrationToken(sttPath);
    const ttsBinToken = generateRegistrationToken(ttsBin);
    const ttsModelToken = generateRegistrationToken(ttsModel);
    const result = checkVoiceSettingsUpdate(
      stt({ localBinaryPath: sttPath }),
      stt(),
      tts({ localBinaryPath: ttsBin, localModelPath: ttsModel }),
      tts(),
      { sttBinaryToken: sttToken, ttsBinaryToken: ttsBinToken, ttsModelToken },
    );
    expect(result.ok).toBe(true);
    const trusted = __trustedBinariesSnapshot();
    expect(trusted).toContain(fs.realpathSync(sttPath));
    expect(trusted).toContain(fs.realpathSync(ttsBin));
    expect(trusted).toContain(fs.realpathSync(ttsModel));
  });
});

// ─── checkSpawnPath ─────────────────────────────────────────────────────────

describe('checkSpawnPath', () => {
  it('refuses an empty path', () => {
    const r = checkSpawnPath('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/empty/);
  });

  it('refuses a path that does not exist', () => {
    const r = checkSpawnPath(path.join(tmpRoot, 'nope'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/does not resolve/);
  });

  it('refuses a real file that was never trusted', () => {
    const p = makeFile('arbitrary');
    const r = checkSpawnPath(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not in the trusted set/);
  });

  it('allows a recorded trusted binary', () => {
    const p = makeFile('whisper');
    recordTrustedBinary(p);
    const r = checkSpawnPath(p);
    expect(r.ok).toBe(true);
  });

  it('allows a binary whose realpath was trusted (symlink → trusted target)', () => {
    const target = makeFile('whisper-real');
    const link = path.join(tmpRoot, 'whisper');
    fs.symlinkSync(target, link);
    recordTrustedBinary(target);
    const r = checkSpawnPath(link);
    expect(r.ok).toBe(true);
    expect(r.realPath).toBe(fs.realpathSync(target));
  });

  it('refuses a symlink whose realpath resolves OUTSIDE the trusted set', () => {
    const trusted = makeFile('whisper-trusted');
    const untrusted = makeFile('sh-attacker');
    recordTrustedBinary(trusted);
    // Renderer / settings file managed to put `link → untrusted` on disk.
    const link = path.join(tmpRoot, 'whisper');
    fs.symlinkSync(untrusted, link);
    const r = checkSpawnPath(link);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not in the trusted set/);
  });

  it('seedTrustedBinariesFromSettings adds all three path fields', () => {
    const sttBin = makeFile('whisper');
    const ttsBin = makeFile('piper');
    const ttsModel = makeFile('voice.onnx');
    seedTrustedBinariesFromSettings({
      stt: stt({ localBinaryPath: sttBin }),
      tts: tts({ localBinaryPath: ttsBin, localModelPath: ttsModel }),
    });
    expect(checkSpawnPath(sttBin).ok).toBe(true);
    expect(checkSpawnPath(ttsBin).ok).toBe(true);
    expect(checkSpawnPath(ttsModel).ok).toBe(true);
  });

  it('seedTrustedBinariesFromSettings tolerates undefined and missing files', () => {
    seedTrustedBinariesFromSettings(undefined);
    seedTrustedBinariesFromSettings(null);
    seedTrustedBinariesFromSettings({});
    seedTrustedBinariesFromSettings({ stt: stt({ localBinaryPath: '/no/such/file' }) });
    expect(__trustedBinariesSnapshot()).toHaveLength(0);
  });
});

// ─── Shape validation ──────────────────────────────────────────────────────

describe('validateSttShape / validateTtsShape', () => {
  it('accepts undefined / null', () => {
    expect(validateSttShape(undefined).ok).toBe(true);
    expect(validateTtsShape(null).ok).toBe(true);
  });

  it('rejects non-object', () => {
    expect(validateSttShape('hello').ok).toBe(false);
    expect(validateTtsShape(42).ok).toBe(false);
  });

  it('rejects wrong-typed enabled / provider', () => {
    expect(validateSttShape({ enabled: 'yes', provider: 'auto' }).ok).toBe(false);
    expect(validateSttShape({ enabled: true, provider: 'bogus' }).ok).toBe(false);
    expect(validateTtsShape({ enabled: true, provider: 'auto', localBinaryPath: 123 }).ok).toBe(false);
    expect(validateTtsShape({ enabled: true, provider: 'auto', localModelPath: {} }).ok).toBe(false);
  });

  it('accepts a well-formed payload', () => {
    expect(validateSttShape({ enabled: true, provider: 'local', localBinaryPath: '/x' }).ok).toBe(true);
    expect(validateTtsShape({ enabled: true, provider: 'auto', localBinaryPath: '/x', localModelPath: '/y' }).ok).toBe(true);
  });
});

// ─── Size caps ───────────────────────────────────────────────────────────────

describe('size caps', () => {
  it('MAX_TTS_TEXT_BYTES is bounded (≤ 64KB)', () => {
    expect(MAX_TTS_TEXT_BYTES).toBeGreaterThan(0);
    expect(MAX_TTS_TEXT_BYTES).toBeLessThanOrEqual(64 * 1024);
  });

  it('MAX_STT_AUDIO_BYTES is bounded (≤ 64MB)', () => {
    expect(MAX_STT_AUDIO_BYTES).toBeGreaterThan(0);
    expect(MAX_STT_AUDIO_BYTES).toBeLessThanOrEqual(64 * 1024 * 1024);
  });
});
