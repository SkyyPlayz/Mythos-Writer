# Mythos merge gate

Airtight, tip-SHA-bound conditions for merging into `main`. Enforced by
[`.github/workflows/mythos-gate-auto-merge.yml`](../.github/workflows/mythos-gate-auto-merge.yml).

Fail-closed: if any condition is missing or ambiguous, the workflow **does not merge**.

## Who merges

| Path | Merger |
| --- | --- |
| Routine product/docs PRs | Mythos gate auto-merge workflow |
| Dependabot patch/minor | [`dependabot-auto-merge.yml`](../.github/workflows/dependabot-auto-merge.yml) (unchanged) |
| Carve-out paths | Same workflow **only** after owner tip-bound `CARVE-OUT APPROVE` |
| Releases | [`release.yml`](../.github/workflows/release.yml) — draft only unless owner publishes |

Copilot / CI-fixer agents **never** merge (see `.github/copilot-instructions.md`).

## Required conditions (ALL)

1. **PR shape** — open, not draft, base `main`, author ≠ `dependabot[bot]`.
2. **Required checks SUCCESS on current head SHA**
   - `ci` (CI workflow aggregator)
   - `notes-windows`
   - `screenshot-check`
   - `carve-out-check` must be **completed** (it never fails the build; it labels/comments only).
3. **Tip-bound gate signals** — issue comments and/or PR reviews whose bodies reference the **current head SHA** (full or ≥7-char prefix) and include:
   - Critic: `APPROVE` (COMMENT reviews count; formal GitHub APPROVE is often blocked on author token)
   - Shield: `CLEAR`
   - Probe: `VERIFY PASS`
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

Default: `GITHUB_TOKEN` (repo has `allow_auto_merge=true`).

Optional repo secret `MYTHOS_BOT_TOKEN` (SkyHigh-Mythos-Bot PAT with Contents + Pull requests write): used when present if `GITHUB_TOKEN` merge is insufficient (403). Wire later; the workflow already prefers the secret when set.

## Idempotency

- Already-merged PRs are no-ops.
- On successful merge the workflow comments once:
  `Mythos gate auto-merge: Critic+Shield+Probe tip-bound + required checks green on <sha>.`

## Out of scope

- Branch protection UI (owner configures required checks)
- Dependabot auto-merge behavior
- `release.yml` publish / draft policy
