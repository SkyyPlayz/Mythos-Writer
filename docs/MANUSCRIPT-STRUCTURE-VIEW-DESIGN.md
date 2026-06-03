# Manuscript Structure View Design Specification

**Issue:** SKY-159  
**Feature:** Manuscript Structure / Outline View  
**Designer:** UXDesigner  
**Status:** Draft Specification  
**Last Updated:** June 2026

---

## Overview

The Manuscript Structure View provides a high-level overview of scene organization within a manuscript, supporting writer workflows for outlining, beat-sheet mapping, and scene reordering. The view supports two primary modes:

1. **List View** — traditional outline hierarchy (folder/chapter/scene)
2. **Card View** — visual grid of scene cards grouped by chapter, optimized for drag-and-drop reordering and beat-sheet overlay

---

## 1. Information Architecture

### Semantic Structure

```
Manuscript
├── Chapter/Act (collapsible section header)
│   ├── Scene Card (draggable, reorderable)
│   ├── Scene Card
│   └── [+] Add Scene button
├── Chapter/Act
│   ├── Scene Card
│   └── [...]
└── [+] Add Chapter button
```

**Key Principles:**
- Chapters/acts are the primary organizational unit; scenes nest within them
- Beat-sheet overlay shows 3-act structure across the entire manuscript (Setup, Confrontation, Resolution)
- Both views maintain the same underlying hierarchy; toggle between them without data loss
- Empty chapters are valid and displayable

---

## 2. Card View Layout

### Grid Specification

**Desktop (default breakpoint):**
- Card dimensions: **120px × 120px** (fixed, no shrink)
- Gap/spacing: **16px** between cards, **24px** between chapter sections
- Columns per row: **4–6 cards** (responsive, preserves full cards; no partial columns)
- Viewport width assumptions: 1440px desktop (1380px available after sidebar + padding)
  - 6 cards × 120px = 720px cards + 5 × 16px gaps = 800px total
  - Fits comfortably with 290px beat-sheet sidebar + padding

**Tablet (768px–1024px):**
- Card dimensions: **100px × 100px**
- Columns per row: **3–4 cards**
- Gap: **12px**

**Mobile (< 768px):**
- Single-column layout; cards expand to fill available width (max 120px)
- Beat-sheet sidebar collapses above the card grid (or moves to bottom tab)
- Full-width header for chapter name

### Chapter Section Header

- **Layout:** Full-width container above each chapter's card row
- **Content:**
  - Chapter/Act title (e.g., "Act I — Setup", "Chapter 3: The Crossing")
  - Chapter metadata: scene count, word count total (e.g., "5 scenes | 2,450 words")
  - [+] button to create a new scene in this chapter (bottom-right of header)
  - Optional: collapse/expand toggle (▼/▶) to fold chapter scenes

**Visual:**
```
┌─────────────────────────────────────────────────┐
│ Act I — Setup                  5 scenes | 2K wds [+]  │
├─────────────────────────────────────────────────┤
│ [Card] [Card] [Card] [Card] [Card] [Card]       │
│ [Card] [Card]                                   │
└─────────────────────────────────────────────────┘
```

---

## 3. Scene Card Component

### Card Dimensions & Layout

- **Size:** 120px × 120px (desktop) | 100px × 100px (tablet) | responsive (mobile)
- **Aspect ratio:** 1:1 (square)
- **Inner padding:** 8px
- **Content hierarchy:** drag handle → title → word count → status badge

### Card Anatomy

```
┌─────────────────┐
│ ⋮⋮     [status] │  (header: drag handle + status badge)
│                 │
│   Scene Title   │  (title, max 2 lines, ellipsis)
│   (wrapped)     │
│                 │
│     247 words   │  (word count, center-bottom)
└─────────────────┘
```

### Content Specification

| Element | Type | Spec | Notes |
|---------|------|------|-------|
| **Drag Handle** | Icon | ⋮⋮ (vertical ellipsis) | 16px tall, left edge, tappable (expand tap target to 24px × 24px on mobile) |
| **Status Badge** | Icon + Color | Circle (12px diameter), positioned top-right | Draft (blue), Final (green), Cut (red/desaturated) |
| **Title** | Text | Heading style (weight: 500, size: 11px desktop / 10px tablet) | Max 2 lines; `text-overflow: ellipsis` on second line; neutral foreground color |
| **Word Count** | Text | Secondary style (size: 9px, weight: 400, color: secondary-foreground) | Right-aligned, bottom-left area; e.g., "247 words" |

