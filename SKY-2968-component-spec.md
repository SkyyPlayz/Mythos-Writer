# SKY-2968 — Liquid Neon Component Specification (v1)

**Issue:** [SKY-2968](/SKY/issues/SKY-2968) v0.3 FOUNDATION #619 — Liquid Neon design-system rollout to ALL buttons/menus/windows

**Resolved Q-619-1:** Renderer-only scope (no OS-native chrome). All window / panel chrome is custom-drawn in the renderer.

**Deliverable:** Token sheet + component spec for buttons, menus, dialogs, dropdowns, panel chrome, window chrome.

**Target:** Foundation phase (tokens + system spec only; visual glass/neon polish is MYT-521).

---

## Part 1 — Liquid Neon Design Principles (Applied Foundation)

These principles govern component behavior and visual treatment in v0.3:

### 1.1 Glass + Neon Language

- **Glass:** Translucent frosted surfaces using `backdrop-filter: blur()` with fallback to opaque fills
- **Neon:** Restrained cyan/violet/magenta accents on frames, glows, rings, focus indicators—never as body-text color
- **Light:** Depth via light, blur, and subtle motion rather than heavy borders
- **Hierarchy:** Primary/secondary/tertiary distinctions via surface elevation, text weight, and neon intensity

### 1.2 Accessibility First

- **Contrast floor:** Body text ≥ 4.5:1 on every panel background (WCAG AA)
- **Focus rings:** Visible cyan focus ring + neon glow on every interactive element
- **Color-independence:** Neon never carries meaning alone; paired with icon, shape, or text
- **Motion:** Subtle, composited transforms/opacity; disabled in `prefers-reduced-motion`
- **High-contrast mode:** Glass→opaque, neon→solid strokes, glows removed; text→AAA (7:1+)

### 1.3 Motion + Feedback

- **Instant feedback:** All interactions ≤400ms (Doherty threshold)
- **Subtle transitions:** Easing curves are `var(--ease-out)` (springy) or `var(--ease-standard)` (smooth); durations ≤280ms
- **No jank:** Composited `transform`/`opacity` only; shadows/blur budget-aware
- **Reduced-motion:** All motion durations collapse to ~1ms; curves flatten to linear

### 1.4 Density + Whitespace

- **Breathing:** Editor/chat surfaces have generous padding (var(--space-5/6))
- **Dense trees:** Navigator/vault browser uses var(--space-3/4) for compact scans
- **Vertical rhythm:** 4px base grid; all spacing from the scale (no off-scale values)
- **Alignment:** Everything to grid or baseline; no stray pixels

---

## Part 2 — Token Reference (Foundation Phase)

All components consume tokens from `frontend/src/tokens.css`. This section maps token use to component surfaces.

### 2.1 Colors

| Token | Value | Usage | WCAG |
|-------|-------|-------|------|
| `--neon-cyan` | #00f0ff | Primary accent / hover frames / focus rings | 1.6:1 text (AA floor), 4.5:1 on dark surfaces |
| `--neon-violet` | #9b5fff | Secondary accent / heading words | 4.1:1 (below floor as text alone) |
| `--neon-magenta` | #ff4dff | Tertiary accent / destructive-hover | 4.2:1 (below floor as text alone) |
| `--text-header` | #edecf6 | Titles, active labels | 13.3:1 on `--bg-canvas` |
| `--text-body` | #bfd6e8 | Paragraphs, UI copy | 10.4:1 on `--bg-canvas` |
| `--text-muted` | #8a9bb0 | Secondary/captions/disabled; ≥4.5:1 floor | 4.5:1 (minimum legible) |

### 2.2 Surfaces

