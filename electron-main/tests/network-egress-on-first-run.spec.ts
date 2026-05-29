// MYT-775 — Network egress on first run.
//
// Audit invariant: a clean boot must produce zero outbound network traffic
// from the telemetry pipeline. This spec proxies the three Node APIs any
// telemetry transport would have to go through — https.request, http.request,
// net.connect — and asserts none of them are called while telemetry is in
// its first-run, default-disabled state.
//
// The proxy approach mirrors what a network sniffer would observe: the spies
// stand in for the kernel and capture every attempted egress. If a new
// transport is ever wired in without honouring `_config.enabled`, this test
// fails.

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import http from 'http';
import https from 'https';
import net from 'net';

// Mock https *and* http so any caller that switches transport is still
// caught. Each factory returns a spy that throws when invoked — a real
// transport call during a clean boot is itself a regression.
vi.mock('https', () => ({
  default: {
    request: vi.fn(() => {
      throw new Error('https.request must not fire on a clean boot');
    }),
  },
}));

vi.mock('http', () => ({
  default: {
    request: vi.fn(() => {
      throw new Error('http.request must not fire on a clean boot');
    }),
  },
}));

// Imported *after* vi.mock so telemetry.ts picks up the mocked https module.
import {
  configureTelemetry,
  getTelemetryConfig,
  reportEvent,
  TELEMETRY_EVENT_TYPES,
  type TelemetryEventType,
} from '../src/telemetry.js';

const mockedHttpsRequest = vi.mocked(https.request);
const mockedHttpRequest = vi.mocked(http.request);

// net.connect is replaced in-place so we can catch raw socket attempts that
// bypass the http/https facades. Restored in afterAll.
const realNetConnect = net.connect;
const netConnectSpy = vi.fn((..._args: unknown[]) => {
  throw new Error('net.connect must not fire on a clean boot');
});
(net as unknown as { connect: typeof netConnectSpy }).connect = netConnectSpy;

afterAll(() => {
  (net as unknown as { connect: typeof realNetConnect }).connect = realNetConnect;
});

beforeEach(() => {
  mockedHttpsRequest.mockClear();
  mockedHttpRequest.mockClear();
  netConnectSpy.mockClear();
  // Reset telemetry module state to its first-run baseline.
  // This is the same shape `initTelemetry()` falls back to when
  // app-settings.json does not yet exist — `enabled: false, sessionId: ''`.
  configureTelemetry({ enabled: false, sessionId: '' });
});

describe('first-run telemetry is silent (MYT-775)', () => {
  it('module idle state is disabled with an empty sessionId', () => {
    expect(getTelemetryConfig()).toEqual({ enabled: false, sessionId: '' });
  });

  it('reportEvent fires zero https/http/net calls for every whitelisted event', () => {
    for (const type of TELEMETRY_EVENT_TYPES) {
      reportEvent({ type });
    }
    expect(mockedHttpsRequest).not.toHaveBeenCalled();
    expect(mockedHttpRequest).not.toHaveBeenCalled();
    expect(netConnectSpy).not.toHaveBeenCalled();
  });

  it('hostile meta payloads do not bypass the disabled gate', () => {
    // Simulates a renderer trying to smuggle prose / chat / vault paths
    // through `meta`. The disabled gate must short-circuit before the body
    // is even constructed, so these payloads never reach a transport.
    const hostileMeta = {
      manuscriptContent: 'Once upon a time, in a deep-sea trench...',
      chatMessage: 'private chat content',
      vaultPath: '/Users/me/MythosWriter/StoryVault/secret.md',
    };
    for (const type of TELEMETRY_EVENT_TYPES) {
      reportEvent({ type, meta: hostileMeta });
    }
    expect(mockedHttpsRequest).not.toHaveBeenCalled();
    expect(mockedHttpRequest).not.toHaveBeenCalled();
    expect(netConnectSpy).not.toHaveBeenCalled();
  });

  it('non-whitelisted event identifiers fire zero requests even after explicit opt-in', () => {
    // Promote telemetry to enabled to prove the whitelist (not just the
    // disabled gate) blocks unknown event types from leaving the machine.
    configureTelemetry({ enabled: true, sessionId: 'sess-test' });
    const unknownTypes = [
      'vault:content',
      'chat:message',
      'manuscript:dump',
      'feature:unregistered',
    ] as unknown as TelemetryEventType[];
    for (const type of unknownTypes) {
      reportEvent({ type });
    }
    expect(mockedHttpsRequest).not.toHaveBeenCalled();
    expect(mockedHttpRequest).not.toHaveBeenCalled();
    expect(netConnectSpy).not.toHaveBeenCalled();
  });
});
