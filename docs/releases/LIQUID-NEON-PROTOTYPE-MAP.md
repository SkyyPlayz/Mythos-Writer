# Liquid Neon — Prototype Source Map

> Companion to [`BETA-LIQUID-NEON.md`](BETA-LIQUID-NEON.md). Line numbers refer to
> `design-handoff/prototype/Mythos Writer - Liquid Neon.dc.html` (**HTML**, 5004 lines)
> and `design-handoff/prototype/support.js` (**JS**, 1688 lines). The prototype is a
> "Design Component": an `<x-dc>` template (HTML 9–2866) rendered by the dc-runtime in
> `support.js` against a `class Component extends DCLogic` (HTML 2868–5001). Bindings
> are `{{ expr }}`, loops `<sc-for>`, conditionals `<sc-if>`, pseudo-styles `style-hover=`.

## A. Source structure map

### A.1 Template + CSS regions

| Region | Lines |
|---|---|
| Global `<style>` — keyframes `lnSpin/lnHue/lnHueSoft/lnFlicker/lnShimmer/lnSnow/lnRise/lnBreathe` (17–24), scrollbars (26–29), selection (30), range thumb (32–33), `lnPulse/lnFadeUp/lnDrift/lnToast` (34–37), reduced-motion (38) | 13–39 |
| Root div + `{{ themeStyle }}` token host | 42–43 |
| Background: wallpaper w/ `lnDrift` (47), ambience layers (48–51), scrim (52), vignette (53) | 45–54 |
| Title bar: project menu (61–75), File…Help menus (77–87), Ctrl-K search (89–93), notifications (95–110), settings (111–113), account (114–126), min/max/close (128–132) | 59–134 |
| Workspace tab strip (drag + right-click menu 138–156, "+" 157–159, agents-idle 161–164) | 136–165 |
| Nav rail: items (173–178), Stories popover + New Story (179–203), vault tiles (204–210), settings (212–215), customize + slim (216–238) | 170–239 |
| Left panels: Story Navigator 246–286 · Notes tree (switcher 292–307, template "+" 309–322, tree 330–349) · Crafter suggested cards 355–371 · Brainstorm 373–388 · Timeline nav 390–411 · Graph filters 413–443 · Settings nav 445–453 · resize/collapse 457–464 | 240–464 |
| Story Writer: sub-tabs 471–478 · Structure view 555–600 · Book preview + reader bar 602–660 (dock 641–658) · doc header w/ drafts popover 673–694, comments chip 697–699, splits 700–705, ⋯ 706–714 · zoom bar 716–741 · toolbar 742–778 · diff mode 779–804 · page area (arrows 809–810, selection bar 811–824, comment card 825–850, sheet + runes + edge-drag 851–869, blocks 870–906) · gutter Reader 913–943 + comments 944–963 · drafts split 966–995 | 466–995 |
| Scene Crafter: canvas board (links 1020–1024, cards 1025–1036, dock 1038–1045) 1003–1048 · kanban (Setup 1059–1094, Draft/plans/checklist 1095–1145, vault cols 1146–1161) | 1003–1165 |
| Notes editor center: header 1171–1205, title/tags 1206–1216, toolbar 1217–1240, rich/md/source 1241–1279, split 1281–1299, footer 1301–1305 | 1168–1307 |
| Brainstorm: header/pages 1312–1336, bot chat 1337–1370, Map 1371–1380, Clusters 1381–1396, Board + tools 1397–1439 | 1309–1441 |
| Timeline: header (modes 1448–1450, legend 1451–1457, zoom/Today 1459–1466), Spreadsheet 1469–1479, Subway 1480–1506, Relationships 1507–1526, Lanes (eras/bands/arcs/chapters/events/characters/world/themes/minimap) 1527–1592 | 1443–1595 |
| Vault graph: header/toggles 1600–1611, canvas (edges 1615–1619, nodes 1620–1625, zoom dock 1627–1632) | 1597–1636 |
| Settings pages: Appearance (presets 1646–1661, slots 1662–1680, sliders/toggles 1681–1699, background 1700–1716, animation 1717–1730, text colors 1731–1747, manuscript page 1748–1788, editor defaults 1789–1809) · AI Agents 1812–1869 · Editor 1871–1890 · Vault & Files 1892–1964 · Sync & Backup 1966–2002 · Shortcuts 2004–2017 · Account 2019–2052 · About 2054–2067 | 1638–2070 |
| Right panels: Reader 2087–2123 · editor assistant (tabs 2127–2133, chat 2134–2207, hub 2211–2278, Scenes mini-canvas 2281–2319, notes 2320–2335, refs 2336–2351) · Beat Sheet 2355–2383 · Notes agent/properties 2385–2467 · Brainstorm feed/assistant 2468–2530 · Timeline detail 2531–2584 · Graph inspector 2585–2615 · Settings preview 2616–2646 | 2074–2646 |
| Status bar 2652–2664 · **window frame ring** 2667–2677 · tree ctx menu 2679–2687 · command palette 2694–2720 · export modal 2722–2777 · welcome wizard 2779–2855 · toast 2857–2862 · props schema 2867 | 2652–2867 |