### Visual States

#### Baseline (default)
- Background: `surface-secondary` (subtle background from design system)
- Border: `border-subtle` (thin, low-contrast)
- Title: `foreground` (neutral text)
- Opacity: 100%

#### Hover
- Background: `surface-secondary` (same, no shift)
- Border: `border-default` (increase contrast slightly)
- Shadow: `elevation-1` (subtle drop shadow, ~2px offset, ~4px blur)
- Cursor: grab (indicates draggability)

#### Focus (keyboard)
- Border: `border-focus` (2px, accent color, `outline: 2px solid`)
- Box-shadow: `0 0 0 2px surface, 0 0 0 4px focus-color` (focus ring)
- No background change

#### Selected (multi-select mode, if implemented)
- Background: `accent-surface` (light accent tint)
- Border: `border-accent` (accent color, same thickness)
- Checkmark icon: appears top-left (optional, can defer to v2)

#### Drag Source (being dragged)
- Opacity: 60%
- Cursor: grabbing
- Shadow: `elevation-3` (larger drop shadow, ~8px offset, ~12px blur)

#### Drag Over Target (another card is over this one)
- Border: `border-accent` (accent color, 2px)
- Background tint: `accent-surface` at 20% opacity (subtle highlight)
- Visual feedback: "drop zone" styling (not a full invert)

#### Loading / Placeholder
- Background: `surface-secondary`
- Border: `border-subtle`
- Content: Skeleton loader (optional) or spinner in center

#### Empty State (no cards in chapter yet)
- Chapter header still visible
- Below header: centered, gray text "No scenes yet. [+] Create one."
- Drag-over-chapter still highlights the chapter header area (not individual cards)

---

## 4. Drag-and-Drop Interaction Specification

### Mouse Behavior

1. **Pickup:** Click + hold on drag handle (⋮⋮) for 200ms → card enters drag state
   - Alternative: Click + hold anywhere on card for 300ms (for accessibility fallback)
   - Feedback: cursor changes to `grabbing`, card opacity reduces to 60%, shadow enlarges

2. **Reorder within chapter:** Drag over sibling cards → visual indicator (border/highlight) shows drop position
   - Drop position: between cards (not on top)
   - Feedback: target card's border highlights in accent color

3. **Move between chapters:** Drag card into another chapter's section
   - Drop zone: over any card in target chapter OR over chapter header
   - Feedback: entire chapter section highlights with accent border
   - If dropped on header: scene is appended to that chapter

4. **Release:** Drop to commit reorder
   - Card returns to normal opacity
   - Order in DOM updates immediately (optimistic UI)
   - Backend sync happens asynchronously (with optional undo affordance)

5. **Cancel:** Escape key or click outside → drag canceled, card snaps back to original position

### Touch Behavior (Mobile/Tablet)

1. **Pickup:** Tap + hold (500ms) on drag handle → haptic feedback + visual feedback (shadow, opacity)
2. **Move:** Drag with finger while continuing to press
3. **Drop:** Lift finger to commit
4. **Visual feedback:**
   - Cards shift apart to show drop zone (not just a border; actual grid repositioning)
   - Target chapter header expands slightly to emphasize it as a valid drop zone

### Accessibility

- **Keyboard:** Tab to a card, then:
  - `Space` + arrow keys to change order (within chapter or move to adjacent chapters)
  - `Escape` to exit reorder mode
  - `Enter` to confirm (if using a separate "move" mode)
- **Screen reader:**
  - Card element: `<article role="option" aria-label="Scene: {title}, {word_count}, {status}">`
  - Drag handle: `aria-grabbed="true/false"`, `aria-dropeffect="move"`
  - Announce reorder: "Scene moved to position X of chapter Y" on drop

---

## 5. Beat-Sheet Sidebar Overlay

### Overview

The beat-sheet sidebar displays a 3-act structure overlay (Save the Cat) on top of the card grid, allowing writers to assign scenes to beats and visualize story pacing.

### Sidebar Layout

**Position:** Right side of viewport (or below on mobile)  
**Width:** 290px (desktop) | 100% (mobile, scrolls above grid)  
**Height:** Scrolls with card grid (synchronized scroll)  

