# Zero-intervention silence fixes

Creed: **cut waste, don't weaken quality.**

Canonical loud digest: [TOKEN_AUDIT_LOUD_DIGEST.md](../TOKEN_AUDIT_LOUD_DIGEST.md).
PR hygiene (rebase + draft-CI comment + draft→ready): [`.github/workflows/mythos-pr-hygiene.yml`](../../.github/workflows/mythos-pr-hygiene.yml).

## Map (trigger → action → silence failure prevented)

### 1. Draft ready after 2 consecutive CI greens (same tip)

| | |
| --- | --- |
| **Trigger** | `mythos-pr-hygiene` `draft-ready-on-green`: CI `workflow_run` **success** on a **draft** PR; sticky `<!-- mythos-draft-green:SHA -->` reaches `green_streak≥2` on the **same** tip SHA. |
| **Action** | `gh pr ready` (mark ready-for-review). **Never** auto-close drafts. |
| **Silence failure prevented** | Draft rot / forever-draft with green CI nobody notices. |
| **Committed** | `.github/workflows/mythos-pr-hygiene.yml` |

### 2. Self-healing audit-down

| | |
| --- | --- |
| **Trigger** | FAILED stub **and** `vars.MYTHOS_TOKEN_AUDIT_LAST_STATUS` was already `failed` (two consecutive Wed stubs). |
| **Action** | Comment on tracking issue + open/comment `audit-down` issue with `@SkyyPlayz`; fail Actions job (red X). |
| **Silence failure prevented** | Blind Wed gap / stub ignored. |
| **Committed** | `scripts/mythos-token-audit/loud-digest.mjs` |

### 3. Gate-avg tip-fix window throttle

| | |
| --- | --- |
| **Trigger** | CURRENT and PRIOR `gate_avg_proxy` both **> 1.5** (prior from artifact / `MYTHOS_GATE_AVG_PREV`). |
| **Action** | Best-effort set `vars.MYTHOS_TIP_FIX_WINDOW_MINUTES=10` (heal to `20` when ≤1.5). Document write if no vars:write token. |
| **Silence failure prevented** | Gate avg drifts >1.5 with nobody reading the digest. |
| **Committed** | `run.mjs` + `loud-digest.mjs` · `docs/FORGE_TIP_FREEZE.md` |

### 4. Draft-push wake circuit breaker

| | |
| --- | --- |
| **Trigger** | `draft_e2e_tip_storms ≥ 3` in lookback. |
| **Action** | Set `vars.MYTHOS_WAKE_CIRCUIT_BREAKER` to ISO timestamp **now+48h**. Grok Bot PR-watch / Forge MUST stay SILENT on draft `pr-pushed` / CI-fail fan-out until that time. |
| **Silence failure prevented** | Forge re-wake spam while humans ignore. |
| **Committed** | `loud-digest.mjs` · documented in hygiene workflow header |

## Repo vars

| Variable | Meaning |
| --- | --- |
| `MYTHOS_TIP_FIX_WINDOW_MINUTES` | Emergency single-fix window (default **20**; throttle → **10**) |
| `MYTHOS_WAKE_CIRCUIT_BREAKER` | ISO-until silence for draft wakes |
| `MYTHOS_GATE_AVG_PREV` | Prior `gate_avg_proxy` |
| `MYTHOS_TOKEN_AUDIT_LAST_STATUS` | `ok` / `failed` |
| `MYTHOS_TOKEN_AUDIT_ISSUE` | Tracking issue number |
| `MYTHOS_USAGE_SNAPSHOT` | Dual-pool JSON (never invented) |

| Autofix shadow / coord / rollback | [MYTHOS_AUTOFIX.md](../MYTHOS_AUTOFIX.md) |
| Standing brief compression | [STANDING_AGENT_CONTEXT_COMPRESSION.md](../STANDING_AGENT_CONTEXT_COMPRESSION.md) |

### 5. Main-push hygiene has no PRs; canary bootstrap

| | |
| --- | --- |
| **Trigger** | CI `workflow_run` on a **main push** (no associated pull request). `GET /actions/runs/{id}/pull_requests` returns HTTP 404 and `gh api` still writes the error JSON to stdout. Separately, `mythos-token-audit.yml` may have zero completed runs until the first Wednesday cron. |
| **Action** | `draft-ready-on-green` and `draft-ci-comment` soft-skip (exit 0). Non-numeric tokens never reach `gh pr view`. Ops canary logs a WARN for a token-audit that has never completed, and does not go red on a hygiene failure when a success exists within 26h. |
| **Silence failure prevented** | A green main CI run painting hygiene (and then the ops canary) red, which looks like a product outage and invites noise. |
| **Committed** | `.github/workflows/mythos-pr-hygiene.yml`, `.github/workflows/mythos-ops-health.yml`, `scripts/mythos-ops/ops-guards.sh` |

## Explicit non-goals

- Do **not** collapse Critic/Shield/Probe.
- Do **not** skip the plan / tip-SHA gate.
- Do **not** auto-close drafts.
- Do **not** shorten lookback below 7d.
- Do **not** ban Other Models.
