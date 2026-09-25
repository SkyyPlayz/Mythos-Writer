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
| Tracking issue | Title `Mythos token audit — weekly`, label `mythos-token-audit`. Created if missing; number written to `vars.MYTHOS_TOKEN_AUDIT_ISSUE` when bot can set vars. |
| Reopen | Closed tracking issue is reopened every run. |
| Body | Overwritten with latest SUMMARY (includes prior `gate_avg_proxy` cache). |
| Comment | One `@SkyyPlayz` notify per America/Denver day (dedupe). |
| Pin | Best-effort GraphQL `pinIssue`; else **pin once in UI**. |
| Actions red X | `loud-digest.mjs` exits `1` after notify when FAILED stub was written. |

## Efficiency

- Single-pass `run.mjs`: list merged PRs once → per-PR comments/reviews.
- Writes `out/metrics.json` (`gate_cycles`, `full_tip_gates`, `gate_avg_proxy`, …).
- Downloads prior successful workflow artifact when possible (`--prior-metrics`).
- Soft OK tip window instruction when CURRENT+PRIOR `gate_avg_proxy` > 1.5 →
  `MYTHOS_TIP_FIX_WINDOW_MINUTES=10` (best-effort vars write).

## Workflow / scripts

- [`.github/workflows/mythos-token-audit.yml`](../.github/workflows/mythos-token-audit.yml)
- [`scripts/mythos-token-audit/run.mjs`](../scripts/mythos-token-audit/run.mjs)
- [`scripts/mythos-token-audit/loud-digest.mjs`](../scripts/mythos-token-audit/loud-digest.mjs)
- Hygiene (rebase + draft CI): [`.github/workflows/mythos-pr-hygiene.yml`](../.github/workflows/mythos-pr-hygiene.yml)

## Repo vars

| Var | Purpose |
| --- | --- |
| `MYTHOS_TOKEN_AUDIT_ISSUE` | Tracking issue number |
| `MYTHOS_TOKEN_AUDIT_LAST_STATUS` | `ok` / `failed` |
| `MYTHOS_USAGE_SNAPSHOT` | Dual-pool JSON (never invented) |
| `MYTHOS_GATE_AVG_PREV` | Prior `gate_avg_proxy` |
| `MYTHOS_TIP_FIX_WINDOW_MINUTES` | Soft-cap minutes (default 20; throttle → 10) |
| `MYTHOS_WAKE_CIRCUIT_BREAKER` | ISO-until silence for draft wakes |

## Related

- [ops/ZERO_INTERVENTION_SILENCE_FIXES.md](./ops/ZERO_INTERVENTION_SILENCE_FIXES.md)
- [FORGE_TIP_FREEZE.md](./FORGE_TIP_FREEZE.md)
- [FORGE_E2E_KEEPALIVE.md](./FORGE_E2E_KEEPALIVE.md)
