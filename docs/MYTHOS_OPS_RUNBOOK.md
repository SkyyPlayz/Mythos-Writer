# Mythos ops runbook

Creed: **cut waste, don't weaken quality.**

In-repo SoT for dependency map, badges, and rollback one-liners. Ivy may mirror
to mythos-ops/specs after merge.

## Workflow badges

```markdown
![token-audit](https://github.com/SkyyPlayz/Mythos-Writer/actions/workflows/mythos-token-audit.yml/badge.svg)
![pr-hygiene](https://github.com/SkyyPlayz/Mythos-Writer/actions/workflows/mythos-pr-hygiene.yml/badge.svg)
![ops-health](https://github.com/SkyyPlayz/Mythos-Writer/actions/workflows/mythos-ops-health.yml/badge.svg)
```

Health canary (weekday mornings + after audit/hygiene completes). Sticky marker: `<!-- mythos-ops-health -->`.

- **token-audit:** red if silent **>8d** or the latest completed run failed. No completed runs yet (workflow just landed; first Wed cron has not fired) is a **WARN**, not a failure. A missing workflow file is still a failure.
- **pr-hygiene:** red on silence (**>26h since last success**) or when there is still no success and completed runs are older than the 26h bootstrap grace. A latest failure with a success inside 26h is OK (noted). No completed runs yet is a WARN.
- **Main-push `workflow_run`:** `GET /actions/runs/{id}/pull_requests` is HTTP 404 (no PRs). `gh api` still prints that error JSON on stdout. Hygiene (`draft-ready-on-green`, `draft-ci-comment`, and the same list path in auto-rebase) soft-skips exit 0. Non-numeric tokens are never passed to `gh pr view`.

## Dependency map

| Surface | Depends on | Notes |
| --- | --- | --- |
| **Token audit** `.github/workflows/mythos-token-audit.yml` | `scripts/mythos-token-audit/run.mjs`, `loud-digest.mjs`, `scripts/mythos-ops/gh.mjs`, `scripts/mythos-autofix/shadow-mode.mjs` | Wed cron; loud digest; rate-limit partial artifact |
| Audit vars | `MYTHOS_TOKEN_AUDIT_ISSUE`, `MYTHOS_USAGE_SNAPSHOT`, `MYTHOS_GATE_AVG_PREV`, `MYTHOS_TOKEN_AUDIT_LAST_STATUS` | Dual-pool never invented |
| Tip-fix window | `MYTHOS_TIP_FIX_WINDOW_MINUTES` (default 20) | Soft cap; see [FORGE_TIP_FREEZE.md](./FORGE_TIP_FREEZE.md) |
| Circuit breaker | `MYTHOS_WAKE_CIRCUIT_BREAKER` | Grok Bot `mythos-pr-ci-watch` / Forge must stay SILENT while ISO future |
| Shadow / autofix | `MYTHOS_AUTOFIX_MODE`, `MYTHOS_AUTOFIX_SHADOW_UNTIL` | [MYTHOS_AUTOFIX.md](./MYTHOS_AUTOFIX.md) |
| Self-improvement loop | `MYTHOS_LOOP_ENABLED`, `MYTHOS_LOOP_STATE`, allow-listed tip-window / batch / circuit / retry vars | Wed audit proposes one tweak; shadow 1w; APPLY or MISS |
| **PR hygiene** `mythos-pr-hygiene.yml` | Labels `tip-freeze` (skip rebase); draft-CI sticky; draft→ready | Merged auto-rebase + draft-CI. Main-push `workflow_run` with no PRs soft-skips (404 is not a red job) |
| Tip-freeze docs | [FORGE_TIP_FREEZE.md](./FORGE_TIP_FREEZE.md), [FORGE_E2E_KEEPALIVE.md](./FORGE_E2E_KEEPALIVE.md) | Inventory → one batch; soft cap window var |
| Standing agents | Forge / Critic / Shield / Probe / Sentinel / `bc-fb92daf9` | [STANDING_AGENT_CONTEXT_COMPRESSION.md](./STANDING_AGENT_CONTEXT_COMPRESSION.md) |
| Branch protection | [BRANCH_PROTECTION_MAIN.md](./BRANCH_PROTECTION_MAIN.md) + `scripts/branch-protection/apply-main-ruleset.mjs` | Manual admin apply after merge |
| Merge gate | [MERGE_GATE.md](./MERGE_GATE.md) | Tip-SHA Critic+Shield+Probe — not collapsed |
| Ops health | `mythos-ops-health.yml` jobs `canary` + `secrets-rotation` | Red on audit silence/failure and hygiene silence since last success. Token-audit bootstrap WARN until the first completed run. Hygiene latest-failure is OK when a success is inside 26h. Quarterly PAT reminder |
| Secrets rotation | `vars.MYTHOS_BOT_TOKEN_SET_AT`, `vars.MYTHOS_SECRET_ROTATION_DAYS` (default 90) | Reminder only — never prints secrets |

## Rollback one-liners

Canonical detail: [MYTHOS_AUTOFIX.md](./MYTHOS_AUTOFIX.md). Helper:
`scripts/mythos-autofix/rollback.sh`.

| Action | Command |
| --- | --- |
| Circuit breaker | `gh variable delete MYTHOS_WAKE_CIRCUIT_BREAKER -R SkyyPlayz/Mythos-Writer` |
| Tip-fix window | `gh variable set MYTHOS_TIP_FIX_WINDOW_MINUTES -R SkyyPlayz/Mythos-Writer -b 20` |
| Autofix kill switch | `gh variable set MYTHOS_AUTOFIX_MODE -R SkyyPlayz/Mythos-Writer -b disabled` |
| Undo draft→ready | `gh pr ready <n> --undo -R SkyyPlayz/Mythos-Writer` |
| Loop kill switch | `gh variable set MYTHOS_LOOP_ENABLED -R SkyyPlayz/Mythos-Writer -b false` |
| Clear loop state | `gh variable set MYTHOS_LOOP_STATE -R SkyyPlayz/Mythos-Writer -b ""` |

## Rate-limit behavior (audit)

`scripts/mythos-ops/gh.mjs`: detect 403 / secondary rate limit / Retry-After /
remaining 0 → backoff **2s / 8s / 32s** (max 3 retries). On exhaustion: write
**partial** `TOKEN_AUDIT.md` / `SUMMARY.md` / `metrics.json` with
`"rate_limited": true` and SUMMARY line `rate-limited: yes`. Prefer exit 0 so
the artifact uploads (no Tuesday blind gap). Exit non-zero only if zero useful
data after partial write path fails hard.

## Explicit non-goals

Do not collapse Critic/Shield/Probe; skip plan/tip-SHA gate; auto-close drafts;
shorten lookback to 3d; ban Other Models.
