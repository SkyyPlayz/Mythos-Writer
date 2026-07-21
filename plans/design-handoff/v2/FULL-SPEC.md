# MYTHOS WRITER — COMPLETE BUILD SPECIFICATION
### "Liquid Neon" · v1.1 (refined) · Ground-up spec for Claude Code (Fable 5)

**Read this as if nothing is built.** This document tells you what to build, where it goes, how it looks, and exactly how it behaves. The pixel-perfect reference for every screen is `prototype/Mythos Writer - Liquid Neon.dc.html` — open it in a browser and click everything before writing code. **When this doc and the prototype disagree, the prototype wins.** When neither covers something, follow the interaction principles in §1.

---

## 0. PRODUCT IN ONE PARAGRAPH

Mythos Writer is a desktop (Electron) writing studio for fiction authors. One **Mythos Vault** (a plain folder of Markdown files) holds a **Story Vault** (manuscripts) and a **Notes Vault** (a worldbuilding wiki, Obsidian-compatible). Around them: a rich manuscript editor, a Plottr/Aeon-class multi-timeline, a brainstorm canvas, a knowledge graph, and four AI agents — **Writing Coach** (teaches, never ghost-writes), **Brainstorm Agent** (curates the vault), **Archive Agent** (continuity + auto-builds timelines), **Beta Reader** (first-time-reader reactions). Note linking is NOT an agent job — it is a deterministic built-in **Auto Note Linker** (behavioral port of `kdnk/obsidian-automatic-linker`). Every AI-judged feature has a manual path; a user with zero AI budget can do everything by hand.

---

## 1. TECH, PRINCIPLES & GLOBAL BEHAVIOR

**Stack:** Electron 30+, React 18, plain CSS-in-JS or CSS modules (no heavy UI framework — the design is fully custom). Local files are the database; a per-vault `settings.json` stores preferences. No cloud requirement for core features.

**Interaction principles (apply everywhere):**
1. **Direct manipulation first.** Anything visual is draggable/resizable/editable in place; the inspector and menus are the fallback, never the only path.
2. **Nothing is dead.** Every visible control either works or explains itself (tooltip + toast). No silent no-ops.
3. **Popups**: every dropdown/popover has an invisible full-screen backdrop; clicking it closes the popup. The backdrop's click handler MUST call `stopPropagation()` so it can't re-trigger the button that opened it (this bug shipped once; never again).
4. **Numeric inputs never fight the user.** Formatted numeric fields (dates, years, px) keep a raw draft while focused and commit on blur/Enter. Never reformat mid-keystroke.
5. **Provisional creation**: the `+` new-scene tab opens a scene immediately but does not persist it until the user types or renames it; closing/navigating away discards it silently with toast `Empty scene discarded — nothing was saved`.
6. **Toasts** confirm every action: bottom-center pill, glass bg `rgba(15,19,33,.97)`, 1px slot-A border, ~2.5 s, one at a time.
7. **Undo**: destructive actions (delete card/event/row, load draft) are undoable; Load-draft shows an explicit yellow `Undo` chip.
8. **Scrollbars**: `::-webkit-scrollbar` 8px, thumb `rgba(255,255,255,.14)` radius 99px, hover `.25`. Everywhere.
9. **Hit targets** ≥24px in panels, ≥32px toolbars, 44px+ anything touch-like. All sibling rows/chips laid out with flex/grid + `gap`, never margins between inline siblings.
10. **Performance**: target 60fps. Backdrop blur is expensive — blur values are user-tunable; `Reduce motion` pauses ambient + neon animation in one switch; `Reduce glow` caps glow intensity. Never animate `box-shadow` on more than ~6 elements at once.

**Keyboard map:** Ctrl+K command palette · Ctrl+P print/export · Alt+←/→ prev/next scene (plain arrows stay in text) · Ctrl+scroll zooms the timeline axis · Enter splits paragraph · Backspace at paragraph start merges up · Enter commits inline renames · Esc closes topmost popup/modal.

---

## 2. DATA MODEL & FILES