### A.2 `Component` method groups (HTML 2868–5001)

constructor (presets `sets` 2872–2883, `themeAnim` 2884, roles/swatches 2885–2886, `_book0` 2888–2937, notes 3159–3210, vault 2979–2993, brainstorm 2995–3016, timeline 3018–3025, graph 3027–3066, scripts/drafts/notifs 3069–3110, agent files 3145–3151, **initial state** 3211–3297) · helpers `hexA`/`showToast` 3301–3315 · heading-zoom `flatUnits/zoomStep/buildBlocks` 3318–3389 · page-edge drag 3392–3400 · canvas boards 3402–3466 · scenes 3468–3503 · cross-nav 3505–3527 · panel resize 3530–3538 · drag&drop 3541–3597 · comments 3599–3630 · TTS reader 3632–3702 · para/tab/split drags 3704–3742 · vault ops + graph pan 3744–3755 · agent chats 3757–3795 · graph physics 3797–3866 · book/export/cmd 3867–3913 · lifecycle (Ctrl-K/Esc/arrows 3916–3923) 3914–3931 · **`renderVals()`** 3933–5000 (tokens 3934–3967, ambience 4649–4669, frame anim 4628–4632, borders 4158–4161).

### A.3 `support.js`

dc-runtime (generated — never edit): React accessors 8–21, template parsing 23–83, boot 85–198, `{{ }}` resolver 200–292, attr/event maps 294–381, template compiler 383–713, `DCLogic` base + eval 715–750, component factory 752–1032, `x-import` loader 1034–1228, atomic CSS 1230–1234, helmet 1236–1348, pseudo-class sheet 1350–1369, registry 1371–1399, runtime update API 1401–1565, stream tracker 1567–1591, entry (React 18.3.1 UMD) 1593–1687.

## B. Exact token system

Tokens are inline CSS custom properties on the theme host (`{{ themeStyle }}`, HTML 43), computed in `renderVals()` at HTML **3934–3967**. Template usages carry Neon-Classic-valued fallbacks (`var(--n1,#00f0ff)`).

**Inputs** (state 3212–3230 + props 2867): `slots` (six hexes; prop `colorSet` default `winter`, unknown → `classic`), `intensity` **50**, `glassA` **20**, `blur` **1**, `wp` **'match'**, `scrim` **10**, `reduceGlow` false, `animGlow` true, `glowW` **1**, `glowR` **60**, `frameAnim` 'off', `frameSpeed` 12, `pageCfg {mode:'neon', bg:'#0a0d18', op:66, blur:0}`, `txtCfg {head:'#f0f3fc', body:'#c8d3e7', split:false, nHead:'#f0f3fc', nBody:'#c8d3e7'}`.

**Intensity factor** (3935): `I = reduceGlow ? min(intensity,5)/25 : intensity/25` (alphas clamped 0–1 by `hexA` 3305–3309). *Scale note: old 100% == new 50% (headroom above).*

