# SKY-2970 — Onboarding/First-Run Redesign (v0.3)

**Status:** UX Spec (in progress)  
**Owner:** UXDesigner  
**Last updated:** 2026-06-20  

---

## Executive Summary

Redesign the first-run onboarding flow from 4 paths (Default/Blank/Import/Sample) to **3 paths** (Quick / Custom / Import). The new flow balances discoverability with power:
- **Quick Start** — one-click, uses a "Recommended" template (today's Quick Start setup)
- **Custom** — fine-grained control: pick install location + choose template or start blank
- **Import / Open Existing** — open a Mythos Writer vault, import Obsidian vaults (Notes + Story separately), or import Word docs (.docx) as stories

---

## Design Lenses Applied

- **Hick's Law & Choice Overload** — 3 paths is simpler than 4; path names are action-oriented (Quick/Custom/Import) vs. descriptive (Default/Blank/Sample)
- **Progressive Disclosure** — Quick Start is fast-path; Custom reveals power; Import is a distinct task
- **Affordances & Signifiers** — each path card shows an icon, headline, and 1-line subtext; hover/focus is crisp
- **Mental Models** — "Quick" = I want to start NOW; "Custom" = I control everything; "Import" = I have files
- **Recognition over Recall** — no confusing terminology; icons reinforce the action
- **Doherty Threshold** — Quick Start path completes in <2 seconds; Custom picker is snappy with inline validation
- **Gestalt (Proximity, Similarity)** — path cards are uniform; Import card visually distinct (lower emphasis, third option)
- **WCAG POUR** — target 4.5:1 text contrast; keyboard navigable; no color-only affordances

---

## Path 1: Landing Screen

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  Mythos Writer                               [? Help] [x]│
├─────────────────────────────────────────────────────────┤
│                                                         │
│  👋 Welcome to Mythos Writer                           │
│  Let's set up your story workspace in seconds.         │
│                                                         │
│  ┌─────────────────────────┐  ┌─────────────────────┐ │
│  │  ⚡ Quick Start         │  │  ⚙️  Custom         │ │
│  │  Get started in one tap │  │ Customize everything│ │
│  │  [Start >]              │  │ [Setup >]           │ │
│  └─────────────────────────┘  └─────────────────────┘ │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │  📂 Import or Open Existing                       │ │
│  │  Open a vault or import Obsidian / Word files    │ │
│  │  [Open >]                                         │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  [Restart an existing project?]  [Learn more]          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Acceptance Criteria — Landing Screen

1. **AC-L-01**: Three path cards render in order (Quick / Custom / Import); equal visual weight for Quick & Custom, Import card is visually distinct (lower opacity / smaller, or subtle secondary styling).
2. **AC-L-02**: Each card has an emoji icon (⚡🎯📂 TBD in design), headline, subtext, and CTA button.
3. **AC-L-03**: Buttons have clear focus ring (WCAG AA); button text is action-oriented ("Start", "Setup", "Open").
4. **AC-L-04**: Text contrast ≥ 4.5:1 (Liquid Neon glass background).
5. **AC-L-05**: No default focus; first path card gets focus on tab; Tab cycles through all three cards.
6. **AC-L-06**: Clicking any card enters that path; no intermediate confirmation.
7. **AC-L-07**: "Restart an existing project?" link (low-emphasis) at bottom; clicking opens a file picker to select a prior .mythos-project folder.
8. **AC-L-08**: "Learn more" link (low-emphasis) opens a help/docs modal or external page (TBD with CEO).

---

## Path 1.1: Quick Start (Fast Path)

### Behavior

User clicks "Quick Start" button → **immediate onboarding completion**:
1. Auto-creates a default vault at `~/Documents/MythosWriter/` (or macOS/Windows equivalent).
2. Seeds the "Recommended" template (= current Quick Start state: blank Story Vault + basic Notes structure).
3. Switches to main app UI.

### Acceptance Criteria — Quick Start

1. **AC-Q-01**: Clicking "Start" on Quick Start card goes directly to app UI (no intermediate screen).
2. **AC-Q-02**: Default vault path is OS-appropriate (Windows → Documents; macOS → Documents; Linux → ~/Documents).
3. **AC-Q-03**: Vault is created with `manifest.json`, folder structure (Story/Notes), and starter template.
4. **AC-Q-04**: App opens with the new vault active; first scene/note is ready for editing.
5. **AC-Q-05**: If a vault already exists at the default path, **append a number** (MythosWriter-2, -3, etc.) and use that instead (no error/retry).
6. **AC-Q-06**: UI does not flash "loading" or show a progress bar; transition feels instant (<400ms perceived latency).

---

## Path 2: Custom Setup

### Screen 1: Install Location Picker

```
┌─────────────────────────────────────────────────────────┐
│  Mythos Writer Setup                          [? Help] [x]│
├─────────────────────────────────────────────────────────┤
│  Custom Setup (Step 1 of 2)                             │
│  ─────────────────────────────────────────────────────── │
│                                                         │
│  Where should we save your vault?                       │
│                                                         │
│  📂 Suggested Locations:                                │
│  ☐ Documents/                                           │
│  ☐ Desktop/                                             │
│  ☐ OneDrive/ (if present)                               │
│  ☐ [Browse…]                                            │
│                                                         │
│  Or paste a path:                                       │
│  ┌───────────────────────────────────────┐              │
│  │ ~/Documents/MyStories                 │  ✓ (valid) │
│  └───────────────────────────────────────┘              │
│                                                         │
│  📝 Vault name (auto from path):                        │
│  ┌───────────────────────────────────────┐              │
│  │ MyStories                             │              │
│  └───────────────────────────────────────┘              │
│                                                         │
│                                   [Back] [Next >]       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Inline Validation (Path Field)

| State | Appearance | Message |
|-------|-----------|---------|
| idle | neutral | no message |
| validating | spinner | "Checking…" |
| valid | ✓ green | "Ready" |
| new-path | ✓ green | "New folder will be created" |
| not-writable | ⚠ orange | "Folder exists but isn't writable" |
| conflict-mythos | ✗ red | "A Mythos vault already exists here" |
| path-too-long | ✗ red | "Path is too long (max 200 chars on Windows)" |

### Screen 2: Template Picker

```
┌─────────────────────────────────────────────────────────┐
│  Mythos Writer Setup                          [? Help] [x]│
├─────────────────────────────────────────────────────────┤
│  Custom Setup (Step 2 of 2)                             │
│  ─────────────────────────────────────────────────────── │
│                                                         │
│  What template would you like to start with?            │
│                                                         │
│  ┌──────────────────────────┐  ┌──────────────────────┐│
│  │  ✨ Recommended           │  │  📝 Start Blank     ││
│  │  (today's Quick Start)    │  │  Empty Story Vault, ││
│  │  • Blank story            │  │  basic Notes        ││
│  │  • Basic notes structure  │  │  [Select]           ││
│  │  [Selected ✓]             │  │                     ││
│  └──────────────────────────┘  └──────────────────────┘│
│                                                         │
│  (Sidenote: "Library" of templates like Novel/          │
│   Screenplay/Short is deferred to post-v0.3.)           │
│                                                         │
│                                   [Back] [Finish]       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Acceptance Criteria — Custom Setup

1. **AC-C-01**: Screen 1 displays OS-suggested folder locations (Documents, Desktop, OneDrive if mounted, iCloud if available).
2. **AC-C-02**: "Browse…" button opens a native folder picker (dialog).
3. **AC-C-03**: Manual path input field supports auto-expansion of `~`, `.`, relative paths; paths resolve to absolute before validation.
4. **AC-C-04**: Inline validation runs on input change (with 300ms debounce); IPC to main process checks folder state.
5. **AC-C-05**: Valid path → green checkmark + "Ready"; invalid state → red icon + error message (see table above).
6. **AC-C-06**: Vault name field auto-populates from the last path segment; user can edit freely.
7. **AC-C-07**: Screen 2 shows two options: "Recommended" template (highlighted/selected by default) + "Start Blank".
8. **AC-C-08**: Clicking [Next] from Screen 1 with a valid path advances to Screen 2.
9. **AC-C-09**: Clicking [Finish] from Screen 2 creates the vault, seeds the template, and enters the app.
10. **AC-C-10**: [Back] button returns to prior screen; state is preserved (path and template choice).
11. **AC-C-11**: Keyboard: Tab navigates all fields; Enter submits (or Spacebar on buttons).

---

## Path 3: Import / Open Existing

### Screen: Import Picker

```
┌─────────────────────────────────────────────────────────┐
│  Mythos Writer — Import                      [? Help] [x]│
├─────────────────────────────────────────────────────────┤
│  Import or Open                                         │
│  ─────────────────────────────────────────────────────── │
│                                                         │
│  📂 Open existing Mythos vault:                          │
│  [Browse…] or paste path:                               │
│  ┌───────────────────────────────────────┐              │
│  │ ~/Documents/MyVault                   │ ✓            │
│  └───────────────────────────────────────┘              │
│                                                         │
│  📋 Import from Obsidian:                               │
│  Slot 1 (Notes Vault): [Browse…]                        │
│  ┌───────────────────────────────────────┐              │
│  │ ~/Obsidian/Worldbuilding/             │ ✓            │
│  └───────────────────────────────────────┘              │
│                                                         │
│  Slot 2 (Story Vault): [Browse…]                        │
│  ┌───────────────────────────────────────┐              │
│  │ (optional)                            │              │
│  └───────────────────────────────────────┘              │
│                                                         │
│  📄 Import Word documents (.docx):                      │
│  [Browse…] Select one or more .docx files               │
│  ┌───────────────────────────────────────┐              │
│  │ (none selected)                       │              │
│  └───────────────────────────────────────┘              │
│  ⓘ Word files become stories in Story Vault             │
│                                                         │
│  💡 Tip: Only one action will be performed. If you      │
│     choose multiple, the first valid one will run.      │
│                                                         │
│                    [Cancel]  [Import / Open]            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Inline Validation — Import Fields

| Field | Valid | Invalid | Error Message |
|-------|-------|---------|---------------|
| MW vault path | folder has manifest.json | folder doesn't exist or no manifest | "Not a Mythos vault folder" |
| Obsidian path (Notes/Story) | folder exists + has .md files | doesn't exist or empty | "Folder doesn't exist or is empty" |
| Word docs | .docx files exist | file not found or wrong ext | "File not found or not a Word doc" |

### Acceptance Criteria — Import Screen

1. **AC-I-01**: Three independent sections: "Open existing MW vault", "Import Obsidian" (2 slots), "Import Word docs".
2. **AC-I-02**: Each section has a [Browse…] button (opens native file/folder picker) and a text input field.
3. **AC-I-03**: MW vault field validates: folder must contain `manifest.json` (Mythos signature).
4. **AC-I-04**: Obsidian slots validate: folder must exist and contain at least one .md file. Slots are optional (either or both can be empty).
5. **AC-I-05**: Word docs field allows multi-select (.docx files only). Shows file count + names in a scrollable list.
6. **AC-I-06**: Inline validation shows: green ✓ = valid; red ✗ = invalid; empty = not yet picked.
7. **AC-I-07**: At least one field must be filled before [Import / Open] is enabled.
8. **AC-I-08**: Tip/info text clarifies that only **one** import action runs per wizard flow (first valid path wins).
9. **AC-I-09**: [Import / Open] button triggers the import process; IPC to main process handles file I/O.
10. **AC-I-10**: [Cancel] returns to landing screen.
11. **AC-I-11**: Keyboard: Tab navigates all fields; Enter submits.

### Import Success / Error States

#### Success Flow

After [Import / Open] click:
1. **Progress screen** (optional): "Importing…" with a spinner; real files being read/written.
2. **Completion**: app enters main UI with the imported/opened vault active.

#### Error States

- **MW vault not found**: show error modal "That folder doesn't contain a Mythos vault. Please choose another or use Import path."
- **Obsidian import fails** (e.g., corrupt metadata): show error modal "Could not read that Obsidian vault. Verify folder path and try again."
- **Word doc corruption**: show error modal "Could not read `filename.docx`. File may be corrupted. Try another."
- **Path validation error** (not writable, too long): inline error in field + [Import / Open] disabled until fixed.

### Acceptance Criteria — Error States

1. **AC-E-01**: If MW vault path invalid, show modal error + [Try Again] button (stays on Import screen).
2. **AC-E-02**: If Obsidian slot invalid, inline error under that slot; user can fix and retry.
3. **AC-E-03**: If Word docs unreadable, show modal error with filename + [Retry] button.
4. **AC-E-04**: All errors are user-friendly; no stack traces or technical jargon.
5. **AC-E-05**: Error modals have a clear [OK] or [Try Again] button to dismiss/recover.

---

## Visual Design & Theming

### Tokens (Liquid Neon)

When [SKY-2619](/SKY/issues/SKY-2619) (Liquid Neon tokens) lands, apply:

- **Background**: `--bg-canvas` (dark glass)
- **Panel backgrounds**: `--lg-glass-fill` with `backdrop-filter: blur(var(--lg-blur))`
- **Text**: `--text-body` (4.5:1 contrast minimum)
- **Accent buttons**: `--neon-cyan` or `--neon-violet` with soft glow
- **Borders**: `--frame-width-rest` (1–2px neon outline on focus)
- **Disabled state**: reduced opacity, `--text-muted`

### Layout

- **Canvas**: centered column, max-width ~600px (responsive; mobile/tablet: full-width with margins).
- **Spacing**: use token scale (8px, 12px, 16px, 24px, 32px).
- **Cards**: uniform radii (`--radius-lg`), consistent shadow depth.
- **Empty state**: inline placeholder text or icon; same contrast rules apply.

### Motion

- **Transitions**: fade-in on path card hover (~100ms); button press feedback via `transform: scale(0.98)`.
- **Validation feedback**: inline spinner (200–300ms debounce before showing).
- **Reduced motion**: `prefers-reduced-motion` media query disables scale/spin effects; show static checkmarks/X icons instead.

---

## Acceptance Criteria — Visual & A11y

1. **AC-V-01**: All text ≥ 4.5:1 contrast (WCAG AA) on glass backgrounds.
2. **AC-V-02**: Focus rings are visible (≥ 3:1 contrast) on all interactive elements.
3. **AC-V-03**: No color-only affordances (e.g., icons always pair with text or labels).
4. **AC-V-04**: Reduced-motion mode disables animations; static alternatives render.
5. **AC-V-05**: High-contrast theme (WCAG AAA) is composable with Liquid Neon tokens (when available).
6. **AC-V-06**: All interactive elements are ≥ 44×44px (touch target size).
7. **AC-V-07**: Hover/focus states are crisp and immediate (no delayed feedback).
8. **AC-V-08**: Empty state (e.g., Word docs field before selection) shows clear placeholder text.

---

## Acceptance Criteria — Flow & Interaction

1. **AC-F-01**: Landing screen is the initial state on app first-run.
2. **AC-F-02**: Each path (Quick / Custom / Import) is a standalone entry point; no mixing required.
3. **AC-F-03**: Quick Start completes in <2 seconds (perceived instant).
4. **AC-F-04**: Custom Setup: path validation runs live; user doesn't wait >1 second for feedback.
5. **AC-F-05**: Import: multi-field state is preserved if user navigates back/forth (within the wizard).
6. **AC-F-06**: Canceling at any point returns to landing screen (or closes app if first-run was a requirement).
7. **AC-F-07**: Completing any path → app enters main UI with the selected/created vault active.
8. **AC-F-08**: No modals or popups during completion (except error recovery).

---

## Open Questions (Resolved in Owner Comment)

### Q-645-1: Word → Story Chapter Split

**Recommendation (from owner spec):** Yes, H1 = chapter, H2 = scene (matches [#631 heading model](/SKY/issues/SKY-2942)).

**Resolution:** When importing Word docs, mammoth.js parses the .docx; the app detects heading levels and creates nested folder structure:
```
Story Vault/
└── [DocName]/
    ├── Chapter 1.md (H1 becomes folder)
    │   ├── Scene 1.md (H2 becomes file)
    │   ├── Scene 2.md
    ├── Chapter 2.md
    │   ├── Scene 1.md
```

**Acceptance Criteria — Word Import Hierarchy**
- **AC-W-01**: H1 headings → chapter folders.
- **AC-W-02**: H2 headings → scene files within chapters.
- **AC-W-03**: Heading-less paragraphs → go into the current scene/chapter context (or a "Prologue" if no heading yet).
- **AC-W-04**: Deeper nesting (H3+) is flattened under H2 (capped at 2 levels).

### Q-645-2: "Recommended" Template

**Recommendation (from owner spec):** Recommended only for v0.3; library (Novel/Screenplay/Short) deferred post-v0.3.

**Resolution:** Template picker shows only:
1. ✨ **Recommended** — current Quick Start state (blank story, basic notes).
2. 📝 **Start Blank** — empty Story Vault, empty Notes Vault.

Full template library is a **follow-up child ticket** (not in v0.3 scope).

### Q-645-3: "Open existing MW vault" on Non-MW Folder

**Recommendation (from owner spec):** Error + suggest Import path.

**Resolution:** When user browses a folder that doesn't have `manifest.json`:
- Show inline error: "Not a Mythos vault. Did you mean to import an Obsidian vault instead? Try the Obsidian import slot above."
- Disable [Import / Open] until a valid vault is selected.
- No auto-retry or folder sniffing; user must pick the right folder.

---

## Scope Boundaries

### In Scope (This Ticket)

- Landing screen 3-card layout.
- Quick Start instant completion.
- Custom Setup: location picker + template picker.
- Import / Open screen with three sections (MW vault, Obsidian 2-slot, Word docs).
- Inline validation and error handling.
- Keyboard navigation (Tab, Enter).
- Reduced-motion + high-contrast composability.
- IPC stubs (detailed in child BE tickets).

### Out of Scope (Post-v0.3)

- Template library (Novel, Screenplay, Short).
- Cloud sync / multi-device onboarding.
- Wizard theming animations beyond basic fade/scale.
- OAuth or account integration.
- Accessibility beyond WCAG AA (AAA deferred).

---

## Implementation Breakdown

**UX → FE → BE waterfall** (spec → component → IPC/logic).

### FE-1: Landing Screen (PE)

- Render 3 path cards (Quick / Custom / Import) with icons, headlines, CTAs.
- Tab navigation; focus management.
- Styling with placeholder tokens (until Liquid Neon lands).
- Link routing to each path.

### FE-2: Custom Setup Screens (PE)

- Screen 1: OS-suggested folders + manual path input + vault name field.
- Screen 2: Template picker (Recommended + Start Blank).
- Tab between screens; state preservation.
- Inline validation UI (spinner, checkmark, error icon).

### FE-3: Import / Open Screen (PE)

- Three sections: MW vault, Obsidian (2 slots), Word docs.
- Multi-select for Word docs; single-select for folders.
- Inline validation for each field.
- Error modals for import failures.

### BE-1: IPC Handlers + MW Vault Detector (FE)

- `onboarding:validatePath(path)` → checks folder state (exists, writable, etc.).
- `onboarding:detectMythosVault(path)` → checks for `manifest.json`.
- `onboarding:openExistingVault(path)` → opens a Mythos vault.
- `onboarding:getSuggestedPaths()` → returns OS-level paths (Documents, Desktop, etc.).

### BE-2: Obsidian Import IPC (FE)

- `onboarding:importObsidianVault(srcPath, targetVaultKind)` → reads Obsidian folder, converts structure, writes to Notes or Story vault.
- `onboarding:dryRunObsidianImport(srcPath)` → preview import without writing.

### BE-3: Word → Story Import + mammoth.js (FE)

- `onboarding:importDocxToStoryVault(filePaths[])` → reads .docx files with mammoth, parses heading hierarchy, writes chapter/scene structure.
- Separate child ticket (not in this PR).

### QA-1: E2E Tests (QA)

- Test all 3 paths: Quick, Custom (2 screens), Import (all three sections).
- Test path validation, error recovery, focus management.
- Test keyboard navigation (Tab, Enter).
- Covered by child tickets; not in-scope here.

---

## Acceptance Criteria Summary

| Category | Criteria |
|----------|----------|
| **Landing Screen** | AC-L-01 through AC-L-08 |
| **Quick Start** | AC-Q-01 through AC-Q-06 |
| **Custom Setup** | AC-C-01 through AC-C-11 |
| **Import / Open** | AC-I-01 through AC-I-11 |
| **Error Handling** | AC-E-01 through AC-E-05 |
| **Visual & A11y** | AC-V-01 through AC-V-08 |
| **Flow & Interaction** | AC-F-01 through AC-F-08 |
| **Word Hierarchy** | AC-W-01 through AC-W-04 |

---

## Next Steps

1. **CEO review & approval** of this spec (doc link below).
2. **Fan out implementation child issues** (FE-1, FE-2, FE-3, BE-1, BE-2, QA-1).
3. **Liquid Neon tokens** (SKY-2619) land → polish styling.
4. **Sequential build**: FE-1 → FE-2 → FE-3, then BE tasks in parallel, QA covers all paths.

---

## References

- **Owner spec (verbatim):** [SKY-2970 issue description](/SKY/issues/SKY-2970)
- **Supersedes:** [SKY-2553](/SKY/issues/SKY-2553) (4-path spec; CEO will redirect)
- **Related:** [SKY-2942](/SKY/issues/SKY-2942) (v0.3 UX overhaul parent), [SKY-2619](/SKY/issues/SKY-2619) (Liquid Neon tokens)
- **Design system:** [`plans/ProjectGoalOverView/12-visual-design-system.md`](../../plans/ProjectGoalOverView/12-visual-design-system.md)
- **Heading model (for Word import):** [#631 heading model](/SKY/issues/SKY-2942) (referenced in SKY-2942)

---

**End of Spec**
