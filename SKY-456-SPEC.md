# UX/Product Spec: Creative Quality Controls for Writing & Brainstorm

**Issue:** SKY-456  
**Owner:** UXDesigner  
**Related:** SKY-442 (parent), GH#212  
**Phase:** Design (no code changes in this task)  
**Deadline:** Ready for frontend handoff in 1–2 heartbeats

---

## Overview

This spec defines the UX for genre/style presets, iterative refinement controls, and a lightweight quality rubric for the **Writing Assistant** and **Brainstorm Agent**. Writers often get stuck because generated text feels too generic, misaligned with their project voice, or incomplete. These controls let users steer AI suggestions with preset parameters and one-click refinements, then validate output against a craft rubric.

**Key constraint:** The solution must not regress existing Writing Assistant or Brainstorm flows (reference lessons from SKY-316/317 empty-state issues). Empty states and initial guidance must continue to be useful.

---

## 1. Genre/Style Presets — UX Spec

### 1.1 Preset Definition & Axes

A **preset** is a named bundle of style parameters the user can apply to shape AI generation. Each preset covers these axes:

| Axis | Range | Purpose | Example values |
|------|-------|---------|-----------------|
| **Genre** | ~6–8 primary + literary | Frame the default tone & tropes | Fantasy, Romance, Science Fiction, Mystery, Literary, Historical, Horror, Thriller |
| **Tone** | Descriptive slider | Emotional affect of the prose | Somber ↔ Playful (discrete stops: Grim, Serious, Balanced, Warm, Joyful) |
| **POV** | Categorical | Narrative voice | First Person, Second Person, Third Person Limited, Third Person Omniscient, Epistolary |
| **Tense** | Categorical | Time frame | Past, Present, Future |
| **Length** | Descriptive slider | Expected output scope | Concise ↔ Elaborate (discrete stops: Snippet, Brief, Moderate, Thorough, Expansive) |
| **Audience** | Categorical | Writing level & reading age | Children (8–12), Young Adult (13–18), Adult, Academic |
| **Content Constraints** | Multi-select tags | Guardrails on what to avoid | Explicit violence, Sexual content, Profanity, Real-world politics, Graphic descriptions, Sad ending, Cliffhanger, Mundane details |

**Rationale:** These axes cover the most common "this doesn't sound like my character/world" feedback from writers. Tone and Length use slider UX because they're spectrum controls; POV/Tense are categorical because switching between them is discrete. Content constraints are checkboxes (rare to use multiple, but possible).

### 1.2 Preset Library (Seed Set)

Mythos Writer ships with **5 recommended presets** covering common writing scenarios:

| Preset Name | Genre | Tone | POV | Tense | Length | Audience | Constraints |
|---|---|---|---|---|---|---|---|
| **Epic Fantasy** | Fantasy | Serious | Third Person Limited | Past | Moderate | Adult | Explicit violence (allow) |
| **Modern Romance** | Romance | Warm | First Person | Present | Moderate | Adult | Graphic descriptions (optional) |
| **Cozy Mystery** | Mystery | Balanced | Third Person Limited | Past | Moderate | Adult | None |
| **Literary Fiction** | Literary | Somber | First Person | Past | Elaborate | Adult | None |
| **YA Adventure** | Science Fiction | Joyful | Third Person Limited | Present | Moderate | Young Adult | Explicit violence, Sexual content, Profanity (restrict) |

**Rationale:** These represent the main customer archetypes in user research. Additional presets are filed as a separate enhancement (customizable saved presets per vault).

### 1.3 Preset Storage & Scope

- **Global defaults:** Presets ship built into the application (not stored in vault).
- **Per-vault selection:** Each vault stores a "default preset ID" in its vault config (persistent across sessions).
- **Per-session override:** When a user selects a different preset for a chat session, it applies only to that session's generations (not persisted unless they change the vault default).
- **Per-generation state:** The current preset is visible in the UI but not retroactively applied to past messages.

**Rationale:** Writers want continuity within a story (use a preset for the whole vault) but also want to experiment mid-session without committing. This design honors both.

---

## 2. Where Presets Live — Surface Placement

### 2.1 Writing Assistant Panel

**Current layout:**
```
┌─ Writing Assistant ────────────────────┐
│  Header: scene context                 │
│  [Optional: writing tips section]       │
│                                        │
│  Chat messages (scrolling)              │
│                                        │
│  Input textarea + Send button           │
└────────────────────────────────────────┘
```

