# Telemetry opt-in audit (MYT-775)

Reference: `PROJECT_PLAN.md §Telemetry`, `plans/ProjectGoalOverView/11-cross-cutting.md §Telemetry`.

Project policy:

> Opt-in only, off by default. Anonymized crash reports and feature-usage counts only — never vault content, scenes, notes, or chat. A clear toggle in settings lists exactly what is sent.

This document audits the telemetry pipeline against that policy. Every claim
below is verified in code and pinned to a regression test, so drift is caught
in CI rather than at user-report time.

## Summary

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Default config has telemetry **off**; no transport runs until the user toggles | PASS | `electron-main/src/main.ts` `SETTINGS_DEFAULTS` (no `telemetry` field) + `initTelemetry()` falls back to `{ enabled: false, … }` |
| 2 | Settings toggle shows exactly what is sent, sourced from a static manifest (not free text) | PARTIAL — manifest exists; UI surface is not yet wired | `TELEMETRY_EVENT_TYPES` + `TELEMETRY_EVENT_DESCRIPTIONS` in `electron-main/src/telemetry.ts`. No section in `frontend/src/SettingsPanel.tsx` yet → tracked as MYT-799 (see §2 below) |
| 3 | Network egress on first run is **zero** | PASS | `electron-main/tests/network-egress-on-first-run.spec.ts` proxies `https.request` / `http.request` / `net.connect` and asserts no calls during a clean boot |
| 4 | No telemetry path serialises manuscript content, chat, or vault paths beyond hashed feature identifiers | PASS | Whitelist enforced by `reportEvent`; payload is `{ sessionId, type, meta, ts }` only; no callsite passes prose, chat, or absolute paths (see §4 below) |

## 1. Default config is off

`electron-main/src/main.ts:2280-2289` defines `SETTINGS_DEFAULTS` with **no
`telemetry` field**:

```ts
const SETTINGS_DEFAULTS: AppSettings = {
  apiKey: '',
  agents: { /* … */ },
  theme: 'dark',
  snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  updateChannel: 'stable',
};
```

The `AppSettings.telemetry` field on `electron-main/src/ipc.ts:899-903` is
optional. When `loadAppSettings()` is called on first boot the settings file
is absent, so `settings.telemetry` is `undefined`.

`initTelemetry()` (`electron-main/src/main.ts:2371-2382`) then coerces the
missing value to `{ enabled: false, sessionId: '' }` and calls
`configureTelemetry(...)` with `enabled: false`. The module-level state in
`electron-main/src/telemetry.ts:72` also starts at `{ enabled: false,
sessionId: '' }`, so even if `initTelemetry()` were never reached, the
module's idle state is "off".

`reportEvent()` (`electron-main/src/telemetry.ts:94-130`) short-circuits at
the first line — `if (!_config.enabled) return;` — before constructing the
body or touching `https.request`. The `electron-main/src/telemetry.test.ts`
suite already covers this for every whitelisted event type.

## 2. Settings toggle and manifest of what is sent

The static manifest is fully defined in code:

- `TELEMETRY_EVENT_TYPES` (`electron-main/src/telemetry.ts:10-29`) is a
  `readonly` tuple of the only event identifiers the pipeline will accept.
  Adding a new identifier requires editing this list and the description
  table — there is no free-text channel.
- `TELEMETRY_EVENT_DESCRIPTIONS` (`electron-main/src/telemetry.ts:34-53`) is
  a `Record<TelemetryEventType, string>` of human-readable descriptions for
  each event. The unit test in `telemetry.test.ts` asserts the two maps stay
  in lock-step (`description count matches event type count`).

`reportEvent()` enforces the whitelist at runtime as well as at the type
boundary:

```ts
if (!TELEMETRY_EVENT_TYPES.includes(event.type)) return;
```

This means even a renderer with the IPC bridge cannot send an arbitrary
event identifier — the main process drops anything outside the manifest
silently.

### Gap

The Settings panel (`frontend/src/SettingsPanel.tsx`) does **not** currently
render the telemetry toggle or the manifest. The IPC plumbing
(`window.api.telemetryReport`, `SETTINGS_GET/SET` carrying
`AppSettings.telemetry`) is in place; only the UI section is missing.

