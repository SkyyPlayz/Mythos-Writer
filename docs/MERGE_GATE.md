# Mythos merge gate

Airtight, tip-SHA-bound conditions for merging into `main`. Enforced by
[`.github/workflows/mythos-gate-auto-merge.yml`](../.github/workflows/mythos-gate-auto-merge.yml).

Fail-closed: if any condition is missing or ambiguous, the workflow **does not merge**.

## Who merges

| Path | Merger |
| --- | --- |
| Routine product/docs PRs | Mythos gate auto-merge workflow |
| VR baseline refresh PRs (`vr-baselines.yml`) | Same Mythos gate — workflow opens a PR to **`main` only** with `MYTHOS_BOT_TOKEN` (so required checks run); **no** `--auto --squash` |
| Dependabot (any update) | Human merge. The Mythos gate still skips `dependabot[bot]`. `.github/workflows/dependabot-auto-merge.yml` was removed after PR #1696 (`abceeae7`) armed native auto-merge and landed on `main` with no reviews and no CI on `main` (owner Option A, 2026-10-16). |
| Carve-out paths | Same workflow **only** after owner tip-bound `CARVE-OUT APPROVE` |
| Releases | [`release.yml`](../.github/workflows/release.yml) — draft only unless owner publishes |

Copilot / CI-fixer agents **never** merge (see `.github/copilot-instructions.md`).

While the bot PAT returns 403, Critic/Shield/Probe verdicts posted in the Mythos room with the tip sha count as official gate evidence. The only trusted approver is still SkyyPlayz (by `user.login`). Merge path: Ivy MERGE GO, then Sentinel merges as the bot pinned with `--match-head-commit`; on a 403, Ivy merges with the owner token pinned to the same sha; Skyy never merges.
`tip-freeze` goes on at the tip-freeze wake, before any verdict. No tip-freeze until CI has run on the current head sha (a `GITHUB_TOKEN` rebase starts no CI, so the builder pushes an empty commit first).

## Required conditions (ALL)

1. **PR shape** — open, not draft, base `main`, author ≠ `dependabot[bot]`.
2. **Required checks SUCCESS on current head SHA**
   - `ci` (CI workflow aggregator)
   - `notes-windows`
   - `screenshot-check`
   - `carve-out-check` must be **completed** (it never fails the build; it labels/comments only).
3. **Tip-bound gate signals from trusted authors** — issue comments and/or PR reviews by allowlisted accounts (`SkyyPlayz`, `SkyHigh-Mythos-Bot`) whose bodies reference the **current head SHA** (full or ≥7-char prefix) and include:
   - Critic: latest tip-bound decision must be `APPROVE` (body must include Critic; COMMENT reviews count; a later tip-bound `CHANGES_REQUESTED` revokes an earlier APPROVE)
   - Shield: body must include `Shield` + `CLEAR`
   - Probe: body must include `Probe` near `VERIFY PASS` (fail closed on bare "verify pass" alone)
4. **Carve-outs** — if label `carve-out` is present, or the diff hits carve-out paths (workflows, actions, `db.ts`, auth, secrets, release/electron-builder config), or the active `carve-out-check` sticky still requires review:
   - **Do not merge** unless owner `SkyyPlayz` has commented tip-bound `CARVE-OUT APPROVE`.
   - Otherwise a sticky comment asks Ivy/owner for that allow.
5. **Clean merge** — `mergeable === true`; no tip-bound Critic `CHANGES_REQUESTED`.
6. **Merge method** — create a **merge commit** (`merge_method: merge`). Branch delete is not required.
7. **Never** publish GitHub releases, push commits to `main` outside this merge, or weaken tests.

## Triggers

- `workflow_run` of workflow `CI` with `conclusion=success` (resolve PR from head SHA)
- `issue_comment` / `pull_request_review` when the body looks like a gate signal
- `pull_request` `labeled` / `unlabeled` / `ready_for_review` / `synchronize` (re-evaluate)

## Tokens

Prefer repo secret `MYTHOS_BOT_TOKEN` (SkyHigh-Mythos-Bot PAT with Contents + Pull requests write) when set so the merge push can trigger downstream workflows.

Fallback: `GITHUB_TOKEN` (repo has `allow_auto_merge=true`). Because that token does not re-trigger `push` workflows, the gate **dispatches `ci.yml` on `main`** after a successful `GITHUB_TOKEN` merge.

## Idempotency

- Already-merged PRs are no-ops.
- The merge-intent comment is posted **only after** a successful merge API call (so transient merge failures can retry):
  `Mythos gate auto-merge: Critic+Shield+Probe tip-bound + required checks green on <sha>.`

## Out of scope

- Branch protection UI (owner configures required checks) — see
  [BRANCH_PROTECTION_MAIN.md](./BRANCH_PROTECTION_MAIN.md) for the canonical
  `main — Mythos single tip-gate` ruleset (docs + manual apply helper; not
  auto-applied by Actions).
- Tip-freeze / CI-fix batching soft cap — see [FORGE_TIP_FREEZE.md](./FORGE_TIP_FREEZE.md)
  and [FORGE_E2E_KEEPALIVE.md](./FORGE_E2E_KEEPALIVE.md) (comment-only draft CI sticky).
- `release.yml` publish / draft policy
