# HANDOFF — WSL host → grokbot (2026-09-15)

Written while retiring the WSL machine that ran the PaperclipAI agent company.
Everything below is the state of the world at handoff. **`origin/main` is the
source of truth.** Nothing needed to build, test, or ship Mythos Writer lives
only on the old host any more.

---

## 1. Where main stands

`origin/main` is current and clean. The last two open PRs were merged during
handoff, so the board of in-flight GitHub work is empty:

| PR | Change |
|---|---|
| #1563 | `fix(SKY-11791)` — Boards column-ref click-to-open survives a note rename (+138/−0) |
| #1533 | `feat(SKY-11192)` — Brainstorm Board-page unification + Idea Collections (+3822/−340) |

Both merged with every required check green (lint, typecheck, unit,
build-electron, notes-windows, e2e shards 1–4, carve-out-check, zero-diff-check).

**Open PRs at handoff: 0.**

---

## 2. What was rescued from the old host

The WSL box had work in three places that GitHub could not see. All of it is now
on GitHub.

### 2a. Uncommitted changes in the primary checkout

The main checkout had **641 files staged but never committed** on `main`
(+45,418 / −3,330) — screenshots, wallpaper tooling, docs, spec updates. Captured
verbatim as:

> **`wsl-handoff/main-worktree-snapshot`**

Unreviewed and deliberately *not* merged. Treat it as a quarry, not a candidate:
cherry-pick what still matters, drop the rest.

### 2b. Local branches and stashes

**197 branches** carrying commits that existed on no remote were pushed under
their original names. Remote branch count went from 104 → 294.

The primary checkout's **10 stashes** were converted to real branches and pushed
as `wsl-handoff/stash-0` … `wsl-handoff/stash-9`. Their original descriptions are
in the commit metadata; several are explicitly labelled superseded or
"pre-existing, not part of PR", so read the message before acting on one.

Two branches had diverged from same-named remotes and were pushed without
clobbering anything, as `wsl-handoff/sky11213-create-scene-local` and
`wsl-handoff/sky11791-column-ref-local`.

### 2c. Agent clones → draft release

Each agent kept its *own full clone*, each with its own branches and stash stack.
Across 15 clones: **~1,550 branches, 134 stashes, and ~7,000 uncommitted files**
spread over 60+ checkouts.

This is overwhelmingly superseded rebase-scratch — in the shared project clone
alone, **534 branches all pointed at one stale commit**. Pushing it as branches
would have buried the ~290 real ones, so it was archived instead:

