import { describe, it, expect, vi, beforeEach } from 'vitest';
import https from 'https';

// Mock https so no real network calls fire
vi.mock('https', () => ({
  default: {
    request: vi.fn(),
  },
}));

import {
  configureTelemetry,
  generateSessionId,
  reportEvent,
  getTelemetryConfig,
  TELEMETRY_EVENT_TYPES,
  TELEMETRY_EVENT_DESCRIPTIONS,
  TELEMETRY_META_MAX_KEYS,
  TELEMETRY_META_MAX_BYTES,
  validateTelemetryPayload,
  type TelemetryEventType,
} from './telemetry.js';

const mockHttpsRequest = vi.mocked(https.request);

function makeReqMock() {
  const req = { on: vi.fn(), write: vi.fn(), end: vi.fn() };
  req.on.mockReturnValue(req);
  return req;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: telemetry disabled
  configureTelemetry({ enabled: false, sessionId: 'test-session' });
});

describe('generateSessionId', () => {
  it('returns a uuid v4 string', () => {
    const id = generateSessionId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('generates unique ids on each call', () => {
    const a = generateSessionId();
    const b = generateSessionId();
    expect(a).not.toBe(b);
  });
});

describe('reportEvent — disabled', () => {
  it('makes no network call when telemetry is disabled', () => {
    configureTelemetry({ enabled: false, sessionId: 'sess-1' });
    reportEvent({ type: 'app:launch' });
    expect(mockHttpsRequest).not.toHaveBeenCalled();
  });

  it('remains a no-op for any whitelisted event when disabled', () => {
    configureTelemetry({ enabled: false, sessionId: 'sess-1' });
    for (const type of TELEMETRY_EVENT_TYPES) {
      reportEvent({ type });
    }
    expect(mockHttpsRequest).not.toHaveBeenCalled();
  });
});

describe('reportEvent — enabled', () => {
  beforeEach(() => {
    configureTelemetry({ enabled: true, sessionId: 'sess-enabled' });
  });

  it('sends a POST request for a whitelisted event', () => {
    const req = makeReqMock();
    mockHttpsRequest.mockReturnValue(req as unknown as ReturnType<typeof https.request>);

    reportEvent({ type: 'app:launch' });

    expect(mockHttpsRequest).toHaveBeenCalledOnce();
    const [opts] = mockHttpsRequest.mock.calls[0];
    expect((opts as unknown as { method: string }).method).toBe('POST');
    expect(req.write).toHaveBeenCalledOnce();
    expect(req.end).toHaveBeenCalledOnce();
  });

  it('includes sessionId and event type in the body', () => {
    const req = makeReqMock();
    mockHttpsRequest.mockReturnValue(req as unknown as ReturnType<typeof https.request>);

    reportEvent({ type: 'feature:export-epub', meta: { storyId: 'abc' } });

    const body = JSON.parse(req.write.mock.calls[0][0] as string) as {
      sessionId: string;
      type: string;
      meta: Record<string, unknown>;
    };
    expect(body.sessionId).toBe('sess-enabled');
    expect(body.type).toBe('feature:export-epub');
    expect(body.meta).toEqual({ storyId: 'abc' });
  });

  it('does NOT fire for non-whitelisted event types', () => {
    const req = makeReqMock();
    mockHttpsRequest.mockReturnValue(req as unknown as ReturnType<typeof https.request>);

    // This string is not in the whitelist
    reportEvent({ type: 'vault:content' as TelemetryEventType });

    expect(mockHttpsRequest).not.toHaveBeenCalled();
  });

  it('swallows errors from https.request without throwing', () => {
    mockHttpsRequest.mockImplementation(() => {
      throw new Error('network failure');
    });

    expect(() => reportEvent({ type: 'app:launch' })).not.toThrow();
  });
});

describe('whitelist coverage', () => {
  it('every whitelisted event type has a human-readable description', () => {
    for (const type of TELEMETRY_EVENT_TYPES) {
      expect(TELEMETRY_EVENT_DESCRIPTIONS[type]).toBeTruthy();
    }
  });

  it('description count matches event type count', () => {
    expect(Object.keys(TELEMETRY_EVENT_DESCRIPTIONS).length).toBe(TELEMETRY_EVENT_TYPES.length);
  });
});

describe('validateTelemetryPayload (MYT-794)', () => {
  it('accepts a whitelisted type with no meta', () => {
    const result = validateTelemetryPayload({ type: 'app:launch' });
    expect(result).toEqual({ ok: true, event: { type: 'app:launch', meta: undefined } });
  });

  it('accepts a whitelisted type with valid meta', () => {
    const result = validateTelemetryPayload({
      type: 'feature:export-epub',
      meta: { storyId: 'abc', count: 3, ok: true },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.meta).toEqual({ storyId: 'abc', count: 3, ok: true });
    }
  });

  it('rejects payload that is not a plain object', () => {
    expect(validateTelemetryPayload(null)).toEqual({ ok: false, error: 'Invalid telemetry payload.' });
    expect(validateTelemetryPayload('app:launch')).toEqual({
      ok: false,
      error: 'Invalid telemetry payload.',
    });
    expect(validateTelemetryPayload([])).toEqual({ ok: false, error: 'Invalid telemetry payload.' });
  });

  it('rejects non-string type', () => {
    const result = validateTelemetryPayload({ type: 42 });
    expect(result).toEqual({ ok: false, error: 'Invalid telemetry event type.' });
  });

  it('rejects unknown (non-whitelisted) type', () => {
    const result = validateTelemetryPayload({ type: 'vault:steal-content' });
    expect(result).toEqual({ ok: false, error: 'Unknown telemetry event type.' });
  });

  it('rejects non-object meta', () => {
    const result = validateTelemetryPayload({ type: 'app:launch', meta: 'string-meta' });
    expect(result).toEqual({ ok: false, error: 'Telemetry meta must be a plain object.' });
  });

  it('rejects meta values that are nested objects', () => {
    const result = validateTelemetryPayload({
      type: 'app:launch',
      meta: { nested: { evil: 1 } },
    });
    expect(result).toEqual({
      ok: false,
      error: 'Telemetry meta values must be string, number, or boolean.',
    });
  });

  it('rejects meta values that are arrays', () => {
    const result = validateTelemetryPayload({
      type: 'app:launch',
      meta: { list: [1, 2, 3] },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects meta values that are functions', () => {
    const result = validateTelemetryPayload({
      type: 'app:launch',
      meta: { fn: () => 1 } as unknown as Record<string, string | number | boolean>,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects meta values that are symbols', () => {
    const result = validateTelemetryPayload({
      type: 'app:launch',
      meta: { sym: Symbol('s') } as unknown as Record<string, string | number | boolean>,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects meta values that are non-finite numbers', () => {
    const result = validateTelemetryPayload({
      type: 'app:launch',
      meta: { bad: Number.POSITIVE_INFINITY },
    });
    expect(result).toEqual({ ok: false, error: 'Telemetry meta contains non-finite number.' });

    const nanResult = validateTelemetryPayload({
      type: 'app:launch',
      meta: { bad: Number.NaN },
    });
    expect(nanResult.ok).toBe(false);
  });

  it('rejects meta exceeding key cap', () => {
    const meta: Record<string, number> = {};
    for (let i = 0; i <= TELEMETRY_META_MAX_KEYS; i++) meta[`k${i}`] = i;
    const result = validateTelemetryPayload({ type: 'app:launch', meta });
    expect(result).toEqual({ ok: false, error: 'Telemetry meta exceeds key limit.' });
  });

  it('rejects meta exceeding total byte cap', () => {
    const huge = 'a'.repeat(TELEMETRY_META_MAX_BYTES + 1);
    const result = validateTelemetryPayload({ type: 'app:launch', meta: { big: huge } });
    expect(result).toEqual({ ok: false, error: 'Telemetry meta exceeds size limit.' });
  });

  it('rejects payloads with prototype-polluted meta containers', () => {
    const evil = Object.create({ injected: 'bad' });
    evil.type = 'app:launch';
    // Object.create(...) does not have Object.prototype, so isPlainObject rejects it.
    expect(validateTelemetryPayload(evil).ok).toBe(false);
  });
});

describe('telemetry:report IPC handler — validation (MYT-794)', () => {
  beforeEach(() => {
    configureTelemetry({ enabled: true, sessionId: 'sess-validation' });
  });

  it('does not fire a network request for unknown event types', () => {
    const req = makeReqMock();
    mockHttpsRequest.mockReturnValue(req as unknown as ReturnType<typeof https.request>);

    const result = validateTelemetryPayload({ type: 'malicious:event' });
    expect(result.ok).toBe(false);
    // Sanity: reportEvent itself also no-ops on unknown types (defense-in-depth).
    reportEvent({ type: 'malicious:event' as TelemetryEventType });
    expect(mockHttpsRequest).not.toHaveBeenCalled();
  });

  it('forwards a validated event to reportEvent', () => {
    const req = makeReqMock();
    mockHttpsRequest.mockReturnValue(req as unknown as ReturnType<typeof https.request>);

    const result = validateTelemetryPayload({
      type: 'feature:search-query',
      meta: { ms: 12, ok: true },
    });
    expect(result.ok).toBe(true);
    if (result.ok) reportEvent(result.event);
    expect(mockHttpsRequest).toHaveBeenCalledOnce();
  });
});

describe('configureTelemetry / getTelemetryConfig', () => {
  it('reflects latest config after configure', () => {
    configureTelemetry({ enabled: true, sessionId: 'new-id' });
    expect(getTelemetryConfig()).toEqual({ enabled: true, sessionId: 'new-id' });
  });

  it('returns a copy, not a reference', () => {
    configureTelemetry({ enabled: false, sessionId: 'copy-test' });
    const config = getTelemetryConfig();
    config.sessionId = 'mutated';
    expect(getTelemetryConfig().sessionId).toBe('copy-test');
  });
});
