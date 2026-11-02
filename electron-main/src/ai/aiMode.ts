// Pure effective-mode resolution for AI modes (Off / Local Only / Full); no I/O.
//
// PLAN-AI-MODES M0. In M1 the planned online-state and local-probe modules
// feed this function, and the provider gate and UI read its result. This
// module never touches the filesystem, the network, timers or Electron.
//
// Scope notes for M1 (deliberately not decided here):
// - "Local" means the loopback probe said yes. This function never sees a
//   provider kind or URL, so it cannot enforce that Local Only sends only to
//   loopback. M1's provider gate must check `isLoopbackUrl` (provider.ts) on
//   the effective base URL for every kind. `isLocalReserveEligible` is not
//   enough on its own: it trusts ollama / lmstudio / llamacpp whatever their
//   base URL is.
// - When the result is Off with reason `offline-no-local` or `no-local`, M1
//   must show the Settings line and must never render an empty Local Only
//   option.

/** The mode a user can pick, and the mode the app actually runs in. */
export type AiMode = 'off' | 'local' | 'full';

/**
 * Why the effective mode differs from the picked mode. Present exactly when
 * they differ.
 * - `offline-using-local`: Full was picked, the app is offline and local AI
 *   is up, so it runs Local Only.
 * - `offline-no-local`: Full was picked, the app is offline and there is no
 *   local AI, so AI is off.
 * - `no-local`: Local Only was picked and there is no local AI, so AI is off
 *   (online or not).
 * - `invalid-mode`: the picked mode is not an `AiMode`, so AI is off.
 */
export type AiModeReason = 'offline-using-local' | 'offline-no-local' | 'no-local' | 'invalid-mode';

export interface AiModeInput {
  /**
   * The mode the user picked. Validate a raw stored value with `isAiMode`
   * first; anything else reaching here resolves to Off (`invalid-mode`).
   */
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

/** Whether a value is one of the three AI modes. */
export function isAiMode(value: unknown): value is AiMode {
  return value === 'off' || value === 'local' || value === 'full';
}

/**
 * Resolve the mode the app runs in from the picked mode and current state.
 *
 * Truth table (PLAN-AI-MODES M0):
 * 1. Off, any                      → Off
 * 2. Full, online                  → Full
 * 3. Full or Local, offline, local → Local Only
 * 4. Full, offline, no local       → Off (`offline-no-local`)
 * 5. Local, any, no local          → Off (`no-local`)
 * Local, online, local follows from the picked mode: Local Only.
 *
 * Fails closed: an unknown mode resolves to Off, and only a strict `true`
 * counts for `online` and `localAvailable`.
 */
export function resolveEffective(input: AiModeInput): AiModeResult {
  if (!isAiMode(input.mode)) return { effective: 'off', reason: 'invalid-mode' };

  // Cell 1: Off wins over every other input. Without this line Off would be
  // handled as Local Only below.
  if (input.mode === 'off') return { effective: 'off' };

  const online = input.online === true;
  const local = input.localAvailable === true;

  if (input.mode === 'full') {
    if (online) return { effective: 'full' };
    if (local) return { effective: 'local', reason: 'offline-using-local' };
    return { effective: 'off', reason: 'offline-no-local' };
  }

  // Local Only picked.
  if (local) return { effective: 'local' };
  return { effective: 'off', reason: 'no-local' };
}
