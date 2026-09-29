import { describe, it, expect } from 'vitest';
import { mapWelcomeSetupError, WELCOME_SETUP_ERROR_GENERIC } from './welcomeSetupError';

describe('mapWelcomeSetupError (F3#9 security residual)', () => {
  it('returns a short generic string for null/undefined', () => {
    expect(mapWelcomeSetupError(null)).toBe(WELCOME_SETUP_ERROR_GENERIC);
    expect(mapWelcomeSetupError(undefined)).toBe(WELCOME_SETUP_ERROR_GENERIC);
  });

  it('never surfaces filesystem paths from Error.message', () => {
    const err = new Error('ENOENT: no such file or directory, open \'/Users/Skyy/Vaults/Story\'');
    const msg = mapWelcomeSetupError(err);
    expect(msg).toBe(WELCOME_SETUP_ERROR_GENERIC);
    expect(msg).not.toMatch(/[/\\]/);
    expect(msg).not.toContain('Users');
    expect(msg).not.toContain('ENOENT');
  });

  it('never surfaces stack traces', () => {
    const err = new Error('boom');
    err.stack = 'Error: boom\n    at Object.<anonymous> (/workspace/frontend/src/App.tsx:42:11)';
    expect(mapWelcomeSetupError(err)).toBe(WELCOME_SETUP_ERROR_GENERIC);
    expect(mapWelcomeSetupError(err.stack)).toBe(WELCOME_SETUP_ERROR_GENERIC);
  });

  it('rejects long or path-like free strings', () => {
    expect(mapWelcomeSetupError('Failed at C:\\Users\\x\\vault')).toBe(WELCOME_SETUP_ERROR_GENERIC);
    expect(mapWelcomeSetupError('x'.repeat(200))).toBe(WELCOME_SETUP_ERROR_GENERIC);
  });
});