| Token | Computation (line) | Template fallback |
|---|---|---|
| `--n1..--n3` | raw `c1,c2,c3` (3950) | `#00f0ff` `#9b5fff` `#ff4dff` |
| `--n4..--n6` | raw `c4,c5,c6` (3954, 3956; code fallbacks `#ff9a3d #2fe6c8 #3d9bff` at 3937) | same |
| `--b1..--b6` | `hexA(cN, .3 + .4*I)` (3951, 3954, 3956) | `rgba(…,.5)` (also .3/.35/.4 variants) |
| `--g1..--g6` | `hexA(cN, .18 + .5*I)` (3952, 3955, 3956) | `rgba(…,.4)` |
| `--gs1..--gs6` | `hexA(cN, .05 + .13*I)` (3953, 3955, 3956) | `rgba(…,.12)` |
| `--ring` | `slots.join(',') + ',' + c1` (7 stops, 3957) | `#00f0ff,#9b5fff,#ff4dff,#ff9a3d,#2fe6c8,#3d9bff,#00f0ff` |
| `--ringA` | `min(1, .35 + .65*I)` (3958) | `.7` |
| `--grad` | `linear-gradient(120deg, <6 slots>)` (3959) | 3-color variant |
| `--glass` | `rgba(13,16,28, glassA/100)` (3960) | `rgba(13,16,28,.72)` |
| `--glass2` | `rgba(21,26,45, clamp(.5, glassA/100+.16, .97))` (3961) | `rgba(21,26,45,.88)` |
| `--bw` | `glowW+'px'` (3962; slider 1–4, 4204) | `1px` |
| `--gr` | `glowR+'px'` (3962; slider 8–160, 4205) | `26px` |
| `--txH/--txB` | `txtCfg.head/body` (3963) | `#f0f3fc` / `#c8d3e7` |
| `--txNH/--txNB` | `split ? nHead/nBody : head/body` (3964) | `#eef2fb` / `#c8d3e7` |
| `--blur` | `blur+'px'` (3965; slider 0–40, 4207) | `18px` |
| `--wp` | `wps[wp]` (3965; defs 3939–3947) | `url('assets/cosmic-bg.webp')` |
| `--wpsize` | `wp==='none' ? '26px 26px' : 'cover'` (3965) | `cover` |

Scrim is a separate div: `opacity = scrim/100` over `#04050b` (3967, rendered 52). Wallpaper CSS per key (3939–3947): `aurora` = 3 radial tints (`c1/.14, c2/.18, c3/.1`) over `linear-gradient(170deg,#0a0d18,#0b0f22 50%,#070910)`; `slate` = `linear-gradient(165deg,#0d1017,#121826 55%,#0b0e17)`; `deep` = flat `#07080d`; `none` = `repeating-conic-gradient(#151a23 0% 25%,#0b0e14 0% 50%)` checkerboard (transparent-window stand-in, `--wpsize` 26px); `custom` = user blob URL; `match` = `cosmic-bg.webp` for `classic`, else generated starfield (6 white radial dots) + tints `c1/.2, c2/.24, c3/.14, c4/.1` + `linear-gradient(168deg,#0a0d16,#0b0f20 52%,#070911)`.

Slot roles (3885; settings 1662–1680): **A** left panel · primary accent, **B** center panel · wiki-links, **C** right panel · agents, **D** warm data · ideas & items, **E** cool data · systems, **F** nav rail · timeline · frame. Curated swatches (2886): `#00f0ff #34ffc8 #3d9bff #9b5fff #c86bff #ff4dff #ff2d95 #ff6b4d #ffd319 #a3ff57 #eaf2ff`.

## C. The 10 presets

Palettes `this.sets` 2872–2882 · idle border animation `this.themeAnim` 2884 (applied via `borderAnim`/`breathe` 4158–4161 to overlays at 243/468/2085/172; suppressed when `animGlow` off; overridden by Cycle/Sparkle) · ambience `ambConf` 4650–4660 rendered as two repeating-radial-gradient particle layers (`mkAmb` 4663–4669) animated by `lnSnow` (falling, 22) or `lnRise` (rising, 23) · background: all presets `wp:'match'`.

