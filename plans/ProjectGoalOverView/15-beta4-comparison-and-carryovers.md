# 15 — Beta 4 "Refine": Old-Docs Comparison & Carry-Over Register

> Companion to [`14-beta4-refine-overview.md`](14-beta4-refine-overview.md).
> Purpose: before the old overview docs were marked outdated, every substantive
> commitment in them was audited against FULL-SPEC v1.1 + the B4 owner decisions
> so nothing is lost silently. This file records the disposition of every doc and
> the **carry-over register** — commitments the new spec doesn't restate but
> which remain binding (or need an explicit owner ruling, marked ⚖️).

## Disposition of the old docs

| Doc | Disposition |
|---|---|
| 00-decisions-log.md | **Stays active** — it's the log; B4 decisions appended. |
| 01–12 (overview/module docs) | **Outdated** — superseded by doc 14 + FULL-SPEC v1.1. Historical context only. |
| 13-Code-Quality.md | **EXEMPT — still in force.** The engineering/testing bar is not a design-spec concern; FULL-SPEC §14 is behavioral QA, not a code-quality standard. |
| 13-team-goals.md | **Updated** — its "read these first" index now points at doc 14 / FULL-SPEC. |
| questions.md | **Outdated** (resolved 2026-05-22 history) — but see carry-overs below. |
| Mythos writer.md | **Outdated** — the original design bible; superseded twice over. |
| plans/PROJECT_PLAN.md, plans/GOALS.md | GOALS.md stays (mission/process). PROJECT_PLAN.md marked outdated; its live commitments appear below. |

## Carry-over register

Items the new spec does NOT restate. **CF-x** = carried forward as binding
(compatible with the new design; builders must honor them). **⚖️-x** = genuine
conflict with the new design — owner ruling required before the affected
milestone starts.

### ⚖️ Owner rulings — RESOLVED 2026-07-10 (B4-8…B4-11; details in 00-decisions-log.md)

- **⚖️-1 · RESOLVED (B4-8): keep BOTH — Inbox + toggles, all OFF by default, per-category certainty sliders.** Original conflict: Old docs promise, pervasively
  and explicitly: *"agents never change your story text without your approval"*,
  *"every agent action is a suggestion by default"*, a **Suggestion Inbox**,
  provenance records, and *"accepting a suggestion always creates a snapshot"*
  (GOALS.md, PROJECT_PLAN, 01, 05, 06, 09). The new spec instead has §11
  **auto-apply autonomy toggles** (Grammar/Clarity/Pacing/Style/Tone), an
  auto-building Archive, auto-extracting Brainstorm, and no inbox.
  *Proposed reconciliation:* keep the hard rule **"nothing modifies manuscript
  prose without an explicit user action"** (auto-apply toggles are opt-in,
  default OFF, scoped to mechanical fixes, and every application creates a
  draft snapshot + is undoable); notes-vault writes by Brainstorm/Archive remain
  confirmation-free for *creation* but confirmed for *edits* (04's old
  create-vs-edit asymmetry). Drop the separate Suggestion Inbox surface.
- **⚖️-2 · RESOLVED (B4-9): generated prose goes to the scene board only ("Add to scene board"); never into the manuscript.** Original conflict: §7.1's
  Coach scaffold generates prose with an *Insert into manuscript* button. The
  spec's framing (explicit insert, never silent) is a deliberate design change —
  confirm it, and we'll restate the boundary as: *generation only in the
  Crafter, insertion only by explicit user action, never in the editor.*
- **⚖️-3 · RESOLVED (B4-10): full BYO stays (any API + any local) + OAuth buttons for every supporting provider, connect-later.** Original conflict: Old commitment: any provider
  (OpenAI-compatible endpoints, Ollama/LM Studio/llama.cpp, HermesAI). New §11:
  `Claude API / Local model` + OAuth only. Confirm the narrowing, or keep the
  OpenAI-compatible adapter that already exists in the repo behind the
  "Local model" path.
- **⚖️-4 · RESOLVED (B4-11): dropped by accident — monetization plan re-included as a parked post-Beta-4 roadmap track.** Original conflict: (Windows-first signed release,
  license tiers, Mythos cloud sync, mobile) — absent from the new spec and
  partly contradicted by GOALS.md's private-repo stance. Confirm it's parked,
  not canceled-by-accident.

