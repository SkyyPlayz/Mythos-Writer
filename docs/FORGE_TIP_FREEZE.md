# Forge tip-freeze (CI-fix discipline)

Creed: **cut waste, don't weaken quality.** Tip pushes reset Critic / Shield / Probe
and burn Mythos gate cycles. After TIP FREEZE on a gated PR, thrashing the tip
SHA is the expensive anti-pattern.

Cross-links: [MERGE_GATE.md](./MERGE_GATE.md) · [FORGE_E2E_KEEPALIVE.md](./FORGE_E2E_KEEPALIVE.md) ·
[BRANCH_PROTECTION_MAIN.md](./BRANCH_PROTECTION_MAIN.md)

## Default rule — inventory, then one batch tip

1. Collect the **full fail inventory** from the red CI run (every failing check /
   shard / assertion that matters — not the first failure alone).
2. Land **one CI-fix batch tip**: a single push that addresses the inventory.
3. Wait for that tip’s CI. Do **not** stream many small fix tips.

Label `tip-freeze` (or document TIP FREEZE in the PR) means: stop tip pushes
except as allowed below. The auto-rebase bot **skips** PRs with `tip-freeze` or
`do-not-rebase` so mid-gate rebase cannot fight the freeze
(see `.github/workflows/auto-rebase-main.yml`).

## Soft cap — one emergency single-fix tip (~20 minutes)

If, **after that one batch tip**, CI is still red for longer than **~20 minutes
wall clock**, allow **exactly one emergency single-fix tip**:

| Field | Rule |
| --- | --- |
| **Threshold** | **20 minutes** |
| **Clock starts** | When CI **starts** on the batch tip (preferred: `workflow_run` / check-suite `created_at` / `started_at` for that head SHA). If start time is unavailable, use wall clock since the **first red conclusion** on that tip. |
| **Allowance** | **One** narrowly scoped commit (single failure class / one root cause), then push once. |
| **After** | **Resume batching** — next reds go back through full inventory → one batch tip. No drip stream. |

This is an emergency unblock only. It does **not** authorize a stream of
one-commit-per-failure tips.

## Anti-pattern (still forbidden)

- Streaming many small CI-fix tips without inventory + batch discipline.
- “Fix one flake, push, wait, fix next flake, push…” drip that burns gate cycles
  and Actions minutes.
- Using the 20-minute soft cap as a standing drip schedule.

## Operators / agents

- Prefer sibling fix branches when the tip is frozen and the change is large.
- Bugbot / autofix agents must not thrash tip SHA after TIP FREEZE
  (see `.cursor/BUGBOT.md`).
- Keep-alive / draft-CI sticky comments are **comment-only** — they do not wake
  Forge or authorize tip pushes (see [FORGE_E2E_KEEPALIVE.md](./FORGE_E2E_KEEPALIVE.md)).