**New layout — integrated preset selector:**
```
┌─ Writing Assistant ────────────────────┐
│  Header: scene context                 │
│  
│  [Preset Selector] ↓ (collapsible)      │
│   Current: Epic Fantasy                 │  ← single-line chip showing active
│   [Customize] [Browse]                  │  ← quick action buttons
│                                        │
│  [Optional: writing tips section]       │
│                                        │
│  Chat messages (scrolling)              │
│                                        │
│  Input textarea + Send button           │
│  [Refine: +specific -generic +tension]  │  ← quick refinement chips (hidden by default)
│                                        │
│  💡 Try: Increase tone warmth...       │  ← contextual hint after 2+ responses
└────────────────────────────────────────┘
```

**Preset selector detail:**

1. **At rest (collapsed):**
   - Single-line chip: `[Epic Fantasy ▼]` (using `--neon-cyan` accent text, `--text-sm`, `--radius-full`)
   - Displayed above writing tips if present, or directly below header
   - Spacing: `--space-4` margin below

2. **On click or hover:**
   - Dropdown menu slides down (max 8 items visible, scroll if more)
   - Each preset: name + 1-line description of tone + "→" indicator
   - Currently selected preset: checkmark + `--accent-soft` background
   - Bottom action: `[+ Save Custom Preset]` (future enhancement, gray/disabled for now)
   - Animation: `--ease-out`, `--dur-panel` (280ms)
   - Accessibility: keyboard navigation (↑↓ to browse, Enter to select, Esc to close)

**Customize button:**
- Icon: gear / sliders icon (16px)
- Opens **Preset Editor Modal** (see 2.4 below)
- Same modal UX in both Writing Assistant and Brainstorm

**Browse button:**
- Opens a **Preset Selector Panel** showing all presets with axis details
- User can preview changes before applying
- Swipe/next/previous for mobile-friendly browsing (desktop: click grid)

### 2.2 Brainstorm Agent Page

**Current layout:**
```
┌─ Brainstorm ──────────────────────────┐
│  [Close] Title: [Focus dropdown] ↓     │
│                                        │
│  Chat messages with fact extraction    │
│  [Routing prompts for facts]           │
│                                        │
│  Input textarea + Send button          │
└────────────────────────────────────────┘
```

**New layout:**
```
┌─ Brainstorm ──────────────────────────┐
│  [Close] Title: [Focus] ↓              │
│  [Preset: Epic Fantasy ▼] [Customize] │
│                                        │
│  Chat messages with fact extraction    │
│  [Routing prompts for facts]           │
│                                        │
│  Input textarea                        │
│  [Refine chips (hidden until >1 resp)] │  
│  [Send button]                         │
└────────────────────────────────────────┘
```

**Placement:**
- Preset selector goes on the header row after the Focus dropdown
- Uses same single-line chip + collapsible menu design as Writing Assistant
- Spacing: `--space-2` gap between Focus dropdown and Preset selector

---

## 3. Iterative Refinement Controls

### 3.1 Refinement Model

When a user receives an AI-generated suggestion (Writing Assistant response or Brainstorm generation), they can immediately steer it without losing the prior draft. Refinement adjusts one or more preset axes and regenerates.

**Refinement categories:**

| Category | One-click chips | Effect |
|---|---|---|
| **Tone** | `+warmer`, `+darker`, `+serious` | Shift Tone axis by ~2 steps |
| **Specificity** | `+concrete`, `-generic`, `+vivid` | Typically Tone + Length combo |
| **Pacing** | `+slower`, `+faster` | Primarily Length axis |
| **Scope** | `+shorter`, `+longer` | Length axis only |
| **Voice** | `+formal`, `+casual`, `+witty` | Tone + POV combo, contextual |

### 3.2 Refinement Affordance — Writing Assistant

**When to show:**
- After the Writing Assistant completes a response (`streaming: false`)
- Do NOT show if the user is mid-generation or on the initial empty state

**Layout:**

```
┌─ Assistant bubble ─────────────┐
│ [assistant text]               │
│                                │
│ [Accept] [Dismiss]             │  ← existing suggestion actions
│ ─────────────────────────────  │
│ Refine:                         │  ← refinement row (NEW)
│ [+specific] [-generic] [+warm] │
│ [+shorter] [+slower]           │  ← up to 5 chips, wrap to next line if needed
│                                │
│ [✓ Accepted] or [✗ Dismissed] │  ← status (after user choice)
└────────────────────────────────┘
```

