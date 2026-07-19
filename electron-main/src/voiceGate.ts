// Voice spawn gate (MYT-788) — refuses renderer-supplied binary paths for
// local STT (whisper.cpp) and local TTS (Piper) unless they came through a
// main-process file picker.
//
// Two independent layers of defense:
//
//   1. settings:set gate. When a renderer-supplied AppSettings tries to change
//      stt.localBinaryPath, tts.localBinaryPath, or tts.localModelPath, the
//      caller must include a one-shot registration token bound to that exact
//      path (issued by voice:pickBinary). Echo of the current persisted value
//      is always accepted; an empty/undefined value clears the setting.
//
//   2. Spawn-time gate. Even if a stale settings file points elsewhere,
//      transcribeLocal / speakWithPiper refuse to spawn unless the binary
//      (and TTS model) is in a main-managed trusted set. The set is
//      bootstrapped on app startup from the persisted settings (those got
//      there through a previous gated write) and extended whenever a fresh
//      settings:set successfully passes the gate. Renderer-controlled state
//      is never sufficient to populate this set on its own.
//
// Pure Node — no Electron deps — so unit tests can exercise the gate.

import fs from 'fs';
import path from 'path';
import type { SttSettings, TtsSettings } from './ipc.js';
import { validateRegistrationToken } from './registrationToken.js';

// ─── Size caps ──────────────────────────────────────────────────────────────
//
// Renderer-supplied payloads that flow into spawn'd subprocesses must be
// bounded so a buggy / compromised renderer cannot blow up the host with
// arbitrary stdin or temp-file writes.

/** Cap for voice:speak text payload (UTF-8 bytes, ≈ 32 KB). */
export const MAX_TTS_TEXT_BYTES = 32 * 1024;

/** Cap for voice:transcribe audio payload (≈ 25 MB, matches Whisper API cap). */
export const MAX_STT_AUDIO_BYTES = 25 * 1024 * 1024;

// ─── Trusted-binary set ─────────────────────────────────────────────────────
//
// In-memory set of real-resolved paths the main process has approved to be
// passed to child_process.spawn. The renderer cannot extend this set on its
// own — entries are added only by:
//   - `seedTrustedBinariesFromSettings` (startup, from persisted settings), or
//   - `recordTrustedBinary` (settings:set succeeded the gate).

const trustedBinaries = new Set<string>();

