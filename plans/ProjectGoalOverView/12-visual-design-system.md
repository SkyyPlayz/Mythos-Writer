# Visual Design System — Liquid Glass Dark Neon

> **CEO decision (MYT-516):** Mythos Writer's official visual identity is **Liquid Glass Dark Neon** — translucent frosted-glass surfaces with restrained neon accents, applied consistently across every surface of the app.

## Board decisions (MYT-516 follow-up)

The board confirmed three points after reviewing the direction:

- **Dark-only.** Liquid Glass Dark Neon is the **single app theme** — the previous light/system theme options are dropped. The WCAG **high-contrast** accessibility theme is retained (it composes with this theme; see [11-cross-cutting.md](11-cross-cutting.md#accessibility)).
- **Timing: next milestone.** This is **not** an MVP-core feature. It is sequenced as the **immediate next milestone after the current core work lands** (see [10-releases-and-roadmap.md](10-releases-and-roadmap.md)). It does not block in-flight MVP work.
- **Dedicated designer.** A **UX designer is being hired** to own the design-system spec; engineering implements.

This document is the product-level direction. The full design brief lives in
[`Ui-Disign-Goal`](Ui-Disign-Goal); annotated reference images live in
[`Liduid-Glass-Dark-Neon- theme- exampels/`](<Liduid-Glass-Dark-Neon- theme- exampels/Example photos.md>).
The detailed token set, component specs, and implementation are delegated (see **Workstream & ownership** below).

## Design intent

A calm, immersive, long-session-comfortable workspace where depth and hierarchy are
communicated by **light, blur, and subtle motion** rather than heavy borders. Neon is
treated as **directional lighting and state**, never as the fill color for large text blocks.

The look must be **smooth, consistent, and uniform across the entire app** — every surface
(editor, navigator, agent chat, Scene Crafter, timeline, notes/graph view, dialogs) shares
the same glass + neon language. The reference images show the target for the full app shell,
the AI chat box, the notes section (Obsidian-style with graph view), and the editor.

## Non-negotiable constraints (carried from the brief)

- **Body text contrast ≥ 4.5:1** on every panel background. Legibility wins over effect.
- **Neon = accent + state only.** Thin frames (1–3px), soft outward falloff, subtle hover pulse — no constant animation, no bloom that hurts readability.
- **Performance:** limit large blur radii and animated shadows; composited `transform`/`opacity` only; `backdrop-filter: blur()` with a noise-fill fallback.
- **Reduced-motion mode** disables pulsing and parallax.
- **Accessibility focus indicators** in addition to neon frames (ARIA states, not color alone).

## New board requirement — Softness ↔ Contrast slider

Beyond the brief, the board requested a **single continuous slider** that blends between:

- a **softer mode** — lighter, lower-contrast, blue-tinted glass (gentler on the eyes), and
- a **sharper mode** — darker, higher-contrast, crisper neon.

Requirements:

- The control is a **gradient/continuous slider**, not discrete steps — users park it exactly where they like.
- It drives **theme tokens** (background depth, glass opacity, neon intensity, text contrast) along a single interpolated axis.
- It must never drop body text below the 4.5:1 contrast floor at any slider position.
- It persists per-user and respects reduced-motion / high-contrast OS settings.

> Note: this is distinct from the existing WCAG **high-contrast theme** (a discrete accessibility mode in [11-cross-cutting.md](11-cross-cutting.md#accessibility)). The two should compose, not conflict.

## Acceptance criteria (definition of done for the workstream)

1. A documented token set (color, radii, blur, shadow, motion curves) implementing the palette in the brief.
2. The Liquid Glass Dark Neon language applied uniformly to all primary surfaces.
3. The Softness↔Contrast gradient slider, wired to tokens, persisted, contrast-floor-safe.
4. Reduced-motion and high-contrast paths verified.
5. Side-by-side review against the reference images, approved by UX and the board.

## Workstream & ownership

- **UX Design (UXDesigner):** translate the brief + images into a concrete design-system spec — tokens, component states, and the slider's interpolation model and UX.
- **Engineering (CTO):** implement the token system and `backdrop-filter` glass, apply it across surfaces, build the slider control and replace `theme.ts` (today dark/light/system) with a **dark-only** token-driven theme, with reduced-motion/contrast fallbacks and perf budget adherence.

Tracked via child issues of MYT-516.