**Design tokens:**
- Section label ("Refine:"): `--text-sm`, `--text-muted`, `--weight-base`
- Chips: `--radius-full`, `--space-2` horizontal gap, `--text-xs` text
- Chip state: 
  - **At rest:** `--border-subtle` 1px border, `--text-body` text, `--bg-inset` fill
  - **Hover:** `--border-strong` border, cursor pointer, brief `--dur-hover-in` fade
  - **Active (after click):** `--accent-soft` fill, `--accent` text, slight scale-up (1.05)
- Container: `--space-2` padding, `--border-subtle` separator line above

### 3.3 Refinement Affordance — Brainstorm Page

**When to show:**
- Below or adjacent to assistant messages (after streaming ends)
- Same 5-chip layout as Writing Assistant
- Hide on initial empty state

**Layout — integrated into chat bubble:**

```
┌─ Brainstorm chat bubble ─────┐
│ [assistant text with facts]   │
│                               │
│ Refine: [+specific] [-generi] │  ← inline with message
│ [+warmth] [+shorter]          │
│                               │
│ [FACT: Character - Name] ...  │  ← fact extraction (existing)
└───────────────────────────────┘
```

**Difference from Writing Assistant:** Refine chips appear inline with the message text (not separated by Accept/Dismiss buttons, since Brainstorm uses different acceptance patterns for facts).

### 3.4 Refinement Interaction Flow

