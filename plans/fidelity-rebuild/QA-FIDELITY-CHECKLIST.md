# QA Fidelity-Gate Checklist — Fidelity Rebuild

Owner: **QA** (SKY-9016, sibling to parent rollout SKY-8951). Source of authority:
`plans/fidelity-rebuild/PLAN.md` §0 (authority stack), §3 P0.3/P0.4, §4 cross-cutting
R11 rule, §8.5. Where this checklist and PLAN.md disagree, PLAN.md wins — fix this file.

This is the operational checklist QA runs against the plan's two Definition-of-Done
changes. It does not restate PLAN.md; it tells QA exactly what to click, run, and
reject.

---

## A. Per-PR gate (run on every PR in this rollout, before it reaches merge-gate)

1. **Side-by-side present.** PR body (or a linked doc) has a screenshot of the app
   surface next to the *same* prototype surface, same color set, same viewport class.
   Missing → comment the PR, request it, do not let it proceed to merge-gate.
2. **AI-off shot on AI-bearing surfaces (R11).** If the PR touches a surface listed in
   PLAN.md §4 M11b's contract table (editor sub-tabs, right-panel tabs, agent cards,
   comments gutter, Notes right panel, Brainstorm, Timeline), it must also include a
   shot with manual mode / AI off, compared against the prototype with the toggle off.
   Missing on an AI-bearing surface → same as #1, request and hold.
3. **No baseline churn outside a baseline PR (P0.4).** Diff the PR's file list for
   `e2e/visual-baselines/**`. Any hit → reject unless the PR's *sole* content is
   baseline regeneration (title/body says so, no app-code diff). Baselines regenerate
   once per milestone in a dedicated PR that Ivy approves — never smuggled into a
   feature PR.
   - Quick check: `gh pr diff <n> --name-only | grep -E 'visual-baselines|__screenshots__|e2e-visual-artifacts'`
4. **Keep-list guard.** If the PR removes or shrinks function from K1–K8 (PLAN.md §1
   keep-list), that's an automatic carve-out — stop, do not approve, route to Ivy.
5. **Palette guard.** If the PR changes palette/theme token values under the banner of
   "fidelity," reject — colors are explicitly out of scope for this whole plan (§0).

## B. Per-milestone fidelity pass (before a milestone epic — M1–M11 — closes)

CI-green does not close a milestone (P0.3). Before marking an M-epic `done`:

1. Re-read that milestone's **Acceptance criteria** checkboxes verbatim from PLAN.md §4
   — every box must be literally true in the *running app*, not inferred from the diff.
2. Run the harness: `npm run fidelity:both` (produces app + prototype captures side by
   side — see §C). Walk every surface named in the milestone spec at 1920×1080.
3. Confirm every merged PR under this milestone attached its side-by-side per §A.1/§A.2
   — this is the audit trail the EPIC's done-criteria requires. Missing shots on a
   merged PR = the milestone does not close until backfilled.
4. Confirm no baseline PR is outstanding/undone for this milestone if any visual
   baseline changed (P0.4) — baseline PR merged and Ivy-approved before close.
5. Milestone-specific gates:
   - **M2**: confirm the Ivy/owner sign-off comment exists on the migration PR before
     treating M2 as mergeable at all (SKY-6626 policy) — this blocks earlier than close.
   - **M8**: confirm native-Windows CI ran and passed for the emoji-name-handling work
     (create/rename/open/wikilink-to/display an emoji-named note and folder) — see §D.
     No Linux-only green counts for M8's name-handling acceptance criteria.
   - **M11 (a/b/c)**: confirm the network-silence assert ran (zero AI-provider requests
     with master off) and that M11c's completeness audit list is attached before M11c
     closes.
6. This pass is **Ivy's fidelity pass** per PLAN.md §8.5 — QA runs the mechanics (harness,
   screenshots, checklist) and hands the recorded result to Ivy for the actual close
   sign-off. QA does not self-certify a milestone closed; QA supplies the evidence.
7. Record the pass on the milestone issue: checklist items above, harness output paths,
   any gaps found + follow-up issue links (mirrors FULL-SPEC §14 item 11's "matches, or
   named gaps + follow-up issue" rule).

## C. Running the harness

```
npm run fidelity:proto   # capture prototype surfaces
npm run fidelity:app     # capture app surfaces
npm run fidelity:both    # both, paired for side-by-side review
```

Harness rules (PLAN.md P0.2, learned the hard way — do not relearn these):
- Never click a selector matching `Close` / `aria-label*="lose"` — kills the Electron
  window mid-capture.
- Dismiss the vault-format modal (`Not now`) before first navigation.
- Verify navigation landed via the `--active` class, not a timing guess.
- Never pipe the runner through `head` — it needs to exit cleanly on its own.

The harness lives at `e2e/fidelity/` (wired under SKY-9257; the old
`plans/fidelity-rebuild/harness/` location is retired). Outputs land in
`e2e/fidelity/output/<script-name>/` (gitignored). On a headless host, wrap the app
capture the same way CI wraps E2E: `xvfb-run --auto-servernum npm run fidelity:both`.
`npm run fidelity:verify-offline` asserts the P0.1 offline-render criterion.

## D. Native-Windows gate (M8 name-handling)

M8's emoji-in-names acceptance criterion is **not satisfied by Linux CI alone**. Before
M8 closes:
1. Confirm `build-windows` (or the dedicated native-Windows CI job) ran and is green for
   the PR(s) implementing R3/M8.5 (emoji names, path-separator regression guard vs
   SKY-8881).
2. Where CI coverage is thin, drive it manually via the WSL2 host's `cmd.exe`/
   `powershell.exe` interop (see workspace reference notes) as a second real check —
   not a simulation.
3. Record which path (native CI job vs manual host verification, or both) actually ran.

## E. Escalation

- Missing side-by-sides / smuggled baselines on a PR → comment the PR with what's
  missing, do not approve toward merge-gate.
- Keep-list deletion, palette drift, or any ambiguity not covered by PLAN.md §0's
  authority stack → escalate to Ivy per PLAN.md §0 ("stop and ask Ivy — a wrong guess
  here is how the last three weeks of drift happened").
- Auth / IPC / filesystem / secrets / import-surface findings encountered during a pass
  → escalate to CTO per QA's standing instructions, independent of this checklist.