```
MythosVault/                      ← user picks any folder (local, Dropbox, network)
  mythos.json                     ← vault id, name, default theme, story list, timelines
  settings.json                   ← per-vault user settings (everything in §13)
  Story Vault/
    <Story Name>/
      book.md                     ← compiled order + metadata
      Part 1/Chapter 01/Scene 01.md   ← scene = md + frontmatter {title, status, pov, when}
      drafts/Scene 01.draft-6.md      ← numbered snapshots
  Notes Vault/
    Worldbuilding/… Characters/… Plot/…   ← plain Obsidian-style .md with frontmatter
  timelines.json                  ← all timelines, eras, spans, events, custom rows (§8 schema)
```
- Scene status: `todo | draft | done`. Frontmatter `when:` = timeline date (year×10 float, §8.2).
- Notes support Obsidian frontmatter incl. `aliases:`, `tags:`, and auto-linker opt-outs (§12).
- Seed a NEW vault with the demo content from the prototype ("The Last City of Veynn", 3 books/45 chapters skeleton, sample notes: Mira Veynn, Kael Thorne, The Sunken Gate, Tide Mechanics…, the starter idea library §7) so every screen demos itself. Seeding runs ONCE (marker in mythos.json) — re-seeding on boot was a shipped bug; never again. Story-internal folders (scene UUIDs) must never appear in the Notes tree.

---

## 3. THEME SYSTEM — "LIQUID NEON"

Dark glassmorphism over a wallpaper.
- **Layer stack:** wallpaper PNG (theme-matched art) → scrim (default 10% black, slider) → glass panels `rgba(13,16,28,.72)` + `backdrop-filter: blur(18px) saturate(150%)` → 1px neon borders + outer glow `0 0 26px -7px <slot>`.
- **6 neon slots** (each = border color + glow + soft fill derived at 12% alpha):
  A `#00f0ff` left panel/primary · B `#9b5fff` center/wiki-links · C `#ff4dff` right panel/agents · D warm data (ideas/items) · E cool data (systems) · F nav rail/timeline. Defaults from active preset.
- **Type:** Lora (manuscript, page/section titles) + Inter (all UI). UI sizes: panel headers 12.5px/600, body rows 11.5px, sublabels 10px, section eyebrows 9.5–10px/700/letter-spacing .12em uppercase, view titles 21px Lora.
- Text: headings `#f0f3fc`, body `#c8d3e7`, muted `#8e9db8`, faint `#7686a2`. Primary buttons: gradient `linear-gradient(120deg,#00f0ff,#9b5fff,#ff4dff)` with near-black text `#0b0d17`, 700 weight.
- Radii: panels 18px, cards 13–15px, chips 99px, inputs 8–9px.
- **10 presets** (each with unique wallpaper art): Neon Classic, Aurora (real northern-lights artwork — green/teal curtains, star field, ridge silhouette), Cyberpunk, Sunset Coast, Ice Mono, Emberfall, Verdant Reach, Royal Arcana, Noir Rose, Winterlight.
- **Preset import/export** (Appearance header buttons): JSON `{slots, setKey, wp, ambMode, frameAnim}` — export copies to clipboard/file, import applies live, invalid file → toast `Not a valid theme preset file`.
- **Per-vault default theme**: dropdown on each vault card; switching vaults applies its theme + toast.
- **Settings → Appearance card order:** 1 Color theme (preset cards + export/import) · 2 Neon border colors (6 rows: label+role, live swatch, hex, 11 curated swatches + rainbow wheel) · 3 Glow & glass (sliders: Neon intensity %, Border thickness 1–4px, Glow radius 0–120px, Glass opacity, Backdrop blur 0–40px, Wallpaper scrim; toggles: Animated panel glow, Reduce glow) · 4 Background (wallpaper cards + upload custom) · 5 Background animation (Theme match/Snowfall/Rising/Off + drift speed %) · 6 Neon animation (Off/Cycle/Sparkle + speed) · 7 Interface (density seg Comfortable/Cozy/Compact; Nav rail labels toggle; Reduce motion; App text color wheel; Button text color wheel). No "neon window frame" ring around the app — panels only.

---

## 4. APP SHELL

Top→bottom: **Title bar** (44px) → body row (`nav rail | left panel | center | right panel`, 10px gutters) → **status bar** (26px).

**Title bar:** fox logo + "Mythos Writer" (click = Mythos-vault switcher popover listing every vault with location/stats + quick-switch + `New Mythos vault…`), menus **File Edit View Insert Tools Help** (real dropdowns; File: New scene, New note…, Import vault…, Export…; Edit: Undo/Redo/Find everywhere; View: toggle left/right panel, Focus mode; Insert: Beat, Comment, Wiki link; Tools: Run continuity scan (Archive), …; Help: Welcome tour, About, Check for updates). Center: `Search vault…` field + `Ctrl` hint → **command palette** (Ctrl+K): fuzzy list grouped Notes / Scenes / Commands, Enter opens. Right: bell (notification feed: agent events, each row deep-links), quick settings, avatar, window controls.

