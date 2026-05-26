// Opt-in telemetry — never collects vault content.
// Collects only: anonymized crash reports and feature usage counts.
// All collection is gated on AppSettings.telemetry.enabled === true (default: false).
import type { AppSettings } from './ipc.js';

export function isTelemetryEnabled(settings: AppSettings): boolean {
  return settings.telemetry?.enabled === true;
}

/**
 * Record an anonymous feature-usage event. No-op when telemetry is disabled.
 * Events must never include user content — only event names and numeric counts.
 */
export function recordEvent(settings: AppSettings, event: string): void {
  if (!isTelemetryEnabled(settings)) return;
  // Stub transport: in a future release this would batch-send aggregated counts
  // to a first-party analytics endpoint. No vault content is ever included.
  void event;
}
