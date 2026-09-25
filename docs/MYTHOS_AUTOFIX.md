# Mythos autofix — shadow, coordination, rollback

Creed: **cut waste, don't weaken quality.**

Covers zero-intervention autos from the weekly token audit and PR hygiene
workflows. Does **not** collapse Critic/Shield/Probe, skip the tip-SHA gate,
auto-close drafts, shorten audit lookback, or ban Other Models.

Related: [ops/ZERO_INTERVENTION_SILENCE_FIXES.md](./ops/ZERO_INTERVENTION_SILENCE_FIXES.md) ·
[TOKEN_AUDIT_LOUD_DIGEST.md](./TOKEN_AUDIT_LOUD_DIGEST.md) ·
[FORGE_TIP_FREEZE.md](./FORGE_TIP_FREEZE.md) ·
[STANDING_AGENT_CONTEXT_COMPRESSION.md](./STANDING_AGENT_CONTEXT_COMPRESSION.md)

## Repo vars

| Var | Values / meaning |
| --- | --- |
| `MYTHOS_AUTOFIX_MODE` | `shadow` \| `live` \| `disabled`. **Default after merge: `shadow`.** |
| `MYTHOS_AUTOFIX_SHADOW_UNTIL` | ISO timestamp (prefer America/Denver wall). Set at first deploy to **now+7d**. |
| `MYTHOS_WAKE_CIRCUIT_BREAKER` | ISO-until silence for draft wakes |
| `MYTHOS_TIP_FIX_WINDOW_MINUTES` | Emergency tip-fix window (default **20**) |

### Shadow window

1. While `MYTHOS_AUTOFIX_MODE=shadow` **and** `now < MYTHOS_AUTOFIX_SHADOW_UNTIL`:
   circuit breaker set, auto ready-for-review, and trend throttle are **log only**
   (issue comment / Actions summary / `out/shadow-log.md` artifact). **Do not execute.**
2. When `now >= MYTHOS_AUTOFIX_SHADOW_UNTIL` and mode is still `shadow`:
   Actions **auto-flips** to `live` via idempotent `gh variable set MYTHOS_AUTOFIX_MODE … -b live`
   (unless mode is `disabled`).
3. First run with empty UNTIL (post-merge): scripts set
   `MYTHOS_AUTOFIX_MODE=shadow` and `MYTHOS_AUTOFIX_SHADOW_UNTIL=<now+7d>` (needs
   `MYTHOS_BOT_TOKEN` / vars:write).

Flip helpers: `scripts/mythos-autofix/shadow-mode.mjs` · wired from
`scripts/mythos-token-audit/loud-digest.mjs` and `.github/workflows/mythos-pr-hygiene.yml`.

## Coordination (priority / mutual exclusion)

High → low:

1. **Circuit breaker** (`MYTHOS_WAKE_CIRCUIT_BREAKER`) — suppresses wakes
2. **Trend throttle** (`MYTHOS_TIP_FIX_WINDOW_MINUTES` 20→10)
3. **Auto ready-for-review** (hygiene `draft-ready-on-green`)

Rules:

- While the circuit breaker ISO is **in the future**: **do not** auto
  ready-for-review; **do not** fire trend-throttle changes. Log
  `suppressed by circuit breaker` in shadow/live audit / shadow-log.
- Circuit breaker may still be **set** (highest priority) when tip-storms spike.
- Trend throttle must not race the breaker on the same audit event — breaker
  is evaluated first; throttle only runs if breaker is inactive.

## Covered auto-actions (shadow vs live)

| Action | Shadow | Live | Suppressed if breaker active? |
| --- | --- | --- | --- |
| Set `MYTHOS_WAKE_CIRCUIT_BREAKER` | Log only | Set var | n/a (is the breaker) |
| Set `MYTHOS_TIP_FIX_WINDOW_MINUTES=10` | Log only | Set var | **Yes** |
| `gh pr ready` after 2 greens | Log only | Execute | **Yes** |

## Rollback (one command each)

Repo: `SkyyPlayz/Mythos-Writer`. Copy-paste; no agent turn required.
Also: `scripts/mythos-autofix/rollback.sh <action>`.

### Circuit breaker

```bash
gh variable delete MYTHOS_WAKE_CIRCUIT_BREAKER -R SkyyPlayz/Mythos-Writer
# or clear / past ISO:
gh variable set MYTHOS_WAKE_CIRCUIT_BREAKER -R SkyyPlayz/Mythos-Writer -b ""
# or:
gh variable set MYTHOS_WAKE_CIRCUIT_BREAKER -R SkyyPlayz/Mythos-Writer -b "1970-01-01T00:00:00.000Z"
```

### Draft auto ready-for-review (undo ready → draft)

```bash
# Replace <n> with PR number
gh pr ready <n> --undo -R SkyyPlayz/Mythos-Writer
# GraphQL fallback if --undo unavailable:
# gh api graphql -f query='mutation($id:ID!){convertPullRequestToDraft(input:{pullRequestId:$id}){pullRequest{number}}}' -F id="$(gh api repos/SkyyPlayz/Mythos-Writer/pulls/<n> --jq .node_id)"
```

### Tip-fix window throttle

```bash
gh variable set MYTHOS_TIP_FIX_WINDOW_MINUTES -R SkyyPlayz/Mythos-Writer -b 20
```

### Autofix mode (kill switch)

```bash
gh variable set MYTHOS_AUTOFIX_MODE -R SkyyPlayz/Mythos-Writer -b disabled
```

## Workflows / scripts

| Path | Role |
| --- | --- |
| `.github/workflows/mythos-token-audit.yml` | Weekly audit + loud digest (breaker + throttle) |
| `.github/workflows/mythos-pr-hygiene.yml` | Auto-rebase + draft-CI comment + draft→ready |
| `scripts/mythos-autofix/shadow-mode.mjs` | Resolve mode / flip / shadow-log append |
| `scripts/mythos-autofix/rollback.sh` | One-command rollbacks |
| `scripts/mythos-token-audit/loud-digest.mjs` | Executes or shadows breaker + throttle |