| Key | Name | Slots A–F | Ambience (layers 1/2) | Idle border anim |
|---|---|---|---|---|
| `classic` | Neon Classic | `#00f0ff #9b5fff #ff4dff #ff9a3d #2fe6c8 #3d9bff` | `lnRise` 46s/70s, `rgba(255,255,255,.75)` / `hexA(c2,.5)`, op .4/.28, 1.8×1.8 | `lnBreathe 4.6s ease-in-out` |
| `aurora` | Aurora | `#34ffc8 #00d4ff #a78bfa #ffd97a #5f8bff #8ad9ff` | `lnRise` 40/64s, `c1/.55`+`c2/.45`, .42/.3, 2×2 | `lnHueSoft 9s linear` |
| `cyber` | Cyberpunk | `#ff2d95 #ffd319 #00e5ff #b4ff39 #8a5cff #ff6b4d` | `lnSnow` 7/11s, `c1/.55`+`c3/.45`, .35/.25, 1.4×15 (rain) | `lnFlicker 3.4s steps(1,end)` |
| `sunset` | Sunset Coast | `#ff9a3d #ff4d88 #b06bff #ffd319 #ff6b4d #ffe680` | `lnRise` 26/40s, `c4/.6`+`c1/.5`, .45/.3, 2×2.4 | `lnBreathe 6.5s ease-in-out` |
| `ice` | Ice Mono | `#7ae7ff #00c8f0 #3d9bff #9fd0ff #5f7dff #c9e6ff` | `lnSnow` 22/34s, white/.8 + `rgba(200,230,255,.6)`, .5/.35, 1.8×1.8 | `lnShimmer 5.5s ease-in-out` |
| `ember` | Emberfall | `#ff6b4d #ffd319 #ff2d95 #ff9a3d #b06bff #ffe680` | `lnRise` 16/26s, `c2/.6`+`c4/.55`, .5/.35, 1.8×2.6 | `lnFlicker 4.6s steps(1,end)` |
| `verdant` | Verdant Reach | `#a3ff57 #2fe6c8 #00d4ff #ffd97a #57ff9a #8ad9ff` | `lnRise` 34/52s, `c1/.55`+`c5/.4`, .4/.3, 2×2 | `lnHueSoft 7.5s linear` |
| `royal` | Royal Arcana | `#c86bff #7a5cff #ff4dff #ffd319 #5f8bff #ff9ad5` | `lnSnow` 30/48s, `c3/.5`+white/.7, .4/.28, 1.6×1.6 | `lnBreathe 5.2s ease-in-out` |
| `noir` | Noir Rose | `#ff5f8f #8a9bff #ffd319 #ff9a3d #5fffe0 #c86bff` | `lnSnow` 36/56s, `c1/.45`+`c2/.38`, .35/.25, 1.5×1.5 | `lnPulse 4.4s ease-in-out` |
| `winter` | Winterlight *(props default)* | `#eaf6ff #9fd4ff #6fa8ff #cfeaff #8fc0f0 #dff0ff` | `lnSnow` 14/24s, white/.9 + `rgba(230,244,255,.8)`, .8/.55, 2.2×2.2 | `lnShimmer 7s ease-in-out` |

`custom` (user-edited slots): `lnBreathe 5s ease-in-out` (2884), **no ambience** (lookup miss → off, 4662–4667).

## D. Key behavior implementations

**Heading-zoom manuscript.** Zoom `book/part/chapter/scene` (control 4096–4098, template 718–722); `buildBlocks` (3339–3389) emits H1/H2/H3/paragraph blocks scoped to `{zoom, pp, cc, ss}`, per-heading fold state (`collapsed`, fold 3343, pill 901–905), status dots done/draft/todo click-cycle (3346–3347, 3368, `cycleStatus` 3497–3503). `zoomStep` (3329–3337) wraps through `flatUnits(zoom)` (3318–3328); wired to toolbar chevrons (723–728), floating page arrows (809–810), ←/→ keys (3919–3922); breadcrumbs jump levels (4101–4105 / 729–734). Paragraph drag via grip (`paraDown/Over/Drop` 3705–3719, grip 894–895); scene drag between chapters (3541–3555). Page width slider (4523 / 736–740) + draggable page edges (`startDrag` 3392–3400 / 861–869), 520–3000, default 1000.

**Canvas boards.** `draftBoard` (3403–3423) creates `{id,name,cards[{x,y,w,h,c,av,nid}],links}` after 1.2s busy; cards drag (`cvCardDown` 3425–3435, zoom-scaled), corner-resize min 130×60 (`cvResizeDown` 3436–3446), ⚯ connect mode (`cvLinkClick` 3461–3466) drawing cubic béziers (`cvLinks` 4795–4799), empty-drag pans (3447–3453), wheel-zoom .4–2.4 (4775) + Fit (4779) + add (4781). Right-panel mini canvas (`sbCv` 4749–4765 / 2296–2317) with own pan/zoom (3454–3460).

