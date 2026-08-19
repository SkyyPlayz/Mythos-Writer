# GAP-REPORT-v2 — Delta Pass vs Refreshed Prototype (2026-07-30)

**From:** UXDesigner
**Re:** SKY-8961 (parent SKY-8951)
**Source of truth used:** `plans/design-handoff/v2/prototype/Mythos Writer - Liquid Neon.dc.html`
at HEAD (`6b7a8a9b`) — refreshed twice this week by PR #1153 (Timeline Archive Agent
chat + card feeds) and PR #1156 (Notes Vault folder drag/drop). GAP-REPORT-v2 was
filed 2026-07-09 against the pre-refresh copy; per the owner ruling, **prototype wins**
wherever the two disagree.

Six defects (P0 #1, #2, #4 chrome + right-panel #3, plus P1 #5, #6) are already
diagnosed and in build — not re-litigated here beyond a one-line status. This pass
focuses on the remainder: P1 #7–#10 and P2 #11–#15.

Legend: **still-broken** = gap is real, prototype still specifies this, not yet fixed.
**fixed-since** = shipped app already matches. **superseded-by-refresh** = the 07-09
wording no longer matches what the refreshed prototype does; corrected text given.
**ASK** = may be intentional product behavior — do not build blind.

---

## P0 (in build — status only, not re-diagnosed)

| # | Item | Status |
|---|---|---|
| 1 | Notes Vault seeding / UUID leak | still-broken, in build (SKY-8881 folder-move bug tracked separately). **Note:** refresh #2 (PR #1156) added new reference detail implementers should read before closing: `above/into/below` drop-zone geometry, a "DROP HERE FOR VAULT ROOT" strip, and inline-rename-on-create for new folders (`vNewSub`). Confirm the in-build fix picks up these bindings (`nVaultRows`, `nToolNewFolder`, root-drop strip) — the pre-refresh copy didn't have them, so an implementation started before Jul 29 may be missing this. |
| 2 | Rich view renders frontmatter as body text | still-broken, in build |
| 3 | Right-panel layout collisions | still-broken, in build |
| 4 | Editor chrome duplicated | still-broken, in build |

---

## P1

### 5. Scene-level editor — in build
No change from refresh (neither PR touched the manuscript-page/page-setup markup). Wording stands as written.

### 6. Brainstorm — Clusters and Map — in build
No change from refresh. Wording stands as written.

### 7. Timeline — **still-broken, wording partially superseded-by-refresh**
PR #1153 changed exactly the surface this item covers (the Archive Agent right panel), so the "Expected" text needs an addendum:
- Confirmed unchanged and still the target: all five modes (Spreadsheet/Plan-vs-Progress/Subway/Relationships/Map) render from `tlEvents`; `Today` (`tlToday`) jumps/selects the current event; View/Group/Show filters re-group bands.
- **New in the refresh, not in the 07-09 doc:** the Archive Agent feed panel (`tlarc`) now has a live chat input — "Talk to the Archive Agent…" with a send button and Enter-to-send — and both `tlbs`/`tlarc` feeds render card-style messages (title/text/footer), not just chat bubbles, and no longer truncate history to the last 6. Any build against the old export is missing this chat affordance entirely. Add to the acceptance criteria: Archive Agent panel must have the chat input + card rendering, not just a read-only feed.
- **ASK:** "the Suggest-with-AI button proposes dates for undated scenes" — I could not find this control by that name or an "undated" state in the current export. Either it's named differently now or it dropped out of this refresh. Confirm with the owner before filing a P1 build issue for it; don't guess at the copy.

### 8. Settings — still-broken
Confirmed still standing against the refresh (untouched by either PR): Settings is modeled as a full left-rail section view (`account / appearance / agents / editor / vault / sync / keys / about`), not a modal — matches the "full workspace view" expectation. One correction to the 07-09 wording: the prototype's actual section labels are **Account, Appearance, AI Agents, Editor, Vault & Files, Sync & Backup, Shortcuts, About** — the doc's "General" should read "**Editor**" (there is no "General" section in the prototype). Thin scrollbar rule (`::-webkit-scrollbar`, 9px, translucent thumb) is global CSS, confirmed present — applies here too.

### 9. Window & navigation chrome — still-broken, one clause corrected
- Rail label visibility is bound to a single state flag (`railSlim` / `railNotSlim`), toggled from the View menu ("Slim rail") — confirms this is one global user toggle, not per-view. Wording stands.
- Tab strip: confirmed `showTabStrip` is false for settings/graph/brainstorm/timeline/beta and the strip supports drag-reorder + right-click menu (Open to the side / Pop out into new window / Close tab) — matches "documents/workspaces" model. Wording stands.
- **Correction:** the `+` next to tabs does **not** open a "tab-kind picker" in the current prototype — it directly creates a new blank scene tab (`addProvSceneH`, tooltip "New blank scene — it only saves once you type"). There is no picker menu in this export. Update the acceptance criteria to: *"+ creates a new blank scene tab directly"* rather than *"+ opens the tab-kind picker."* If a picker is still wanted product-side, flag as ASK to the owner — this reads like an intentional simplification, not a regression.

### 10. Bottom status bar — still-broken
Read-time chip (`~N min read`, `statRead`) confirmed present in the source; nothing else in this item touched by the refresh. Wording stands as written.

---

## P2

### 11. Scrollbars — still-broken
Global thin/translucent scrollbar rule is unchanged by the refresh (not part of either PR's diff). Applies app-wide per the existing CSS block. Wording stands.

### 12. Empty states — still-broken
Not touched by either refresh PR outside of the Notes Vault tree (which gained a root-drop empty affordance, not a copy change). General "glyph + one-line hint + action button" pattern is unchanged elsewhere (Scene Crafter, Timeline, Graph). Wording stands.

### 13. Typo / title-case mapping (`chaper 1` → title case from frontmatter) — still-broken
No change from refresh; this is a display-mapping rule, not markup the export would show either way. Wording stands, unverifiable further from the static prototype alone — implementer should treat "has `title:` frontmatter → display that" as the rule regardless.

### 14. Genre preset control 3× on Brainstorm — **ASK / wording likely stale**
The refreshed prototype has exactly **one** `<select>` for genre ("Epic Fantasy ▾", line ~3681, in the Brainstorm agent header) — consistent with the 07-09 "Expected" state. But I could not find any "Show Presets" string, or a second/third genre control, anywhere in the current export (the only other "genre preset" text is the unrelated onboarding wizard step "Pick a genre preset"). Two possibilities: (a) the right-panel "tip" link genuinely isn't in this export and the doc's expected-behavior clause is stale, or (b) it's named differently now. **Recommend:** before CEO mints this as a P2 build issue, confirm against the shipped app whether the 3× duplication still reproduces at all, and drop the "Show Presets" wording — verify the actual right-panel control name in the current prototype export instead of trusting the 07-09 text.

### 15. Beta-Read panel copy — **ASK / wording superseded-by-refresh**
I could not find "Reviewing sceene 2," "No active Beta-Read comments," or "No feedback yet…" anywhere in the current prototype. What exists instead: a "Beta Reader" agent (`S.agentNames.beta`) whose stated model is "reactions land as margin comments" (toast copy at line ~6907) — i.e., the current prototype's Beta Reader concept is margin annotations on the manuscript, not a dedicated review panel with three stacked empty-state lines. This is either an older screen that predates both refreshes (possibly not even in this export's reachable states) or a deliberate rework to a margin-comments model. **Flag as ASK, not still-broken** — filing a P2 issue to "collapse three empty statements into one" against a panel structure that may no longer exist in the product direction would send someone chasing the wrong surface. Owner should confirm whether the Beta-Read panel (as three-empty-state UI) is still in scope, or whether P1 build work should instead target the margin-comments model.

---

## Summary for CEO (still-broken items ready to mint as build issues)

- **P1:** #7 (Timeline — plus the new Archive Agent chat/card requirement from the refresh), #8 (Settings — correct "General" → "Editor" in the ticket), #9 (nav chrome — correct the `+` button's expected behavior), #10 (status bar).
- **P2:** #11 (scrollbars), #12 (empty states), #13 (title-case mapping).
- **Hold for confirmation, do not mint as-is:** #14 (genre preset — confirm control naming/reproduction first), #15 (Beta-Read panel — confirm whether the panel model itself is still current before scoping a copy fix).
- **P0 #1–4 / P1 #5–6:** already in build per parent issue; #1's implementer should double check against the Jul 29 refresh's new drag/drop + inline-rename bindings.
