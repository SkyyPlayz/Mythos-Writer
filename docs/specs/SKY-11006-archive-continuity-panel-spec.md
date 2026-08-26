# Archive Continuity Panel — states, empty-state, scope tags

SKY-11006 · design-ahead for SKY-10736 M12.B (PRs #1292/#1322) · owner: UXDesigner

Scope: this doc + token notes only. No product code. Extends the shipped
`InconsistencyCard`/`ContinuityPanel` (SKY-1685, SKY-9825/M9d) rather than
replacing it — M12.B adds a **question-first** step in front of the existing
flag lifecycle; it does not change how resolved/ignored flags already work.

Precedent read: `frontend/src/InconsistencyCard.tsx`, `ContinuityPanel.tsx`,
their `.css`, `plans/design-handoff/v2/FULL-SPEC.md` §6/§8.6 (Archive Agent),
`docs/releases/BETA-REFINE.md`.

## 1. Why a 4th state (the gap M12.B closes)

Today `InconsistencyItem.status` is `open | resolved | ignored`. Every flag
the Archive Agent raises is presented as already-decided fact ("Character
Attribute Drift", `CRITICAL`) with two confident actions (match vault / suggest
story change). That's correct for hard contradictions (`Eyes: brown` here,
`Eyes: green` there) but wrong for the cross-story class M12.B introduces:
inferences the agent isn't certain enough to assert as a contradiction —
lower confidence facts. Presenting a guess with the same weight as a
confirmed contradiction is a **Framing** problem (overclaiming) and invites
**Automation bias** (Trust). The fix is a state the copy and visual weight of
which reads as *a question*, not *a verdict*, until the author confirms it.

**States (author-facing lifecycle):**

| status | what it means | who set it | visual weight |
|---|---|---|---|
| `proposed-question` | Archive Agent has a low/medium-confidence hypothesis and is asking, not asserting | Archive Agent (scan) | quiet — question framing, no severity badge |
| `confirmed` | Author said "yes, that's a real inconsistency" — now carries full weight and the existing resolution actions | Author, from `proposed-question` | full — same visual language as today's flags |
| `resolved` | Author applied a fix (match vault / suggest story change) — unchanged from today's `resolved` | Author, from `confirmed` (or directly from a hard-contradiction flag, unchanged) | collapsed into the existing "resolved" group |
| `dismissed` | Author said "not an issue" — replaces `ignored` as the terminal negative state for this lifecycle; same behavior/data shape as today's `ignored`, renamed for clarity against `proposed-question`'s "not now" affordance | Author, from `proposed-question` or `confirmed` | collapsed into the existing "ignored"-equivalent group |

State machine:

```
proposed-question ──confirm──▶ confirmed ──match/suggest──▶ resolved
        │                          │
        └──────dismiss─────────────┴──────dismiss──▶ dismissed
```

`dismissed` is the same terminal shape as today's `ignored` — do not add a
second dead-end status to `InconsistencyItem`; either rename `ignored` →
`dismissed` project-wide (preferred, one status vocabulary) or treat
`dismissed` as an alias serialized as `ignored` (only if a migration is out
of scope for M12.B — call this out to the coders as an explicit decision,
not a silent choice).

Hard-contradiction flags (the existing `character_attribute_drift` /
`location_attribute_mismatch` / `factual_contradiction` categories, scoped
`story_vault` / `vault_internal` / `timeline`) skip `proposed-question`
entirely and enter at `confirmed` — unchanged from today's `open`. Only the
new lower-confidence cross-story class enters at `proposed-question`.

## 2. InconsistencyCard states — visual spec

### 2a. `proposed-question` (new)

- **Framing, not verdict.** No severity badge (`CRITICAL`/`HIGH`/…) — severity
  implies a confirmed fact. Replace with a question-mark glyph chip using
  `--accent` (cyan), not a severity color: `background: var(--accent-soft);
  color: var(--accent);`. Label: `?` icon + `Question` (not a category name).
- **Copy pattern:** rationale text is phrased as a question by the agent
  prompt layer (out of scope here), but the card must not editorialize on
  top of it — no "we think" hedging in UI chrome; let the copy itself carry
  the uncertainty (Plain Language, Trust: don't fake confidence, don't fake
  false modesty either).
- **Actions (2, not 3):** `Confirm` (`.ic-btn--primary`, moves to
  `confirmed`) and `Dismiss` (`.ic-btn--ghost`, moves to `dismissed`). No
  "Suggest story change" / "Edit notes to match" at this stage — those are
  resolution actions for a *confirmed* issue; offering them on an unconfirmed
  guess is premature commitment (Postel's Law: be conservative in what you
  assert).
- **Scope tag still shows** (see §4) — scope is a location fact independent
  of confidence.
- Reuses `.ic-card` shell, `.ic-anchors`, `.ic-rationale-row` unchanged.

### 2b. `confirmed`

