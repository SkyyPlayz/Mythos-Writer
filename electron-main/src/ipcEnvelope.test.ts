import { describe, expect, it } from 'vitest';
import { isIpcEnvelope, unwrapIpcEnvelope } from './ipcEnvelope.js';

describe('ipcEnvelope helpers', () => {
  it('recognizes and unwraps successful standard envelopes', () => {
    const value = { ok: true, data: { saved: true } };

    expect(isIpcEnvelope(value)).toBe(true);
    expect(unwrapIpcEnvelope(value)).toEqual({ saved: true });
  });

  it('recognizes and unwraps failed standard envelopes', () => {
    const value = { ok: false, code: 'permission_denied', message: 'Permission denied.' };

    expect(isIpcEnvelope(value)).toBe(true);
    expect(unwrapIpcEnvelope(value)).toEqual({ error: 'Permission denied.' });
  });

  it('does not misclassify legacy ok-shaped settings responses as envelopes', () => {
    const success = { ok: true, latencyMs: 4 };
    const failure = { ok: false, latencyMs: 0, error: 'Invalid provider URL.' };

    expect(isIpcEnvelope(success)).toBe(false);
    expect(unwrapIpcEnvelope(success)).toBe(success);
    expect(isIpcEnvelope(failure)).toBe(false);
    expect(unwrapIpcEnvelope(failure)).toBe(failure);
  });
});