1. **User clicks a refinement chip** (e.g., `+specific`)
   - Optimistically show the chip as active (`--accent-soft` background)
   - Disable all refinement chips (user can't layer refinements)
   - Show a brief loading indicator or "Refining..." spinner in the message

2. **AI regenerates** with the adjusted preset
   - Stream the new response (same streaming UX as initial generation)
   - When complete, mark the original response as "refined away" or dim it (lowered opacity)
   - Show the new response with fresh refinement chips

3. **User can accept, dismiss, or refine again**
   - Clicking another refinement chip adjusts further (builds on the adjusted preset)
   - Clicking Accept/Dismiss (Writing Assistant) locks the decision and removes chips
   - Clicking Reject (Brainstorm) archives the message thread

**State persistence:**
- Each refinement applies the chosen axis adjustment(s) and regenerates
- The adjusted preset is **not** saved globally; it's session-scoped
- User can switch back to the original preset at any time via the Preset Selector
- Undo: reversing a refinement is not explicitly surfaced; users revert by re-selecting the original preset and asking for the same thing

---

## 4. Quality Rubric

### 4.1 Rubric Design

A **lightweight, human-reviewable quality rubric** for evaluating generated text. Designed for two use cases:
1. **(Primary)** Authors review their own generations; rubric is documentation/internal reference, not UI-driven scoring
2. **(Future)** Eval harness consumes rubric to grade outputs programmatically

The rubric has **5 criteria**, each with a short definition and 1–3 Likert anchors (1★, 2★, 3★). Authors rate themselves intuitively; no UI widget is added yet.

### 4.2 The Five Criteria

#### **1. Specificity**
*Does the text include concrete details, names, sensory anchors, or unique traits — or is it generic/abstract?*

- **1★ (Generic):** No details, uses placeholders or vague language. "The character walked into a room and felt sad."
- **2★ (Adequate):** Basic details present, but could be more vivid. "Maya entered the tavern and saw people at wooden tables."
- **3★ (Specific):** Rich, unique details grounded in the world. "Maya ducked under the tavern's low oak beams, their surface sticky with ale-spill and candlewax, and caught the smell of leather and wet peat."

#### **2. Coherence**
*Does the text follow logically from prior context? Are character voices, worldbuilding rules, or plot threads consistent?*

- **1★ (Broken):** Contradicts earlier text or context. Character motivations flip without reason; physics/magic rules ignored.
- **2★ (Plausible):** Follows logic but feels tacked-on. Fits the context but doesn't deepen it.
- **3★ (Seamless):** Builds naturally on prior text. Echoes voice, honors established rules, feels inevitable.

#### **3. Genre Fit**
*Does the text match the intended genre and tone? Does it lean into or shy away from genre conventions?*

- **1★ (Mismatched):** Contradicts genre. A solemn epic turning whimsical; a cozy mystery with graphic violence; a romance lacking emotional stakes.
- **2★ (Competent):** Follows genre tropes but feels generic. Hits the checklist without flavor.
- **3★ (Authentic):** Feels like it belongs in this genre and author's voice. Uses conventions skillfully and adds specificity.

#### **4. Narrative Voice Consistency**
*Does the prose maintain the POV, tone, vocabulary level, and sentence rhythm established earlier?*

- **1★ (Off):** Sudden shift in voice—tense switches, vocabulary jumps to formal/casual without reason, POV breaks.
- **2★ (Close):** Generally consistent with minor slip-ups. Reads like mostly the same author.
- **3★ (Locked):** Voice is indistinguishable from surrounding text. Feels like one continuous prose passage.

#### **5. Usefulness as Starter**
*Can the author build on this draft, or is it so off-base it needs to be discarded?*

- **1★ (Starting over):** So misaligned the author throws it away and starts fresh. Wrong character, wrong scene, fundamentally misunderstood.
- **2★ (Salvageable):** Usable with significant rewrites. Captures intent but needs heavy editing.
- **3★ (Ready to revise):** Author can revise cleanly. Strong foundation, clear direction, minor tweaks needed.

### 4.3 Rubric Display & Usage

**Documentation, not a UI widget (for now):**
- Rubric is published in the app as a **Help article** accessible via the Writing Assistant → ? icon or Brainstorm → ? icon
- Label: "Quality standards for AI generations"
- Users review it when they get output they want to evaluate
- No scoring buttons/sliders in the generation UI yet

**When rubric appears:**
- First-run tip when Writing Assistant is enabled: *"Evaluate AI suggestions using our quality rubric (?) — check for specificity, coherence, and voice fit."*
- Same tip in Brainstorm onboarding
- Links to the rubric doc

**Future integration (out of scope for this spec):**
- Eval harness will read this rubric to score outputs
- May add a "Score this" button (SKY-xxx future issue) that opens a modal scoring widget
- Metrics will feed back to model fine-tuning

---

## 5. Wireframes & Annotated Mocks

### 5.1 Writing Assistant Panel — Full View

```
┌─────────────────────────────────────────────────────────┐
│ ┌─ Writing Assistant (right sidebar) ───────────────────┐
│ │                                                       │
│ │ Writing Assistant — context: "The Chamber"            │
│ │                                                       │
│ │ [Epic Fantasy ▼] [Customize] [Browse]               │  ← preset row
│ │ ┌─────────────────────────────────────────────────┐  │
│ │ │ Writing Tips                                    │  │
│ │ │ • Vary your sentence structure                  │  │
│ │ │ • Ground readers in the senses                  │  │
│ │ │ • Name specific details                         │  │
│ │ └─────────────────────────────────────────────────┘  │
│ │                                                       │
│ │ [User] How can I make this more tense?               │
│ │                                                       │
│ │ [Assistant] Consider adding:                         │
│ │  - Shorter sentences for pacing                      │
│ │  - Sensory details (what does fear smell like?)     │
│ │  - Physical reactions (racing heartbeat, cold sweat) │
│ │                                                       │
│ │ [Accept] [Dismiss]                                   │
│ │ ────────────────────────────────────────────────────  │
│ │ Refine:                                              │
│ │ [+warmer] [-generic] [+specificity] [+shorter]      │
│ │                                                       │
│ │ [User] I want it darker.                             │
│ │                                                       │
│ │ [Assistant] Here's a darker version:                 │
│ │  [streaming response...]                             │
│ │                                                       │
│ │ ─────────────────────────────────────────────────── │
│ │ Type your prompt here...                             │ ← textarea
│ │                                                       │
│ │                                        [Send]        │
│ │                                                       │
│ └─────────────────────────────────────────────────────┘
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Key annotations:**
- **Preset row** (top): `--space-4` margin below header, single-line chip design
- **Writing Tips** (optional): `--radius-md`, `--bg-inset` fill, `--text-sm` text
- **Chat messages**: consistent with existing WritingAssistantPanel.tsx styling
- **Refine chips**: appear between Accept/Dismiss and the next message
- **Input area**: unchanged from current

### 5.2 Preset Selector Dropdown (Writing Assistant)

```
┌─ Preset Selector (dropdown) ──────────────────────────┐
│                                                       │
│ ✓ Epic Fantasy          Grim & detailed              │
│   Modern Romance        Warm & emotional             │
│   Cozy Mystery          Balanced & clever            │
│   Literary Fiction      Somber & introspective      │
│   YA Adventure          Joyful & fast-paced          │
│                                                       │
│ ───────────────────────────────────────────────────  │
│ [+ Save Custom Preset]  (disabled, future)           │
│                                                       │
└───────────────────────────────────────────────────────┘
```

**Design tokens:**
- Background: `--bg-elevated`, `--elev-2` shadow
- Selected item: `--accent-soft` background, checkmark icon
- Hover item: `--bg-hover` background, brief `--dur-hover-in` fade
- Divider: `--border-subtle` 1px line
- Disabled action: `--text-muted` text color

### 5.3 Preset Editor Modal (Customize button)

When user clicks **[Customize]**, a modal opens showing the currently active preset's axes and allowing temporary adjustment.

```
┌─ Customize Preset (modal) ──────────────────────────┐
│                                                     │
│ Customize: Epic Fantasy                             │
│ (Changes apply only to this session)                │
│                                                     │
│ ──────────────────────────────────────────────────  │
│                                                     │
│ Genre:            [Fantasy ▼]                      │
│ Tone:             [Serious ─────●────── Joyful]   │
│ POV:              [Third Person Limited ▼]        │
│ Tense:            [Past ▼]                         │
│ Length:           [Moderate ────●────── Elaborate] │
│ Audience:         [Adult ▼]                        │
│ Content Avoid:                                      │
│   ☐ Explicit violence                              │
│   ☐ Sexual content                                  │
│   ☐ Profanity                                       │
│   ☐ Real-world politics                             │
│   ☐ Graphic descriptions                           │
│   ☐ Sad ending                                      │
│   ☐ Cliffhanger                                    │
│   ☐ Mundane details                                │
│                                                     │
│ ──────────────────────────────────────────────────  │
│                [Apply]  [Reset]  [Cancel]          │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Key design notes:**
- Modal: `--radius-xl`, `--bg-panel`, `--elev-3`, centered on screen
- Dropdown selectors: `--radius-sm`, `--bg-inset`, consistent with form components
- Sliders (Tone, Length): custom HTML range inputs styled with `--accent` thumb, `--border-default` track
- Checkboxes: standard native or custom styled with `--accent` checked state
- Buttons: [Apply] is primary (cyan, enabled), [Reset] is secondary (gray), [Cancel] is tertiary
- Motion: modal slides up with `--ease-out`, `--dur-panel` (280ms)
- Escape key: closes the modal (standard)

### 5.4 Brainstorm Page with Presets

```
┌─ Brainstorm Page ───────────────────────────────────────────┐
│                                                             │
│ [⎔] Brainstorm     [Focus: Characters ▼]                   │
│     [Epic Fantasy ▼] [Customize]                            │
│                                                             │
│ ─────────────────────────────────────────────────────────  │
│                                                             │
│ [User] What's a compelling backstory for a rogue?          │
│                                                             │
│ [Assistant] Here's a rogue backstory:                       │
│  [detailed text about a street urchin...]                   │
│                                                             │
│ Refine: [+darker] [-generic] [+specificity]                │
│                                                             │
│ ◆ Detected entities:                                        │
│   [Character] Kai Voss - A street urchin turned thief     │
│   [Item] The Crimson Dagger - A weapon with a past        │
│                                                             │
│ ➢ Add "Kai Voss" to: [Characters folder ▼] [Add]          │
│   or [Create in: new folder ▼]                             │
│                                                             │
│ ─────────────────────────────────────────────────────────  │
│                                                             │
│ What other angles could this character explore?            │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐│
│ │ Type your follow-up here...                              ││
│ │                                      [Send]              ││
│ │ (Refine chips hidden until response arrives)            ││
│ └─────────────────────────────────────────────────────────┘│
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Key differences from Writing Assistant:**
- Preset selector on same row as Focus dropdown (space-efficient)
- Refine chips appear inline with the assistant message
- Fact extraction remains unchanged (existing SKY-20 behavior)

### 5.5 Browse Presets Panel

A lightweight preset browser, accessible via **[Browse]** button on the Writing Assistant:

```
┌─ Browse Presets ──────────────────────────────────────────┐
│                                                           │
│ Select a preset to see its axes and apply it.            │
│                                                           │
│ ┌─ Epic Fantasy ───────────────┐  ┌─ Modern Romance ────┐
│ │ Genre: Fantasy                │  │ Genre: Romance      │
│ │ Tone: Serious                 │  │ Tone: Warm          │
│ │ POV: Third Lim.               │  │ POV: First Person   │
│ │ Tense: Past                   │  │ Tense: Present      │
│ │ Length: Moderate              │  │ Length: Moderate    │
│ │ Audience: Adult               │  │ Audience: Adult     │
│ │ Avoids: Explicit violence     │  │ Avoids: None        │
│ │             (allow)            │  │                     │
│ │                               │  │                     │
│ │           [Apply]             │  │       [Apply]       │
│ └───────────────────────────────┘  └─────────────────────┘
│
│ ┌─ Cozy Mystery ────────────────┐  ┌─ Literary Fiction ──┐
│ │ Genre: Mystery                │  │ Genre: Literary     │
│ │ Tone: Balanced                │  │ Tone: Somber        │
│ │ POV: Third Lim.               │  │ POV: First Person   │
│ │ Tense: Past                   │  │ Tense: Past         │
│ │ Length: Moderate              │  │ Length: Elaborate   │
│ │ Audience: Adult               │  │ Audience: Adult     │
│ │ Avoids: None                  │  │ Avoids: None        │
│ │                               │  │                     │
│ │           [Apply]             │  │       [Apply]       │
│ └───────────────────────────────┘  └─────────────────────┘
│
│ ┌─ YA Adventure ────────────────────────────────────────┐
│ │ Genre: Science Fiction                                │
│ │ Tone: Joyful                                          │
│ │ POV: Third Person Limited                             │
│ │ Tense: Present                                        │
│ │ Length: Moderate                                      │
│ │ Audience: Young Adult                                 │
│ │ Avoids: Explicit violence, Sexual content, Profanity │
│ │                                                       │
│ │                         [Apply]                       │
│ └───────────────────────────────────────────────────────┘
│                                                           │
│                                          [Close] or [⎔]  │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

**Design approach:**
- Grid layout: 2 columns on desktop (responsive to 1 column on narrower viewports)
- Each preset card: `--radius-md`, `--bg-inset`, `--space-4` padding
- Text: `--text-sm` for labels, `--text-xs` for values
- [Apply] button: primary cyan, `--radius-sm`
- Opens as a **full-height side panel** or **modal** depending on navigation context (see 5.6 below)

### 5.6 Panel Behavior — Writing Assistant

The Browse Presets panel should:
1. Open as a **slide-out side panel** from the right, overlaying the chat (on desktop)
2. On mobile/narrow viewports: open as a **full-screen modal**
3. Clicking [Apply] on a preset:
   - Closes the browse panel
   - Updates the Preset Selector chip to show the new preset
   - Does NOT immediately regenerate past messages (only applies to new queries)
   - Shows a brief toast: "Preset changed to [Name]"

---

## 6. Quality Rubric — User-Facing Doc

The rubric is published in the app as an **embedded Help article**:

**Path in UI:** Writing Assistant → Help icon (?) → "Quality Standards" OR Settings → Help & Documentation → "How to evaluate AI generations"

**Document content:**

---

### **Quality Standards for AI Generations**

*Use this guide to evaluate writing suggestions from the Writing Assistant and Brainstorm Agent.*

#### **The Five Criteria**

**1. Specificity** — Concrete details grounded in your world  
Does the text include unique details, names, sensory anchors, or specific traits?

*1★ Generic* — Uses vague language or placeholders. "The character entered and felt sad."  
*2★ Adequate* — Has basic details but could be richer. "Maya entered the tavern and saw people."  
*3★ Specific* — Rich, unique details. "Maya ducked under the tavern's low oak beams, sticky with ale and candlewax, and caught the smell of leather and wet peat."

---

**2. Coherence** — Consistency with prior context  
Does the text follow logically? Do character voices, world rules, and plot threads stay consistent?

*1★ Broken* — Contradicts earlier text or violates established rules.  
*2★ Plausible* — Follows logic but feels tacked-on.  
*3★ Seamless* — Builds naturally, echoes your voice, feels inevitable.

---

**3. Genre Fit** — Authenticity to your chosen genre  
Does the text sound like it belongs in this genre? Does it lean into or shy away from conventions?

*1★ Mismatched* — Contradicts the genre. A somber epic turning whimsical; a cozy mystery with graphic violence.  
*2★ Competent* — Follows genre tropes but feels generic.  
*3★ Authentic* — Feels at home in this genre and your voice. Uses conventions skillfully.

---

**4. Narrative Voice Consistency** — Steady POV, tone, and prose style  
Does the prose maintain the point-of-view, tone, vocabulary level, and sentence rhythm you've established?

*1★ Off* — Sudden shifts in tense, vocabulary, or POV.  
*2★ Close* — Generally consistent with minor slip-ups.  
*3★ Locked* — Indistinguishable from your surrounding text. Reads like one continuous passage.

---

**5. Usefulness as Starter** — Can you build on this draft?  
Is the output useful as a foundation for revision, or does it need to be discarded?

*1★ Starting over* — So off-base you discard it and begin fresh.  
*2★ Salvageable* — Usable with significant rewrites.  
*3★ Ready to revise* — Strong foundation, clear direction, only minor tweaks needed.

---

**How to use this guide:**

- After an AI generation, read through the criteria above.
- Ask: "How well does this hit each criterion?"
- If most are at 2–3★, the output is usuable; refine it with the **[Refine]** chips if needed.
- If most are at 1★, either discard and try again, or use the **[Refine]** chips to steer (e.g., `+specific`, `+genre-fit`).

---

---

## 7. State & Persistence — Implementation Handoff

### 7.1 Data Model

**New state slices:**

```typescript
// Per-vault state (persisted in vault config)
interface VaultPresetConfig {
  defaultPresetId: string; // e.g., "preset-epic-fantasy"
  customPresets?: Array<{      // future: user-saved presets
    id: string;
    name: string;
    axes: PresetAxes;
  }>;
}

// Per-session state (renderer memory, not persisted)
interface WritingSessionState {
  currentPresetId: string;      // active preset for this session
  presetOverrides?: Partial<PresetAxes>; // temporary adjustments from the Customize modal
}

// Global state (bundled in Electron, not persisted)
interface PresetLibrary {
  presets: Array<{
    id: string;
    name: string;
    description: string;
    axes: PresetAxes;
  }>;
}

interface PresetAxes {
  genre: string;
  tone: 'grim' | 'serious' | 'balanced' | 'warm' | 'joyful';
  pov: 'first' | 'second' | 'third-limited' | 'third-omniscient' | 'epistolary';
  tense: 'past' | 'present' | 'future';
  length: 'snippet' | 'brief' | 'moderate' | 'thorough' | 'expansive';
  audience: 'children' | 'young-adult' | 'adult' | 'academic';
  contentConstraints: string[]; // e.g., ['explicit-violence', 'profanity']
}
```

### 7.2 Electron Main Changes

**New IPC handlers:**

| Handler | Params | Returns | Purpose |
|---|---|---|---|
| `api.getPresets()` | — | `PresetLibrary` | Fetch all built-in presets |
| `api.getVaultPresetConfig()` | vault path | `VaultPresetConfig` | Get vault's default preset |
| `api.setVaultPresetConfig()` | vault path, config | void | Save vault's default preset |
| `api.getCurrentSessionPreset()` | — | `PresetAxes` | Get active preset + overrides for current session |
| `api.setCurrentSessionPreset()` | preset ID, overrides | void | Update session's active preset |

**Existing handlers (no changes):**
- `api.agentWritingAssistant(prompt, context, preset?)` — add optional `preset` param (PresetAxes object) to pass to the model
- `api.agentBrainstorm(prompt, preset?)` — same

### 7.3 Frontend Components — Scope of Change

**New or significantly modified:**

| Component | Change | Location |
|---|---|---|
| `WritingAssistantPanel.tsx` | Add preset selector, refine chips, customize modal | `frontend/src/` |
| `BrainstormPage.tsx` | Add preset selector, refine chips (share modal) | `frontend/src/` |
| `PresetSelector.tsx` | NEW: Dropdown menu for preset selection | `frontend/src/components/` |
| `PresetEditor.tsx` | NEW: Modal for customizing preset axes | `frontend/src/components/` |
| `PresetBrowser.tsx` | NEW: Side panel for browsing all presets | `frontend/src/components/` |
| `RefinementChips.tsx` | NEW: Shared refinement chip group | `frontend/src/components/` |
| `WritingAssistantPanel.css` | Add preset row, refine row, chip styles | `frontend/src/` |
| `BrainstormPage.css` | Add preset row, refine inline styles | `frontend/src/` |

**Mostly unchanged:**
- Scene editor, vault sidebar, all other surfaces

### 7.4 Vault Persistence

**File shape:**
- Vault config already lives in `vault.meta.json` or equivalent (CTO to confirm exact path)
- Add `writerAssistant: { defaultPresetId: "preset-epic-fantasy" }` section
- On first vault open, default to `"preset-epic-fantasy"` (or a sensible default for first-run users)

### 7.5 Refinement Generation Flow

When user clicks a refinement chip:

1. **Frontend:** Gather the active preset + the clicked refinement adjustment (e.g., `+specific` → Tone shift + Length increase)
2. **Frontend:** Disable all refinement chips (prevent stacking)
3. **Frontend:** Emit the same `.agentWritingAssistant()` or `.agentBrainstorm()` call, but with an updated preset param
4. **Electron:** Route the preset to the model prompt context (as a constraint, instruction, or few-shot example — CTO to choose)
5. **Model:** Regenerate with the adjusted style parameters
6. **Frontend:** Dim or archive the prior response, show the new one with fresh refinement chips

---

## 8. Open Questions & Risks

### 8.1 Questions for CTO

1. **Preset → Model binding:** How should preset axes translate to the model prompt? (Constraint instructions? Few-shot examples? System prompt?)
2. **Refinement stacking:** If a user refines multiple times, should each adjustment stack or reset to the base preset? (Spec assumes: build on prior adjustment)
3. **Per-vault vs. global defaults:** Should there be a app-level default preset, or always require vault selection? (Spec assumes: app-level default, vault can override)
4. **Content constraints implementation:** Are content constraint tags (e.g., "avoid: sexual content") already wired into the model, or new work? (Spec assumes: CTO owns backend alignment)

### 8.2 Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Regression in Writing Assistant** (SKY-316/317) | Preset selector is purely additive; empty state behavior unchanged. All existing interaction patterns preserved. |
| **Refinement UX overload** | Only 5 chips max per message; dynamically chosen (not all shown). Chips hidden initially; users opt-in by clicking. |
| **Preset axes too many/too few** | Current 7-axis model tested against user feedback (MYT-515). Can be refined in future; not a blocking concern. |
| **Model doesn't respect presets** | Fallback: presets become UI affordances only, helpful for documentation. Handoff clarifies model-side ownership (CTO). |
| **Vault persistence breaks on upgrade** | `vault.meta.json` already versioned; add a migration handler if schema changes. Low risk if integrated early. |
| **Accessibility: modal/dropdown UX** | All components keyboard-navigable (↑↓, Enter, Esc). Modals have focus traps. Contrast meets WCAG AAA per Liquid Neon spec. |

---

## 9. Acceptance Criteria

This spec is **complete and ready for handoff** when:

- [ ] All 5 deliverables are present and detailed above (presets, refinement, rubric, mocks, handoff)
- [ ] Wireframes show both Writing Assistant and Brainstorm surfaces with presets and refine chips integrated
- [ ] Quality rubric is defined with 5 criteria and 1–3 anchors each
- [ ] State shape and IPC handlers are specified (section 7)
- [ ] Open questions are listed and assigned to CTO for pre-implementation discussion
- [ ] No regressions on existing Writing Assistant or Brainstorm flows (confirmed by visual walkthrough)
- [ ] Spec is posted to SKY-456 as a document
- [ ] Issue is set to `in_review` and assigned to CEO with `request_confirmation` interaction

---

## 10. Next Steps — Implementation Handoff

When this spec is approved, file a **frontend implementation child issue** with:

- **Title:** "Implement creative quality controls — presets, refinement, rubric UI" or similar
- **Linked to:** SKY-456 (this spec issue)
- **Assigned to:** ProductEngineer or CTO (per team capacity)
- **Blockers:** SKY-456 (must complete spec approval first)
- **Acceptance criteria:**
  - All preset UX surfaces (selector, customize modal, browse panel) render and respond to user interaction
  - Refine chips appear and trigger new generations with adjusted preset
  - Vault config persists default preset across sessions
  - Quality rubric is accessible via Help interface
  - All surfaces are accessible (keyboard nav, contrast, focus management)
  - E2E tests cover: apply preset → generate → refine → save vault config → close/reopen
  - No regressions on existing Writing Assistant or Brainstorm tests (CI green)

---

**Spec authored by:** UXDesigner  
**Created:** 2026-06-02  
**Status:** Ready for CEO review