Visually identical to today's `open` card — full severity badge, category
label, scope tag, 3-action row (`Edit notes to match` / `Suggest story
change` / `Ignore`→`Dismiss`, see §5 on the ignore→dismiss button rename).
No new CSS needed; this is the existing `.ic-severity-badge--*` +
`.ic-action-row` treatment. The only new requirement: a card that arrived via
`Confirm` from `proposed-question` gets a one-time subtle acknowledgment —
reuse the existing 250ms `.ic-expand-area` transition pattern (`max-height`
open) is overkill here; a plain state swap with no transition is correct
(Doherty: don't make the author wait through an animation to see the result
of their own click).

### 2c. `resolved`

Unchanged from today. Grouped under the existing collapsed "Resolved"
section pattern already used for `ignored` in `ContinuityPanel.tsx`
(`GROUP_LABELS`, `collapsedGroups` defaulting closed). No visual changes; the
panel-level `GroupKey` union gains `resolved` alongside the existing
`critical | high | medium | low | ignored` keys once M12.B lands (product
code — noted for the coders, not this doc's scope).

### 2d. `dismissed`

Unchanged from today's `ignored` visual treatment (dimmed, collapsed-by-
default group). Rename only — see §5.

## 3. Empty-state — no inconsistencies found

This is the existing `panelState === 'empty'` branch in `ContinuityPanel.tsx`
(`.cp-empty`, `CircleCheck` icon, "All consistent"). M12.B does not need a
*second* empty state — a scan that finds zero hard contradictions AND zero
open questions is one state, not two, because splitting it would ask the
author to parse "no confirmed issues but also no questions" as two separate
non-events (Occam: one empty state, one message).

**Spec (confirms + extends existing):**

- Icon: `CircleCheck` (lucide), 32px, `opacity: 0.6` — unchanged.
- Primary line: **"All consistent"** — unchanged, keep exact copy (Jakob's
  Law: authors who've seen this panel before shouldn't have to re-parse new
  wording for the same outcome).
- Secondary line (existing `.cp-empty-sub`): last-scan token cost — unchanged.
- **New for M12.B:** if the scan *did* run the cross-story question pass and
  found nothing to ask either, no separate line is needed — "All consistent"
  already covers "no contradictions and no open questions." Do NOT add
  "No questions either" as a second sub-line; two positive confirmations in
  a row reads as the UI protesting too much (Peak-End: end on the one clean
  signal, not a checklist of absences).
- If a `proposed-question` exists but zero `confirmed`/hard-contradiction
  flags exist, the panel is **not** empty — it must show the questions.
  Empty-state only applies when the item list is fully empty of anything
  actionable (no open, no proposed-question).

No new empty-state component or copy needed. Token references: `--text-body`
(`.cp-empty-text`), `--text-muted` (`.cp-empty-sub`), `--space-4`/`--space-2`
(`.cp-centered` padding/gap) — all existing, unchanged.

## 4. Scope tags — story-internal vs cross-story

Today's `ContinuityScope` is `story_vault | vault_internal | timeline` with
labels `Story ↔ Vault` / `Vault internal` / `Timeline` (`.ic-scope-tag`,
`SCOPE_LABEL` in `InconsistencyCard.tsx`). M12.B's ticket language
("story-internal vs cross-story") maps onto this existing axis rather than
requiring a new one — clarify the mapping instead of adding parallel scope
vocabulary (one taxonomy, not two overlapping ones):

