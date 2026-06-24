# Dyslexia — Deep-Dive Findings (Phase 1)

> **Source issue:** SKY-3945 · **Epic:** SKY-3941 (owner directive — Skyy is dyslexic).
> **Purpose:** a sourced evidence base that Phase 2 (SKY-3946) turns into buildable contracts.
> **One-line takeaway:** dyslexia is a *range*, not one thing — so the product answer is
> **great defaults + user choice**, never a single forced "dyslexia mode."

---

## How to read this doc

- Short lines. Clear headings. Skimmable. (We practice what we preach.)
- Every factual claim carries an **evidence tag** and a **[source]**.
- Evidence tags:
  - **[STRONG]** — peer-reviewed and/or independently verified in this research pass.
  - **[MODERATE]** — authoritative body or primary study; consistent across sources.
  - **[MIXED]** — primary evidence exists on *both* sides; reader-dependent.
  - **[WEAK/ANECDOTAL]** — practitioner blogs, vendor docs, lived-experience reports.
- **Verification note:** the adversarial fact-check stage of the research run was cut
  short by a model session-limit outage. Four claims completed full 3-vote / 2-vote
  verification (flagged **[VERIFIED]**). The rest are quoted directly from their primary
  source but did *not* finish the adversarial pass — they are tagged by source quality,
  not by independent re-derivation. Phase 2 should treat the four VERIFIED claims as
  bedrock and the BDA / WCAG / PNAS numbers as authoritative-but-double-check.

---

## 1. How dyslexia actually works — and its RANGE

**Core message for the team: there is no single "dyslexic profile."**

- Dyslexia involves **multiple neurocognitive deficits** — phonological, memory,
  attention, processing speed, visual, motor and visual-motor — **not** a single
  phonological deficit. Most affected people have difficulty in *more than one* domain.
  **[VERIFIED · STRONG]** [PMC11739093]
- Because individual deficit profiles differ so much, effective help must be
  **personalised / targeted to the individual**, not one uniform approach.
  **[VERIFIED · STRONG]** [PMC11739093]
- A reader can have a **working-memory deficit even with intact phonological skills** —
  so phonology is not the sole mechanism. In those readers the bottleneck looks more
  like the **central executive** than the phonological loop. **[MODERATE]** [PMC3496727]

### The sub-dimensions that vary person to person

| Dimension | What it affects | Why it matters for us |
|---|---|---|
| **Phonological decoding** | sounding out unfamiliar words | TTS read-aloud removes the decoding load |
| **Surface / orthographic** | whole-word recognition, irregular spellings | predictable layout + spacing help word-shape recognition |
| **Working memory** | holding a sentence while reading/writing | short lines, chunking, outline/structure aids |
| **Processing speed** | how fast text is decoded | no time pressure; adjustable pace; read-aloud |
| **Attention** | staying on the line / task | line focus, distraction-free mode, reduced clutter |
| **Visual stress** *(see below)* | glare, "swimming"/moving text | tint, line ruler, contrast tuning |

> **Important nuance — subtypes are contested.** A tempting claim is that dyslexia splits
> into a few neat discrete subtypes. The research pass actually **refuted** the strong
> "three discrete clusters" framing (3 verifiers against). Safer framing: dyslexia is a
> **multi-dimensional continuum**, not a small set of boxes. Design for *independent
> adjustable levers*, not for "pick your subtype." [PMC11739093]

### Visual stress / Meares-Irlen — handle with care

- **Meares-Irlen Syndrome / Visual Stress** is described as a visual-processing
  difficulty with reading. Its status as a **distinct clinical entity is scientifically
  contested** — first thought to be a subset of dyslexia, later studies suggest a
  different etiology. **[VERIFIED · STRONG]** [EyeWiki-MISViS]
- Visual stress is **not the same as** the reading/learning difficulty of dyslexia; the
  two co-occur but address **different levers** (perceptual comfort vs. decoding).
  **[MODERATE]** [dyslexiauk]
- **Tinted lenses / Irlen overlays are not supported by strong evidence.** Major
  ophthalmology bodies (AAP, AAO, AAPOS) concluded scientific evidence does **not**
  support tinted filters/lenses for educational performance, and an RCT found Irlen
  lenses produced **no significant reading improvement**. **[VERIFIED · STRONG]**
  [EyeWiki-MISViS] · corroborated [AAP-Pediatrics]

