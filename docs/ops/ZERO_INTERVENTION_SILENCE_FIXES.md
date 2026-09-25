# Zero-intervention silence fixes

Creed: **cut waste, don't weaken quality.** Automated loudness so failures cannot
rot unread. Humans are not required to open a weekly digest for the system to
correct course.

Canonical loud digest: [TOKEN_AUDIT_LOUD_DIGEST.md](../TOKEN_AUDIT_LOUD_DIGEST.md).

## Map (trigger → action → silence failure prevented)

### 1. Auto-escalation on repeated draft-CI failure

| | |
| --- | --- |
| **Trigger** | `draft-ci-comment.yml` sees **≥2** CI failures on the same **draft** PR across **distinct head SHAs** (`fail_streak` + `fail_tips` in sticky `<!-- mythos-draft-ci -->`). |
| **Action** | Auto **draft → ready-for-review** (`pulls.update draft:false`) + escalation comment. (Ready is louder than close; close is not used.) |
| **Silence failure prevented** | Draft rot invisible forever. |
| **Committed** | `.github/workflows/draft-ci-comment.yml` |

### 2. Self-healing audit-down

| | |
| --- | --- |
| **Trigger** | FAILED stub **and** `vars.MYTHOS_TOKEN_AUDIT_LAST_STATUS` was already `failed` (two consecutive Wed stubs). |
| **Action** | Open/comment issue labeled `audit-down` with `@SkyyPlayz`; fail Actions job (red X). Persist new status via `MYTHOS_TOKEN_AUDIT_LAST_STATUS`. |
| **Silence failure prevented** | Blind Wed gap / stub ignored. |
| **Committed** | `scripts/mythos-token-audit/loud-digest.mjs` · `.github/workflows/mythos-token-audit.yml` |

### 3. Trend-based auto-throttle tip-freeze soft cap

| | |
| --- | --- |
| **Trigger** | Audit `gate_avg` (distinct gated tips / merged PRs) **> 1.5** for **two consecutive** audits (`vars.MYTHOS_GATE_AVG_PREV`). |
| **Action** | Best-effort set `vars.MYTHOS_TIP_FREEZE_EMERGENCY_MINUTES=10` (heals back to `20` when `gate_avg ≤ 1.0`). Comment on tracking issue. |
| **Silence failure prevented** | Gate-cycle avg drifts >1.5 with nobody reading the digest. |
| **Committed** | `loud-digest.mjs` · `run.mjs` (emits `gate_avg`) · documented in `FORGE_TIP_FREEZE.md` |

**Forge / standing agents MUST read** `MYTHOS_TIP_FREEZE_EMERGENCY_MINUTES` (default treat as **20** if unset) before applying the soft-cap emergency single-fix tip.

### 4. Duplicate-wake circuit breaker

| | |
| --- | --- |
| **Trigger** | Audit proxy `duplicate_forge_wakes_proxy` **> 40** in lookback (draft sync / extra pushes). |
| **Action** | Set `vars.MYTHOS_DRAFT_PUSH_WAKES=off` and `MYTHOS_DRAFT_PUSH_WAKES_UNTIL=<now+48h>`. Hourly auto-rebase job expires the breaker when due. |
| **Silence failure prevented** | Forge re-wake spam while humans ignore. |
| **Committed** | `loud-digest.mjs` · `.github/workflows/auto-rebase-main.yml` (expiry) |

**Forge / `mythos-pr-ci-watch` MUST check** `MYTHOS_DRAFT_PUSH_WAKES`: while `off` and before `UNTIL`, stay **SILENT** on draft `pr-pushed` / synchronize wakes.

### Follow-up (Ivy / Grok routines)

If Grok Bot routines cannot read repo vars yet, update the standing prompt to
consult these vars (or pause routine) after merge — Actions cannot edit Grok
routines itself.

## Vars cheat-sheet

| Variable | Writer | Readers |
| --- | --- | --- |
| `MYTHOS_TOKEN_AUDIT_ISSUE` | loud-digest (bot) | workflow |
| `MYTHOS_TOKEN_AUDIT_LAST_STATUS` | loud-digest (bot) | loud-digest |
| `MYTHOS_GATE_AVG_PREV` | loud-digest (bot) | loud-digest |
| `MYTHOS_TIP_FREEZE_EMERGENCY_MINUTES` | loud-digest (bot) | Forge / agents |
| `MYTHOS_DRAFT_PUSH_WAKES` | loud-digest + hourly expiry | Forge / ci-watch |
| `MYTHOS_DRAFT_PUSH_WAKES_UNTIL` | loud-digest + hourly expiry | hourly expiry |
| `MYTHOS_USAGE_SNAPSHOT` | human | audit script |
