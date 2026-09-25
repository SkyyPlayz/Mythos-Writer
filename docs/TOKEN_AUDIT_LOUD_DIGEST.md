# Token audit — loud weekly digest

Creed: **cut waste, don't weaken quality.**

Chosen mechanism (least human effort / loudest cheap combo):

1. **Pinned tracking issue + reopen + `@SkyyPlayz`** on every Wed run
   (success **or** fail).
2. **Fail the Actions job** when the FAILED stub is written → red X on the
   Actions tab / workflow run list (visible without opening the issue).

## Surfaces

| Surface | Behavior |
| --- | --- |
| Tracking issue | Title `Mythos token audit — weekly`, label `mythos-token-audit`. Created if missing; number written to `vars.MYTHOS_TOKEN_AUDIT_ISSUE` when `MYTHOS_BOT_TOKEN` can set vars. |
| Reopen | Closed tracking issue is reopened every run. |
| Body | Overwritten with latest SUMMARY. |
| Comment | One `@SkyyPlayz` notify per America/Denver day (`<!-- mythos-token-audit-notify:YYYY-MM-DD -->` dedupe). |
| Pin | Best-effort GraphQL `pinIssue`; if token lacks permission → **pin once in UI**. |
| Actions red X | `loud-digest.mjs` exits `1` after notify when FAILED stub was written. |

## Workflow / scripts

- [`.github/workflows/mythos-token-audit.yml`](../.github/workflows/mythos-token-audit.yml)
- [`scripts/mythos-token-audit/run.mjs`](../scripts/mythos-token-audit/run.mjs)
- [`scripts/mythos-token-audit/loud-digest.mjs`](../scripts/mythos-token-audit/loud-digest.mjs)

## Repo vars (optional but recommended)

| Var | Purpose |
| --- | --- |
| `MYTHOS_TOKEN_AUDIT_ISSUE` | Tracking issue number |
| `MYTHOS_TOKEN_AUDIT_LAST_STATUS` | `ok` / `failed` (consecutive-fail heal) |
| `MYTHOS_USAGE_SNAPSHOT` | Dual-pool JSON |
| `MYTHOS_GATE_AVG_PREV` | Prior gate_avg for throttle |
| `MYTHOS_TIP_FREEZE_EMERGENCY_MINUTES` | Soft-cap minutes (default 20; throttle → 10) |
| `MYTHOS_DRAFT_PUSH_WAKES` | `on` / `off` circuit breaker |
| `MYTHOS_DRAFT_PUSH_WAKES_UNTIL` | Epoch-ms expiry for breaker |

Vars writes require `MYTHOS_BOT_TOKEN` (admin/vars). `GITHUB_TOKEN` still does issues + fail-job loudness.

## Related

- [ops/ZERO_INTERVENTION_SILENCE_FIXES.md](./ops/ZERO_INTERVENTION_SILENCE_FIXES.md)
- [FORGE_TIP_FREEZE.md](./FORGE_TIP_FREEZE.md)
- [FORGE_E2E_KEEPALIVE.md](./FORGE_E2E_KEEPALIVE.md)