**Design implication of §1:** never force one configuration. Ship adjustable, independent
levers and excellent defaults. Tint/overlay is a *comfort* option some users love — offer
it, but don't sell it as a cure or turn it on by default.

---

## 2. What HELPS dyslexic readers and writers

### 2a. Typography — fonts (the evidence is MIXED; spacing matters more than the glyphs)

**Bottom line: there is no proven "magic dyslexia font." Offer good choices, default to a
clean sans-serif, and put the real effort into spacing.**

- **Specialised dyslexia fonts do not reliably outperform standard fonts.**
  - **OpenDyslexic** produced **no improvement** in reading rate or accuracy vs Arial /
    Times New Roman in a controlled study. **[MIXED → leans negative]** [PMC5629233]
  - **Dyslexie font** showed **no net effect** — neither faster nor more accurate — for
    children with or without dyslexia. Any benefit seen is **attributable to its extra
    spacing, not the bespoke letter shapes.** [Springer-Dyslexie]
- **Why each font was designed (so we can choose a stack on principle, not hype):**
  - **OpenDyslexic / Dyslexie** — weighted/“gravity” bottoms + exaggerated asymmetry to
    stop letters flipping/rotating (b/d/p/q). *Theory-driven; evidence null.*
  - **Lexend** — built on a "reading-proficiency" theory using expanded spacing/width;
    aims at reading speed generally. *Readability-rooted; dyslexia-specific peer evidence
    limited.*
  - **Atkinson Hyperlegible** (Braille Institute) — maximises **character
    disambiguation** (b/d, I/l/1, O/0) for low vision; the letter-distinction goal
    incidentally helps anyone who confuses similar letterforms. *Strong legibility
    rationale; not a dyslexia-cure claim.*
  - **Sans-serif generally** — the British Dyslexia Association recommends sans-serif
    (Arial, Verdana, Tahoma, Century Gothic, Trebuchet, Calibri, Open Sans, Comic Sans)
    because letters appear **less crowded**. **[MODERATE]** [BDA-2023]
- **Takeaway for the font picker:** offer a curated stack (a clean sans-serif default +
  Atkinson Hyperlegible + Lexend + OpenDyslexic as opt-ins). Frame OpenDyslexic honestly:
  "some readers prefer it; evidence is mixed." Let the user decide.

### 2b. Typography — spacing (this is where the STRONG evidence is)

- **Increased letter spacing substantially improves reading speed AND accuracy in
  dyslexic children — immediately, with no training.** The mechanism is **reduced visual
  crowding** (adjacent-letter interference that is abnormally strong in dyslexics).
  **[STRONG · primary RCT-style study]** [PNAS-Zorzi2012]
- This is the single best-supported typographic lever. It also explains the apparent
  "font" effects above: spacing, not shape, is doing the work.

### 2c. Concrete spacing / size floors (authoritative)

- **WCAG 2.1 SC 1.4.12 (Text Spacing)** — content must stay functional when the user sets:
  - **line-height ≥ 1.5×** font size,
  - **letter-spacing ≥ 0.12em**,
  - **word-spacing ≥ 0.16em**,
  - **paragraph spacing ≥ 2×** font size.
  These are **adjustability floors for low-vision/dyslexic users**, *not* forced defaults.
  **[MODERATE · normative spec]** [W3C-TextSpacing]
- **BDA body text size: 12–14pt (≈16–19px / 1–1.2em).** **[MODERATE]** [BDA-2023]

### 2d. Alignment & line length

- **Left-aligned, unjustified text** — BDA recommendation. Justified text creates uneven
  "rivers" of white space that disrupt tracking. **[MODERATE]** [BDA-2023]
- **Shorter line length / measure** aids tracking and working memory (≈ 45–70 chars).
  **[WEAK/ANECDOTAL → practitioner consensus]** [Smashing]

### 2e. Colour, contrast, tint, dark/light

- **Avoid pure white backgrounds** — they can be "too dazzling." BDA recommends **cream
  or a soft pastel.** **[MODERATE]** [BDA-2023]
- In a customization study, **dark text on a warm off-white "creme" background gave the
  fastest reading** (lowest fixation duration ≈0.214s), beating high-contrast pairs like
  black-on-yellow. **[MODERATE]** [W3C-TextCustomization]
- **Optimal tint/overlay colour is individual** and varies person to person — there is no
  universal best colour. Offer a palette, remember the choice. **[WEAK/ANECDOTAL]**
  [Helperbird-Overlay]
