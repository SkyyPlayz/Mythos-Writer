// Telemetry — opt-in, off by default, anonymized crash reports + feature-usage counts.
// Never transmits vault content, scene text, notes, or chat.

import crypto from 'crypto';
import https from 'https';

// ─── Permitted event types (whitelist) ───────────────────────────────────────
// These are the ONLY events allowed through the telemetry pipeline.
// Adding a new event type requires updating this list + the settings panel copy.
export const TELEMETRY_EVENT_TYPES = [
  'app:launch',
  'app:quit',
  'feature:vault-open',
  'feature:export-epub',
  'feature:export-docx',
  'feature:voice-transcribe',
  'feature:voice-speak',
  'feature:search-query',
  'feature:snapshot-save',
  'feature:brainstorm-run',
  'feature:writing-assistant-run',
  'feature:archive-run',
  'feature:scene-crafter-open',
  'feature:timeline-view',
  'feature:beta-read-create',
  'feature:update-check',
  'crash:unhandled-exception',
  'crash:unhandled-rejection',
] as const;

export type TelemetryEventType = (typeof TELEMETRY_EVENT_TYPES)[number];

// ─── Human-readable descriptions (shown in Settings panel) ──────────────────
export const TELEMETRY_EVENT_DESCRIPTIONS: Record<TelemetryEventType, string> = {
  'app:launch': 'App opened (OS platform, app version)',
  'app:quit': 'App closed (session duration in seconds)',
  'feature:vault-open': 'Vault folder opened',
  'feature:export-epub': 'EPUB export completed',
  'feature:export-docx': 'DOCX export completed',
  'feature:voice-transcribe': 'Voice-to-text transcription run',
  'feature:voice-speak': 'Text-to-speech synthesis run',
  'feature:search-query': 'Full-text search performed (no query content)',
  'feature:snapshot-save': 'Scene snapshot saved',
  'feature:brainstorm-run': 'Brainstorm agent invoked',
  'feature:writing-assistant-run': 'Writing assistant agent invoked',
  'feature:archive-run': 'Archive agent invoked',
  'feature:scene-crafter-open': 'Scene Crafter board opened',
  'feature:timeline-view': 'Story timeline viewed',
  'feature:beta-read-create': 'Beta-read comment created',
  'feature:update-check': 'Update check initiated',
  'crash:unhandled-exception': 'Unhandled JS exception (stack trace, no user data)',
  'crash:unhandled-rejection': 'Unhandled promise rejection (stack trace, no user data)',
};

// ─── Event payload ───────────────────────────────────────────────────────────
export interface TelemetryEvent {
  /** One of the whitelisted event type strings */
  type: TelemetryEventType;
  /** Arbitrary metadata — must NOT contain vault content, scene text, notes, or chat */
  meta?: Record<string, string | number | boolean>;
}

// ─── Telemetry config (subset of AppSettings) ────────────────────────────────
export interface TelemetryConfig {
  enabled: boolean;
  sessionId: string;
}

const TELEMETRY_ENDPOINT = 'https://telemetry.mythoswriter.app/v1/event';

// ─── Module state ────────────────────────────────────────────────────────────
let _config: TelemetryConfig = { enabled: false, sessionId: '' };

export function configureTelemetry(config: TelemetryConfig): void {
  _config = config;
}

export function getTelemetryConfig(): TelemetryConfig {
  return { ..._config };
}

/** Generate a fresh random session ID (UUID v4). */
export function generateSessionId(): string {
  return crypto.randomUUID();
}

// ─── Core reporter ───────────────────────────────────────────────────────────

/**
 * Report a telemetry event.
 * No-op when telemetry is disabled or the event type is not whitelisted.
 * Network failures are silently swallowed — telemetry must never crash the app.
 */
export function reportEvent(event: TelemetryEvent): void {
  if (!_config.enabled) return;
  if (!TELEMETRY_EVENT_TYPES.includes(event.type)) return;

  const body = JSON.stringify({
    sessionId: _config.sessionId,
    type: event.type,
    meta: event.meta ?? {},
    ts: Date.now(),
  });

  try {
    const url = new URL(TELEMETRY_ENDPOINT);
    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume(); // drain and discard
      },
    );
    req.on('error', () => {
      /* swallow */
    });
    req.write(body);
    req.end();
  } catch {
    /* swallow — telemetry must never crash the app */
  }
}