function tryRealpath(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/** Add a path's resolved real-path to the trusted set. No-op on bad input. */
export function recordTrustedBinary(p: string | null | undefined): void {
  if (typeof p !== 'string' || p.length === 0) return;
  const real = tryRealpath(p);
  if (real) trustedBinaries.add(real);
}

/**
 * Walk a persisted AppSettings and seed the trusted set from any paths that
 * resolve on disk. Safe to call repeatedly (idempotent set add).
 */
export function seedTrustedBinariesFromSettings(s: { stt?: SttSettings; tts?: TtsSettings } | null | undefined): void {
  if (!s) return;
  recordTrustedBinary(s.stt?.localBinaryPath);
  recordTrustedBinary(s.tts?.localBinaryPath);
  recordTrustedBinary(s.tts?.localModelPath);
}

export interface SpawnCheck {
  ok: boolean;
  realPath?: string;
  error?: string;
}

/**
 * Defense-in-depth check before spawn. Resolves the supplied path to its
 * real-path and refuses if the result is not in the trusted set. This blocks
 * both:
 *   - stale-settings attacks (binary swapped on disk after a previous gate
 *     pass) — the realpath comparison no longer matches what was approved,
 *   - direct in-process tampering of `settings.stt.localBinaryPath` without
 *     going through settings:set.
 */
export function checkSpawnPath(p: string | undefined | null): SpawnCheck {
  if (typeof p !== 'string' || p.length === 0) {
    return { ok: false, error: 'binary path is empty' };
  }
  const real = tryRealpath(p);
  if (!real) {
    return { ok: false, error: `binary path does not resolve on disk: ${p}` };
  }
  if (!trustedBinaries.has(real)) {
    return {
      ok: false,
      error:
        'refusing to spawn: binary is not in the trusted set — pick it via voice:pickBinary first',
    };
  }
  return { ok: true, realPath: real };
}

// ─── settings:set gate ──────────────────────────────────────────────────────

export interface VoiceSetTokens {
  /** Token bound to the new `stt.localBinaryPath`. */
  sttBinaryToken?: string;
  /** Token bound to the new `stt.localModelPath`. */
  sttModelToken?: string;
  /** Token bound to the new `tts.localBinaryPath`. */
  ttsBinaryToken?: string;
  /** Token bound to the new `tts.localModelPath`. */
  ttsModelToken?: string;
}

export type VoiceGateResult = { ok: true } | { ok: false; error: string };

function normalizeOptionalPath(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function pathChanged(next: string | undefined, current: string | undefined): boolean {
  return next !== current;
}

function checkPathField(
  field: string,
  next: string | undefined,
  current: string | undefined,
  token: string | undefined,
  now: number,
): VoiceGateResult {
  if (!pathChanged(next, current)) return { ok: true };
  // Clearing the setting is always allowed.
  if (next === undefined) return { ok: true };
  if (!token) {
    return {
      ok: false,
      error: `${field}: renderer-supplied path change requires a registrationToken from voice:pickBinary`,
    };
  }
  // Peek without consuming — we'll consume after every field has passed so a
  // partial-failure doesn't burn a still-valid token.
  const validated = validateRegistrationToken(token, { consume: false, now });
  if (!validated) {
    return { ok: false, error: `${field}: registrationToken is invalid or expired` };
  }
  if (validated.vaultRoot !== next) {
    return { ok: false, error: `${field}: registrationToken does not match the supplied path` };
  }
  return { ok: true };
}

/**
 * Gate the STT + TTS slices of a settings:set payload. On success, consumes
 * any tokens that were used and records the new paths as trusted for spawn.
 * On failure, no token is consumed and no path is trusted.
 *
 * Caller is expected to abort the whole settings:set when this returns !ok.
 */
export function checkVoiceSettingsUpdate(
  nextStt: SttSettings | undefined,
  currentStt: SttSettings | undefined,
  nextTts: TtsSettings | undefined,
  currentTts: TtsSettings | undefined,
  tokens: VoiceSetTokens,
  now: number = Date.now(),
): VoiceGateResult {
  const nextSttBin = normalizeOptionalPath(nextStt?.localBinaryPath);
  const curSttBin = normalizeOptionalPath(currentStt?.localBinaryPath);
  const nextSttModel = normalizeOptionalPath(nextStt?.localModelPath);
  const curSttModel = normalizeOptionalPath(currentStt?.localModelPath);
  const nextTtsBin = normalizeOptionalPath(nextTts?.localBinaryPath);
  const curTtsBin = normalizeOptionalPath(currentTts?.localBinaryPath);
  const nextTtsModel = normalizeOptionalPath(nextTts?.localModelPath);
  const curTtsModel = normalizeOptionalPath(currentTts?.localModelPath);

  const sttBinResult = checkPathField('stt.localBinaryPath', nextSttBin, curSttBin, tokens.sttBinaryToken, now);
  if (!sttBinResult.ok) return sttBinResult;

  const sttModelResult = checkPathField('stt.localModelPath', nextSttModel, curSttModel, tokens.sttModelToken, now);
  if (!sttModelResult.ok) return sttModelResult;

  const ttsBinResult = checkPathField('tts.localBinaryPath', nextTtsBin, curTtsBin, tokens.ttsBinaryToken, now);
  if (!ttsBinResult.ok) return ttsBinResult;

  const ttsModelResult = checkPathField('tts.localModelPath', nextTtsModel, curTtsModel, tokens.ttsModelToken, now);
  if (!ttsModelResult.ok) return ttsModelResult;

  // All checks passed — consume tokens for any fields that actually changed
  // to a non-empty value, then mark the new paths trusted for spawn.
  if (pathChanged(nextSttBin, curSttBin) && nextSttBin && tokens.sttBinaryToken) {
    validateRegistrationToken(tokens.sttBinaryToken, { now });
    recordTrustedBinary(nextSttBin);
  }
  if (pathChanged(nextSttModel, curSttModel) && nextSttModel && tokens.sttModelToken) {
    validateRegistrationToken(tokens.sttModelToken, { now });
    recordTrustedBinary(nextSttModel);
  }
  if (pathChanged(nextTtsBin, curTtsBin) && nextTtsBin && tokens.ttsBinaryToken) {
    validateRegistrationToken(tokens.ttsBinaryToken, { now });
    recordTrustedBinary(nextTtsBin);
  }
  if (pathChanged(nextTtsModel, curTtsModel) && nextTtsModel && tokens.ttsModelToken) {
    validateRegistrationToken(tokens.ttsModelToken, { now });
    recordTrustedBinary(nextTtsModel);
  }

  return { ok: true };
}

// ─── Shape validation ───────────────────────────────────────────────────────
//
// Light-touch type checks so an obviously malformed stt/tts blob is rejected
// before it can be persisted. We deliberately accept extra fields (forward
// compatibility) but reject wrong types on the security-relevant fields.

const STT_PROVIDERS = new Set(['local', 'cloud', 'auto']);
const TTS_PROVIDERS = STT_PROVIDERS;

export function validateSttShape(v: unknown): VoiceGateResult {
  if (v === undefined || v === null) return { ok: true };
  if (typeof v !== 'object') return { ok: false, error: 'stt: must be an object' };
  const s = v as Record<string, unknown>;
  if (typeof s.enabled !== 'boolean') return { ok: false, error: 'stt.enabled: must be boolean' };
  if (typeof s.provider !== 'string' || !STT_PROVIDERS.has(s.provider)) {
    return { ok: false, error: 'stt.provider: must be one of local|cloud|auto' };
  }
  if (s.localBinaryPath !== undefined && typeof s.localBinaryPath !== 'string') {
    return { ok: false, error: 'stt.localBinaryPath: must be string when set' };
  }
  return { ok: true };
}

export function validateTtsShape(v: unknown): VoiceGateResult {
  if (v === undefined || v === null) return { ok: true };
  if (typeof v !== 'object') return { ok: false, error: 'tts: must be an object' };
  const t = v as Record<string, unknown>;
  if (typeof t.enabled !== 'boolean') return { ok: false, error: 'tts.enabled: must be boolean' };
  if (typeof t.provider !== 'string' || !TTS_PROVIDERS.has(t.provider)) {
    return { ok: false, error: 'tts.provider: must be one of local|cloud|auto' };
  }
  if (t.localBinaryPath !== undefined && typeof t.localBinaryPath !== 'string') {
    return { ok: false, error: 'tts.localBinaryPath: must be string when set' };
  }
  if (t.localModelPath !== undefined && typeof t.localModelPath !== 'string') {
    return { ok: false, error: 'tts.localModelPath: must be string when set' };
  }
  return { ok: true };
}

// ─── Test helpers ───────────────────────────────────────────────────────────

/** Test-only: clear the in-memory trusted set between cases. */
export function __resetVoiceGate(): void {
  trustedBinaries.clear();
}

/** Test-only: inspect the trusted set. */
export function __trustedBinariesSnapshot(): string[] {
  return [...trustedBinaries];
}

// Exported so voice.ts can render a stable path for trusted-set lookups in
// situations where realpath would resolve too aggressively (e.g. tests that
// stub fs.realpathSync). Pure path.resolve normalization.
export function normalizePathForTrust(p: string): string {
  return path.resolve(p);
}
