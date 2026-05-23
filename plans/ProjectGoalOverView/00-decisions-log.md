# Q&A Decisions Log — MYT-183

This document captures every decision resolved via the board Q&A on `questions.md`. Each row cites the original question, the resolution, and where the resolution is documented in the plan files.

For the full plain-language explanation of every question and the recommended defaults that were accepted, see the `Q&A Explainer` issue document on **[MYT-183](/MYT/issues/MYT-183)**.

---

## CEO decisions (board-delegated)

| ID | Decision | Notes |
| --- | --- | --- |
| 0.1 | **Keep Obsidian backwards-compatibility.** | Compat is low-cost and does not constrain UX innovation. Documented in [01-overview.md → Obsidian compatibility (CEO decision)](01-overview.md#obsidian-compatibility-ceo-decision). |

---

## Board-overridden questions

| Q | Topic | Resolution | Lives in |
| --- | --- | --- | --- |
| 1.2 | External tagline | "A writing app, with an extra brain, to keep everything in mind so you don't have to." | [01-overview.md](01-overview.md) (top quote) |
| 4.1 | Default AI provider | **BYO any model** — cloud APIs, local runtimes (Ollama, LM Studio, llama.cpp), and custom agent providers like HermesAI. Model-agnostic by design. | [04-brainstorm-agent.md → Model choice](04-brainstorm-agent.md#model-choice--bring-your-own) |
| 4.5 | Frontmatter / vault layout | Default folder structure: `Mythos Vault/Universes/<World>/...` for worldbuilding, `Mythos Vault/Story ideas/<Story>/...` for story-specific notes. Agent falls back to default frontmatter schemas when structure doesn't fit. | [02-storage-and-organization.md → Default folder layout](02-storage-and-organization.md#default-folder-layout-inside-the-notes-vault) and [04-brainstorm-agent.md → Vault structure](04-brainstorm-agent.md#vault-structure-the-agent-builds-against) |
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
