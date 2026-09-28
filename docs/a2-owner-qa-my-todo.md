# A2 Owner Q&A — My Todo List (rounded window chrome)

**Status:** OPEN — needs Skyy decision  
**PR:** https://github.com/SkyyPlayz/Mythos-Writer/pull/1638 (draft)  
**Branch tip:** `66ae9ec1` (`66ae9ec13972eabf98fe3dad1fc69e5a93ed4631`) on `cursor/mw-fidelity-a2`  
**Rule:** Creed #3 / A2 SCOPE #2 — never ship square quietly; escalate when Windows/Electron blocks.

## Ask

Opaque frameless windows (B4-2 / PERFORMANCE.md — **no** `transparent: true`) cannot reliably get OS-level rounded corners on **Windows** and **Linux**. Electron `roundedCorners: true` is honored on **macOS**; Win11 DWM rounding for opaque frameless is inconsistent / unavailable in our Electron build without reintroducing transparency (forbidden).

### What we shipped as the chase (this tip)

1. `BrowserWindow({ frame: false, roundedCorners: true, backgroundColor: '#07090f' })` — opaque kept.
2. Renderer clip: `.desktop-shell` / `#root` `border-radius: 12px` + `overflow: hidden` so content corners match the intended chrome.

### Evidence

| Platform | OS frame | Content clip |
|---|---|---|
| macOS | Electron `roundedCorners` applies | 12px shell clip |
| Windows 11 | Frameless opaque stays **square** at DWM edge | 12px shell clip only (square OS frame remains) |
| Linux | Frameless opaque stays **square** | 12px shell clip only |

Transparent + CSS-radius would round visually but **violates B4-2** (GPU compositing).

### Options for Skyy

| ID | Decision |
|----|----------|
| **A2-Q1-A** | Accept content-clip radius + macOS OS rounding; Windows/Linux square OS frame is an approved exception (document in release notes). |
| **A2-Q1-B** | Allow a scoped Windows-only exception to B4-2 (`transparent: true` + opaque fill) solely for OS-visible rounded corners — needs PERFORMANCE sign-off. |
| **A2-Q1-C** | Drop visual radius chase; keep square until Electron/Windows supports opaque frameless rounding — tip holds for other A2 items only after you confirm. |

Default while waiting: tip keeps chase (A) visually; do **not** tip-freeze as “rounded done” on Windows until you pick.
