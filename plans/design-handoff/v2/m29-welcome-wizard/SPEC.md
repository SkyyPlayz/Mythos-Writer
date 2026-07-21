# M29 — Welcome / First-Run Wizard — Design-Ahead Spec

**Issue:** SKY-7255 · **Owner:** UXDesigner · **Status:** ready for engineering (design-ahead, land before M29 coding starts)
**Milestone:** Beta 4 "Refine" (v0.5.0-beta.1), Wave 7, depends on M5 (MythosVault) + M28 (Settings workspace), both merged.
**Named constraint:** dyslexia-friendly first impression (owner is dyslexic, SKY-3941). This is the first thing a new writer sees — it has to be exemplary.

Redline screenshots for every new/changed screen are in [`redlines/`](redlines/), rendered at 1440×900 from real Liquid Neon tokens (not a sketch — see [`redlines/harness.html`](redlines/harness.html) for the exact markup/values used). Screenshot filenames match the section headers below.

---

## 0. What already exists — read this before touching code

This is **not** a from-scratch build. `frontend/src/OnboardingWizard.tsx` (~3,100 lines) and `OnboardingWizard.css` already implement a mature wizard from Beta 3 (M25, tickets SKY-2007/2008/1399/2988/2990/2993/2220) and it already uses Liquid Neon tokens (`--glass`, `--n1`, `--b1`, `--grad`, `backdrop-filter: blur(14px)`, etc.) — the visual language is largely already correct. **Do not rebuild it.** This spec is a **fidelity + gap-closing** pass, same pattern as every other Wave-1-6 milestone in `docs/releases/BETA-REFINE.md` (bring an existing surface to parity with the v1.1 prototype, then add what the prototype/acceptance criteria add on top).

Current structure, for reference:
- `step1` — 3 top-level `StartingPointCard`s: **Quick Start** (recommended chip), **Custom**, **Import / Open Existing**.
- `step1b` — one level deeper under Custom: Blank Slate, Sample Project, From Template, **Guided Setup** (the 4-step location→template→genre→theme tour).
- `step1c` — sample-project genre picker (3 flavors, accordion "what's inside").
- `custom-location` / `custom-template` / `custom-genre` / `custom-theme` — the Guided Setup tail (this is the piece closest to the target flow).
- `step-import` — Obsidian dry-run import + DOCX import.
- `step3` — scaffolding / creating.
- Replay: title-bar project menu → **"Replay onboarding"** (`WindowChrome.tsx:241` → `DesktopShell.tsx`) and Settings → About → **"Replay welcome tour"** (`AboutSection.tsx:77-79`), both call `onboardingReset()`. This already satisfies the "runs once; replay via project menu" acceptance line — **no new replay mechanism needed**, just confirm it still points at the entry screen defined below after this change.

### Gaps vs. the Beta 4 v1.1 prototype + this issue's acceptance criteria

Ground truth for the wizard is `plans/design-handoff/v2/prototype/Mythos Writer - Liquid Neon.dc.html` lines 3879–3966 (markup) and 6398–6410 (`pathCards`/`wizGenres`/`wizThemes`/`wizFinish` logic) — per `AGENTS.md`, **the prototype wins disagreements with FULL-SPEC**. Where I deviate from the prototype below, it's because this issue's acceptance criteria are more specific than the prototype's minimal mock, and I call the deviation out explicitly.

