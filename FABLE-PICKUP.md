# Fable — Pick Up Here (handoff 2026-07-14)

Ivy prepared this. The Paperclip team is winding down and **you (Fable) now own all
currently-open PRs.** The team has stopped touching these branches. Ivy watches and
**merges** them for you as they go green (you fix, Ivy merges — you never merge to main).

CI note: the repo just moved **off the exhausted GitHub Actions budget onto the 6
self-hosted runners** (PR #935). Land #935 first — it green-lights CI for everything
else. Required checks are `ci` + `build-linux`. All open PRs are **SkyyPlayz-authored**,
so the auto-merge watcher ignores them by design — Ivy merges each one by hand.

## Open PRs — where to pick up (merge order top→bottom)

| PR | What it is | State | What it needs |
|----|-----------|-------|---------------|
| **#935** | SKY-6723 restore self-hosted CI (kill Actions-budget spend) | BLOCKED, CI running | **Land FIRST.** Get `ci`+`build-linux` green on self-hosted, then Ivy merges. Unblocks all other CI. |
| **#933** | SKY-6629 ManifestV1 coercion on legacy schemaVersion 1 collision | ✅ CLEAN, all green | **Merge-ready.** Ivy merges on your go. |
| **#931** | SKY-6632 reroute timeline IPC off incompatible ManifestV1 schema | ✅ CLEAN, all green | **Merge-ready.** Ivy merges on your go. |
| **#932** | SKY-6596 make manifest.json structure-only (O(1) scene:save) | ✅ CLEAN, all green | **DATA MIGRATION → owner sign-off required before merge** (Ivy will not merge without Skyy's OK). |
| **#926** | SKY-6491 DocHeader real word count + persist title edits | ⚠️ DIRTY | Rebase onto main; CI was green before the conflict. |
| **#918** | SKY-6323 Timeline data model / codec / migration (M21) | ⚠️ DIRTY | Rebase onto main. **Overlaps #914 — pick ONE M21 data-model PR, close the other.** |
| **#914** | SKY-6306 M21 Timeline data model + calendars | ❌ BLOCKED, 5 failing | Rebase + fix e2e-shard-3 (SKY-6496); `pull_request` events weren't firing (SKY-6627). **Reconcile vs #918.** |
| **#917** | beta4-M15 right-panel agent hub + session store | ❌ BLOCKED, 3 failing | Fix CI red at `setup` (SKY-6718), then green the shards. |

## After the open PRs — Beta 4 "Refine" (v0.5.0) queue

Source of truth in-repo: `docs/releases/BETA-REFINE.md` (30 milestones, waves,
dependency order) + `plans/design-handoff/v2/` (FULL-SPEC + prototype = pixel/behavior
truth). Owner rulings that constrain the build live in the plan's `00-decisions-log.md`
(B4-8..B4-11: inbox + toggles-off-by-default + certainty slider · prose→scene board ·
any API/local + OAuth · monetization re-included).

**Done on main:** Wave 0 + M1–M5.
**Next milestone chain once the PRs above land:** M6/M7, M15 (#917), M16, and the M21
timeline chain (#914/#918), then remaining waves in `BETA-REFINE.md` dependency order.
Definition of done = FULL-SPEC §14 checklist + PERFORMANCE targets + green CI, verified
in the running app. Repo stays **private**; releases are owner-gated.

## Gotchas
- Concurrent-CI e2e/VR flake: re-run the failed shard before assuming a real break.
- `VR Baselines` workflow failing on a main push is benign (manual regen job, nothing to
  commit) — it is NOT a merge gate.
- Ping Ivy on Telegram–relayed status; Ivy merges each PR after reviewing the diff +
  confirming `ci`+`build-linux` green.
