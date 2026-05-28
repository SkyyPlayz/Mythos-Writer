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