**Nav rail** (72px, slim 44px): Story Writer, Notes Editor, Scene Crafter, Brainstorm, Timeline, Vault Graph; Settings + user/collaborator avatars at bottom. Icons 16px + 9.5px labels (labels always on unless slim toggle). Active = slot-glow pill. Edit popover (pencil at rail bottom): drag-reorder modules, hide/show. Story Writer button re-click opens the **stories switcher** (stories in the CURRENT vault only, + New Story wizard: name, genre voice preset — "tunes the Writing Coach", link existing note folders).

**Workspace tab strip** (38px, inside center panel top, Story + Notes views ONLY — hidden on Brainstorm/Timeline/Graph/Settings/Beta): document tabs (status dot, label, ×), `+` (provisional scene per §1.5), right "All agents idle/…" status. Drag: reorder within strip; drag DOWN (lower 45% of window) or RIGHT (right 44%) shows a highlight zone and opens the doc as a **split pane** — a second fully editable editor (own sheet, own scroll); dropping a notes tab splits notes. Right-click tab: Open to the side / Pop out into new window / Close.

**Status bar:** `‹ › nav · words · characters · read time · Page W px — drag page edge to resize` … right: status chip, goal chip, `Saved 2m ago` + pulsing dot.

---

## 5. STORY WRITER (view `editor`) — sub-tabs **Editor · Coach · Structure · Book**

### 5.1 Editor
- **Doc header row:** zoom seg (Full Book/Part/Chapter/Scene), breadcrumb, editable doc title + star; right: Draft dropdown (`Draft 7 ▾` current), live word count, comments chip (count, gold), **Drafts** (opens compare split), **Focus**, ⋯ menu (Rename, Duplicate scene, Save snapshot now, History…).
- **Format toolbar** (single row, 26px controls): style select (Body Text/H1/H2/H3/Quote) · font (Lora/Georgia/Palatino Linotype/Inter) · size stepper · **line-spacing dropdown** (1.15/1.3/1.5/1.85 default/2/2.5/3/3.5/4/5/6) · B I U S · align ×4 · lists/indent · `+ Part + Chapter + Scene` (insert after current) · right: **Read** (opens Reader card in right gutter: play/pause, ±10s, prev/next scene, from-cursor/from-start, speed 50–200%, voice select incl. Edge natural voices; highlights the sentence being read), **Dictate**, **Coach** (purple, opens Coach chat).
- **Margin ruler** (15px, under toolbar): tick marks every 24px (major 120px), end stops, glowing slot-A span = page width, two slot-B **diamond handles** (8px, rotate 45°) drag symmetrically to resize the page; live `1000 px` readout floats top-right of the sheet while dragging. Ruler width subtracts the comment gutter (250px) when open so it stays centered over the page.
- **The sheet:** centered, width = pageW (default 1000, clamp 520–3000, also draggable at sheet edges), maxWidth 100%. Page styles (Settings→Editor, live): **Neon** (glass + slot-B border/glow) / **No glow** / **Scroll** (parchment gradient, sepia tint + opacity sliders, optional glowing archaic runes) / **Custom** (user-uploaded texture image, cover-fit) / **Off**. Padding ~64–96px.
- **Editing model:** every paragraph contentEditable. Enter splits at caret; Backspace at start merges; empty paragraph on blur is removed (min 1 per scene). Part/Chapter/Scene headings inline-editable; renaming a provisional scene persists it. First scene paragraph gets a drop cap. Scene heading dot cycles status on click. Left grip (6-dot, 26px hit area) drags a paragraph to another position: selection is suppressed during drag, dragged block dims to 38%, gradient insert line marks the drop, drop reorders; drag state always clears on mouseup anywhere.
- **Word/char/read-time** computed from actual text at current zoom scope.
- **Comments:** selecting text pops a composer (input + Comment + Read-aloud); comments = underlined segments (kind color) + right gutter cards (author, quote, body; actions Resolve / Update note / Suggest edit). Kinds: user gold `#ffd319`, Writing Coach slot-A, Archive Agent pink `#ff5f8f`. `Show in focus` toggle.
- **Drafts split:** header `DRAFTS — <scope>` (always the OPEN scene/chapter) + draft select + `Highlight changes` toggle + **Full diff** (side-by-side; **current draft ALWAYS the left/green column**, previous right/red, labeled) + **Load draft** (replaces current, yellow Undo chip appears) + close. Read-only compare text on the split side.
- **Alt+←/→** moves between scenes at scene zoom (chapters at chapter zoom).