| M12.B term | maps to existing `ContinuityScope` | label shown |
|---|---|---|
| story-internal | `vault_internal` (a contradiction entirely inside one story's own vault notes/timeline) | `Vault internal` |
| cross-story | **new value**: `cross_story` — a fact that contradicts something in a *different* story's vault (only possible once the vault holds >1 story; ties to the Mythos-vault multi-story model in FULL-SPEC §"Mythos Vault") | `Cross-story` |

`story_vault` (Story text ↔ its own vault notes) and `timeline` are
unaffected — they're a different axis (which two sources disagree) and
already coexist correctly with `vault_internal`. `cross_story` is additive:
extend the `ContinuityScope` union, don't repurpose an existing value.

### Visual treatment

- Current `.ic-scope-tag` uses a single hardcoded color for all three values:
  `color: var(--severity-critical-text, #ff9db4)` (pink). That's a bug this
  spec should fix going in: pink signals danger and is shared with the
  `CONTINUITY FLAGS` / `ARCHIVE AGENT` chip identity color — using it for
  *every* scope tag regardless of meaning means the color carries no
  information (violates color-independence in the other direction: color is
  present but meaningless, so it's just noise, and it collides visually with
  severity badges sitting one line above sharing a similar pink family for
  `critical`).
- New rule: scope tags are **neutral**, not severity-colored. Severity is
  already fully carried by `.ic-severity-badge`; the scope tag's job is
  *location*, not *urgency*, and duplicating a warning color across both
  invites the two to be misread as reinforcing each other (Redundancy done
  wrong — Gestalt Similarity says same-color chips get grouped as "the same
  kind of thing," but severity and scope are different axes).
- Proposed tokens (no new hex values — reuse existing neutrals):
  - `story_vault` / `vault_internal` / `timeline`: `color: var(--text-muted);
    background: var(--bg-inset); border: 1px solid var(--border-subtle);`
    (same neutral pill treatment already used for `.ic-diff-label`-adjacent
    chrome — nothing new to define).
  - `cross_story`: needs to stand out *slightly* more than the other three,
    because a cross-story contradiction is a materially bigger deal to
    verify (touches another manuscript). Use the existing accent-violet
    token already in tokens.css (`--accent-violet`) at low opacity, mirroring
    how `--accent-soft`/`--accent` pair for the cyan family:
    `background: color-mix(in srgb, var(--accent-violet) 15%, var(--bg-inset));
    color: var(--accent-violet);`. This reuses `color-mix` exactly as
    `--state-*-bg` already does in tokens.css (§199-209) — no new mixing
    pattern introduced.
  - Keep the existing pill shape/sizing (8.5px, 700 weight, 0.06em tracking)
    — only the color mapping changes. Add a 1px border in the tag's own
    color at ~30% opacity so scope tags read as outlined pills, visually
    distinct from severity badges' solid-fill pills (Similarity: sharing a
    shape family but not a fill treatment keeps them related-but-distinct).

### Contrast / a11y / dyslexia legibility

- `--accent-violet` on `--bg-inset`: verify ≥4.5:1 at the 8.5px size used —
  8.5px is below the WCAG "large text" threshold, so this tag needs
  **AA normal-text contrast (4.5:1)**, not the lower large-text bar. If the
  violet-on-dark mix doesn't clear 4.5:1 at 15% mix, raise the mix percentage
  (match `--state-danger-bg`'s 18% as the baseline) rather than lightening
  text alone, since both bg and text need to move together to hold the pill
  shape's current visual weight. **Coders: run this through the existing
  a11y contrast check used in `docs/security/`-adjacent QA passes before
  merge; this doc specifies intent, not a measured pass/fail number.**
- Do not rely on color alone to distinguish `cross_story` from the other
  three (color-independence, WCAG 1.4.1): the label text itself already
  differs (`Cross-story` vs `Vault internal` etc.), which satisfies this —
  no icon needed, but don't remove the text label in favor of a color+icon
  chip in a future iteration without re-checking this.
- Dyslexia: scope tags are short, single-line, sentence-case-avoided
  (existing labels are already short noun phrases, e.g. "Vault internal") —
  keep `Cross-story` to that same two-word pattern, not a longer descriptive
  phrase. No dyslexia-font tokens apply at 8.5px caption size (the
  `--dyslexia-line-height`/`letter-spacing`/`word-spacing` tokens used on
  `.ic-rationale` are for body-length prose, not single-line tag chips) —
  don't add them here, that would loosen tracking on an already-tight
  all-caps label and hurt legibility instead of helping it.

## 5. Copy fix bundled with this spec: "Ignore" → "Dismiss"

Small, low-risk consistency fix while the state names are being touched:
today's button label is `Ignore` (`InconsistencyCard.tsx` action row,
aria-label `Ignore — {excerpt}`) but the ticket's target status name is
`dismissed`. Keep both button label and status name aligned to `Dismiss` —
mismatched verb/status pairs are a Mental Model cost (author clicks "Ignore"
and later sees a group literally labeled "Dismissed" and has to bridge the
two words themselves). Coders: this is a one-string rename
(`Ignore` → `Dismiss`, aria-labels too) plus the status enum extension in
§1 — not a behavior change.

## 6. Token notes summary (for coders)

No new hex values. New/changed token usage only:

- `ContinuityScope` union: add `'cross_story'` alongside
  `'story_vault' | 'vault_internal' | 'timeline'`.
- New status handling: extend `InconsistencyItem['status']` with
  `'proposed-question'`; decide `dismissed` vs. `ignored` per §1 (naming
  decision to make explicitly, not silently).
- `.ic-scope-tag` needs a per-scope variant class (today it's one class for
  all three values) — `--ic-scope-tag--neutral` (existing 3 scopes) and
  `--ic-scope-tag--cross-story` using `var(--accent-violet)` +
  `color-mix()` per §4, replacing the current single hardcoded
  `var(--severity-critical-text)` rule.
- `proposed-question` card chip: reuse `var(--accent)` / `var(--accent-soft)`
  — already defined, no new token.
- `ContinuityPanel`'s `GroupKey` union gains `confirmed` / renames
  `ignored`→`dismissed` (or aliases, per the §1 decision) — pure product
  code, called out here so the doc and the build stay in sync.

## 7. Open decision for the coders (not this doc's call)

`dismissed` vs. keeping `ignored` as the wire/status value with `Dismiss` only
as display copy: pick one before writing the migration. This spec's
recommendation is a straight rename (one vocabulary, §1) but that touches
persisted data (`InconsistencyItem.status` values already on disk in
existing vaults) — flag it to the M12.B implementer as a real migration
question, not a free rename.
