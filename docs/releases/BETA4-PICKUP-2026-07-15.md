# Beta 4 pickup — state at Fable's 2026-07-15 stopping point

For the Paperclip team (and Ivy). This is the live map of the Beta 4 "Refine"
campaign as of ~13:00Z. The plan is unchanged: `docs/releases/BETA-REFINE.md`
(status table current as of this commit), FULL-SPEC + prototype win every
disagreement, required checks are `ci` + `build-linux` (`build-macos` skipped
is normal), and **`report`/`close-ping` are non-required Paperclip pings —
ignore their status entirely**.

## Rule zero (learned the hard way tonight)

**Check reviews, not just CI.** Ivy posts holds as PR *comments*. Reading
check-runs alone missed two holds for nine hours while five stacks were built
on held branches. Every sweep: comments/reviews first, checks second.

## Merged today (all green)

#931 #926 #932 #935 #937 #938 #939 #940 #941 #945 #947 #948 #949 #950 #953.
Main is healthy; the v2-vault empty-bodies bug (#932's hydration vs `.mythos/`
paths) was fixed inside #953. `e2e/mythos-migration.spec.ts` and
`test:e2e:comments` now run in CI shard-2.

## Open PRs — status and merge order

| PR | What | State | Action for pickup |
|----|------|-------|-------------------|
| #914 | M21 timeline model | Ivy's hold **fixed** on-branch (4 commits thru `68e1c51`: real-manifest reads, wired migration + SKY-6626 note, atomic writes+backup, one-store reroute, labelled Demo seed w/ visible badge, VR baselines net-zero vs main) | Await Ivy re-review; she was pinged. Merge FIRST in the timeline chain |
| #951 | M22 axis engine (base m21) | Cascade agent merging fixed m21 in | Merge after #914 |
| #957 | M23 lane rows (base m22) | Built on pre-fix m22; cascade agent updates it after #951 | Merge after #951; watch its shard-4 (local e2e couldn't run — sandbox blocks electron downloads) |
| #917 | M15 agent hub | Ivy's hold **fixed** (`96de6a1`: findSessionFile lookup kills the wrong-file delete; 17 handler tests incl. the B1 regression pair; ci.yml hunk dropped; dead effect removed). Ivy pinged | Merge first in the coach chain |
| #952 | M12 Coach page (base m15) | Fix cascaded in (`692120b`, incl. `agentSession:read` moved to `agentSessionsIpc.ts`); fully validated | Merge after #917 |
| #956 | M13 scene analysis (base m12) | Fix cascaded in (`cde920b`); validated | Merge after #952 |
| #955 | M26 vault graph | **All required checks green** | Merge any time |
| #954 | Docs (status table + this file) | Re-kicked twice (first fail = main's own bug, second = setup-job 10-min timeout under runner saturation — both understood) | Merge on green |
| #943 | SKY-3223 auto-update e2e salvage | Green, unwired spec + docs only | Merge any time |
| #958 | M20 brainstorm unification (base m15) | Built on the FIXED m15 tip; B4-4 migration test-first | Merge after #917; then run the `brainstorm-chat` VR baseline loop (its PR predicts the trip) |
| #959 | M28 settings workspace | B4-6/8/10 compliant; `settings-panel` VR trip predicted | Review, run the VR baseline loop on its branch, merge; unblocks M29 |

**Stacked-PR mechanics:** bases are updated by MERGE commits, never rebase or
force-push (three PRs hang off these branches). When a base PR squash-merges
to main and its branch is deleted, GitHub retargets the child PR to main —
then merge main in once to deduplicate the diff.

## Agents still working at handoff

- **Cascade agent** finishing main→m21, then m21→m22 (#951), then m22→m23
  (#957) merge-ups with full validation (#914 went `dirty` vs main after
  tonight's ten merges; the cascade resolves it bottom-up).

All five milestone builders have delivered (#955 #956 #957 #958 #959).

## Known cross-PR collision (resolve at merge time)

**#952 and #958 both independently added the `agentSession:read` IPC**
(`handleAgentSessionRead` in `agentSessionsIpc.ts` + the channel plumbing) on
top of m15. Whichever merges second will conflict there — resolution is
"keep one copy" (they are functionally identical parsed-lookup handlers).

If any of these dies silently, its worktree is under
`/tmp/claude-0/-home-user-Mythos-Writer/*/scratchpad/wt-*` and the branch
name tells you what it owned. Nothing else holds unpushed work.

## Launch queue (gated, in dependency order)

- **M18 notes right panel** — after #917 AND #953 (flag actions bind to M9's
  comment handlers). Base: main once both are in.
- **M19 scene crafter** — after M12 (#952) merges; base main.
- **M24 remaining modes / M25 timeline panel** — after M23 (#957).
- **M27 beta reader** — after M9 ✅ + M15 (#917).
- **M29 welcome wizard** — after M28. LAST build milestone; flips default
  onboarding to MythosVault v2.
- **M30 release** — see BETA-REFINE "M30"; release procedure below.

## Standing rules / gotchas

- **Actions budget:** owner ruling — hosted runners are ONLY for
  `release.yml`. All CI is self-hosted (free). Never dispatch hosted
  workflows; `build-macos` stays disabled (#948).
- **Owner demo ruling:** demo content stays, must be labelled (data `source`
  marker + visible "Demo" badge — implemented for timelines in #914's fix).
  Agent rules / hard filters / agent tests are DEFERRED to the
  agent-refinement pass. Brainstorm starter library + sample vaults still
  need the label when touched.
- **Shared clone node_modules is broken** (hollow packages from racing npm
  installs). Never `npm install`/`npm ci` in `/home/user/Mythos-Writer`.
  Fresh `npm ci` in a private worktree is the standard; if electron downloads
  403 (sandbox egress), overlay a packaged harness
  (`scratchpad/squashfs-root` pattern: fresh `out/` into
  `resources/app/out/`, `app.asar*` renamed away, `ELECTRON_OVERRIDE_DIST_PATH`).
- **Never run `npm run fuzz:build`** (emits .js beside sources, poisons
  vitest). Use `npx tsc --project electron-main/fuzz/tsconfig.fuzz.json
  --noEmit`. electron-main relative imports need the `.js` suffix.
- **VR loop:** baselines must be captured on the self-hosted runner image.
  If a shard-3 VR failure is a legitimate UI change, run `vr-baselines.yml`
  (workflow_dispatch, ref = the PR branch, self-hosted), wait for the bot
  commit, then push an empty commit (bot pushes don't trigger CI).
- **Known CI flakes:** timeline perf gate can miss its 100ms CI budget by a
  few ms under runner saturation (re-run, don't loosen product code);
  setup-job 10-minute Node timeouts under load → whole run "skipped"
  cascade → re-kick with an empty commit.
- **Commit trailers** (every commit):
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` +
  `Claude-Session: https://claude.ai/code/session_01KfCADSstF41YyEVWXSkM45`.

## M30 + release (unchanged, owner-authorized)

All M1–M29 merged and table complete → version bump to `0.5.0-beta.1` +
changelog + VR refresh on main → FULL-SPEC §14 checklist 1–10 on a packaged
build + PERFORMANCE re-measure → dispatch `release.yml`
(`workflow_dispatch`, tag `v0.5.0-beta.1`, `is-beta: true`, ref `main`) —
this is the ONE sanctioned hosted-runner use; it produces the Windows NSIS
installer + Linux AppImage in a draft pre-release → publish the pre-release
(owner authorized; it feeds the beta auto-update channel) → post the
download link in chat.
