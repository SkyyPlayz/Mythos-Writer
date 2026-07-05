# Mythos Writer — Liquid Neon Design Spec

Extracted from the approved prototype (`prototype/Mythos Writer - Liquid Neon.dc.html`). The prototype source is authoritative — this doc is the map.

## 1. Theme system (Liquid Neon)

- **Six neon color slots A–F** with roles: A = left panel/primary accent, B = center panel/wiki-links, C = right panel/agents, D = warm data (ideas & items), E = cool data (systems), F = nav rail/timeline/frame.
- CSS custom properties: `--n1..--n6` (raw colors), `--b1..--b6` (border colors, alpha scales with intensity), `--g1..--g6` (glow), `--gs1..--gs6` (soft fills), `--bw` (border thickness 1–4px), `--gr` (glow radius 8–160px), `--grad` (6-color gradient), `--glass`/`--glass2` (panel fills), `--txH/--txB/--txNH/--txNB` (text colors), `--ring` (frame conic gradient stops).
- **Defaults:** intensity 50% (scale rescaled so old 100% = new 50% with headroom), glass opacity 20% (range 0–96), blur 1px, scrim 10%, border 1px, glow radius 60px, wallpaper `Theme match`, page width 1000px (range 520–3000), manuscript page mode `Neon`.
- **10 presets**, each with a matching background + its own animated ambience layer and idle border animation: Neon Classic (cosmic-bg.webp + drifting stardust), Aurora (rising motes, hue-drift borders), Cyberpunk (digital rain, flicker), Sunset Coast & Emberfall (rising embers), Ice Mono (snow, shimmer), Verdant Reach (spores), Royal Arcana (falling sparkles), Noir Rose (rose dust), Winterlight (snowfall, soft whites/blues).
- Every slot editable via curated swatches **or a full color wheel**; custom wallpaper upload; `No background` = fully transparent window (desktop shows through).
- **Neon animation setting:** Off (per-theme idle shimmer) / Cycle (colors rotate) / Sparkle (palette fades in/out), speed 0.25–30s, drives the square window frame ring AND every panel border. Frame ring toggle independent of animation. Reduce-glow accessibility toggle.
- Text colors: story headings/body + optional split for notes. Manuscript page modes: Neon (glow border, tunable bg color/opacity/blur), No glow, Scroll (aged/cracked parchment, tint + opacity, archaic runes on all four edges, glowing-symbols toggle themed to palette), Off.

## 2. Shell

- Title bar: logo, project menu (switch project / new / open vault / replay onboarding), File-Edit-View-Insert-Tools-Help menus with working actions, Ctrl-K command palette (commands/notes/scenes), notification center (agent events, each deep-links to its source), account menu → Account & profile settings page, Windows min/max/close.
- Workspace tab strip: per-module tabs, drag to reorder, right-click → open to the side / pop out / close; "All agents idle" status.
- Nav rail: Story Writer, Notes Editor, Scene Crafter, Brainstorm, Timeline, Vault Graph (+ Settings). Customize popover (show/hide/reorder), slim icon-only mode, vault tiles (per-universe vaults) with minimized `+`, Stories popover on Story Writer (switch/new story: name, genre, tone, POV → creates Story Plan note; timeline is per-story).
- Panels: left/right collapsible + drag-resizable; center always fluid; status bar with live word/char/read-time; glass panels with per-slot neon borders.

## 3. Story Writer

- **Heading-zoom manuscript:** one continuous document; zoom levels Full Book / Part (H1) / Chapter (H2) / Scene (H3); prev/next arrows (toolbar + floating page edges + ←/→ keys); breadcrumbs; collapsible headings; scene status dots (todo/draft/done) click-cycle everywhere; navigator `+` adds scene; drag scenes to restructure (navigator + Structure view).
- Word-like toolbar: style/font/size, B I U S, alignment, lists, Read, Dictate, Assist (opens Writing Assistant chat), page-width slider; drag page edges to resize (520–3000px).
- Paragraphs are draggable blocks (grip in margin, drop indicator).
- **Comments:** select text → comment bar (+ Read selection); margin gutter dock; agent comments carry actions (Archive: edit notes to match / suggest story change / ignore); hidden in Focus mode w/ override toggle.
- **Drafts:** button in header; per-document draft list; side-by-side previous draft with `Highlight changes` ON by default (inline red/green); Full diff view with draft selector; snapshot frequency + keep-count settings in the drafts popover.
- **Reader (TTS):** reads headings + body with a Speechify-style moving highlight; from cursor / from start / selection-only; ±10s and ±scene skips; speed 50–200%; voices = system + Edge naturals + Piper/Kokoro open models (offline); docks under Comments in the gutter, centered when comments hidden; audiobook bar in Book preview.
- Structure view (grid/list scene cards, drag to restructure, Save-the-Cat beat sheet in right panel). Book preview (compiled read-only, comments work, page width follows editor, export modal: PDF/DOCX/EPUB, scope, synopsis/separators toggles).

