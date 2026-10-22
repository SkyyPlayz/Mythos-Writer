# Mythos merge gate

Airtight, tip-SHA-bound conditions for merging into `main`. A human applies
them. Actions does not.

`.github/workflows/mythos-gate-auto-merge.yml` (check name
`mythos-gate-auto-merge`) was removed. It still had live triggers
(`workflow_run` when CI completed successfully, `issue_comment`,
`pull_request_review`, and `pull_request` labeled / unlabeled /
ready_for_review / synchronize) and read the repo bot PAT, falling back to
`GITHUB_TOKEN`. A working PAT would have revived auto-merge with no GitHub
review. Skyy approved the removal. The repo secret is left in place; deleting
it is a separate owner-only step.

Fail-closed: if any condition below is missing or ambiguous, do not merge.

## Who merges

| Path | Merger |
| --- | --- |
| Routine product/docs PRs | Human. The Mythos gate auto-merge workflow was removed. |
| VR baseline refresh (`vr-baselines.yml`) | No PR. The step that opened one required the dead bot PAT and was removed. The workflow still regenerates baselines and uploads the `vr-baselines` artifact. |
| Dependabot (any update) | Human merge. `.github/workflows/dependabot-auto-merge.yml` was removed after PR #1696 (`abceeae7`) armed native auto-merge and landed on `main` with no reviews and no CI on `main` (owner Option A, 2026-10-16). |
| Carve-out paths | Human **only** after owner tip-bound `CARVE-OUT APPROVE` |
| Releases | [`release.yml`](../.github/workflows/release.yml) — draft only unless owner publishes |

Copilot / CI-fixer agents **never** merge (see `.github/copilot-instructions.md`).

While the bot PAT returns 403, Critic/Shield/Probe verdicts posted in the Mythos room with the tip sha count as official gate evidence. The only trusted approver is still SkyyPlayz (by `user.login`). Merge path: Ivy MERGE GO, then Sentinel merges as the bot pinned with `--match-head-commit`; on a 403, Ivy merges with the owner token pinned to the same sha; Skyy never merges.
`tip-freeze` goes on at the tip-freeze wake, before any verdict. No tip-freeze until CI has run on the current head sha.

## Required conditions (ALL)

1. **PR shape** — open, not draft, base `main`, author ≠ `dependabot[bot]`.
2. **Required checks SUCCESS on current head SHA**
   - `ci` (CI workflow aggregator)
   - `notes-windows`
   - `screenshot-check`
   - `carve-out-check` must be **completed** (it never fails the build; it labels/comments only).
   - No bypass merge of a PR whose newest `ci` isn't `success`. The newest check run for a name is the one that counts. A light run ends `ci` as `failure` (`DRAFT-LIGHT`) and has no success path. `ci-light` is not a required check.
   - Tip-freeze source of truth: Mythos-Ops `rules/gates/FORGE_TIP_FREEZE.md`. Freeze line: Ivy undrafts (= the freeze). Builders push code only; builders never undraft, re-draft or re-run.
3. **Tip-bound gate signals from trusted authors** — issue comments and/or PR reviews by allowlisted accounts (`SkyyPlayz`, `SkyHigh-Mythos-Bot`) whose bodies reference the **current head SHA** (full or ≥7-char prefix) and include:
   - Critic: latest tip-bound decision must be `APPROVE` (body must include Critic; COMMENT reviews count; a later tip-bound `CHANGES_REQUESTED` revokes an earlier APPROVE)
   - Shield: body must include `Shield` + `CLEAR`
   - Probe: body must include `Probe` near `VERIFY PASS` (fail closed on bare "verify pass" alone)
4. **Carve-outs** — if label `carve-out` is present, or the diff hits carve-out paths (workflows, actions, `db.ts`, auth, secrets, release/electron-builder config), or the active `carve-out-check` sticky still requires review:
   - **Do not merge** unless owner `SkyyPlayz` has commented tip-bound `CARVE-OUT APPROVE`.
5. **Clean merge** — `mergeable === true`; no tip-bound Critic `CHANGES_REQUESTED`.
6. **Merge method** — create a **merge commit** (`merge_method: merge`). Branch delete is not required.
7. **Never** publish GitHub releases, push commits to `main` outside this merge, or weaken tests.

## Triggers

Removed with the workflow. No remaining workflow re-checks a PR in order to
merge it. Do not restore `workflow_run`, comment, review, or pull-request
triggers that merge.

## Tokens

Removal note: the deleted workflow read the repo bot PAT (SkyHigh-Mythos-Bot,
Contents + Pull requests write) and, when that secret was empty, `GITHUB_TOKEN`.
That read is gone. This change does not delete the secret.

## Idempotency

The deleted workflow posted this comment only after a successful merge API call:

`Mythos gate auto-merge: Critic+Shield+Probe tip-bound + required checks green on <sha>.`

Nothing posts that marker now.

## Out of scope

- Branch protection UI (owner configures required checks) — see
  [BRANCH_PROTECTION_MAIN.md](./BRANCH_PROTECTION_MAIN.md) for the canonical
  `main — Mythos single tip-gate` ruleset (docs + manual apply helper; not
  auto-applied by Actions).
- Tip-freeze / CI-fix batching soft cap — see [FORGE_TIP_FREEZE.md](./FORGE_TIP_FREEZE.md)
  and [FORGE_E2E_KEEPALIVE.md](./FORGE_E2E_KEEPALIVE.md) (comment-only draft CI sticky).
  The freeze line's source of truth is Mythos-Ops `rules/gates/FORGE_TIP_FREEZE.md`:
  Ivy undrafts (= the freeze). Builders push code only; builders never undraft, re-draft or re-run.
- `release.yml` publish / draft policy