### CF — Carried forward as binding (no conflict; builders must honor)

**Safety & privacy**
- CF-1 Telemetry: opt-in analytics AND opt-in crash reports, both default OFF,
  independently toggled, never vault contents (00/Q4, 11).
- CF-2 Voice: dictation off by default; **no mic-permission prompt at first
  launch**; prompt only when the user first enables Dictate (00/Q8).
- CF-3 API keys stored via OS keychain (safeStorage — already implemented);
  "Key stored locally" copy must remain true (Q9.7).
- CF-4 Reversibility: destructive/AI-applied changes snapshot first; per-scene
  history + one-click restore stays (09).
- CF-5 Story Vault boundary: agents write to the Notes Vault and machine state;
  the only paths that touch manuscript files are explicit user actions
  (subject to ⚖️-1/⚖️-2 ruling).

**Accessibility (11, 12, GOALS dyslexia goal)**
- CF-6 Body-text contrast floor ≥ 4.5:1 **hard-clamped** at every slider
  position, over any wallpaper/custom color — the theme engine keeps its clamp
  even though the new spec doesn't restate it.
- CF-7 Keyboard-complete: every core action reachable without a mouse; visible
  focus states not conveyed by color alone; screen-reader labels on controls.
  (WCAG 2.1 AA remains the target bar.)
- CF-8 Reduced-motion + reduce-glow respected app-wide (already in spec) and
  `prefers-contrast`/`prefers-reduced-transparency` honored where present.

**Data integrity**
- CF-9 Link survival on rename: renames update inbound `[[links]]`
  (deterministic rename-refactor in the linker engine, since stable-ID
  indirection is gone) (02, Q2.8).
- CF-10 Continuity flags stable across no-op edits; dismissed
  suggestions/reactions don't reappear (Q6.7, Q5.4, 05, 06).
- CF-11 Obsidian round-trip stays lossless: Source view is authoritative;
  Rich view must not destroy markdown it can't represent (GOALS, Q3.2).
- CF-12 External-edit conflict handling: the watcher path already reindexes
  external edits; simultaneous-edit conflicts surface to the user rather than
  last-write-wins silently (09, Q9.4).
- CF-13 Archive continuity semantics: the three-way resolution (match notes /
  suggest story change / ignore) is the required action set on every flag card
  (06 — the new spec's "actions" are exactly these); resolutions persist.

**Product capabilities the new spec is silent on**
- CF-14 Search: SQLite FTS5 full-text search stays (it exists and works); the
  Ctrl+K palette fronts it; Story/Notes/Both scoping preserved (11).
- CF-15 Timeline conflict flags: Archive Agent's timeline build flags
  chronology issues (§1 of old 08 — "skips backward" survives in DESIGN-SPEC §7;
  character-in-two-places and calendar violations ride on the new model's data
  and stay on the Archive scan list) (08).
- CF-16 Performance capacity budget: 1,000 scenes / 5,000 notes / 500 MB vaults
  stay usable; regressions are bugs (11) — now measurable with the profiling
  harness built during the July audit.
- CF-17 i18n: UI strings stay externalized as they are; English-only remains
  fine (11).
- CF-18 Update channels: Help → Check for updates stays manual-first; no
  silent auto-install (11).
- CF-19 Cost controls: per-agent budget caps exist in the repo (budget.ts) and
  REMAIN, surfaced in Settings → AI Agents even though §11 doesn't list them
  (09).

### Explicitly obsolete (no carry-forward)

Frame ring & transparency (B4-1/2) · Softness↔Contrast single slider (12) ·
Edit Mode (03) · per-block fullscreen focus & cross-scene block move (03) ·
Brainstorm Map/Clusters (B4-4) · old 5-mode timeline (B4-4) · Scene Crafter as
Obsidian-Kanban markdown note (07 — replaced by §7.1; board data still lives as
vault files per B4-3) · twin independently-relocatable vault roots (02) ·
universe-centric notes scaffold `Universes/…` (02 — new vaults use §2's layout;
imported/migrated vaults keep their existing folders) · Beta-Read as a Writing-Assistant sub-mode (05 — now
its own agent/view).