```
┌────────────────────┐
│   Beat Sheet       │ (header, collapsible)
├────────────────────┤
│ ▼ Setup (Acts 1–1) │ (act section, collapsible)
│   ☐ Hook           │ (beat checkboxes)
│   ☐ Inciting       │
│   ☐ Debate         │
│                    │
│ ▼ Confrontation    │
│   ☐ B-Story       │
│   ☐ Fun & Games   │
│   ☐ Midpoint      │
│   ☐ Bad Guys      │
│   ☐ All Is Lost   │
│                    │
│ ▼ Resolution (3)  │
│   ☐ Dark Night    │
│   ☐ Break Into 3  │
│   ☐ Finale        │
│   ☐ Final Image   │
└────────────────────┘
```

### Content Specification

| Element | Spec |
|---------|------|
| **Section Header** | 14px, weight 600, accent color, collapsible (▼/▶ icon) |
| **Beat Item** | Checkbox (accessible `<input type="checkbox">`) + label (12px, weight 400) |
| **Metadata** | Optional: scene count per beat (gray text, right-aligned, e.g., "2 scenes") |
| **Action** | Hover on beat → show linked scenes count as a badge or popover |

### Interaction

1. **Check a beat:** Click checkbox to mark beat as assigned
   - **Visual feedback:** Card(s) linked to that beat highlight with a subtle outline or background tint (beat color: Setup = blue, Confrontation = yellow, Resolution = green)
   - **Scope:** Only scenes explicitly assigned to this beat light up

2. **Click beat label:** Focus the card grid on scenes matching this beat
   - Scroll grid to show the beat's scenes
   - Optionally: dim non-matching cards (with a toggle for full-grid view)

3. **Assign scene to beat:** 
   - Right-click on card (or context menu on mobile) → "Assign to beat" submenu → select beat
   - Or: drag card onto beat label in sidebar (advanced; can defer to v2)
   - Or: edit scene metadata (shown in right-panel scene detail view, if it exists)

### Visual States

#### Baseline
- Checkbox: unchecked, neutral border
- Text: secondary foreground color
- Linked scene count (if shown): gray, small

#### Checked
- Checkbox: filled, accent color (checkmark)
- Text: emphasis (slightly darker)
- Linked scene count: accent color

#### Hover
- Background: `surface-secondary` (subtle tint)
- Checkbox: border-accent (slight highlight)
- Cursor: pointer

#### Mobile / Small Viewport
- Sidebar relocates above the grid or becomes a bottom drawer
- Width: full viewport width
- Collapsible section headers stay visible; content scrolls within drawer

---

## 6. View Toggle & Mode Switching

### Toggle Location & Design

**Position:** Top-right of the view container (near title bar or below global navigation)  
**Style:** Button group (two toggle buttons, segmented control style)

```
┌─────────────────────────────────────────────────────┐
│ Manuscript Structure                [List] [Card v]  │
└─────────────────────────────────────────────────────┘
```

| State | List Button | Card Button |
|-------|-------------|-------------|
| **List mode active** | Background: accent, Text: inverse | Background: surface, Text: foreground |
| **Card mode active** | Background: surface, Text: foreground | Background: accent, Text: inverse |
| **Hover** | Opacity increase on inactive button | Opacity increase on inactive button |

### Keyboard Shortcut

- **`Ctrl+1` (Windows/Linux) / `Cmd+1` (macOS):** Toggle to List View
- **`Ctrl+2` / `Cmd+2`:** Toggle to Card View
- Documented in Help menu and keyboard shortcuts reference

### Interaction Behavior

1. **Click toggle:** Smoothly transition between List and Card views (no flash)
   - Animation: fade out current view (100ms), fade in new view (100ms)
   - Scroll position: remembered per mode (if switching back to List, restore previous List scroll position)

2. **State persistence:** Selected view mode is saved to user preferences (localStorage or app settings)
   - Next session remembers the user's last-used view

---

## 7. List View Specification

### Overview

The List View shows the same scene hierarchy in a traditional outline format. It shares the same underlying data model as Card View but displays it as a nested list with keyboard navigation.

### Layout

```
Manuscript Structure

📄 Act I — Setup (5 scenes)
   ▶ Scene: The Crossing (412 words) [🔵 Draft]
     └─ Last edited: 3 days ago
   ▶ Scene: Discovery (623 words) [🟢 Final]
   ▼ Scene: The Choice (547 words) [🔵 Draft]
     └─ Last edited: today
📄 Act II — Confrontation (8 scenes)
   ▶ Scene: Escalation (389 words) [🔵 Draft]
   ...
```

### Row Anatomy

