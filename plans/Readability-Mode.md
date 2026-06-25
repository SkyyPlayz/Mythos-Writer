# Readability Mode — Design Spec

**Owner-shaped with Ivy (Skyy + Ivy, 2026-06-24).** This is the agreed design for the
dyslexia-friendly customization initiative (epic SKY-3941). The exact preset *values* come
from the Phase-1 deep-dive research; this spec locks the *shape, behavior, and scope*.

Liquid Neon stays the **default theme**. Everything here is opt-in customization on top.

## Core principle
As customizable as possible while staying **simple and never overwhelming.** Great defaults +
presets + progressive disclosure. Anything that could frustrate a non-dyslexic user is an
**adjustable option, never a forced default.**

## Appearance tab (always visible)
- **Theme** — Liquid Neon default.
- **High Contrast** — existing.
- **Readability mode** — preset toggle, sits next to High Contrast.
  - Turns on a research-backed bundle of reading/writing-friendly settings.
  - **Non-destructive:** everything it changes stays individually adjustable.
  - Shows **"edited"** + a **Reset** button when you tweak it.
  - **Live preview** — a sample text block updates as you adjust (find what works by feel).
  - **Progressive disclosure:** simple by default; a **"Customize"** button expands the detailed sliders.
  - **On/off behavior (decided):** turning Readability mode OFF returns to normal **but keeps
    anything the user personally changed** — they never lose their own tweaks.
- **Text size** (always visible, below the mode) — scales the app's **interface text** (buttons,
  menus, labels). Does NOT touch the editor writing area.
- **Zoom** (always visible) — magnifies the **whole app** in/out. Includes **Ctrl + / Ctrl − /
  Ctrl 0** shortcuts and a **Reset to 100%** button.

## Editor settings tab
- **Default editor font size** — lives here, in the section where you change the **paper** behind
  the text window. The editor font is also changeable **live while writing**; the app "Text size"
  slider does NOT affect editor font.
- **Paper** — the page background behind the text window.
- **Switch: match Story & Notes** — **ON by default** (both vaults share the same paper); flip OFF
  to give the **Story writer** and the **Notes vault** different paper, so users get a visual cue
  for which vault they're in.

## What Readability mode bundles (final values from the deep-dive)
- **Type:** dyslexia-friendly font options (e.g. OpenDyslexic / Lexend / Atkinson Hyperlegible)
  with preview; size, line-height, letter & word spacing, paragraph spacing; left-aligned (never
  justified); avoid italics/all-caps for body.
- **Color / visual stress:** background tint (cream / soft), adjustable contrast, optional color
  overlays (Irlen); reduce harsh pure-white.
- **Reading aids:** reading ruler / line highlight; **Focus mode** (dim everything except the
  current line/paragraph).

## Writing help — the biggest win (it's a writing app)
For a dyslexic *writer*, writing is the harder part. First-class, not buried:
- **Read-aloud (TTS)** — hear the text spoken back (catches errors the eye misses).
- **Dictation (speech-to-text)** — write by speaking. (Ties into Beta 2 Voice I/O.)
- **Forgiving spell-check** — understands dyslexic/phonetic spellings and still finds the intended
  word; good word suggestions / prediction. A real differentiator.

## Quality / coverage requirements
- **Apply everywhere** — menus, dialogs, sidebars, settings — not just the editor. No hard-to-read
  pop-up anywhere.
- **Don't break layouts** — Text size / Zoom must reflow cleanly at extremes; nothing clipped or
  overlapping (responsive).
- **Instant apply** (no reload); **persists** locally and **syncs** across devices.

## Safety / recovery
- **"Reset everything to default"** master button — nobody gets stuck in an unreadable setup.
- Per-preset Reset (above). Live preview helps avoid unreadable combos.

## Discoverability
- **Gentle onboarding offer:** *"Want to make reading and writing more comfortable?"* with a live
  **"try it"** on sample text. **Never** ask "are you dyslexic?" — offer comfort to everyone.
- **Quick toggle in the editor** so it's one tap.
- **Save your own setup** as a named preset, synced across devices.

## Naming
Called **"Readability mode"** — inclusive (great for dyslexia, anyone can use it), not clinical.

## Process
Heavy-pipeline epic SKY-3941: Phase-1 deep-dive research → ceo-refine (lock contracts + slices +
wave schedule) → **owner sign-off (required)** → parallel build → integrate → polish. Held behind
the backlog burn-down (SKY-3896) — research/planning may proceed; building waits.
