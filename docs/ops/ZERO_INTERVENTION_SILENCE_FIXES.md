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

## Explicit non-goals

- Do **not** collapse Critic/Shield/Probe.
- Do **not** skip the plan / tip-SHA gate.
- Do **not** auto-close drafts.
- Do **not** shorten lookback below 7d.
- Do **not** ban Other Models.
