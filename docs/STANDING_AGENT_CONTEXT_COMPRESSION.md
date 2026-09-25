# Standing-agent context compression

Creed: **cut waste, don't weaken quality.** Lean context windows; keep quality
of the current source of truth. No product UI change.

## Goal

Monthly (or every ~4 weeks), compress Forge / Sentinel / Critic / Shield / Probe
accumulated brief history into **one standing summary** each (or one Mythos
standing summary). Old detail moves to an archive path so REPLY prompts do not
paste full history.

## Repo paths

| Path | Role |
| --- | --- |
| `docs/STANDING_AGENT_CONTEXT_COMPRESSION.md` | This playbook |
| `docs/archive/standing-briefs/YYYY-MM.md` | Archived detail for the month |
| `docs/archive/standing-briefs/CURRENT.md` | Optional pointer / latest compressed summary |

Optional monthly workflow:
[`.github/workflows/mythos-standing-context-compress.yml`](../.github/workflows/mythos-standing-context-compress.yml)
opens a **draft PR** or posts a checklist for Ivy — **does not auto-delete**
agent memory. Repo docs only unless Ivy owns Grok Bot memory separately.

## Compression recipe (Ivy / standing agent)

1. Collect the last ~4 weeks of standing REPLY briefs / ops notes for each role
   (Forge, Sentinel, Critic, Shield, Probe) — or one Mythos standing rollup.
2. Write a **compressed summary** (≤ ~1–2 pages): current SoT pointers, open
   carve-outs, tip-freeze / autofix vars, known traps, creed.
3. Append or move the verbose history to
   `docs/archive/standing-briefs/YYYY-MM.md`.
4. Point the next REPLY at the compressed summary path — not a full paste.

### Ivy-side (Grok / cloud agents)

Standing cloud agent `bc-fb92daf9` REPLY prompts should **start from the
compressed summary path** (`docs/archive/standing-briefs/CURRENT.md` or the
latest `YYYY-MM` summary header), not full history paste. Compress agent briefs
in mythos-ops separately if that store is outside this repo.

## What not to do

- Do not auto-delete Grok Bot / Paperclip memory from Actions.
- Do not collapse Critic/Shield/Probe into one silent gate.
- Do not put product UI changes in the archive PR.