## 4. Scene Crafter (own module)

- Scene Setup: title/POV/goal/conflict, beats add/remove, tone chips, length.
- Suggested cards (left panel): searchable, grouped by type, click or drag onto board; stays available while in a scene.
- Quick summary + selectable **plan cards** (from vault Story Plans) → **Draft board** (single button) → creates a **canvas board** listed under BOARDS.
- **Canvas boards (Obsidian-canvas-style):** dotted-grid surface; cards are draggable, corner-resizable boxes with colored neon borders; ⚯ connect tool draws bezier connectors; add/delete cards; pan (left-drag empty space or right-drag anywhere), scroll zoom + zoom buttons + Fit; card icon click opens the attached vault note.
- Editor right panel "Scenes" tab lists canvas boards + a live mini canvas (pan/zoom/right-drag, Open full) sized to the sidebar.

## 5. Notes Editor

- Multi-vault: vault switcher (per-universe), imported vaults appear as second vault; Brainstorm agent reads/edits all.
- Tree: folders/files drag to move/reorder; right-click → open in new tab / beta read / continuity check / rename / delete; `+` → template picker (Character, Location, Faction, Item/System, Event/History, Blank).
- Rich Text default; Markdown/Source behind gear menu (+ "always open rich" toggle).
- **Wiki links Obsidian-parity:** clickable `[[links]]`, hover preview, unresolved = dashed → would-create; links across notes AND into story scenes.
- Tags (add via inputs), properties panel, backlinks; right panel defaults to **Brainstorm Agent** chat + continuity flags with 3 action buttons; note splits + draft compare.

## 6. Brainstorm Center

- Agent Chat page (default): converse → agent files notes + builds cards, activity feed on right.
- Board / Map (mind-map of ideas clustered by collection) / Clusters (gravity bubbles) modes; canvas tools (select/connect/frame/text), zoom controls.

## 7. Timeline (Aeon-class, per-story)

- Views: **Plan vs Progress** (written = color, planned-from-notes = greyscale, "you are here" marker), Structure, **Spreadsheet** (events as data rows), **Relationships** (presence dots per character), **Subway** (each character a colored line through event stations). Eras ruler, arcs, chapters strip, key events, characters, world events, themes, mini-map scrubber.
- Filters (View/Group/Show) + Today jump. Archive Agent auto-builds the timeline from vault plans + written scenes and flags timeline issues (e.g. skips backward).

## 8. Vault Graph

- Nodes = glowing stars (colored by category incl. History/Lore); drag to pin, Re-layout re-runs force sim; scroll zoom + pan; per-category color wheels; separate colors for note↔note vs story↔note connection lines; Story cluster toggle; node inspector with connections.

## 9. Agents (4)

Writing Assistant (prose/tone/pacing, per-scene chat), Brainstorm Agent (vault curator), Archive Agent (continuity story↔story & story↔vault, auto-links vault, builds timeline, flags → actionable comments), **Beta Reader** (reader-eye chapter reads, reactions as margin comments). All renameable; each has agent.md / instructions.md / learning.md / soul.md editable in Settings; provider (Claude API/local), per-agent model, autonomy auto-apply toggles.

## 10. Settings

Account & profile (avatar, plan, devices, sign out) · Appearance (everything in §1) · AI Agents · Editor (defaults, behavior toggles) · Vault & Files (location, **Move vault** defaulting to a local path, maintenance, **Import vault** [Obsidian/Notion/Scrivener/Markdown, into current-as-second-vault or new vault], **Import story** [docx/gdocs/md/scriv/epub → headings map to structure + plan note], danger zone) · Sync & Backup · Shortcuts · About. Welcome wizard (4 entry paths, genre, theme).
