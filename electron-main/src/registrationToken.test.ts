// Registration token gate (MYT-360 / MYT-367) — proves that
// vault:obsidian-register and friends cannot run on a renderer-supplied
// path without a valid, dialog-issued token.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateRegistrationToken,
  validateRegistrationToken,
  __clearRegistrationTokens,
  TOKEN_TTL_MS,
} from './registrationToken.js';

beforeEach(() => {
  __clearRegistrationTokens();
});

describe('registration token gate', () => {
  it('issues a token bound to the chosen vault root', () => {
    const token = generateRegistrationToken('/home/alice/vault');
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);

    const validated = validateRegistrationToken(token);
    expect(validated).toEqual({ vaultRoot: '/home/alice/vault' });
  });

  it('rejects missing / wrong / empty tokens', () => {
    generateRegistrationToken('/home/alice/vault');
    expect(validateRegistrationToken('')).toBeNull();
    expect(validateRegistrationToken(undefined)).toBeNull();
    expect(validateRegistrationToken(null)).toBeNull();
    expect(validateRegistrationToken('not-a-real-token')).toBeNull();
  });

  it('default validate is one-shot — second consume returns null', () => {
    const token = generateRegistrationToken('/home/alice/vault');
    expect(validateRegistrationToken(token)).toEqual({ vaultRoot: '/home/alice/vault' });
    expect(validateRegistrationToken(token)).toBeNull();
  });

  it('peek (consume:false) leaves the token usable for a later consume', () => {
    const token = generateRegistrationToken('/home/alice/vault');
    // dry-run-style peek
    expect(validateRegistrationToken(token, { consume: false })).toEqual({ vaultRoot: '/home/alice/vault' });
    expect(validateRegistrationToken(token, { consume: false })).toEqual({ vaultRoot: '/home/alice/vault' });
    // register-style consume
    expect(validateRegistrationToken(token)).toEqual({ vaultRoot: '/home/alice/vault' });
    expect(validateRegistrationToken(token)).toBeNull();
  });

  it('expires tokens older than TOKEN_TTL_MS and removes them from the store', () => {
    const now = Date.now();
    const token = generateRegistrationToken('/home/alice/vault', now);
    expect(validateRegistrationToken(token, { now: now + TOKEN_TTL_MS - 1 })).not.toBeNull();
    // Re-issue (previous call consumed) and let it expire
    const token2 = generateRegistrationToken('/home/alice/vault', now);
    expect(validateRegistrationToken(token2, { now: now + TOKEN_TTL_MS + 1 })).toBeNull();
    // A second call with a valid `now` still returns null — expired tokens are deleted, not just rejected.
    expect(validateRegistrationToken(token2, { now: now + 1 })).toBeNull();
  });

  it('a token is bound to one path — a different token returns a different root', () => {
    const tA = generateRegistrationToken('/home/alice/vault');
    const tB = generateRegistrationToken('/etc');
    expect(validateRegistrationToken(tA)).toEqual({ vaultRoot: '/home/alice/vault' });
    expect(validateRegistrationToken(tB)).toEqual({ vaultRoot: '/etc' });
  });

  it('non-string tokens are rejected without throwing (defensive against renderer junk)', () => {
    expect(validateRegistrationToken(123 as unknown as string)).toBeNull();
    expect(validateRegistrationToken({} as unknown as string)).toBeNull();
    expect(validateRegistrationToken([] as unknown as string)).toBeNull();
  });
});
