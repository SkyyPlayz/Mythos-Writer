// Pure effective-mode resolution for AI modes (Off / Local Only / Full); no I/O.
//
// PLAN-AI-MODES M0. M1 feeds this from `onlineState` and `localProbe` and
// reads the result in the provider gate and the UI. This module never touches
// the filesystem, the network, timers or Electron.
//
// Scope notes for M1 (deliberately not decided here):
// - "Local" means the loopback probe said yes. That Local Only sends only to
//   loopback provider kinds is enforced by the provider gate in M1
//   (`isLocalReserveEligible` in provider.ts), not by this function.
// - When the result is `off` with reason `no-local-offline` or
//   `no-local`, M1 shows the Settings line and never renders an empty Local
//   Only option.

/** The mode a user can pick, and the mode the app actually runs in. */
export type AiMode = 'off' | 'local' | 'full';

/**
 * Why the effective mode differs from the picked mode. Absent when they match.
 * - `offline-local`: Full was picked, the app is offline, local AI is up, so
 *   it runs Local Only.
 * - `no-local-offline`: Full was picked, the app is offline and there is no
 *   local AI, so AI is off.
 * - `no-local`: Local Only was picked and there is no local AI, so AI is off.
 */
export type AiModeReason = 'offline-local' | 'no-local-offline' | 'no-local';

export interface AiModeInput {
  /** The mode the user picked. */
  mode: AiMode;
  /** Whether the app is online. Only `true` counts as online. */
  online: boolean;
  /** Whether the local probe found a usable model. Only `true` counts. */
  localAvailable: boolean;
}

export interface AiModeResult {
  effective: AiMode;
  reason?: AiModeReason;
}

/**
 * Resolve the mode the app runs in from the picked mode and current state.
 *
 * Truth table (PLAN-AI-MODES M0):
 * 1. Off, any                     → Off
 * 2. Full, online                 → Full
 * 3. Full or Local, offline, local → Local Only
 * 4. Full, offline, no local       → Off (`no-local-offline`)
 * 5. Local, any, no local          → Off (`no-local`)
 * Local, online, local follows from the picked mode: Local Only.
 *
 * Fails closed: an unknown mode resolves to Off, and only a strict `true`
 * counts for `online` and `localAvailable`.
 */
export function resolveEffective(input: AiModeInput): AiModeResult {
  // Cell 1: Off wins over every other input.
  if (input.mode === 'off') return { effective: 'off' };

  const online = input.online === true;
  const local = input.localAvailable === true;

  if (input.mode === 'full') {
    if (online) return { effective: 'full' };
    if (local) return { effective: 'local', reason: 'offline-local' };
    return { effective: 'off', reason: 'no-local-offline' };
  }

  if (input.mode === 'local') {
    if (local) return { effective: 'local' };
    return { effective: 'off', reason: 'no-local' };
  }

  // A value M1's settings parser should already have rejected.
  return { effective: 'off' };
}