> **Draft release [`wsl-handoff-2026-09-15`](https://github.com/SkyyPlayz/Mythos-Writer/releases)** — 12 git bundles, 572 MB

Every uncommitted working tree was committed *before* bundling, so nothing was
dropped. Bundles are named per agent (`FableEngineer.bundle`, `CTO.bundle`,
`shared-project-clone.bundle`, …); `MANIFEST.txt` lists per-bundle branch counts
and every checkout whose loose changes were folded in.

To resurrect anything:

```bash
gh release download wsl-handoff-2026-09-15 -p 'CTO.bundle'
git bundle list-heads CTO.bundle
git fetch CTO.bundle '<branch>:recovered/<branch>'
```

The release is a **draft** (owner-only) and its tag does not match `v*`, so it
cannot trigger `release.yml`.

### 2d. Website repo

`shitechworks.com` had 21 untracked files (screenshots, `css/`, `js/`) and one
stash. Loose files are pushed as `wsl-handoff/site-loose-files`. The stash — a
+671-line `index.html` WIP — could not be pushed because its committer address
trips GitHub's email-privacy block; it remains only in that clone's stash list.
**This is the one item not on GitHub.** See §5.

---

## 3. Open work carried over

The Paperclip board lived in a local Postgres that does not migrate. Snapshot of
everything still open, so it can be re-created wherever work is tracked next.

### In progress
- **SKY-11899** *(high)* — verify 10 consecutive green `e2e-shard-1` runs on main after PR #1581 (SKY-11865)
- **SKY-11891** *(high)* — regression: legacy session + brainstorm-board migrations silently no-op

### Needs a decision from the owner
- **SKY-11890** *(critical)* — Windows-host go-ahead #2, Kokoro re-smoke after PR #1582
- **SKY-11834** *(medium)* — retrieve pre-restructure BOARDS-SPEC v2 source cited by shipped Notes Board work
- **SKY-11853** *(medium)* — older BOARDS-SPEC v2 source has content missing from the landed doc (PR #1562)
- **SKY-11208** *(high)* — merge gates must mint assigned to the CEO, never unassigned

### Critical / high
- **SKY-11887** *(critical)* — Kokoro TTS synthesis fails in packaged Windows build
- **SKY-11889** *(critical)* — re-run SKY-11788 Kokoro TTS smoke on a packaged Windows build
- **SKY-8882** *(critical)* — Windows vault lifecycle: old vault not deleted, fresh vault prompts migration
- **SKY-11142** *(critical)* — next beta: close all open PRs, then vault surface + M12 + Notes Board
- **SKY-11698** *(high)* — EPIC: Timeline multi-calendar worlds
- **SKY-11192** *(high)* — Notes Board 9/9 (PR #1533 merged; confirm the ticket is actually closed out)
- **SKY-10390** *(high)* — owner ruling: MythosVault is just the format, remove the user-facing upgrade choice
- **SKY-10407** *(high)* — remove MythosVault upgrade UI entry points
- **SKY-11791** *(high)* — shipped via PR #1563; close it
- **SKY-11780** *(high)* — PR #1521 merge gate
- **SKY-11756** *(high)* — `winter-2.webp` cannot ship: generator caption baked into pixels
- **SKY-11436** *(high)* — live host runs stale paperclipai; obsolete after this migration
- **SKY-10602** *(high)* — isolate agent git checkouts; **this migration is the proof it was real** (see §4)
- **SKY-10086 / SKY-10160 / SKY-9916** *(high)* — carve-out gate hardening and a retroactive escalation
- **SKY-7568** *(high)* — backlog triage

### Medium / low
- **SKY-11832** — task-watchdog self-locks out of further mutation
- **SKY-11757** — regenerate 10 wallpaper sources at ≥1188 px height
- **SKY-10447** — `blocked` status auto-reconciles back to `todo`
- **SKY-9139** — host merge-gate doesn't watch `shitechworks.com`
- **SKY-11833** — reconcile code §-references against landed BOARDS-SPEC.md
- **SKY-10569** — root-cause duplicate PR-merge-gate minting
- **SKY-11737** *(low)* — `noteThumbnails` test assumes case-sensitive FS, fails macOS preflight
- **SKY-8244** *(low)* — un-skip `e2e/cloud-sync.spec.ts` when the Dropbox wizard ships

Several of these (SKY-11436, SKY-10602, SKY-11208, SKY-10569, SKY-11832) describe
Paperclip-specific infrastructure and may simply die with the platform. Confirm
before re-creating them.

---

## 4. Lessons worth keeping

**Per-agent clones are a data-loss trap.** Fifteen independent clones each
accumulated their own branches and stash stacks invisible to `origin`. Nobody
noticed until the machine was being retired, and recovery took a full sweep of
every clone. SKY-10602 called this out; it was right. Whatever runs the agents
next should use one shared repo with worktrees, or push every branch on creation.

**Ticket-named branches are not work.** 534 branches in one clone pointed at a
single stale commit — auto-created per ticket, never used. Branch count is a
useless proxy for how much work exists; dedupe by tip SHA before believing any
estimate.

**GitHub's email-privacy block is a silent migration hazard.** Commits authored
or committed with a private address are rejected at push time with `GH007`, and
`git push --atomic` turns one such branch into a whole failed batch. Push
non-atomically when rescuing bulk history, and check the *committer* field too —
not just the author.

---

## 5. Not migrated / still open

- **`shitechworks.com` stash@{0}** — the +671-line `index.html` WIP, blocked by
  `GH007`. Either disable "Block command line pushes that expose my email" in
  GitHub email settings and push it, or copy the diff out by hand, **before the
  old machine is wiped.**
- **The Paperclip board** (issues, comments, approvals, agent history) lives in
  local Postgres and is not exported beyond §3 above.
- **`~/PaperclipWork`** (SOUL/GOALS/memory/BOARDS-SPEC/COMPANY-LESSONS/scripts) —
  owner copied this to Windows and handed it to grokbot directly; it was
  deliberately not pushed here.
- **Host automation fleet** (merge bridge, reaper, tier-applier, watchdog timers)
  was Paperclip-specific and does not carry over.

---

## 6. Verification at handoff

- `origin/main` == local `main`, working tree clean
- 0 open PRs
- 0 branches with commits absent from origin, in the primary checkout
- 59 secondary worktrees closed; only `~/Mythos-Writer` remains
- All 15 agent clones bundled; bundle integrity verified by restoring 57 branches
  from `CTO.bundle` and confirming real commit history