- **Dark vs light is a preference, not a rule** — provide both; let users pick. (Reduced
  glare helps some; others read better on light.) **[WEAK/ANECDOTAL]**

### 2f. Reading aids

- **Reading ruler / line focus** — a coloured bar highlights the current line (optionally
  dimming the rest) to keep the eye on track; addresses the "text swims" symptom.
  **[WEAK/ANECDOTAL · widely shipped]** [Helperbird-Ruler]
- **Syllable / word emphasis & "bionic"-style bolding** — segmentation aids; **mixed,
  largely unproven** — offer as optional, off by default.
- **Text-to-speech read-aloud** — removes the decoding burden so the reader focuses on
  comprehension; a 2018 meta-analysis reports positive comprehension impact.
  **[MODERATE]** [ReadSpeaker] *(Mythos already has OS speechSynthesis TTS — SKY-3188.)*
- **Speech-to-text dictation** — lets writers bypass spelling/handwriting friction;
  strong fit for a *writing* app. **[WEAK/ANECDOTAL · strong practitioner consensus]**
  [Lexia]

### 2g. Structure, clutter, focus

- **Reduced clutter + predictable, consistent layout** lowers working-memory and
  attention load. **[MODERATE · cross-source consensus]**
- **Focus / distraction-free mode** (hide chrome, one thing at a time) directly supports
  attention and working-memory limits. *(Mythos already has a Focus-Mode hook — SKY-3207.)*

---

## 3. What dyslexic users STRUGGLE with / AVOID

- **Dense walls of text** — high working-memory load. → chunking, spacing, short lines.
- **Justified text** — uneven gaps disrupt tracking. → default left-aligned. [BDA-2023]
- **Italics & ALL-CAPS for body text** — distort word shape; harder to decode. → reserve
  for short emphasis only. [BDA-2023]
- **Pure white / extreme contrast** — glare and visual stress. → off-white/cream default,
  tunable contrast. [BDA-2023] [W3C-TextCustomization]
- **Cramped / tiny text** — crowding. → comfortable size + adjustable spacing.
  [PNAS-Zorzi2012]
- **Clutter & unpredictable layout** — attention/memory cost. → calm, consistent UI.
- **Some fonts** — tight, ambiguous letterforms (e.g. similar b/d/p/q). → disambiguated,
  less-crowded sans-serif.

---

## 4. Evidence quality — where it's STRONG vs WEAK

**STRONG (lean on these):**
- Dyslexia is multi-domain & heterogeneous → personalise. [PMC11739093] **VERIFIED**
- Increased letter spacing helps reading speed + accuracy (reduced crowding).
  [PNAS-Zorzi2012]
- Irlen/tinted-lens *claims* are **not** supported by strong evidence. [EyeWiki] **VERIFIED**

**MODERATE (authoritative bodies / specs — good for defaults):**
- BDA Style Guide numbers (size, sans-serif, left-align, cream). [BDA-2023]
- WCAG 2.1 text-spacing floors. [W3C-TextSpacing]
- TTS comprehension benefit. [ReadSpeaker]

