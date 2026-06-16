# Q&A Decisions Log — MYT-183

This document captures every decision resolved via the board Q&A on `questions.md`. Each row cites the original question, the resolution, and where the resolution is documented in the plan files.

For the full plain-language explanation of every question and the recommended defaults that were accepted, see the `Q&A Explainer` issue document on **[MYT-183](/MYT/issues/MYT-183)**.

---

## CEO decisions (board-delegated)

| ID | Decision | Notes |
| --- | --- | --- |
| 0.1 | **Keep Obsidian backwards-compatibility.** | Compat is low-cost and does not constrain UX innovation. Documented in [01-overview.md → Obsidian compatibility (CEO decision)](01-overview.md#obsidian-compatibility-ceo-decision). |
| 0.2 | **Adopt "Liquid Neon" as the official visual identity (MYT-516).** | Board-supplied brief + reference images. Applies uniformly across the app and adds a continuous Softness↔Contrast slider. Documented in [12-visual-design-system.md](12-visual-design-system.md); design + implementation delegated via MYT-516 child issues. |

---

## Board decisions — SKY-1663 open-questions round (2026-06-16)

Ten open product questions posed by CEO on [SKY-1663](/SKY/issues/SKY-1663); board answered all ten. Decisions and follow-ups:

| Q | Topic | Decision |
| --- | --- | --- |
| 1 | **MVP ship target date** | No fixed public date — ship when ready. Internal velocity gating, not a calendar. |
| 2 | **Launch platforms** | **Windows-only first.** macOS and Linux remain in CI (don't regress them) but the first official published release is Windows-only. macOS/Linux ship as follow-on releases once Windows is stable. |
| 3 | **Monetization model** | **Three-tier plan.** MVP: **one-time license fee** (BYO-API-key for now). Phase 2: **in-app AI subscription** where users buy LLM credits from us instead of managing third-party API keys. Phase 3: **paid cloud-storage subscription** with our own sync, gated to coincide with a future mobile app. Documented in [10-releases-and-roadmap.md → Monetization plan](10-releases-and-roadmap.md#monetization-plan). |
| 4 | **Telemetry posture** | Opt-in anonymous usage analytics **and** opt-in crash reports. Both default off; user enables each independently. |
| 5 | **Early-user support channel** | GitHub Discussions + Issues. No Discord at MVP. |
| 6 | **Cloud sync v1 — build any?** | **No built-in sync at MVP.** Users put the vault folder in their existing cloud storage (Dropbox / iCloud / Google Drive / OneDrive desktop client) and the OS-level syncer handles it. Built-in sync is **Phase 3 only**, tied to the paid cloud-storage subscription and a future mobile app where folder-syncers aren't available. SKY-843 spec is preserved but the implementation epic is parked behind monetization Phase 3. |
| 7 | **Default local-model recommendation** | `llama3.1:8b` via Ollama in the post-MVP local-model picker placeholder text. |
| 8 | **Voice IO default state** | Off by default at first run. User opts in via Settings. No mic-permission prompt on first launch. |
| 9 | **Writing Assistant heartbeat cadence** | **User-configurable in Settings.** Default = **on save**. Add a sub-toggle "idle-typing heartbeat" (on = constant interval heartbeat, off = only after user stops typing). This supersedes any single-default cadence I'd previously have picked. |
| 10 | **App name** | Locked: **"Mythos Writer"** is the shipping name. Brand assets (icon, marketing copy, social handles) can proceed against this name. |

### Implementation follow-ups (CEO will fan out)

- **Phase-3 monetization roadmap revision** ([10-releases-and-roadmap.md](10-releases-and-roadmap.md) updated inline).
- **Writing Assistant cadence settings spec** — PM ticket to define the Settings toggle UX (default on-save, optional idle heartbeat sub-toggle).
- **Cloud-sync re-scope** — defer the SKY-843 built-in sync implementation behind monetization Phase 3; ship a "Put your vault in Dropbox/iCloud/GDrive/OneDrive" help doc instead for MVP.
- **Voice IO default audit** — verify the SKY-1506 voice-IO setting defaults to off at first run; create a fix ticket if not.
- **Windows-first release pipeline** — verify Windows packaging + signing is on the critical path for first ship; macOS/Linux stay green in CI but are not the launch target.

---

## Board-overridden questions

| Q | Topic | Resolution | Lives in |
| --- | --- | --- | --- |
| 1.2 | External tagline | "A writing app, with an extra brain, to keep everything in mind so you don't have to." | [01-overview.md](01-overview.md) (top quote) |
| 4.1 | Default AI provider | **BYO any model** — cloud APIs, local runtimes (Ollama, LM Studio, llama.cpp), and custom agent providers like HermesAI. Model-agnostic by design. | [04-brainstorm-agent.md → Model choice](04-brainstorm-agent.md#model-choice--bring-your-own) |
| 4.5 | Frontmatter / vault layout | **Superseded by [SKY-15](/SKY/issues/SKY-15) ([#document-plan](/SKY/issues/SKY-15#document-plan)) — the original Q4.5 wording was an example, not a spec.** Authoritative default structure now: parent `~/Mythos/` with siblings `Story Vault/` and `Notes Vault/`; Notes Vault top level is `Universes/`, `Stories/`, `Inbox/`, `Research/`, `Daily Notes/`, `Archive/`; Story Vault is per-story → `Manuscript/` → numbered chapter folders → numbered scene files with seeded `Outline.md` + `Synopsis.md`. Brainstorm Agent falls back to frontmatter schemas when structure doesn't fit. | [SKY-15 #document-plan](/SKY/issues/SKY-15#document-plan) is the source of record; [02-storage-and-organization.md](02-storage-and-organization.md) and [04-brainstorm-agent.md](04-brainstorm-agent.md) mirror it. |
| 5.2 | Where inline suggestions render | **Two modes**: heartbeat scans land in the sidebar; **Beta-Read Mode** writes Word-style inline comments anchored to highlighted spans, visible in Edit Mode. | [05-writing-assistant.md → Beta-Read Mode](05-writing-assistant.md#beta-read-mode) |
| 6.6 | Continuity-issue UI | Checkbox-style todo list in the Brainstorm Agent's sidebar. Click an issue to expand, answer inline, and the answer routes back to the Brainstorm Agent. | [06-archive-agent.md → Continuity issues in Brainstorm sidebar](06-archive-agent.md#continuity-issues-live-in-the-brainstorm-sidebar) and [04-brainstorm-agent.md → How it interacts](04-brainstorm-agent.md#how-it-interacts-with-the-rest-of-the-app) |
| 10.4 | Local-model support at MVP | Cloud-only at MVP is acceptable. **Full local-model + BYO-provider support is the immediate post-MVP priority** (highest-priority next task). | [10-releases-and-roadmap.md → Full local-model and BYO-provider support](10-releases-and-roadmap.md#full-local-model-and-byo-provider-support-immediate-post-mvp-priority) |

---

## Questions accepted at default

All other questions (1.1, 1.3, 2.1–2.8, 3.1–3.7, 4.2–4.4, 4.6–4.8, 5.1, 5.3–5.7, 6.1–6.5, 6.7, 7.1–7.6, 8.1–8.7, 9.1–9.8, 10.1–10.3, 10.5–10.6, 11.1–11.10) were accepted at the **recommended defaults** documented in the Q&A Explainer.

A summary of the defaults already lives in the relevant per-surface plan files:

- **Overview defaults** → [01-overview.md](01-overview.md)
- **Storage defaults** → [02-storage-and-organization.md](02-storage-and-organization.md)
- **Editor & modes defaults** → [03-writing-experience-and-modes.md](03-writing-experience-and-modes.md)
- **Brainstorm defaults** → [04-brainstorm-agent.md](04-brainstorm-agent.md)
- **Writing Assistant defaults** → [05-writing-assistant.md](05-writing-assistant.md)
- **Archive Agent defaults** → [06-archive-agent.md](06-archive-agent.md)
- **Scene Crafter defaults** → [07-scene-crafter.md](07-scene-crafter.md)
- **Timeline defaults** → [08-timeline-builder.md](08-timeline-builder.md)
- **Safety & versioning defaults** → [09-safety-versioning-sync.md](09-safety-versioning-sync.md)
- **Release / roadmap defaults** → [10-releases-and-roadmap.md](10-releases-and-roadmap.md)
- **Cross-cutting defaults** → [11-cross-cutting.md](11-cross-cutting.md)

---

## How to revisit a decision

If a decision needs to change later:

1. Add a row in this table noting the change, the date, and the reason.
2. Update the file(s) where the decision lives.
3. Optionally open a follow-up issue and link it here.

The Q&A Explainer document on MYT-183 is the conversation record and should not be edited retroactively — it captures what was decided in that round.

---

## Implementation log

| Date | Issue | Change |
| --- | --- | --- |
| 2026-05-28 | SKY-9 | Two-vault foundation lands against the board-accepted [SKY-15 #document-plan](/SKY/issues/SKY-15#document-plan) (which supersedes the old Q4.5 example). Default vault roots are now `~/Mythos/Story Vault/` and `~/Mythos/Notes Vault/` as siblings under `~/Mythos/`; existing installs keep persisted paths. Notes Vault scaffolds the six SKY-15 top-level folders (`Universes/`, `Stories/`, `Inbox/`, `Research/`, `Daily Notes/`, `Archive/`) with `.gitkeep` sentinels, plus a seeded `My First Universe/{Characters,Locations,Factions,History,Systems,Items}/` example and a per-story `Stories/My First Story/` folder. Story Vault scaffolds `My First Story/Manuscript/01 - Opening/01 - Scene One.md` plus seeded `Outline.md` and `Synopsis.md`. Added `layoutMode` to `VaultSettings` (`default` \| `blank` \| `imported`) so the seeding hook honors Blank-mode (only the top-level vault folder is created). `ensure*VaultDir` seeds when the root exists but is empty (not only when missing). Added Notes-Vault-scoped IPC handlers `notesVault:read/write/list/delete/move` plus `vault:move` for symmetry; renderer bridge exposes `readNotesVault`/`writeNotesVault`/`listNotesVault`/`deleteNotesVault`/`moveNotesVault` and `moveVault`. Settings UI gained a "Vault paths" section backed by a new generic `vault:chooseFolder` IPC decoupled from the Obsidian-import token flow. Brainstorm asks-once-per-category routing in Blank-mode vaults (SKY-15 item 5) is split into a separate Brainstorm-Agent child issue blocked by SKY-9. |
