# Visual Design System — Liquid Neon

> **CEO decision (MYT-516):** Mythos Writer's official visual identity is **Liquid Neon** — translucent frosted-glass surfaces with restrained neon accents, applied consistently across every surface of the app.

## Board decisions (MYT-516 follow-up)

The board confirmed three points after reviewing the direction:

- **Dark-only.** Liquid Neon is the **single app theme** — the previous light/system theme options are dropped. The WCAG **high-contrast** accessibility theme is retained (it composes with this theme; see [11-cross-cutting.md](11-cross-cutting.md#accessibility)).
- **Timing: phased (foundation now, polish later).** The board approved starting the **foundation now** — the design-system spec and a dark-only **token layer** (CSS variables) that in-flight components adopt as they're built, avoiding a costly second restyle pass. The **full glass/neon visual polish** and the **Softness↔Contrast slider** are deferred to the **next milestone after current core work lands** (see [10-releases-and-roadmap.md](10-releases-and-roadmap.md)). Neither phase blocks in-flight MVP work.
- **Dedicated designer.** A **UX designer** (already on the roster) owns the design-system spec; engineering implements.

This document is the product-level direction. The full design brief lives in
[`Ui-Disign-Goal`](Ui-Disign-Goal); annotated reference images live in
[`Liquid-Neon-theme-examples/`](<Liquid-Neon-theme-examples/Example photos.md>).
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
2. The Liquid Neon language applied uniformly to all primary surfaces.
3. The Softness↔Contrast gradient slider, wired to tokens, persisted, contrast-floor-safe.
4. Reduced-motion and high-contrast paths verified.
5. Side-by-side review against the reference images, approved by UX and the board.

## Workstream & ownership

- **UX Design (UXDesigner):** translate the brief + images into a concrete design-system spec — tokens, component states, and the slider's interpolation model and UX.
- **Engineering (CTO):** implement the token system and `backdrop-filter` glass, apply it across surfaces, build the slider control and replace `theme.ts` (today dark/light/system) with a **dark-only** token-driven theme, with reduced-motion/contrast fallbacks and perf budget adherence.

Tracked via child issues of MYT-516.

---

## Advanced UI Customization — Approved (MYT-708, 2026-05-28)

> **Board decision (MYT-708):** Extend the Softness↔Contrast slider with a full **Advanced UI settings** popover giving users per-value sliders, per-element color pickers, a user-changeable background image, and a reset-to-default button.

### Background: what the slider does today

The Softness↔Contrast slider (`frontend/src/themeAxis.ts` + `ThemeContrastSlider.tsx`) maps one `0–100` position onto three CSS token groups, persisted as `AppSettings.themeAxis` (default 0.4), contrast-floor-guarded:

| # | Value | CSS var | Soft → Sharp |
|---|-------|---------|--------------|
| 1 | Backdrop blur | `--lg-blur` / `--blur-panel` | 24px → 8px |
| 2 | Glass fill opacity | `--lg-glass` / `--glass-fill` | 0.58 → 0.90 |
| 3 | Neon glow intensity | `--lg-neon` / `--neon-intensity` | 0.60 → 0.35 |

### Approved scope

#### A. Advanced settings button + popover
- **"Advanced" button** in the bottom-right corner of the main slider; opens a popover with the controls below.
- Main one-knob slider stays as the default; advanced controls are opt-in.
- Main and advanced sliders stay in sync; advanced can break from the single-axis coupling.

#### B. Per-value sliders (the three main-slider values, decoupled)
1. Backdrop blur
2. Glass fill opacity
3. Neon glow intensity

#### C. Background (image-first, board clarification)
4. **Background image** — user can choose/upload an image as the app background; controls for fit (cover/contain/tile), position, and a **darkening scrim/overlay** to keep text legible over any image.
5. **Background base color** (`--bg-base` / `--bg-canvas`) — used when no image is set, and as the scrim color.
6. **Background vignette intensity** (`--bg-vignette`).

#### D. Additional sliders (board confirmed: include)
7. **Text contrast level** (`--text-header` / `--text-body` / `--text-muted`) — hard-clamped at 4.5:1 floor.
8. **Neon frame width** (`--frame-width-rest` / `--frame-width-hover`).
9. **Border strength** (`--border-default` / `--border-strong`).

#### E. Per-element color pickers
- Body & header **text color**, **accent/button** color, **neon border/frame** colors (`--neon-cyan/violet/magenta`), and the background base color (shared with C5).

#### F. Reset to default
- One **"Reset to default"** button restoring every advanced value, color, and background image to shipped defaults.

### Hard constraints

- **Contrast floor:** body text must resolve ≥ 4.5:1 at every setting AND over any background image (enforced via scrim + `themeAxis.ts` contrast guard). Pickers/images that would violate this are clamped or auto-scrimmed.
- **Compose with, never override**, the high-contrast theme and `prefers-contrast` / `prefers-reduced-transparency` / `prefers-reduced-motion`.
- **Persist per-user** in `AppSettings`. Background images stored locally (per-vault/app dir), not inlined into settings JSON; applied on load and live on change.

### Architecture

Add a general **per-token override layer** in `AppSettings` (e.g. `themeOverrides`) plus a `backgroundImage` ref, layered beneath the high-contrast overlay by cascade, with the contrast guard applied to the resolved palette + scrim. Single-axis slider stays the default; overrides are advanced. Image storage/IPC handled in electron-main with a safe local path + size guard.

### Acceptance criteria

1. "Advanced" button opens a popover from the existing slider component with all controls listed above.
2. Per-value sliders (A–D) decouple from the main axis and persist independently.
3. Background image upload/pick, fit, position, and scrim controls work; image survives app restart.
4. Per-element color pickers cover text, accent/button, neon borders, and background base.
5. "Reset to default" restores all advanced values and removes any custom background image.
6. Body text contrast ≥ 4.5:1 enforced at every combination of settings and over any background image.
7. High-contrast theme + `prefers-contrast` / `prefers-reduced-motion` compose correctly.
8. CI (`ci`, `build-linux`, `build-macos`) stays green.

### Workstream (MYT-708 children)

- **UXDesigner** — design spec for popover layout, control ranges, background-image picker UX, color-picker UX, contrast-guard behavior over images + picked colors, reset semantics; update this document with spec details.
- **CTO / FrontendDev** — implement override layer + background-image upload/persist/render + advanced popover + sliders + pickers + reset; extend `AppSettings`; contrast-floor tests; CI green. Blocked by UXDesigner spec.
- **GitHub Manager** — track implementation progress via GitHub issue; sync plan state as children complete.

Tracked via GitHub issue linked from Paperclip MYT-717.