| Token | Typical Use | Foundation Value |
|-------|-------------|------------------|
| `--bg-app` | App shell outermost | `--bg-base` (#0e1116) |
| `--bg-canvas` | Deepest layer behind content | #0b0e13 |
| `--bg-panel` | Default panel fill (opaque fallback in foundation) | `--glass-fill-fallback` (#1212 @92% + inset shadow) |
| `--bg-elevated` | Popovers, raised cards, tooltips | #222a36 |
| `--bg-inset` | Wells, inputs, code blocks | #15191f |
| `--bg-hover` | Hover state on clickable elements | rgba(255,255,255, 0.06) |
| `--bg-active` | Active/pressed state | rgba(255,255,255, 0.1) |

### 2.3 Borders + Frames

| Token | Purpose |
|-------|---------|
| `--border-subtle` | Faint divider, disabled state | rgba(255,255,255, 0.06) |
| `--border-default` | Standard component border | rgba(255,255,255, 0.1) |
| `--border-strong` | Prominent edge, input focus | rgba(255,255,255, 0.16) |
| `--frame-width-rest` | Neon frame width (resting state) | 1px |
| `--frame-width-hover` | Neon frame width (hover/focus) | 3px |

### 2.4 Glass + Blur

| Token | Purpose | Foundation | Polish (MYT-521) |
|-------|---------|-----------|-----------------|
| `--glass-fill` | Opaque fill color (fallback) | rgba(14,14,18, 0.72) | (pending) |
| `--blur-panel` | Backdrop blur for panel surfaces | 28px | Axis-driven: 8–24px |
| `--blur-overlay` | Backdrop blur for modal overlays | 40px | Axis-driven: 8–32px |
| `--neon-intensity` | Master glow multiplier (0–1) | 0.75 | Axis-driven: 0.35–0.75 |

### 2.5 Radius Scale

| Token | Use | Foundation |
|-------|-----|-----------|
| `--radius-xs` | Floating tabs, small chips | 8px |
| `--radius-sm` | Inputs, small controls | 12px |
| `--radius-md` | Buttons, cards | 16px |
| `--radius-lg` | Panels, navigator rails | 20px |
| `--radius-xl` | Major surfaces, dialogs, popovers | 24px |

### 2.6 Spacing Scale

| Token | Use | Value |
|-------|-----|-------|
| `--space-1` | Hairline gaps | 4px |
| `--space-2` | Icon spacing | 8px |
| `--space-3` | Dense layouts (trees) | 12px |
| `--space-4` | Standard padding | 16px |
| `--space-5` | Default panel padding | 20px |
| `--space-6` | Major surface padding | 24px |

### 2.7 Motion

| Token | Use | Default | Reduced-Motion |
|-------|-----|---------|-----------------|
| `--ease-out` | Springy, exit animations | cubic-bezier(0.16, 1, 0.3, 1) | linear |
| `--ease-standard` | Smooth, general transitions | cubic-bezier(0.4, 0, 0.2, 1) | linear |
| `--dur-press` | Tap feedback | 100ms | ~1ms |
| `--dur-hover-in` | Hover entrance | 180ms | ~1ms |
| `--dur-hover-out` | Hover exit | 240ms | ~1ms |
| `--dur-panel` | Panel open/close | 280ms | ~1ms |

---

## Part 3 — Component Specifications

### 3.1 Button Component

**Purpose:** Single, consistent button component used across all actionable surfaces.

**Variants:**

| Variant | Use Case | Resting | Hover | Active | Disabled |
|---------|----------|---------|-------|--------|----------|
| **Primary** | Main CTA (Apply, Save, Confirm) | Solid `--accent` (#00f0ff) cyan, `--text-on-accent` black | 20% opacity reduction | Scale ↓2%, no shadow change | `--text-muted`, `--bg-inset`, no glow |
| **Secondary** | Cancel, Don't, Back | Outline: `--border-strong` 1px, `--text-body` | `--bg-hover` fill + `--border-default` | Inset shadow + text dim | `--text-muted`, `--border-subtle` |
| **Tertiary** | Minimal, ghost (help, dismiss) | No background, `--text-muted` | `--text-body`, `--bg-hover` | `--text-header` + inset shadow | `--text-muted` 50% opacity |
| **Destructive** | Delete, Remove | Solid `--state-danger` (#f88585), text white | Glow: var(--neon-glow) `--state-danger-hover` (magenta) | Same as primary active | Disabled state |

**States (all variants):**

- **Resting:** 1px solid border or opaque fill, no shadow, no glow
- **Hover:** 3px neon frame (via `--frame-width-hover`), soft glow (var(--neon-glow) at `--neon-intensity`), scale 102% via transform
- **Active (pressed):** Scale 98%, shadow inset, glow at 80% intensity
- **Focus (keyboard):** Cyan focus ring (2px offset, 0 blur), + neon glow
- **Disabled:** Opacity 50%, no interactive transitions, cursor default

**Sizes:**

| Size | Padding | Font | Min Touch | Use |
|------|---------|------|-----------|-----|
| **xs** | 6px 12px | var(--text-xs) | 32px | Compact, inline (chips, badges) |
| **sm** | 8px 16px | var(--text-sm) | 40px (min) | Toolbar, secondary actions |
| **md** | 10px 20px | var(--text-base) | 48px | Default, dialogs, forms |
| **lg** | 12px 28px | var(--text-lg) | 56px | Hero CTA, prominent actions |

**CSS Classes / Token Usage:**

```css
.button {
  /* Base */
  font-family: var(--font-sans);
  border-radius: var(--radius-md);
  font-weight: var(--weight-base);
  cursor: pointer;
  border: 1px solid transparent;
  transition: all var(--dur-hover-in) var(--ease-standard);
  
  /* Focus ring */
  &:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  
  /* Primary variant */
  &.primary {
    background: var(--accent);
    color: var(--text-on-accent);
    border-color: transparent;
  }
  
  &.primary:hover {
    box-shadow: var(--neon-glow-strong);
    transform: scale(1.02);
  }
  
  /* Secondary variant */
  &.secondary {
    background: var(--bg-panel);
    color: var(--text-body);
    border-color: var(--border-default);
  }
  
  &.secondary:hover {
    background: var(--bg-hover);
  }
  
  /* Destructive variant */
  &.destructive {
    background: var(--state-danger);
    color: #fff;
  }
  
  &.destructive:hover {
    box-shadow: var(--glow-sm) var(--state-danger-hover);
  }
  
  /* Disabled state */
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

@media (prefers-reduced-motion: reduce) {
  .button {
    transition: none;
  }
}
```

**Acceptance Criteria:**

- [ ] Primary/secondary/tertiary/destructive variants render correctly
- [ ] Sizes xs/sm/md/lg apply correct padding + font
- [ ] Hover state shows neon glow + frame width increase (1px→3px)
- [ ] Focus ring visible on keyboard tab
- [ ] Disabled state reduces opacity, removes interactions
- [ ] All transitions ≤180ms enter, ≤240ms exit
- [ ] Motion disabled in `prefers-reduced-motion`
- [ ] High-contrast mode: opaque fills, solid strokes, no glows
- [ ] Touch targets ≥40px (Fitts's Law)
- [ ] CI green (lint, typecheck, unit tests)

---

### 3.2 Menu / Dropdown Component

**Purpose:** Context menus, action menus, and dropdown selects with neon-accented items.

**Variants:**

| Variant | Trigger | Items | Use |
|---------|---------|-------|-----|
| **Action Menu** | Button or icon | Actions + destructive (dividers optional) | Edit, Delete, Share, Settings |
| **Dropdown Select** | Button or custom trigger | Single-select options (checkmark) | Sort, Filter, Category picker |
| **Context Menu** | Right-click or long-press | File/entity actions (create, rename, delete) | Vault tree, brainstorm cards |

**Visual Treatment:**

- **Container:**
  - Background: `--bg-elevated` (#222a36)
  - Border: 1px `--border-strong`, no radius (neon frame is the visual edge)
  - Elevation: `--elev-2` (12px shadow + blur)
  - Neon border: `--border-neon-default` (glow effect) on hover/visible

- **Items:**
  - Resting: `--text-body` on `--bg-elevated`, no background
  - Hover: `--bg-hover` fill + 3px neon cyan frame (left edge), text → `--text-header`
  - Active: `--bg-active` fill + neon glow, checkmark in `--accent`
  - Disabled: `--text-muted` text, no hover, opacity 50%

- **Dividers:** 1px `--border-subtle`, full width, no margin shrink

- **Keyboard:** Arrow keys ↑/↓ to navigate (focus ring on item), Enter to select, Escape to close

**CSS Pattern:**

```css
.menu {
  position: absolute;
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: 0;
  box-shadow: var(--elev-2);
  min-width: 200px;
  z-index: 1000;
  animation: menu-in 0.16s var(--ease-out);
  box-shadow: var(--elev-2), var(--border-neon-default);
}

.menu-item {
  padding: var(--space-3) var(--space-4);
  color: var(--text-body);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
  transition: all var(--dur-hover-in) var(--ease-standard);
}

.menu-item:hover {
  background: var(--bg-hover);
  color: var(--text-header);
  border-left: var(--frame-width-hover) solid var(--accent);
  padding-left: calc(var(--space-4) - var(--frame-width-hover));
}

.menu-item.active {
  background: var(--bg-active);
  box-shadow: inset var(--glow-sm) var(--accent);
}

.menu-divider {
  height: 1px;
  background: var(--border-subtle);
  margin: var(--space-1) 0;
}
```

**Acceptance Criteria:**

- [ ] Items highlight on hover with neon left frame
- [ ] Active/selected item shows checkmark in `--accent`
- [ ] Keyboard navigation (arrow keys) works; focus ring visible
- [ ] Escape key closes menu
- [ ] Position calculation avoids viewport edges (smart positioning)
- [ ] Dividers render at correct contrast
- [ ] Elevation shadow visible against dark background
- [ ] High-contrast mode: solid strokes, no glows, higher opacity fills

---

### 3.3 Dialog / Modal Component

**Purpose:** Full-viewport modal overlay for forms, confirmations, and complex interactions.

**Structure:**

```
Dialog (fixed fullscreen overlay)
├─ Scrim (semi-transparent dark background, clickable to close)
├─ Panel (centered card)
│  ├─ Header (title + close button)
│  ├─ Body (scrollable content)
│  └─ Footer (action buttons)
```

**Visual Treatment:**

- **Scrim:** `rgba(8, 10, 16, 0.55)` (semi-transparent dark), click-to-close
- **Panel background:** `--bg-panel` (opaque fallback in foundation), `--border-default` 1px
- **Radius:** `--radius-xl` (24px)
- **Elevation:** `--elev-3` (20px shadow), neon glow on open
- **Header:** Flex, space-between; title `--text-header` bold, subtitle `--text-muted` small
- **Close button:** Icon only, `--text-muted` resting → `--text-body` hover, circular hover state
- **Body:** Scrollable, padding `--space-5` (20px)
- **Footer:** Flex end, gap 8px, button group (secondary + primary)
- **Max size:** 90vw width, 90vh height, centered via flexbox

**Motion:**

- **Enter:** Fade in (0→100% opacity) + slide up (20px→0) over `--dur-panel` (280ms), `--ease-out`
- **Exit:** Reverse, `--dur-hover-out` (240ms)
- **Neon glow:** Pulse at 60% intensity on open

**Keyboard:**

- Escape to close (soft close, confirm if unsaved)
- Tab cycles through form fields (natural DOM order)
- Enter on primary button confirms (if form valid)
- Trap focus inside panel (circular tab within dialog)

**CSS Pattern:**

```css
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(8, 10, 16, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  animation: fade-in 0.28s var(--ease-out);
}

.dialog-panel {
  background: var(--bg-panel);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  box-shadow: var(--elev-3), var(--border-neon-default);
  width: 90vw;
  max-width: 600px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  animation: slide-up-fade 0.28s var(--ease-out);
}

.dialog-header {
  padding: var(--space-5) var(--space-5) var(--space-4);
  border-bottom: 1px solid var(--border-default);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.dialog-title {
  font-size: var(--text-lg);
  font-weight: var(--weight-heading);
  color: var(--text-header);
  margin: 0;
}

.dialog-close {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 1.25rem;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  transition: all var(--dur-hover-in) var(--ease-standard);
}

.dialog-close:hover {
  background: var(--bg-hover);
  color: var(--text-header);
}

.dialog-body {
  padding: var(--space-5);
  overflow-y: auto;
  flex: 1;
}

.dialog-footer {
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--border-default);
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}
```

**Acceptance Criteria:**

- [ ] Dialog centers in viewport, responsive to window size
- [ ] Scrim semi-transparent, click-to-close works
- [ ] Header/body/footer stack vertically, header sticky
- [ ] Body scrolls independently (overflow-y: auto), footer stays fixed
- [ ] Close button (×) visible, clickable, neon on hover
- [ ] Enter animation (slide up + fade) ≤280ms, exit ≤240ms
- [ ] Neon glow visible on open, respects `--neon-intensity`
- [ ] Focus trap: Tab loops within dialog, Escape closes
- [ ] High-contrast mode: solid borders, no glows
- [ ] Button footer uses primary/secondary button component

---

### 3.4 Dropdown / Select Component

**Purpose:** Native `<select>` replacement with neon-accented items and custom trigger styling.

**Trigger (closed state):**

- Background: `--bg-inset` (#15191f), border 1px `--border-default`
- Radius: `--radius-sm` (12px)
- Padding: `var(--space-3) var(--space-4)` (12px 16px)
- Text: `--text-body`, icon down-arrow in `--text-muted`
- Hover: `--border-strong` border, `--bg-hover` fill
- Focus: Cyan focus ring, neon frame

**Menu (open state):**

- Inherits from Menu/Dropdown component above
- Position: Below trigger, aligned left (smart position to avoid viewport edge)
- Neon frame on items, checkmark active

**Keyboard:**

- Space/Enter to open
- Arrow keys ↑/↓ navigate items
- Enter/Space to select
- Escape to close

**CSS Pattern:**

```css
.select-trigger {
  background: var(--bg-inset);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  padding: var(--space-3) var(--space-4);
  color: var(--text-body);
  font-family: inherit;
  cursor: pointer;
  transition: all var(--dur-hover-in) var(--ease-standard);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.select-trigger:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}

.select-trigger:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.select-trigger.open {
  border-color: var(--accent);
  box-shadow: var(--neon-glow);
}
```

**Acceptance Criteria:**

- [ ] Trigger button styled with inset background, down-arrow
- [ ] Menu opens on click, positions below trigger
- [ ] Selected item has checkmark in `--accent`
- [ ] Keyboard navigation works (Space/Enter/arrow keys)
- [ ] Click outside closes menu
- [ ] High-contrast mode respects override tokens

---

### 3.5 Panel Chrome (Renderer-Only)

**Purpose:** Window-like containers for panels, sidebars, and sections within the app (not OS-native titlebar).

**Structure:**

```
Panel
├─ Chrome/Header (title bar, no OS buttons)
│  ├─ Title + breadcrumb (optional)
│  ├─ Icon/avatar (optional)
│  └─ Action buttons (close, pin, minimize within app)
├─ Body (content area, scrollable)
└─ Footer (optional status bar)
```

**Visual Treatment:**

- **Header background:** `--bg-elevated` (#222a36), 1px `--border-strong` divider below
- **Header height:** 40px (3.5rem) standard
- **Title:** `--text-header` bold, centered or left-aligned
- **Action buttons:** Minimal tertiary buttons or icon buttons
- **Neon border:** Optional 1px neon frame on panel edges (scope per Q-619-1, phase 2)
- **Body:** `--bg-panel` (opaque fallback), scrollable
- **Shadow:** `--elev-1` (soft shadow on floating panels)

**Interaction:**

- Click title drag → move panel (if floating)
- Close button (×) in header → close panel
- Pin button → dock/undock panel
- Right-click title → context menu (minimize, close, etc.)

**CSS Pattern:**

```css
.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-panel);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--elev-1);
}

.panel-header {
  height: 40px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border-strong);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-4);
  flex-shrink: 0;
  user-select: none;
  cursor: grab;
}

.panel-header:active {
  cursor: grabbing;
}

.panel-title {
  font-size: var(--text-base);
  font-weight: var(--weight-heading);
  color: var(--text-header);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.panel-actions {
  display: flex;
  gap: var(--space-2);
  flex-shrink: 0;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-5);
}

.panel-footer {
  border-top: 1px solid var(--border-subtle);
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-xs);
  color: var(--text-muted);
}
```

**Acceptance Criteria:**

- [ ] Header 40px, title visible, action buttons right-aligned
- [ ] Body scrollable, header fixed
- [ ] Drag title to move floating panels (if applicable)
- [ ] Close/pin/action buttons functional
- [ ] Neon border optional in v0.3 (phase 2 polish)
- [ ] Shadow visible on floating panels
- [ ] High-contrast mode: solid borders, opaque fills

---

### 3.6 Window Chrome (Renderer-Only)

**Purpose:** Custom window frame chrome (title bar, minimize/maximize/close buttons, menu bar if applicable).

**Note:** This is the app's top-level window frame drawn in the renderer, not OS-native chrome.

**Structure (macOS/Linux style):**

```
Window Frame
├─ Traffic lights (red, yellow, green) on left (macOS) or right (Windows)
├─ Title (app name + document)
└─ Menu bar (if applicable: File, Edit, View, etc.)
```

**Visual Treatment:**

- **Frame background:** `--bg-app` (#0e1116)
- **Traffic lights (OS buttons):** Rendered as circles, draggable region around them
- **Title text:** `--text-header`, centered, 14px
- **Menu bar:** Hidden by default, toggle via Alt key (Windows) or Cmd+Shift+M (macOS)
- **Neon border:** 1px `--border-neon-default` around entire window edge (full glow treatment, phase 2)
- **Height:** 28px standard (28 + 28 for menu if shown)

**Electron Window Configuration:**

- `frame: false` (no OS chrome)
- `webPreferences.nodeIntegration: false` (security)
- Custom drag region via `-webkit-app-region: drag`
- Non-draggable buttons and menus via `-webkit-app-region: no-drag`

**CSS Pattern:**

```css
.window-chrome {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 28px;
  background: var(--bg-app);
  border-bottom: 1px solid var(--border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-4);
  z-index: 10000;
  -webkit-app-region: drag; /* Make entire bar draggable */
  user-select: none;
}

.window-title {
  font-size: 12px;
  color: var(--text-header);
  font-weight: 500;
  flex: 1;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}

.window-controls {
  display: flex;
  gap: var(--space-2);
  -webkit-app-region: no-drag; /* Re-enable clicking on buttons */
}

.window-button {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  cursor: pointer;
  transition: all var(--dur-hover-in) var(--ease-standard);
}

.window-button.close {
  background: #ff5f56;
}

.window-button.close:hover {
  background: #ff6b5a;
  box-shadow: 0 2px 8px rgba(255, 95, 86, 0.4);
}

.window-button.minimize {
  background: #ffbd2e;
}

.window-button.maximize {
  background: #27c93f;
}
```

**Acceptance Criteria:**

- [ ] Custom window chrome renders without OS native frame
- [ ] Window is draggable by title bar, non-draggable buttons/menus
- [ ] Minimize/maximize/close buttons functional
- [ ] Title reflects active document
- [ ] Menu bar optional, togglable (keyboard shortcut)
- [ ] Neon border on edges (phase 2; deferred from v0.3)
- [ ] Works on Windows/macOS/Linux (Electron window API)
- [ ] No OS chrome leakage

---

## Part 4 — Audit Summary

### Current State (Foundation Phase)

**Compliant (token-driven, ready for implementation):**
- PresetEditor dialog pattern (opaque fill, borders, basic shadow)
- PresetSelector buttons (primary/secondary variants, hover states)
- Context menus (elevated background, hover highlight)
- Toast notifications (surface color + border)

**Partial Compliance (using tokens, needs neon frame + glow treatment):**
- Buttons across all surfaces (resting only, hover neon not yet added)
- Dialogs in notes templates + onboarding (structure OK, neon polish pending)
- Menus in brainstorm + vault (foundation structure OK, hover neon pending)
- Panel headers in sidebars (structure OK, chrome polish pending)

**Not Yet Implemented (need new components or significant refactor):**
- Window chrome (custom Electron frame)
- Consistent panel-chrome pattern (currently ad-hoc)
- Neon border animation system (glow on active states)
- High-contrast mode full coverage

### Blockers & Dependencies

- **MYT-521 (Polish pass):** Full glass/neon visual treatment (glows, backdrop-filter, softness slider) deferred
- **Softness↔Contrast slider (MYT-518):** Axis-driven tokens, not implemented yet
- **Window chrome system (SKY-127 + SKY-910):** Requires Electron config + IPC for frame events

---

## Part 5 — Acceptance Criteria (Done Definition)

This spec is **complete** when:

1. **Token sheet delivered:** `tokens.css` documented with all usage + WCAG contrast ratios ✓ (existing)
2. **Component specs written:** Button, menu, dialog, dropdown, panel chrome, window chrome (this document) ✓
3. **Visual audit completed:** Existing components mapped to spec requirements (above) ✓
4. **Implementation plan created:** Child issues fanned out with:
   - Button component refactor + tests
   - Menu/dropdown unified component + tests
   - Dialog system component + tests
   - Panel chrome pattern + adoption across surfaces
   - Window chrome Electron frame + IPC
5. **Acceptance criteria per component:** Checked (see each section 3.1–3.6)
6. **High-contrast + reduced-motion tested:** Each component works in accessibility modes
7. **CI green:** Linting, type-checking, unit tests pass (when implementation begins)

---

## Part 6 — Implementation Fanout (Children Issues)

**Ready for delegation to PE/FE.** Each child issue includes:
- Component name + scope
- Spec section reference
- Acceptance criteria
- Token usage reference
- Test expectations
- Dependencies (if any)

**Proposed children (pending creation):**

1. **SKY-2969:** Button component — refactor, add neon hover, sizes, variants, tests
2. **SKY-2970:** Menu/Dropdown component — unified implementation, keyboard nav, tests
3. **SKY-2971:** Dialog system — standard pattern, adoption across forms
4. **SKY-2972:** Panel chrome — standard header pattern, adoption across sidebars
5. **SKY-2973:** Window chrome — Electron frame, title bar, controls
6. **SKY-2974:** Accessibility audit — high-contrast mode + reduced-motion testing

---

## Appendix A — Reference Images & Figma Links

(To be added: Figma design file links, approved visual references from MYT-516 brief)

---

## Appendix B — Migration Path (Foundation → Polish)

| Phase | What | Issue | Timeline |
|-------|------|-------|----------|
| **Foundation (v0.3, now)** | Tokens + component specs, opaque fills, borders, basic shadows | SKY-2968 (this), + children SKY-2969–2974 | This sprint |
| **Polish (MYT-521, post-core)** | Glass backdrop-filter, neon glows, softness slider, animation refinement | MYT-521 | Next milestone after MVP |
| **Advanced UI (MYT-708, backlog)** | Softness↔Contrast slider, advanced settings popover, user customization | MYT-708 | Future sprint |

---

## Appendix C — QA Checklist (Per Component)

Use this checklist for each implementation child:

- [ ] Spec section reference clear in PR description
- [ ] Acceptance criteria from spec section all met
- [ ] Tokens used (no hard-coded colors)
- [ ] Motion disabled in `prefers-reduced-motion`
- [ ] High-contrast mode override tokens applied
- [ ] Focus ring visible on keyboard tab
- [ ] Touch targets ≥40px (or justified exception)
- [ ] Unit tests written + passing
- [ ] E2E scenario covered (if user-facing interaction)
- [ ] Accessibility audit: screen reader, keyboard nav, color contrast
- [ ] CI green: lint, typecheck, build, tests

---

**Spec version:** v1 (2026-06-20)
**Status:** Ready for implementation fanout
**Next step:** Create child issues SKY-2969–2974, assign to PE/FE