| Gap | Prototype/issue wants | Current code has |
|---|---|---|
| Entry paths | 4 flat cards: **Open sample project** (recommended), **Start blank**, **Import Obsidian vault**, **Restore from backup** | 3 top-level cards, with Sample buried 2 levels deep under Custom → step1b |
| Two-vault promise | Explicit "Story Vault + Notes Vault" messaging at vault setup | No such copy anywhere in the flow |
| Theme step | 10 Liquid Neon presets, 6 colour slots shown (this issue's acceptance criterion) | Only 3 themes (`classic`/`aurora`/`cyber`), 2-stop gradient bar, no slot breakdown — note the **prototype itself** also only wires up 3 themes in its wizard mock, so 10 is a deliberate *upgrade* past the prototype, justified by the acceptance criteria |
| AI provider step | Optional provider setup step before Done | Does not exist in the wizard at all (only in Settings → AI Agents, built in M28) |
| Dyslexia copy pass | Short lines, one idea per sentence, plain language | Several sentences fail this (see §7) |

---

## 1. Target flow

```
Welcome  →  Vault setup  →  Theme pick  →  AI provider (optional)  →  Done
(4 paths)    (per-path)       (all paths)      (all paths, skippable)
```

One canonical **tail** (Vault → Theme → Provider → Done) runs after every entry path chooses. What's pre-filled or skipped in the Vault step depends on the path; the tail itself never changes shape. This is the one structural decision in this spec — everything else is copy, layout, and one new step.

### 1.1 Entry paths (Welcome screen) — redline `A-welcome-paths.png`

Reusing the prototype's real 4 `pathCards`, with "Restore from backup" swapped for "Open existing vault" (see deviation note below):

| Card | Chip | Description | CTA | Tail behavior |
|---|---|---|---|---|
| **Open sample project** | RECOMMENDED | "See how it works with a small demo: characters, lore, and one drafted chapter." | Open sample → | Vault step pre-fills default location + shows the existing 3-flavor sample genre picker (`step1c`, reused as-is); still passes through Theme + Provider |
| **Start blank** | — | "Create an empty vault. Choose where to save it on the next screen." | Choose location → | Full Vault step: two-vault promise + location field + 8-genre picker (existing `custom-genre`, reused as-is) |
| **Import Obsidian vault** | — | "Point at an existing vault. You'll see every change before anything is saved." | Pick folder → | Vault step becomes the existing dry-run import UI (`step-import`); genre step is skipped (importing existing content); still passes through Theme + Provider |
| **Open existing vault** | — | "Already have a Mythos vault on this computer? Open it here." | Browse → | Skips straight to Theme + Provider (existing vault settings aren't touched) |

**Deviation from the prototype:** its 4th path is "Restore from backup" (Mythos Cloud / local snapshot). Cloud sync/backup isn't built yet (no milestone for it has shipped in this release plan) — designing a working restore flow against a backend that doesn't exist is exactly the kind of premature UI Tesler's Law warns against. I'm substituting **"Open existing vault"**, which is real, already implemented (`handleOpenExistingVault`), and covers the actual "I already have one" case today. **Follow-up:** once Sync & Backup ships, swap this card back to "Restore from backup" — flagging this as a natural post-M29 child issue, not blocking this milestone.

**IA change (the only structural change in this spec):** promote **Open sample project** from its current buried position (Custom → step1b, 2 clicks deep) to a top-level card. It's the prototype's actual `RECOMMENDED` default and the best self-demoing path (M29's own acceptance line: "every screen self-demos") — burying the best default behind an extra click works against Serial Position / Recognition-over-Recall. Quick Start and the Template gallery stay reachable — fold them into "Start blank"'s tail as secondary options (see §2.2), they don't need separate top-level cards.

Persistent on this screen only: **"Skip — continue to the app →"** — lands in a fresh empty vault with defaults, no path chosen. **Engineering note (CTO technical-feasibility review, SKY-7395, PR #983):** despite matching prototype line 3898, this link does not exist in `step1` today. The only shipped `startMode: 'skip'` wiring is `handleOpenExistingStory` (`OnboardingWizard.tsx:2795`), which is the "Open Existing Story" error-recovery button shown on scaffold failure (`step3`) — unrelated to a Welcome-screen escape hatch. **Scope this as new work in the M29 issue**, not a "confirm it still works" checklist item — it's the ultimate escape hatch (Nielsen's user-control-and-freedom) and needs to be built, not verified.

---

## 2. Vault setup — redline `B-vault-setup-two-vault-promise.png`

**Engineering note (CTO technical-feasibility review, SKY-7395, PR #983):** this single screen merges what are today **three separate wizard steps** (`custom-location`, `custom-template`, `custom-genre`, each its own screen per `WizardDots total={4}`). The individual fields/grids below are reused verbatim as stated, but combining three screens into one is layout/composition work beyond copy relocation — scope it as such, not as a pure copy-only diff.

### 2.1 Two-vault promise (new)

Two small side-by-side cards, icon + 2-line description each, sitting above the location field:

- **Story Vault** — "Your manuscript. Chapters and scenes."
- **Notes Vault** — "Characters, places, and research."

Heading: **"Your world needs two homes."** Subhead: **"We'll set up two vaults together. You'll never have to think about this again."** This directly satisfies the acceptance criterion and closes the gap found in §0 — nothing in the current copy tells a new user that two vaults exist or why. Both cards are static/informational (no interaction) — this is a mental-model-setting beat, not a decision point, so it shouldn't cost the user a click (don't make people click through explanations they didn't ask a question about).

### 2.2 Location field (existing, reused verbatim)

Reuse `custom-location`'s field 1:1: input pre-filled with a suggested path, `Browse…` button, inline validation states already implemented and correct — keep all 7:

`idle · validating · valid · new-path · not-writable · conflict-mythos · path-too-long · error`

Only copy change: none needed here, existing messages already pass the dyslexia bar (short, concrete: "This location is not writable. Choose a different folder.").

Secondary, low-emphasis links under the field (progressive disclosure, not new top-level cards): **"Use a template instead →"** (opens the existing `custom-template` gallery) and **"One-click setup →"** (existing Quick Start, skips straight to Theme with defaults). Both preserve every capability that exists today; neither adds new engineering surface, just relocates entry points.

### 2.3 Genre preset (existing, reused verbatim)

Existing `custom-genre` grid, 8 chips, 4-column desktop / 2-column narrow (`wiz-genre-grid`, already correct CSS). One copy fix (see §7): subhead becomes **"This sets your starter templates and story tools. Change it anytime."**

### 2.4 States

- Empty: nothing pre-selected on first visit → default to the first genre (`Epic Fantasy`) already selected, so Continue is never blocked by an unmade choice (Goal-Gradient — don't stall a new user on a low-stakes pick).
- Error: path validation errors block Continue with the field's own inline message; genre pick can never error (it's always valid).
- Skip: not applicable here — vault location is required (you can't skip where files go), but every value has a sane default so the step is never effortful.

---

## 3. Theme pick — redline `C-theme-grid-10themes.png`

### 3.1 Layout

Replace the 3-card `wiz-theme-row` with a **5×2 grid of all 10 presets** (Neon Classic, Aurora, Cyberpunk, Sunset Coast, Ice Mono, Emberfall, Verdant Reach, Royal Arcana, Noir Rose, Winterlight — exact names/hex arrays from `theme/presets.ts` / prototype `this.sets`, already the single source of truth, do not re-derive).

Each card is intentionally minimal — **no paragraph copy, ever** — so 10 cards stay glanceable rather than dense (Chunking + Prägnanz: hitting "show all 10" without hitting "dense" is a spacing/content problem, not a count problem):

- A **6-segment colour strip** (one block per neon slot, in FULL-SPEC §3 order: A left panel · B center/wiki-links · C right panel/agents · D warm data · E cool data · F nav rail) — reuse the same 6 hex values already defined per-preset in `theme/presets.ts`.
- The preset **name**, one line.
- Selected state: neon border + glow (existing `wiz-theme-card--on` pattern, just extend the selector to work across 10 cards) + a small checkmark on the name line (redundant with the border for colour-blind users — never rely on colour alone, WCAG).

A one-line legend under the grid spells out what the 6 segments mean (`A · Left panel`, `B · Center / wiki-links`, …) so the strip isn't a decorative abstraction — this is the FULL-SPEC §3 slot-role list, verbatim, in plain reading order.

Default selection: **Winterlight** (matches the existing app-wide default in `theme/presets.ts`), so — same as genre — Continue is never blocked by an unmade choice.

### 3.2 Copy

Heading **"Choose your neon."** Subhead **"Every border in the app glows with these colours. You can change this later in Settings."** (copy-fixed from the current "Fine-tune later in Settings" — see §7).

### 3.3 Interaction

Click anywhere on a card to select (not just the strip) — 13px-radius card is the full hit target, comfortably above the 44px minimum on any reasonable card size at this grid. Hover: border brightens (existing pattern). Keyboard: `role="radio"` grid exactly like the existing genre chips, arrow-key roving tabindex (reuse `handleGridArrowKeys`, it already does this for the step1 card grid — same pattern, don't write a new one).

### 3.4 Reduced motion

No card in this grid should animate on mount or hover-transform when `prefers-reduced-motion: reduce` is set — the existing `@media (prefers-reduced-motion: reduce)` block in `OnboardingWizard.css` already disables `.btn-primary` hover transforms; extend the same guard to the new theme cards (no scale/translate on hover, colour/border transitions only).

---

## 4. AI provider (optional) — new step — redline `D-provider-optional.png`

This step doesn't exist today. It sits between Theme and Done, and it must never feel mandatory — Beta 4's own decision log (B4-8…B4-11) already commits to "connect-later" OAuth (no credentials required to use the app), so this step's entire framing is **an invitation, not a form to complete**.

### 4.1 Content

Heading: **"Want writing help from an AI agent?"**
Subhead: **"This is optional. Skip it and set it up later — nothing here is required to start writing."** (says the same thing twice, deliberately — first line as a question invites engagement, second line as a flat statement removes any doubt it's optional; this is the one step where restating matters more than brevity, because "optional" claims are exactly where users' trust is lowest).

Below that: **one card**, a deliberately trimmed subset of Settings → AI Agents' existing `ProviderSection` (`frontend/src/components/SettingsPanel/sections/ProviderSection.tsx`) — reuse its component, don't refork it:
- Provider segmented control: **Claude API / Local model** (`PROVIDER_OPTIONS`, existing).
- If the selected provider has OAuth (`OAUTH_PROVIDERS[providerKind]`): the existing **"Log in with Claude"** gradient button + **"Key stored locally"** note + explainer-on-click, all verbatim, existing behavior (`oauthExplainerFor` state).
- If the provider needs a key instead: the existing masked API-key field, verbatim.

**Left out on purpose** (this is the wizard, not Settings): model-list fetch/selection rows, the 4 per-agent Identity & Files cards, autonomy toggles. Those stay exactly where they are today (Settings → AI Agents) — a new user configuring their first agent doesn't need to pick per-agent models before they've written a word. This is Progressive Disclosure, not a missing feature.

**Engineering note (CTO technical-feasibility review, SKY-7395, PR #983):** `ProviderSection` (lines ~183-220) has no prop to suppress the model-list block today — the "Default model" field + select + "Refresh models" button render unconditionally whenever the section renders. Importing it verbatim, as this spec originally implied, will show that UI. **M29 needs a small new prop on `ProviderSection`** (e.g. `hideModelField`) to actually leave it out — pick this explicitly rather than accepting the model-list UI shows in the wizard by default.

One line under the card, always visible regardless of provider state: **"You can write, take notes, and build your timeline with zero AI set up."** — removes any lingering "am I locked out if I skip" anxiety (Loss Aversion mitigation).

### 4.2 States

- Idle (nothing configured): valid, Continue always enabled.
- OAuth in progress / explainer open: reuse `ProviderSection`'s existing `oauthExplainerFor` toggle exactly.
- API key entered + Test: reuse existing `TestConnectionStatus` (`idle/testing/success/fail`) and its inline message, verbatim styling.
- Test fails: inline error under the field (existing pattern), **does not block Continue** — a failed test is information, not a gate; forcing a fix here would contradict "optional."

### 4.3 Skip

**"Skip for now — I'll set this up later"** — a plain text link, placed *below* the primary "Open my vault ✦" button, not beside it. This is a deliberate hierarchy choice: the primary action stays visually dominant (most users who reach this screen either configure or skip without reading closely), while skip stays present, legible, and one click away — never hidden in a corner, never styled to look disabled or discouraged (that would be a roach-motel-adjacent dark pattern; explicitly refusing that here).

---

## 5. Done

Reuse the existing finish behavior verbatim (`wizFinish` prototype logic / `withGuidedPersonalization` in code): apply the chosen theme's tokens live, persist settings, show the toast **"Vault ready — welcome to Mythos Writer"**, land in the editor on the new/opened vault. No changes needed here — it already matches the prototype exactly.

---

## 6. Shared chrome across the tail (Vault → Theme → Provider)

- **Progress indicator:** replace the anonymous 3-dot `wizDots` with the same dot styling but **labelled steps** ("Vault", "Theme", "AI helpers") — 3 dots total, Done isn't a counted step (it's the outcome, not a task). Labels matter here more than in the original prototype because this tail is longer and the user needs to know how much is left without holding it in working memory (reduces Zeigarnik-effect anxiety on a form-heavy flow). Reuse `WizardDots`, just add an optional `labels` prop.
- **Back:** always available except on the first tail screen (Vault) and Welcome. Never destructive — going back never discards what was already entered on a later screen (e.g., Back from Provider to Theme keeps the provider fields if the user returns forward).
- **Cancel setup:** existing `ConfirmDialog` ("Cancel setup? / Keep Going / Cancel Setup") stays exactly as-is, reachable from every tail screen.
- **Focus:** each screen auto-focuses its first interactive element on mount (existing pattern for step1/step2 — extend to Theme grid's first card and Provider's segmented control).

---

## 7. Dyslexia-friendly copy pass

Named constraint from the issue (owner is dyslexic, SKY-3941): short lines, one idea per line, plain language. Five offenders found in the current shipped copy, with fixes to carry into this milestone (apply wherever these strings are reused, not just in new screens):

| Current | Fix | Why |
|---|---|---|
| "Fine-grained control: pick your location and starting point." | "Choose your own vault location and starting point." | Drops jargon ("fine-grained"), one clause instead of a colon-joined two |
| "Plain Markdown files on disk — yours, portable, no lock-in." | "Plain text files on your computer. Yours to keep, no lock-in." | Three unexplained nouns → two short sentences |
| "Skip personalization — create vault" | "Skip this — create my vault" | "Personalization" is abstract; "this" points at something concrete on screen |
| "Seeds note templates, beat sheet and agent personas. Change anytime." | "This sets your starter templates and story tools. Change it anytime." | Three unexplained nouns in one sentence → plain restatement |
| "Every border in the app glows with your palette. Fine-tune later in Settings." | "Every border in the app glows with these colours. You can change this later in Settings." | "Palette"/"fine-tune" swapped for plain words |

General rules for engineering to hold the line on for any *new* copy in this milestone (not just the above):
- Max ~12–14 words per sentence; one idea per sentence, not joined with em dashes or colons.
- No unexplained abstract nouns ("personalization", "fine-grained") — name the concrete thing instead.
- Left-aligned always (already the default everywhere in this file — confirm no `text-align: justify` sneaks in).
- Keep the existing spacing scale (`--space-4`/`--space-5`, 16–20px gaps; `gs-modal` padding `2rem 2.5rem 2.5rem`) — it already reads as generous, don't compress it for the new theme grid.
- Keep the existing `1.5` line-height on body/hint text (`--leading-sm`) for anything new.
- **Engineering flag:** `tokens.css` has a "compact density" override that shrinks `--space-*` down to 2–3px (lines ~632–648 per the codebase audit). Confirm this density mode is never reachable while the wizard overlay is mounted — compact density on a first-run screen would directly violate this constraint. If it can currently apply, that's a bug to fix in this milestone, not a follow-up.

---

## 8. Component inventory (for engineering)

**Reuse as-is:**
`StartingPointCard`, `WizardDots` (extend with optional `labels`), `ConfirmDialog`, `ConflictDialog`, `GenreCard`, `useToast`/`Toast`, `Button` (`components/ui/Button`), `handleGridArrowKeys` roving-tabindex pattern, all 7 path-validation states, `ProviderSection`'s OAuth button + API-key field + `TestConnectionStatus` handling (imported/composed, not reforked).

**New:**
- `TwoVaultPromiseCard` — the Story Vault / Notes Vault pair in §2.1. Simple, no state, two instances side by side.
- `ThemeGridCard` — replaces the inline `wiz-theme-row` mapping; one card = colour strip + name + selected state. Take 6 hex values + name as props (already the shape of `theme/presets.ts` entries — no new data modeling needed).
- `ColorSlotStrip` — the 6-segment strip itself, factored out of `ThemeGridCard` so it's reusable. **Cross-surface reuse note (steward hat):** Settings → Appearance's "Neon border colors" section (FULL-SPEC §3, 6 rows: label+role/swatch/hex/curated swatches) renders the same 6 slots today as separate rows — `ColorSlotStrip` at a smaller scale is a legitimate shared primitive between the wizard and that Settings page. Not required for M29, but flag it in the PR description so whoever touches Appearance next sees the option instead of re-inventing it.
- `WizardProviderStep` — composes the trimmed `ProviderSection` subset described in §4.1, plus the skip link and the "zero AI set up" reassurance line. **Engineering note (CTO review, SKY-7395):** don't undersize this as a "thin wrapper" — `ProviderSection` needs ~15 props of controlled state (`providerKind`, `apiKey`/dirty, `baseUrl`, `model`, `testStatus`/`testMsg`, `modelList`/`Status`/`Error`, `useCustomInput`, `onFetchModels`, `activeProviderSupportsVoice`, etc.), all currently owned by `SettingsPanel`. This is a real state-and-IPC integration, not a JSX pass-through — size the M29 provider-step ticket accordingly.

---

## 9. Interaction spec summary (engineering checklist)

- [ ] Promote "Open sample project" to a top-level Welcome card (4 cards total); swap prototype's "Restore from backup" for "Open existing vault" (real, already implemented) and note the future swap-back as a follow-up once Sync & Backup ships.
- [ ] Add the two-vault promise card pair to the Vault step, above the location field, for every path that shows the Vault step.
- [ ] Expand the theme step from 3 to all 10 presets, 5×2 grid, 6-slot colour strip + legend, default to Winterlight, extend reduced-motion guard.
- [ ] Build the new optional AI-provider step: trimmed `ProviderSection` reuse, "Skip for now" link below the primary CTA, permanent "zero AI set up" reassurance line, no field here blocks Continue.
- [ ] Relabel the 3-dot progress indicator with step names (Vault / Theme / AI helpers).
- [ ] Apply the 5 copy fixes in §7 everywhere the old strings currently appear, and hold new copy to the same bar.
- [ ] Confirm (or fix) that compact density mode can never apply while the wizard is mounted.
- [ ] Confirm replay (project menu "Replay onboarding" + Settings → About → "Replay welcome tour") lands on the new 4-card Welcome screen and does not alter an existing vault before the user makes a choice.
- [ ] Every screen keeps its own empty/error/skip state working exactly as inventoried in §2.4, §3.4 (n/a — no error state), and §4.2 — nothing new here should regress an existing validation path.

## 10. Acceptance criteria mapping

- **"Full wizard flow specified with redlines + all states"** → §1–§6 + `redlines/*.png`, states enumerated per step in §2.4/§4.2.
- **"Theme-picker preview designed"** → §3, `redlines/C-theme-grid-10themes.png`.
- **"Dyslexia-friendly constraint named and satisfied"** → named in §0/throughout; satisfied via §7's copy pass + confirmation that the existing generous spacing/line-height scale carries forward untouched, plus the compact-density guard flagged as a must-fix.

---

**Handoff:** ProductEngineer/FoundingEngineer for implementation (component names + reuse notes above should make this a scoped diff on an existing file, not a rewrite). QA verification pass needed on: all 4 entry paths end-to-end, theme grid keyboard nav + reduced-motion, provider step skip path (confirm a skipped provider never blocks app usage), replay-from-menu regression (existing vault untouched). No auth/security-sensitive surface beyond what M28's `ProviderSection` already covers (reused, not reimplemented) — no separate SecurityEngineer review needed for this step.
