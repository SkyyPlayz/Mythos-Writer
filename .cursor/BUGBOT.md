# Mythos Bugbot rules

Creed: **We Build Nothing Less Than the Best.** Quality-over-tokens. Owner-quiet.

## Bar

- Prefer correctness, security, and durable tests over clever or large diffs.
- Do **not** weaken, skip, or delete tests to make CI green.
- Do **not** loosen security, auth, secrets handling, or release/packaging guards.
- Prefer **minimal diffs**; no drive-by refactors, renames, or formatting churn outside the task.

## Product context

Mythos Writer is an **Electron / local-first** fiction writing app (desktop notes + manuscript). Prefer local-vault safety, offline-friendly behavior, and UI fidelity over cloud-first shortcuts.

## Autofix / tip-SHA discipline

- Prefer opening a **new branch** (or a sibling fix PR) for autofixes.
- Do **not** thrash the tip SHA on gated PRs after TIP FREEZE — tip pushes reset Critic/Shield/Probe and burn gate cycles.
- Soft cap (ops): after one CI-fix **batch** tip, if CI stays red **~20 minutes** wall clock since that tip’s CI started, **one** emergency single-fix tip is allowed, then resume batching — see [`docs/FORGE_TIP_FREEZE.md`](../docs/FORGE_TIP_FREEZE.md). Still forbid drip streams.
- Leave merge decisions to the Mythos tip-SHA gate; Bugbot does not merge.