**Timeline views.** Modes Plan-vs-Progress / Structure / Spreadsheet / Relationships / Subway (4571 / 1448–1450). Progress greys unwritten via `grayscale(.92) brightness(.82) opacity .55` (4259) + cyan "you are here" (4263) + legend (1451–1457); Structure = ungreyed lanes (`tlIsLanes` 4576). Lanes: eras 4582/1528–1533, book bands 4260/1534–1539, arcs 4261–4262, 45 chapter cells 4263/1546–1551, key events 4264–4268, characters 4269, world 4270, themes 4271, minimap (left 34%, width 26%) 1583–1591. Spreadsheet grid EVENT/CH/DATE/POV/LOCATION/IMPACT (4577/1469–1479); Relationships = presence dots (4578–4581/1507–1526); Subway = per-character SVG polylines with absence dips + station circles (`subLines` 4703–4709 / 1480–1506); selection → detail card (4272–4277 / 2535–2556).

**TTS Reader.** `buildFlow` (3633–3656) linearizes current view into utterances keyed by paragraph id; `speakIdx` (3660–3675) uses `speechSynthesis` (rate/voice), advances `onend`, word-count timer fallback. Moving highlight = paragraph key match (`reader.curKey`; editor 3376–3377, book 3886–3887). Voices: `getVoices()` filtered `en` (3657–3659) + mocked "Edge Natural / Piper / Kokoro" entries (4604–4605). Controls (3676–3702, 4808–4812): play/pause, ±utterance as ∓10s, scene skip, from-start/from-cursor, selection-only. Docks: right panel (2087–2123), editor gutter (913–943), book bar (641–658).

**Comments.** `pageMouseUp` (3616–3620) captures 4–219-char selections → sticky selection bar (811–824); `addCommentFromSel` (3621–3629) anchors by substring to owning scene: `{id, scene:'pi-ci-si', anchor, author, kind:'user'|'writing'|'archive', text}`. `segsFor` (3601–3615) underlines anchors kind-colored (user `#ffd319`, writing `--n1`, archive `#ff5f8f`; 3373–3374); gutter dock (4633–4645 / 944–963), hidden in Focus unless `commentsInFocus` (3600, 4522); archive comments carry "Edit notes to match / Suggest story change / Ignore" (4519–4521, 4641–4642 / 836–840, 953–956); Resolve deletes (3630).

**Drafts/diff.** `drafts` meta (3098–3103); header popover w/ Compare/Restore + autosave interval + keep-N (673–694, 4460–4463). Split pane side-by-side w/ ratio drag (966–995, 3735–3742); "Highlight changes" ON → `diffData.old` segments (4713–4714). Full diff (779–804): two Lora columns, segment kinds `d` removed (red strike) / `a` added (green) / `s` same (`dSeg` 4512; data 3130–3139).

**Theme animation + frame ring.** Segment Off/Cycle/Sparkle (`frameSeg` 4628 / 1717–1730) + speed 1–30s quantized .25 (4629–4631). Frame ring (2667–2677): two full-viewport conic layers (`--ring`) masked to 1px/7px borders, outer blurred 9px, `lnSpin` (cycle) or `lnHue` (sparkle) via `frameSpinSt` (4632), opacity `--ringA`, gated by `animGlow` (2668, toggle 4211, "static, laptop-friendly" copy 1690–1693). Panel borders: `borderAnim` (4158–4160) — cycle → `lnHue <speed>s`, sparkle → `lnFlicker <speed*.5>s`, else per-preset idle — via inset `breathe(slot, delay)` overlays (4161, 4961).

**Command palette / notifications / account.** Ctrl-K (3916–3918) → palette (2694–2720); `cmdIndex` (3900–3913) = all notes + all scenes + six commands (focus, appearance, archive scan, story cluster, export, tour), grouped, cap 5 (4450–4452). Bell (95–110) renders `notifs` (3104–3110) with deep-link routing (4455–4459). Avatar menu (114–126) → Account page (`goAccount` 4801 / 2019–2052).

**Notes.** `resolveLink` (3511–3520) maps titles → notes/scenes; `mkLink` (4172–4177): resolved note = purple, scene = gold, unresolved = dashed grey; unresolved click toasts "would create" (3521–3525); chips 1261–1267 (hover = glow only — **no preview popup implemented**; build hover preview per DESIGN-SPEC §5 anyway, spec wins). Templates ×6 (4691 / 310–321). Properties/backlinks right tab (4182–4183 / 2431–2456; STORY chips 2451); `addTag` 4695. Note split (`toggleNSplit` 4835–4839 / 1281–1299); Rich/Markdown/Source via gear (4179, 4964 / 1244–1278).