| Component | Spec |
|-----------|------|
| **Expand/Collapse Toggle** | ▶/▼ icon, 16px, left edge (or hidden for leaf scenes) |
| **Scene Icon / Drag Handle** | ⋮⋮ or scene icon, 16px, draggable |
| **Title** | 12px, weight 500, semantic foreground color |
| **Word Count** | Secondary text, right-aligned, gray (e.g., "412 words") |
| **Status Badge** | Circle icon (12px) inline with title (color: Draft/Final/Cut) |
| **Metadata** | Optional: last-edited timestamp, collapsible |

### Row Height
- Default: 32px (includes padding)
- Hover: subtle background tint, shadow on drag handle appears

### Interaction

1. **Expand/Collapse:** Click toggle to show/hide scene metadata or child chapters
2. **Drag-and-drop:** Same as Card View (200ms pickup, reorder between chapters)
3. **Click row:** Open scene editor (navigate to Scene Editor, showing the scene in edit mode)
4. **Right-click:** Context menu with options:
   - Duplicate scene
   - Move to chapter
   - Delete (with confirmation)
   - Assign to beat (if beat-sheet visible)

### Keyboard Navigation

- **Tab:** Navigate between rows (move focus forward)
- **Shift+Tab:** Navigate backward
- **Enter:** Open scene editor for focused row
- **Space + Arrow Up/Down:** Reorder within chapter
- **Space + Arrow Left/Right:** Move to parent chapter or previous/next chapter
- **Delete:** Delete scene (with confirmation dialog)
- **Ctrl+D / Cmd+D:** Duplicate scene

---

## 8. Empty & Edge States

### No Scenes in Manuscript

```
┌─────────────────────────────────────────────────────┐
│ Manuscript Structure                [List] [Card v]  │
├─────────────────────────────────────────────────────┤
│                                                     │
│              No scenes yet.                         │
│                                                     │
│        [+ Create First Scene]                       │
│                                                     │
│  (Beat-sheet sidebar still visible, all beats       │
│   unchecked; shows structure ready to populate)     │
└─────────────────────────────────────────────────────┘
```

### All Scenes in One Chapter

- Chapter header still displayed
- Single row of cards (or single column in list)
- Button to add new chapter appears above/below existing content

### No Beats Assigned

- Checkboxes all unchecked
- Optional: subtle prompt: "Assign scenes to beats to map your story pacing"

### Deleted/Cut Scenes

- Scenes with "Cut" status appear with strikethrough title and desaturated badge (red/gray)
- Option: toggle visibility of cut scenes (hide by default or show but dimmed)
- Can be restored via undo or a "restore" action

---

## 9. Responsive Behavior

### Viewport Breakpoints

| Breakpoint | Width | Layout Changes |
|------------|-------|-----------------|
| **Desktop** | ≥ 1440px | 6-card columns, 290px sidebar (right), both visible |
| **Wide Tablet** | 1024px–1439px | 4-card columns, 260px sidebar, both visible |
| **Tablet** | 768px–1023px | 3-card columns, sidebar relocates below or as drawer |
| **Mobile** | < 768px | 1–2 card columns, sidebar collapses to bottom drawer (or modal tab) |

### Tablet / Mobile Adjustments

1. **Sidebar becomes a bottom drawer or tab:**
   - Swipe up to reveal beat-sheet
   - Or: add a "Beat Sheet" button at top, taps to open modal

2. **Card size reduces:**
   - Tablet: 100px × 100px
   - Mobile: flex to available width, max 120px

