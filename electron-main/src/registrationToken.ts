// Registration token store (MYT-360 / MYT-367)
// Backs vault:obsidian-{dry-run,register} and vault:import. The contract:
// — vault:pick-folder issues a token bound to the user-chosen path.
// — vault:obsidian-register / vault:import consume the token.
// — vault:obsidian-dry-run peeks the token (does not consume), so the
//   natural pick → preview → confirm flow needs only one user gesture.
// Tokens expire 60s after issue.
//
// Pure Node — no Electron deps — so unit tests can exercise the gate.

import crypto from 'crypto';

interface TokenEntry {
  vaultRoot: string;
  issuedAt: number;
}

export const TOKEN_TTL_MS = 60_000;

const store = new Map<string, TokenEntry>();

export function generateRegistrationToken(vaultRoot: string, now = Date.now()): string {
  const token = crypto.randomUUID();
  store.set(token, { vaultRoot, issuedAt: now });
  return token;
}

/**
 * Validate a registration token. Returns the bound vaultRoot on success, null
 * on miss / expiry. By default the token is consumed on success (one-shot);
 * pass `{ consume: false }` to peek without consuming (used by dry-run).
 */
export function validateRegistrationToken(
  token: string | undefined | null,
  opts: { consume?: boolean; now?: number } = {},
): { vaultRoot: string } | null {
  if (typeof token !== 'string' || token.length === 0) return null;
  const entry = store.get(token);
  if (!entry) return null;
  const now = opts.now ?? Date.now();
  if (now - entry.issuedAt > TOKEN_TTL_MS) {
    store.delete(token);
    return null;
  }
  if (opts.consume !== false) {
    store.delete(token);
  }
  return { vaultRoot: entry.vaultRoot };
}

// Test-only: reset the in-memory store between cases.
export function __clearRegistrationTokens(): void {
  store.clear();
}