### 5.2 Coach — the Writing Coach's page
Header: 34px grad-cap icon tile (slot-B), title **Writing Coach**, sub `Teaches you to write better using your own pages — it never ghost-writes`, **session dropdown pill**, spacer, 3 skill chips (`Dialogue Strong` green / `Pacing Improving` yellow / `Description Focus area` pink). Body: 760px-centered chat feed — user bubbles (right, slot-A tint), coach bubbles (left, glass), **lesson cards** (slot-B tinted card: bold title `Lesson — Show, don't tell (using YOUR scene)`, paragraph quoting the user's own prose, `→` bullet points, yellow clock-icon drill footer `Drill: … 5 minutes.`), **analysis cards** (§5.4). Typing = 3 pulsing dots. Chips row: `Review my open scene like a teacher` / `Teach me pacing with my own text` / `Why does my dialogue feel flat?` / `Give me a 10-minute writing drill`. Input textarea + gradient send. Footer: `Lessons reference your open scene · drills are 5–10 minutes · your coach never writes prose for you`.
Right rail (266px): **SUGGESTIONS** — collapsible groups, **General** first, then `Chapter N` (current chapter marked `· current`, open by default); items = title + one-liner; click = `Teach me: <title>` into the chat. Footer hint `Click a suggestion and the coach turns it into a lesson.`

### 5.3 Structure
Chapter cards grid/list (scene rows w/ status chips, drag scenes), beat-sheet templates in right panel. Grid/List seg.

### 5.4 Scene Analysis (right-panel card + full view)
Card rows: Purpose, Tension, Pacing, POV, Word Count, Read Time + one-line note. **View Full Analysis** → Coach page appends an **analysis card**: header `Full Scene Analysis — Sc. N · <title>`; section `COMPUTED · LOCAL · FREE` (green badge; 2-col grid: Words, Read time, Avg sentence length, Dialogue·Description·Action %, Filter words w/ location, Adverb dialogue tags) — computed with plain text analysis, ALWAYS available; section `COACH'S READ · AI` (purple badge, `judgment calls — needs a model`; Purpose/Tension/Pacing/POV each with a teaching clause); takeaway paragraph; drill footer. This computed-vs-AI split is the pattern for all AI features.

### 5.5 Book
Compiled manuscript + **Export modal**: format cards (DOCX/PDF/EPUB), scope seg, synopsis + separator options, progress state, Done.

### 5.6 Right panel (Story) — tabs **Assistant · Scenes · Notes · References**
Assistant tab = **agent hub**: AGENTS card (compact rows: 30px icon tile, name, status dot+text; description on hover tooltip; click → in-panel chat: back button, icon+name+status, **session dropdown pill** (§11), scrolling feed incl. issue cards (severity chips) and note cards (deep-link), chips, textarea+send). The Writing Coach panel chat and Coach page share ONE conversation (lesson messages collapse to `title — text` in the mini view). Below: **Suggestions** card (`WRITING COACH` badge + count, 3 suggestion rows, `See All Suggestions` → Coach page) then **Scene Analysis** card. Scenes tab: scene list. Notes: quick notes. References: wiki targets w/ create-on-click.

---

## 6. NOTES EDITOR (view `notes`)

**Left panel:** Notes-vault switcher dropdown (main / imports / `Import a vault…` → Settings), search field, **explorer toolbar** (5 icon buttons, Obsidian parity): New note (opens template picker popover: Character `Bio, arc, relationships, voice` / Location / Faction / Item·System / Event·History / Blank — Brainstorm pre-fills what it knows), New folder (creates at root), Sort (cycles manual→A–Z→Z–A, active tint), **Auto-reveal current file** (toggle; tree expands to the open note now and on every note switch), Collapse/expand all. Folder tree: chevrons, counts, drag-drop notes between folders (dashed outline on target), right-click: Open in new tab / Beta read / Continuity check / Rename… / Delete. RECENT list below.

**Center:** note tabs strip (same behaviors as editor tabs incl. split), note header (editable Lora title, tag chips + add-tag input, gear → view seg Rich/Markdown/Source), body blocks all contentEditable: paragraphs, H2s, callout cards (purple, titled), bullet lists (edit/add/remove items), links block; backlinks footer. `[[wiki links]]` styled slot-B; resolve to notes or scenes; unresolved → toast offering creation. Markdown + Source views render raw. Frontmatter NEVER renders in Rich view (shipped bug: kanban frontmatter as giant heading — never again).

**Right panel:** tabs Agent / Properties. Agent = Brainstorm Agent chat (`Curator of this vault — tell it your world`) with **CONTINUITY FLAGS — `ARCHIVE AGENT` badge** section (flag cards: title, Story↔Vault source, body, actions). Properties = frontmatter table.

---

## 7. SCENE CRAFTER (view `crafter`) & BRAINSTORM (view `brainstorm`)

### 7.1 Scene Crafter
Left: SUGGESTED CARDS from vault (click/drag to canvas). Center: **Craft a scene** form (title, POV select, GOAL + CONFLICT textareas, BEATS list: add/drag/delete chips, tone select, length seg Short/Medium/Long) + **canvas** (2200×1500 world; pan empty space, wheel zoom 40–240%, cards with colored headers + avatar chip → opens linked note, link tool draws connections) + gradient **generate** → draft card (`— first pass`, word count, preview; actions: Insert into manuscript (adds scene after current), Retry, Discard; summaries land on the board, never silently into the manuscript). Copy frames drafting as the Coach's teaching scaffold: `Set the shape — the Writing Coach drafts a first-pass scaffold from YOUR beats, then annotates why it made each choice, so the rewrite teaches you.` Right: Scene board kanban (beats/cast/places).

### 7.2 Brainstorm — no tab strip
Header: `Brainstorm Agent` / `Brainstorm Center` (Lora) + **session dropdown pill** + page seg **Agent Chat | Board** (**Agent Chat is the default page**) + genre-preset select; Board page adds `+ Idea` + `Search ideas…`; Chat page adds **Board toggle** (shows the canvas stacked under the chat with a drag-bar to resize its height) + `Extracting facts to vault` live chip.
- **Agent Chat:** centered feed (user/bot bubbles, note cards that open vault notes, typing dots), chips (`A market where memories are traded`…), textarea + gradient send, footer `Named characters, locations and rules are extracted automatically — watch the activity feed on the right.`
- **Board:** ONE canvas (no Board/Map/Clusters modes). Floating category labels over home regions: STORY BEATS, CHARACTER RELATIONSHIPS, WORLDBUILDING CLUSTERS, THEMATIC IDEAS, LOOSE IDEAS, TROPES. Idea cards 216px (glass, category border, title, desc, chips, optional avatar): **drag anywhere** (positions persist), wheel zoom, pan, **Connect tool** (click two cards → purple line), **double-click card = inline edit** (title input + desc textarea + Done; Enter commits), **card titles matching a vault note are underlined → click opens the note**. Dock: Select/Connect/Frame + zoom −/％/+. Status: `N ideas · M connections · K clusters · Synced`.
- **Left panel: IDEA COLLECTIONS** (no story-context block) — search box filters + auto-expands; collapsible groups: All Ideas, Story Beats, Characters, World & Lore, Themes, **Tropes**, Loose Ideas. Rows = agent-filed vault notes: `+` adds to board (jumps to Board), `✓` dimmed = already placed. **Preloaded starter library** (chips `Starter`): beats — Midpoint Reversal, The Ticking Clock, Point of No Return; **12 tropes** — The Chosen One, Enemies to Allies, The Reluctant Hero, The Betrayal, The False Victory, The Mentor Falls, Enemy at the Table, Hidden Parentage, The Prophecy Misread, Redemption Arc, Fish Out of Water, The Heist Gone Wrong; 6 themes — Power Corrupts Quietly, Found Family, The Cost of Truth, Becoming the Monster, Home You Can't Return To, Legacy vs. Choice; 4 loose sparks (20-years-late letter, town that votes on weather, swapped secrets, last speaker of a language). Footer: `Ideas the agent captures in chat land in your Notes Vault and appear here — click + to place one on the board.`
- **Right panel:** `Brainstorm Agent` + LIVE badge, stats (Notes/Links/Props), BEHIND THE SCENES activity feed, **QUESTIONS FOR YOU** (open questions; click sends the question into the chat), **NOTES THAT NEED WORK** (rows w/ `MISSING` pink / `NEEDS WORK` yellow chips; click drafts/opens), explore buttons, saved prompts, QUICK GENERATE box.

---

## 8. TIMELINE (view `timeline`) — flagship; no tab strip

### 8.1 Multiple timelines + nesting
Left panel top: **timeline picker** (purple card: chart icon, current name + kind, chevron → dropdown: all timelines w/ active dot, `+ New timeline`, `Edit calendar… (12 months × 30 days × 24h days)`, hint `Drop an existing timeline into another as a span — click a span with a dashed border to open it`). Seeds: **The Last City of Veynn** (Story timeline · 3 books, axis 869.5–874.8 EC), **World of Veynn** (838–880), **Universe — The Great Cycle** (0–920). Every timeline owns: name, kind, axis [start,end], **calendar** {months/yr, days/mo, hours/day; default 12·30·24; preset `Strange world — 13 × 28 · 18h`}, eras, spans, custom rows.
**Embedding:** a span may `open` another timeline → dashed border, sub `timeline · click to open`, and **mini preview strips** rendered inside the span (the embedded timeline's own spans, scaled to its axis — a fully-zoomed-out thumbnail). Clicking opens that timeline; inspector `EMBEDS TIMELINE` select attaches/detaches. Intended flows: story ⊂ world ⊂ universe; short stories dotted along a universe; each opens for a close view.

### 8.2 Time model
`when` = year × 10, float (871.25 = quarter into year 871). Encode/decode through the ACTIVE timeline's calendar: fraction-of-year ↔ (month, day, hour). Guard all math against null/NaN (fall back to axis start — a NaN once blanked the app; never again).

### 8.3 The axis (Progress & Structure lanes)
- **ERAS bar** (19px): named era spans (colored, uppercase). `ERAS +` side label adds one. Tick row beneath; faint vertical gridlines through all rows. **Tick labels adapt to zoom**: coarse `871 EC` → `Y871 · M3` → `M3 · D14` → `D14 · 06:00`.
- **Zoom:** seg **Year/Quarter/Month/Week/Day** + **Ctrl+scroll** continuous (×0.55–×44 ≈ half-day at full zoom); content min-width grows, horizontal scrollbar at the container bottom; tick density scales with zoom.
- **Universal direct manipulation:** every plotted item **drags to move in time** (3px threshold; rough placement, toast `Rough time set — fine-tune with the exact-time picker`); span-like items (**eras, books/story spans, arcs, character lines, custom-row items**) have **7px edge handles → ew-resize** to change start/end; point items (**key events, world events**) drag-move only. Click (no drag) selects → Inspector tab. **Exact-time picker modal** (from inspector `Set exact time…` buttons and the event editor's `DATE / TIME` button): START (+ END when the target has from/to) as four mono inputs YEAR/MONTH/DAY/HOUR in the timeline's calendar, calendar note + `change` link → **Calendar editor modal** (three number fields + presets). Apply toasts `Exact time set — replotted on the axis`.
- **Auto-stacking:** overlapping items flow into additional lanes (row height grows to fit); **touching edges (end == next start) do NOT stack**; characters always one thin lane each. Lane assignment: sort by start; place in first lane whose last end < item start + ε(0.15%).

### 8.4 Lane rows, top→bottom (Progress = DEFAULT mode; Structure identical minus progress styling)
1 ERAS · 2 **BOOKS** (story) / **SPANS & STORIES** (world/universe; embedded timelines live here) — all date-plotted spans `PLOTTED BY DATE`, `+` adds a span → inspector · 3 ARCS (I–IV gradient bars, date-spanned) · 4 CHAPTERS (45 mini blocks positioned by date; tooltip `Chapter N · Year 871.3 EC`; "you are here" ring on current) · 5 **PLOTLINES** (`TOGGLE IN LEFT PANEL`: one thin lane per visible plotline — dot + mini scene-card chips plotted at their chapter's date; click chip → card inspector) · 6 KEY EVENTS (cards 215px: icon tile, title, chapter, 2-line desc, `FLASHBACK` gold badge when chronology ≠ narrative; `+` add) · 7 CHARACTERS (`LIFESPANS · APPEARANCES`: name + glowing 3.5px line) · 8 WORLD (compact chips: day label + title) · 9 THEMES (gradient chips) · 10 **CUSTOM ROWS** — `+ Custom row` adds a user-named row (inline-editable uppercase name + `remove`); items are plotted spans (`+` per row) for anything: MAGIC SATURATION, seasons, faction power…
- **Progress extras:** written vs planned (planned items grayscale/dim), legend chips in header, current-position marker. Book cards in left panel focus/dim everything to one book (Overview resets).
- Toolbar: mode seg **Progress · Structure · Plotlines · Spreadsheet · Tension · Relationships · Subway** · filter selects (View / Group By / Show — all functional: Show filters events written/planned/key; View jumps modes; Group By regroups the sheet) · **Templates ▾** (Three-Act 7 beats / Save the Cat 8 / Hero's Journey 8 → new dashed beat-card plotline, toast) · `+ Plotline` · zoom seg · **Today** (jumps/selects current position).

### 8.5 Other modes
- **Plotlines:** Plottr grid — sticky left column of plotlines (dot, name, count), 12 chapter columns (`YOU ARE HERE` under current), scene cards in cells (written = colored left bar; template beats dashed); drag cards between any cell; `+` per cell; grid min-width scales with zoom seg.
- **Spreadsheet:** table EVENT/CH/DATE·ERA/POV/LOCATION/IMPACT + **Narrative ⇄ Chronological** seg (`Chronological re-sorts by in-world date — flashbacks surface out of narrative order`, FLASHBACK badges) + group header rows per Group-By filter.
- **Tension:** SVG dramatic-arc curve, one draggable point per chapter (ns-resize) vs dashed classic-arc reference, ACT separators, legend `your story / classic arc`.
- **Relationships:** character rows × event columns presence dots. **Subway:** colored character lines through event stations.
- Redlines/theming/states for Progress·Structure·Spreadsheet·Relationships·Subway: `docs/TIMELINE-VIEWS-DESIGN-SPEC.md` (SKY-7253). Plotlines+Tension layout plus the full keyboard-nav/a11y layer for all 5 view modes named in M24 (built ahead of SKY-6980): `docs/TIMELINE-VIEW-MODES-A11Y-SPEC.md` (SKY-7770).

### 8.6 Right panel — tabs **Inspector · Brainstorm · Archive**
- **Inspector** (any click anywhere selects into it): Event editor (pencil toggles edit: TITLE, CHAPTER, **DATE/TIME button → picker**, LOCATION, POV, SUMMARY, Done/Delete; static view shows rows + KEY EVENT badge + impact chips). Lane-item editor (kind label Era/Span/Arc/Journey/World/Custom: TITLE, STARTS/ENDS (or APPEARS/UNTIL, or DAY+YEAR), `Set exact time…`, EMBEDS TIMELINE (spans only), COLOR swatch row, Delete). Plotline-card editor (title/plotline/chapter/what happens/written toggle/delete). All numeric fields use draft-commit (§1.4).
- **Brainstorm tab:** purple blurb `Brainstorm Agent — notes keeper: manages your notes. Ask it to look over the timeline and structure all of it into the vault, then flesh out the events together.` + gradient **Structure timeline into notes** + **NEEDS FILLING OUT** running list (blank-summary events, unreplaced template beats, thin world events — click jumps to the fix) + mini **chat** (bubbles + input, shares the Brainstorm agent conversation).
- **Archive tab:** gold blurb `Archive Agent — timeline builder: auto-builds this timeline from your manuscript and vault.` + quick `Add the festival from Ch. 4…` input (`Add` → agent dates & plots it) + RECENTLY AUTO-ADDED ✓ list + mini chat.

---

## 9. VAULT GRAPH (view `graph`) — no tab strip

Force-directed graph: category-colored nodes (size = degree), labels, edges (note-note vs story links colored differently, user-recolorable). Drag = pin, wheel zoom + Fit, pan, **Re-layout** (re-run physics), hover dims non-neighbors, click → right card (blurb, CONNECTIONS list each clickable, `Open note`). Left: category filter rows (eye toggle + recolor wheel + counts), story-cluster toggle (gold), connection-line colors, physics sliders (center/repel/link/distance).

---

## 10. BETA READER (view `beta`) — no tab strip

Header: eye icon tile (sky `#8ad9ff`), title + `Reader-eye reactions — reads your pages like a first-time reader and leaves honest feedback`, seg **Reports | Chat**.
- **Reports:** feed of report cards (scope + `read as First-time reader` + time; score chips Hook/Pacing/Clarity/Emotion with verdict colors; overall paragraph; REACTIONS list — `LOVED` sky / `STUMBLED` yellow / `CONFUSED` pink chips + italic quote + where + note). Right column: **Run a Beta Read** (WHAT TO READ select: full book/every part/every chapter; FOCUS ON toggles ×4; gradient Run → pulsing `Reading…` → new report on top + margin comments, toast) + How-it-works card (`Nothing is rewritten; the Beta Reader only reacts.`).
- **Chat:** session pill + full chat (reaction cards inline) + chips (`Read Chapter 2 like a first-time reader`, `Where did you get bored?`, `Did the token twist land?`) + input.
- Left panel: BETA READS history + `Reactions inline in editor` link. Right panel: General feedback (reads count, WORKING WELL, WATCH LIST, `See reactions in the manuscript`).

---

## 11. AGENTS — shared architecture

- Exactly four. Every AI surface carries an attribution badge. **Duties** (shown as chips in Settings): Coach — lessons & drills, per-chapter suggestions, Scene Analysis AI read, Crafter first-pass drafts, inline prose comments. Brainstorm — chat & board, fact extraction → notes, idea collections, notes-panel agent, template pre-fill. Archive — continuity scans & flags, story↔vault fact checks, timeline building & dates, vault imports. Beta — reads, margin reactions, pacing/clarity reports.
- **Sessions everywhere:** every chat (panel chats, Coach page, Brainstorm page, Beta chat, timeline side-chats) has a session dropdown: current name + list (name, `N messages`, active dot), `+ New chat` (greeting seeded per agent), right-click → Rename (inline input, Enter/blur commits) / Duplicate (` (copy)`) / Delete (deleting the last creates a fresh one; deleting current switches to first). Coach page ↔ Coach panel chat share one store.
- Personality: Coach teaches and never writes prose; Brainstorm asks questions and files notes; Archive is precise and cites sources; Beta reacts emotionally, never edits.
- **Settings → AI Agents** (ONE page): Provider card (Claude API / Local model seg, masked API key + Test, **`Log in with Claude` gradient button** — OAuth so a subscription can power the agents, `Key stored locally` note) · Models card (4 rows, model select each) · Autonomy (auto-apply toggles: Grammar/Clarity/Pacing/Style/Tone) · green callout **`Note linking is automatic — no agent needed`** (points to Vault & Files) · Identity & files (per agent: rename input, duties chips, 4 editable file chips — agent/instructions/learning/soul → textarea + Save).

## 12. AUTO NOTE LINKER — built-in, deterministic (Settings → Vault & Files, FIRST card)

Badge `BUILT-IN · NO AI`. Port of `kdnk/obsidian-automatic-linker`: text matching note titles/aliases → `[[wiki links]]` via trie matching. Toggles: Format on save · Include aliases · Proximity-based linking (prefer nearest note) · Ignore case · Prevent self-linking · Ignore date formats. Format delay (ms, ≥0). Excluded folders textarea (one/line; seeds `Templates/`, `Archive/`). Buttons **Format vault now** (progress toast w/ counts) + **Rebuild index**. Respect frontmatter `automatic-linker-off / -exclude / -scoped`. Never reformat existing links.

## 13. SETTINGS (full view, left rail: General · Appearance · AI Agents · Editor · Vault & Files · Sync & Backup · Shortcuts · About)

- **Editor page** = manuscript-only controls: **Text colors** (Story headings, Story body, **Wiki links**, optional split Notes colors — hex + wheel each), **Manuscript page** (mode seg Neon/No glow/Scroll/**Custom**/Off + per-mode controls incl. custom texture upload), **Manuscript defaults** (autosave interval slider; page width lives in the editor toolbar, not here), **Editor defaults** (default view Rich seg, default zoom seg, tuck-advanced toggle), Behavior toggles (spellcheck, smart quotes, focus dim, dictation).
- **Vault & Files:** Auto Note Linker card (§12) → Mythos vaults cards (click anywhere on a card switches vault; per-vault theme select; stats; `New Mythos vault…`) → import (Obsidian/Notion/Scrivener/Markdown w/ mapping) → vault actions (relocate, reveal, rebuild).
- Sync & Backup (cloud toggle E2E note, backup cadence, restore points), Shortcuts table, About (version, credits).
- Right panel in Settings = live theme preview card + `Reset appearance to defaults`.

## 14. ACCEPTANCE CHECKLIST — run every one before calling it done

1. Type continuously in a paragraph and in every numeric field (year, px, delay): focus never jumps, text never reformats mid-keystroke; Enter/blur commits.
2. Enter splits / Backspace merges paragraphs; counts update live; paragraph drag reorders without selecting text; drag state can't get stuck.
3. `+` provisional scene: type → persists; close untouched → silently gone. Tab drag-down/right opens a second EDITABLE pane; right-click tab menu works.
4. Timeline: drag an event, resize a book span by its edge, put 3 events on the SAME date (auto-stack, no crash, row grows), sequential books DON'T stack (touching edges), ctrl+scroll to half-day (ticks re-label to hours), open the World timeline from the story span (mini preview strips visible), set an exact time under a 13×28×18 calendar, apply Save the Cat (dashed plotline appears), add + rename a custom row, era drag/rename.
5. Clicking ANY timeline item surfaces the Inspector tab even if Brainstorm/Archive tab was open; both side-tab mini chats send/receive.
6. All four agents chat with working session dropdowns (rename inline, duplicate, delete-last recreates); Coach page and Coach panel share one conversation.
7. Beta Run produces a report AND margin comments; Full Analysis opens in Coach with COMPUTED vs COACH'S READ sections.
8. Auto-linker: format vault links plain mentions, respects exclusions and `automatic-linker-*` frontmatter, never touches existing links.
9. Theme export→import round-trips (slots, wallpaper, animation); per-vault theme applies on switch; Reduce motion stops motes + neon in one toggle.
10. Every popup/dropdown closes on outside click without reopening; Esc closes the top layer; every visible control does something or explains itself; vault seeding runs exactly once; frontmatter never renders in Rich view; the notes tree never shows story-internal UUID folders.
