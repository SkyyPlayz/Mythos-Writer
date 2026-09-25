# Forge / draft E2E keep-alive (comment only)

Cheap Actions signal when **draft** PR CI fails — so humans and agents can see
the red tip without burning Forge / Grok Bot wakes.

Creed: **cut waste, don't weaken quality.**

Cross-links: [FORGE_TIP_FREEZE.md](./FORGE_TIP_FREEZE.md) · [MERGE_GATE.md](./MERGE_GATE.md) ·
[ops/ZERO_INTERVENTION_SILENCE_FIXES.md](./ops/ZERO_INTERVENTION_SILENCE_FIXES.md)

## What this is

Workflow: [`.github/workflows/mythos-pr-hygiene.yml`](../.github/workflows/mythos-pr-hygiene.yml)
(`draft-ci-comment` job)

- Triggers when the **CI** workflow completes with **failure** on a **draft** PR.
- Posts or updates a sticky PR comment (`<!-- mythos-draft-ci:HEAD_SHA -->`) with
  failed jobs + run link.
- Dedupes per **head SHA**: same tip → update (no spam).
- Points standing agents at **docs paths only** (`FORGE_E2E_KEEPALIVE.md`,
  `FORGE_TIP_FREEZE.md`) — do not paste full contracts into the comment.
- Tip-fix window: `vars.MYTHOS_TIP_FIX_WINDOW_MINUTES` (default 20).
- Sticky itself has **no** Forge calls, **no** Grok Bot, **no** agent `@` mentions.

## Zero-intervention ready (greens)

Separate job `draft-ready-on-green`: after **2 consecutive CI greens** on the
**same** draft tip SHA → `gh pr ready`. **Never** auto-close drafts.

## Tip-freeze soft cap

Keep-alive comments do **not** change tip-freeze policy. When fixing:

1. Default: full fail inventory → **one CI-fix batch** tip.
2. Soft cap: if still red for `MYTHOS_TIP_FIX_WINDOW_MINUTES` (default **20**)
   wall clock since that tip’s CI started, **one** emergency single-fix tip,
   then resume batching.
3. Anti-pattern remains: streaming many small CI-fix tips.

## What this is not

- Not a merge gate signal.
- Not permission to drip-fix the tip.
- Not an agent wake or Paperclip/Forge dispatch.