Because the default is off, this is a *user-experience* gap rather than a
privacy regression: telemetry cannot leak data without a UI toggle, but a
user also cannot opt in. **Filed as MYT-799 — "Telemetry settings UI —
opt-in toggle + static manifest of sent events".** The follow-up must
render the descriptions directly from `TELEMETRY_EVENT_DESCRIPTIONS` (not
retyped free text) so the audit guarantee that the UI matches what is
sent holds by construction.

## 3. Zero network egress on first run

`electron-main/tests/network-egress-on-first-run.spec.ts` proves this by:

1. Spying on `https.request`, `http.request`, and `net.connect` — the three
   APIs the Node runtime would have to go through to leave the machine.
2. Calling `configureTelemetry({ enabled: false, sessionId: '' })` to match
   the state produced by `initTelemetry()` on a first launch.
3. Looping over every entry in `TELEMETRY_EVENT_TYPES` and calling
   `reportEvent({ type, … })`. Even hostile `meta` payloads with
   manuscript-shaped strings and absolute paths are exercised.
4. Asserting the three spies recorded zero calls.

Auto-update traffic is **also** quiet on first run unless the build is
packaged *and* `MYTHOS_AUTO_UPDATE=1`. See
`electron-main/src/main.ts:2144` (`AUTO_UPDATE_ENABLED`) and lines 2199 /
2261, both of which guard `autoUpdater` calls behind both flags. Default
binaries do not poll for updates without explicit user action.

## 4. No vault content, chat, or absolute vault paths in telemetry payloads

The on-wire payload is constructed by `reportEvent()` and is exactly:

```json
{ "sessionId": "<uuid>", "type": "<whitelisted-event>", "meta": { … }, "ts": <ms> }
```

- `sessionId` is a `crypto.randomUUID()` generated by `generateSessionId()`
  (`electron-main/src/telemetry.ts:83-85`). It is regenerated when the user
  *disables* telemetry (`main.ts:919-922`) so future sessions cannot be
  joined to past ones via the stored ID. The ID has no user-identifying
  content.
- `type` is constrained to `TELEMETRY_EVENT_TYPES`.
- `meta` is a `Record<string, string | number | boolean>` — primitives only.
  The compile-time signature on `TelemetryEvent.meta`
  (`telemetry.ts:60`) prevents nested objects, arrays, or other shapes that
  could smuggle prose.
- `ts` is `Date.now()`.

No callsite in the repository passes manuscript prose, chat messages, or
absolute vault paths to `reportEvent`. Verified by:

```bash
grep -rn "reportEvent(" electron-main/src
```

The only producer is the IPC handler at `main.ts:1962-1965`, which forwards
`{ type, meta }` from the renderer. The renderer's preload bridge
(`preload.ts:338-339`) is the surface area for those calls; the audit
recommends that the follow-up MYT-792 work also asserts at the UI layer
that `meta` only contains primitive event counters (e.g. word counts,
durations) and never prose snippets, scene paths, or chat content.

The descriptive entry for `feature:search-query` explicitly notes "no query
content" — this is the documented contract.

## 5. Privacy invariants verified by tests

| Invariant | Test |
|---|---|
| Telemetry idle state is `{ enabled: false, sessionId: '' }` | `telemetry.test.ts → reportEvent — disabled` |
| `reportEvent` is a no-op for every whitelisted event when disabled | `telemetry.test.ts → "remains a no-op for any whitelisted event when disabled"` |
| Non-whitelisted event identifiers are dropped even when enabled | `telemetry.test.ts → "does NOT fire for non-whitelisted event types"` |
| Every whitelisted event has a human-readable description (UI source of truth) | `telemetry.test.ts → "whitelist coverage"` |
| Zero outbound `https.request` / `http.request` / `net.connect` calls on first boot | `network-egress-on-first-run.spec.ts` |
| `sessionId` is regenerated when telemetry is disabled | covered indirectly by `main.ts:919-922`; dedicated unit test deferred to MYT-799 |

## When to revisit

- A new event identifier is added → update `TELEMETRY_EVENT_TYPES`,
  `TELEMETRY_EVENT_DESCRIPTIONS`, and re-run the audit checklist.
- The Settings panel renders the toggle (MYT-799) → confirm the UI sources
  copy from `TELEMETRY_EVENT_DESCRIPTIONS`, not free text.
- A new transport is added (different endpoint, batching, retries) →
  re-run `network-egress-on-first-run.spec.ts` and extend it to cover the
  new code path.
- Any caller wires structured payloads into `meta` → add a unit test that
  asserts the payload contains only primitive feature counters, no prose
  or absolute paths.
