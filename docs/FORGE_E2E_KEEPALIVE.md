# Forge / draft E2E keep-alive (comment only)

Cheap Actions signal when **draft** PR CI fails — so humans and agents can see
the red tip without burning Forge / Grok Bot wakes.

Creed: **cut waste, don't weaken quality.**

Cross-links: [FORGE_TIP_FREEZE.md](./FORGE_TIP_FREEZE.md) · [MERGE_GATE.md](./MERGE_GATE.md)

## What this is

Workflow: [`.github/workflows/draft-ci-comment.yml`](../.github/workflows/draft-ci-comment.yml)

- Triggers when the **CI** workflow completes with **failure** on a **draft** PR.
- Posts or updates a single sticky PR comment (`<!-- mythos-draft-ci -->`) with
  failed checks + a link to the run + `fail_streak` across distinct tip SHAs.
- Dedupes per **head SHA**: same tip → silent (no spam).
- **Zero-intervention:** streak ≥ 2 distinct red tips → auto **ready-for-review**
  (louder notifications; not close) — see [ops/ZERO_INTERVENTION_SILENCE_FIXES.md](./ops/ZERO_INTERVENTION_SILENCE_FIXES.md).
- Sticky itself has **no** Forge calls, **no** Grok Bot, **no** `@` agent mentions.
  Cheap Actions minutes.

## Tip-freeze soft cap (same 20-minute rule)

Keep-alive comments do **not** change tip-freeze policy. They only surface reds.

When fixing a draft (or a tip-frozen PR) after a keep-alive / red CI notice:

1. Default: full fail inventory → **one CI-fix batch** tip
   ([FORGE_TIP_FREEZE.md](./FORGE_TIP_FREEZE.md)).
2. Soft cap: if after that batch tip CI stays red for **~20 minutes wall clock**
   since that tip’s CI **started** (fallback: since first red on that tip), allow
   **one emergency single-fix tip**, then **resume batching**.
3. Anti-pattern remains: streaming many small CI-fix tips.

## What this is not

- Not a merge gate signal.
- Not permission to drip-fix the tip.
- Not an agent wake or Paperclip/Forge dispatch.