3. **Chapter headers become sticky:**
   - Sticky top of scrollable list (so you always see which chapter you're in)

4. **Drag-and-drop adjusted for touch:**
   - Longer tap-hold (500ms) to initiate
   - Visual feedback: haptic + cards shift apart to show drop zone
   - Drop on another card or chapter header

---

## 10. Interaction Flows

### Flow: Create a New Scene in a Chapter

```
1. User hovers over chapter header
2. [+] button appears (or always visible, top-right of header)
3. User clicks [+]
   → Modal/form opens: "New Scene in [Chapter Name]"
   → Input: Title, optional: word count (defaults to 0)
4. User enters title, clicks "Create"
   → New card appears at end of chapter
   → Focus moves to card (highlight/keyboard focus)
   → Optional: card opens inline editor, or navigates to Scene Editor
```

### Flow: Reorder Scenes via Drag-and-Drop (Card View)

```
1. User hovers over card → shadow enlarges
2. User clicks + holds drag handle (⋮⋮) for 200ms
   → Card becomes semi-transparent (60% opacity)
   → Shadow enlarges
   → Cursor changes to "grabbing"
3. User drags card over another card
   → Target card's border highlights (accent color)
   → Visual indicator shows drop position
4. User drags to another chapter
   → Target chapter header highlights
5. User releases mouse
   → Card reorders optimistically (DOM updates immediately)
   → Backend sync happens asynchronously
   → Undo available if sync fails
```

### Flow: Assign Scene to Beat

```
1. Card is visible in grid
2. User right-clicks card → Context menu: "Assign to beat"
   → Submenu shows: Setup / Confrontation / Resolution / Unassigned
3. User selects a beat
   → Card gets a subtle outline or corner indicator (beat color)
   → Beat checkbox in sidebar auto-checks
   → Card is now linked to that beat
4. User can click beat name in sidebar
   → Grid scrolls to show all scenes for that beat
   → Beats are highlighted
```

### Flow: Toggle Between List and Card View

```
1. User clicks [List] or [Card] button (top-right)
   → Current view fades out (100ms)
   → New view fades in (100ms)
   → Scroll position is restored (per-view memory)
2. User's selection (if any) is preserved
3. Keyboard navigation switches context:
   - Card View: arrow keys move to adjacent cards
   - List View: arrow keys move to adjacent rows, expand/collapse with arrows
```

---

## 11. Accessibility Requirements

### WCAG 2.1 AA Compliance

- **Color independence:** Status badges use both color AND shape/icon (circle for different statuses, not just color)
- **Color contrast:** All text meets 4.5:1 minimum (body) and 3:1 (large text); badges meet same standard
- **Target size:** All clickable elements (cards, buttons, drag handles) are ≥ 44px × 44px (or equivalently tappable on mobile)
- **Keyboard navigation:** Full keyboard support (Tab, Shift+Tab, Enter, Space, Escape, arrow keys)
- **Screen reader:** All interactive elements are properly labeled with ARIA attributes
  - Cards: `role="option"`, `aria-label="Scene: [title], [word count], [status]"`
  - Drag handle: `role="button"`, `aria-grabbed="true/false"`, `aria-dropeffect="move"`
  - Checkboxes: `role="checkbox"`, `aria-checked="true/false"`, `aria-label="Beat: [name]"`
- **Focus management:** Clear, visible focus indicators (focus ring); focus moves logically
- **Reduced motion:** Animations respect `prefers-reduced-motion` media query (fade transitions become instant swaps if disabled)

### Error & Feedback Messages

- **Toast notifications:** All actions (create, delete, reorder) show success/error feedback
  - Success: green accent, "Scene created" or "Scene moved to [Chapter]"
  - Error: red accent, "Could not reorder. Undo?"
- **Confirmation dialogs:** Destructive actions (delete) require explicit confirmation before proceeding
- **Aria live regions:** Announce reorder actions and beat assignments to screen reader users

---

## 12. Design System Integration

### Token Usage

- **Colors:**
  - Foreground (text): `--color-foreground` (neutral)
  - Surface (card background): `--color-surface-secondary` (subtle)
  - Border: `--color-border-subtle` (low-contrast), `--color-border-default` (normal), `--color-border-focus` (focus ring)
  - Accent (buttons, highlights): `--color-accent` (primary brand color)
  - Status: Draft = `--color-blue`, Final = `--color-green`, Cut = `--color-red` (desaturated)
  - Beat colors (Setup = blue, Confrontation = yellow, Resolution = green)

- **Spacing:**
  - Card spacing: `16px` gap (desktop), `12px` (tablet), `8px` (mobile)
  - Chapter header margin: `24px` below
  - Sidebar padding: `16px`
  - Card inner padding: `8px`

- **Typography:**
  - Chapter header: 14px weight 600
  - Card title: 11px weight 500
  - Card subtitle (word count): 9px weight 400, secondary color
  - List row title: 12px weight 500

- **Shadows & Elevation:**
  - Baseline card: none
  - Hover card: `elevation-1` (2px offset, ~4px blur)
  - Dragging card: `elevation-3` (8px offset, ~12px blur)

- **Motion:**
  - View toggle transition: 100ms fade (linear easing)
  - Drag animation: 200ms ease-out (return to position on cancel)
  - Hover shadow: 100ms ease-out

### Component Library Reuse

- **Button (view toggle):** Use existing Button component with `variant="segmented"`
- **Checkbox (beat assignments):** Use existing Checkbox component (WCAG AAA compliant)
- **Card (scene card):** Potentially extend existing Card component or create specialized SceneCard component
- **Sidebar:** Reuse Layout/Sidebar if available; ensure scrolling synchronizes with main grid

---

## 13. Implementation Handoff Notes

### For FoundingEngineer / Product Engineer

#### File Structure
```
src/
├── components/
│   ├── ManuscriptStructureView.tsx (main container)
│   ├── CardView.tsx (card grid layout)
│   ├── ListView.tsx (list outline)
│   ├── SceneCard.tsx (reusable card component)
│   ├── ChapterHeader.tsx (chapter section header)
│   ├── BeatSheetSidebar.tsx (beat overlay panel)
│   └── ViewToggle.tsx (list/card toggle buttons)
├── hooks/
│   ├── useManuscriptStructure.ts (data fetching, state mgmt)
│   ├── useDragDrop.ts (drag-and-drop logic)
│   └── useKeyboardNav.ts (keyboard shortcuts)
├── constants/
│   ├── BEAT_STRUCTURE.ts (Save the Cat beats: Setup, Confrontation, Resolution)
│   └── VIEW_MODES.ts (list/card/beat)
└── styles/
    └── ManuscriptStructureView.module.css (or Tailwind classes)
```

#### Key Props / Interface Contracts

**SceneCard:**
```typescript
interface SceneCardProps {
  id: string;
  title: string;
  wordCount: number;
  status: 'draft' | 'final' | 'cut';
  beatAssignment?: string;
  isDragging?: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: (e: DragEvent) => void;
  onClick: () => void;
  onContextMenu: (e: MouseEvent) => void;
}
```

**BeatSheetSidebar:**
```typescript
interface BeatSheetSidebarProps {
  beats: Beat[]; // Setup, Confrontation, Resolution
  assignments: Map<sceneId, beatId>; // scene → beat mapping
  onBeatToggle: (beatId: string, checked: boolean) => void;
  onBeatClick: (beatId: string) => void; // scroll grid to beat
  onSceneAssign: (sceneId: string, beatId: string) => void;
}
```

#### Critical Interactions to Test

1. **Card drag-and-drop:** 200ms pickup, reorder within chapter, move to another chapter
2. **Beat assignment:** Right-click → assign to beat; beat checkbox auto-checks; card highlights
3. **Keyboard navigation:** Tab through cards, Space+Arrow for reorder, Escape to cancel drag
4. **View toggle:** Switch List ↔ Card without data loss; scroll position restored per view
5. **Empty states:** No scenes, no beats assigned, all scenes cut
6. **Responsive:** Test 1440px, 1024px, 768px, 375px viewports

#### Acceptance Criteria

- ✅ Card grid renders with 4–6 cards per row (desktop)
- ✅ Drag-and-drop reorders scenes within and between chapters
- ✅ Beat-sheet sidebar shows 3-act structure with checkboxes
- ✅ List view displays outline hierarchy with full keyboard support
- ✅ View toggle switches modes smoothly (fade transition, scroll restored)
- ✅ All interactive elements are keyboard-accessible (Tab, Enter, Escape, arrow keys)
- ✅ Focus indicators visible and logical
- ✅ Color-independent status badges (shape + color)
- ✅ Responsive on tablet (3-card columns) and mobile (1 column, sidebar drawer)
- ✅ Beat assignment workflow (right-click → assign → auto-check sidebar)
- ✅ Empty states are user-friendly and actionable ([+ Create] buttons)

---

## 14. Future Enhancements (v2+)

- Multi-select scenes (Ctrl+Click) and batch operations (move, delete, assign beat)
- Drag scene directly onto beat label in sidebar to assign
- Scene metadata modal (click card → detail panel: word count, status, notes, beat assignment)
- Custom chapter/act labels (allow user to rename "Act I" to custom names)
- Scene thumbnail previews (first line of scene text shown on hover)
- Export manuscript structure to outline (Markdown, Word, etc.)
- Collaboration: real-time conflict resolution for concurrent reorders
- Performance: virtualization for manuscripts with 100+ scenes
- Dark mode support (theme tokens already in place)

---

## End of Specification

**Next Action:** Implementation by FoundingEngineer / Product Engineer  
**Review Gate:** CEO / ProductManager approval before implementation starts  
**Estimated Implementation Effort:** 2–3 days (core feature) + 1 day (polish + accessibility testing)