**Vault graph.** Star nodes = radial-gradient discs (white core → category color → transparent), size-by-`r`, `lnPulse` twinkle (4300). Force sim `stepSim` (3805–3840): center pull + pairwise repulsion + spring links, params from sliders (4382–4387), damping ×.85, clamp ±4.5, bounds 1000×640, rAF w/ energy cutoff (3841–3848). Drag pins `fx/fy` (3849–3866); hover dims non-neighbors (4285–4302); categories `gCats` (3044–3052), per-category recolor + per-edge-type colors (`gCatCols` 4568, `gLines` 4872; defaults note `#9fc0e8`, story `#ffd319`). Story cluster = 5 gold `cat:5` nodes (3058–3066), hidden by default (`offCats:{5:true}` 3259), toggle 4388–4389 / 423–426; zoom/pan/fit 3749–3755, 4871–4876; Re-layout clears pins + randomizes velocities (4698).

**Agents.** `agentDefs` (4346–4351): Writing Assistant (slot 1), Brainstorm (slot 2), Archive (slot 3), **Beta Reader** (slot 2); renameable via `agentNames` (3245, inputs 4586–4588). Four identity files each — `agent.md`, `instructions.md`, `learning.md`, `soul.md` (3145, sample bodies 3146–3151) — editable in Settings→AI Agents (4586–4594 / 1848–1868); provider (Claude API/local) + key + per-agent models (1814–1836, 4478–4479); autonomy auto-apply toggles Grammar/Clarity/Pacing/Style/Tone (1838–1847, 4480). Prototype chats are scripted (`waScript` 3080–3097 via `sendWa` 3784–3795; `bsScript` 3069–3079 via `sendBs` 3757–3781 emitting activity events + board cards).

## E. Data model & state

All in-memory; **no persistence** (only `URL.createObjectURL` for custom wallpaper, 4225).

- **Manuscript** `_book0` (2888–2937): `[{t, label:'PART ONE', chapters:[{t, n, scenes:[{t, status:'done'|'draft'|'todo', paras:[string]}]}]}]` — 3 parts / 4 chapters / 9 scenes.
- **Vault tree** `_vault0` (2979–2993): `[{id, label, count?, kids?, files:[{id,label}]}]`.
- **Notes** (3159–3210): `{title, crumbs[], tags[{t,c}], blocks[{k:'p'|'callout'|'h2'|'ul'|'links',…}], md (frontmattered), props[[k,v,color?]], backlinks[{t,d}], words, chars}`.
- **Boards** (3230, 3403–3423): `{id, name, cards:[{id,t,d,av,c,x,y,w,h,nid}], links:[[id,id]]}`.
- **Timeline** `tlEvents` (3018–3025): `{t, ch, d, icon, detail?:{book,date,loc,pov,sum,impact[]}}`.
- **Graph** nodes `{id,label,cat(0–6),x,y,r}` + edge pairs (3027–3066); sim positions on `this.simN` (not state).
- **Comments** (3237–3241): `{id, scene:'pi-ci-si', anchor, author, kind, text}`.
- **State groups** (3213–3297): routing (`view/storySub/settingsSec/etab/ntab`), layout (`leftW:268/rightW:316/railSlim/railOrder/splitRatio:.5`), theme (see §B), manuscript (`zoom:'chapter', pp/cc/ss, collapsed, pageW:1000, styleSel/font/fsize`), reader (`{open,playing,flow,idx,curKey,rate:1,voiceI:0,selOnly}`), canvas (`cvZoom/cvPan*/cvLinkFrom/sbBoard`), graph (`gZoom/gPan*/gCatCols/gLineNote:'#9fc0e8'/gLineStory:'#ffd319'/offCats/fCenter:6/fRepel:14/fLink:8/linkDist:120`), brainstorm (`bsPage/bsChat/bsActivity/bsMode/bsTool`), agent chats (`waChats.{writing,brainstorm,beta,archive}`), comments (`showComments:true/commentsInFocus:false`), crafter (`{pov,len,status,beats[],tones{}}`), settings misc `sx` (autosave:30, backup:'Daily', keepN:14), onboarding (`welcomeStep/wizGenre/wizTheme`), modals (`cmdOpen/exportOpen/draftsOpen/bellOpen/…`).
- **Props** (2867): `startView` default `editor`; `colorSet` default `winter`; `neonIntensity` 0–100 step 5 default 50; `wallpaper` `match|aurora|slate|deep|none` default `match`.