**WEAK / ANECDOTAL (offer as *options*, not defaults; don't over-claim):**
- **Specialised "dyslexia fonts"** (OpenDyslexic, Dyslexie) — controlled studies show
  **no reliable benefit**; perceived benefit ≈ spacing. **Treat as preference, not
  remedy.** [PMC5629233] [Springer-Dyslexie]
- Best **overlay/tint colour** is individual; no universal value. [Helperbird-Overlay]
- Reading rulers, syllable/bionic emphasis, dark-mode benefit — practitioner-popular,
  thin formal evidence.

**The headline for Phase 2:** the strongest evidence backs **spacing + personalisation +
read-aloud**, *not* magic fonts or overlays. So: **great defaults, everything adjustable,
nothing forced, no over-claiming.**

---

## 5. Concrete, buildable parameters (ranges + defaults)

> Defaults are tuned to "calm and comfortable, standards-aligned." Every value below is a
> *user-adjustable* control unless marked. Hand these straight to Phase 2 contracts.

| Lever | Range | Default | Source / rationale |
|---|---|---|---|
| **Body font size** | 14–24px | **18px** | BDA 12–14pt ≈16–19px [BDA-2023] |
| **Font family** | curated stack | **clean sans-serif** (system UI / Inter-class); opt-ins: Atkinson Hyperlegible, Lexend, OpenDyslexic, Comic Sans | sans-serif less crowded [BDA-2023]; fonts MIXED [PMC5629233] |
| **Line height** | 1.4–2.2 | **1.6** | WCAG floor 1.5 [W3C-TextSpacing] |
| **Letter spacing** | 0–0.12em | **0.04em** (allow up to 0.12em) | crowding [PNAS-Zorzi2012]; WCAG 0.12em [W3C-TextSpacing] |
| **Word spacing** | 0–0.20em | **0.08em** | WCAG 0.16em floor [W3C-TextSpacing] |
| **Paragraph spacing** | 1–2.5em | **1.5em** | WCAG ≥2× [W3C-TextSpacing] |
| **Line length / measure** | 45–90 ch | **66ch** | tracking/memory [Smashing] |
| **Text alignment** | left / justify | **left, unjustified** | [BDA-2023] |
| **Background tint** | palette | **warm off-white `#FBF7EF`** (alts: cream `#FAF3E0`, soft blue `#EAF1F8`, mint `#EAF6EE`, grey `#F2F2F2`); avoid pure `#FFFFFF` | [BDA-2023] [W3C-TextCustomization] |
| **Text colour** | dark options | **near-black `#1A1A1A`** (not pure `#000`) | softens contrast [W3C-TextCustomization] |
| **Theme** | light / dark / sepia | **light (off-white)**; dark + sepia offered | preference, provide all |
| **Contrast tuning** | adjustable | **AA-compliant, slightly-softened** | glare avoidance [BDA-2023] |
| **Colour overlay (Irlen)** | palette, opacity 0–30% | **OFF** | individual [Helperbird-Overlay]; weak evidence [EyeWiki] |
| **Reading ruler / line focus** | off / bar / dim-rest | **OFF** | opt-in [Helperbird-Ruler] |
| **Word/syllable emphasis (bionic-style)** | off / on | **OFF** | mixed/unproven |
| **TTS read-aloud** | rate, voice, highlight | **available, rate 1.0×** | [ReadSpeaker]; exists SKY-3188 |
| **Speech-to-text dictation** | on demand | **available** | writing-app fit [Lexia] |
| **Focus / distraction-free mode** | off / on | **off** | exists SKY-3207 |
| **Reduce motion / clutter** | off / on | **calm by default** | attention/memory load |

> **Liquid-Neon caveat (epic context).** Dyslexia accessibility presets must compose with
> the Liquid-Neon dark theme — high-saturation neon-on-dark can raise glare/visual-stress.
> Phase 2 should ensure the dyslexia levers (tint, contrast softening, spacing) apply
> *on top of* any theme, and that a "calm" toggle can tame neon for readers who need it.

---

## Design implications — prioritised lever list for Phase 2

Ranked by **(evidence strength × user impact × build cost)**:

1. **Adjustable spacing engine** — line-height, letter-, word-, paragraph-spacing on the
   writing surface. *Strongest evidence; moderate cost.* **(P0)**
2. **Type controls** — size + curated font stack (clean sans-serif default; Atkinson /
   Lexend / OpenDyslexic opt-ins, honestly labelled). **(P0)**
3. **Background tint + contrast softening** — off-white default, cream/pastel palette,
   near-black text, avoid pure white/black. **(P0)**
4. **Left-aligned, sensible measure** as the default body setting. *Cheap; clear win.* **(P0)**
5. **TTS read-aloud polish** — build on SKY-3188 (rate, voice, word highlight). **(P1)**
6. **Speech-to-text dictation** — high value for a *writing* app. **(P1)**
7. **Focus / distraction-free + reduced clutter** — extend SKY-3207. **(P1)**
8. **Reading ruler / line focus** — opt-in comfort aid. **(P2)**
9. **Colour overlay (Irlen-style)** — opt-in, off by default, no curative claims. **(P2)**
10. **Word/syllable/bionic emphasis** — experimental, opt-in, off by default. **(P3)**

**Two non-negotiable design principles (from the evidence):**
- **Presets, not forced defaults.** A one-click "Dyslexia-friendly" preset that sets sane
  values — but every lever stays individually adjustable and resettable.
- **Simple + progressive disclosure.** A short "comfortable reading" panel up front;
  advanced spacing/colour controls behind "More". Never clutter — that itself harms
  dyslexic users.

---

## Sources

- **[PMC11739093]** *Are there distinct subtypes of developmental dyslexia?* — Frontiers in Behavioral Neuroscience (2024). https://pmc.ncbi.nlm.nih.gov/articles/PMC11739093/ *(primary; VERIFIED claims)*
- **[PMC3496727]** Working memory in dyslexia with intact phonology (central-executive locus). https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3496727/ *(primary)*
- **[EyeWiki-MISViS]** *Meares-Irlen Syndrome / Visual Stress.* EyeWiki (AAO). https://eyewiki.org/Meares-Irlen_Syndrome/Visual_Stress_(MISViS) *(primary; VERIFIED)*
- **[AAP-Pediatrics]** *Irlen Colored Overlays Do not Alleviate Reading Difficulties.* Pediatrics 128(4). https://publications.aap.org/pediatrics/article/128/4/e932/30786/ *(primary)*
- **[dyslexiauk]** Visual stress / Irlen's syndrome overview. https://www.dyslexiauk.co.uk/visual-stress-irlens-syndrome/ *(secondary)*
- **[PMC5629233]** Wery & Diliberto (2017), *Effect of OpenDyslexic font on reading rate and accuracy.* https://pmc.ncbi.nlm.nih.gov/articles/PMC5629233/ *(primary)*
- **[Springer-Dyslexie]** *Dyslexie font* controlled study. Annals of Dyslexia (2017). https://link.springer.com/article/10.1007/s11881-017-0154-6 *(primary)*
- **[Annals2016]** Rello & Baeza-Yates (2017), OpenDyslexic. https://link.springer.com/article/10.1007/s11881-016-0127-1 *(primary)*
- **[PNAS-Zorzi2012]** *Extra-large letter spacing improves reading in dyslexia.* PNAS. https://www.pnas.org/doi/10.1073/pnas.1205566109 *(primary; STRONG)*
- **[BDA-2023]** British Dyslexia Association — Dyslexia Style Guide 2023. https://cdn.bdadyslexia.org.uk/uploads/documents/Advice/style-guide/BDA-Style-Guide-2023.pdf *(primary/authoritative)*
- **[W3C-TextSpacing]** WCAG 2.1 — Understanding SC 1.4.12 Text Spacing. https://www.w3.org/WAI/WCAG21/Understanding/text-spacing.html *(normative spec)*
- **[W3C-TextCustomization]** W3C WAI text-customization research (creme background fastest). https://www.w3.org/WAI/RD/2012/text-customization/r11 *(primary)*
- **[opo.12316]** Coloured overlays study, Ophthalmic & Physiological Optics. https://onlinelibrary.wiley.com/doi/abs/10.1111/opo.12316 *(primary)*
- **[Helperbird-Ruler]** Reading ruler / line focus feature. https://www.helperbird.com/features/ruler/ *(vendor/blog)*
- **[Helperbird-Overlay]** Colour overlay feature. https://www.helperbird.com/features/overlay/ *(vendor/blog)*
- **[ReadSpeaker]** Assistive technology for dyslexia (TTS meta-analysis ref). https://www.readspeaker.com/blog/assistive-technology-for-dyslexia/ *(vendor/blog)*
- **[Lexia]** Assistive technologies for students with dyslexia. https://www.lexialearning.com/blog/classroom-essentials-assistive-technologies-for-students-with-dyslexia *(vendor/blog)*
- **[Smashing]** *Building A Dyslexia-Friendly Mode.* Smashing Magazine (2021). https://www.smashingmagazine.com/2021/11/dyslexia-friendly-mode-website/ *(blog)*
- **[Stark]** Why personalization is key to accessibility. https://www.getstark.co/blog/why-personalization-is-key-to-your-accessibility-toolbox/ *(blog)*

---

### Research provenance & limitations

- Produced via the `deep-research` harness: 5 search angles → 22 sources fetched → 98
  candidate claims → top 25 sent to adversarial verification.
- **4 claims completed full verification** (flagged **VERIFIED**); the verification +
  synthesis stages were then interrupted by a model session-limit outage. Remaining claims
  are quoted from their primary sources and tagged by source quality, **not** independently
  re-derived. Phase 2 should spot-check the BDA/WCAG/PNAS numbers against the linked PDFs/
  specs before freezing them into contracts.
- One fetched source (`dyslexiahelp.umich.edu` good-fonts PDF) was rated **unreliable** by
  the extractor and contributed no claims.
