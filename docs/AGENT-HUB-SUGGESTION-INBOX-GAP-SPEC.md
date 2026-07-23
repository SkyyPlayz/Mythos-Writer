# Right-panel Agent Hub + Suggestion Inbox — Gap-Check Spec

**Issue:** SKY-8134 (design-ahead for **SKY-6228**, M15: Right panel agent hub +
Suggestion Inbox + sessions everywhere)
**Designer:** UXDesigner
**Status:** Ready for build — land before M15 coding starts
**Authoritative sources:** `plans/design-handoff/v2/FULL-SPEC.md` §5.6 (agent hub),
§11 (agent shared architecture), §14.6 (acceptance) win on any conflict with this
doc. This doc is additive only — it does not re-specify anything FULL-SPEC or the
prototype already covers.

## Scope note — this is a gap-check, not a re-design

This doc **only** covers interaction states missing from FULL-SPEC. It does not
touch layout, copy, or visuals that are already specified. Where a gap's answer is
"reuse an existing pattern from elsewhere in the spec," that's called out instead of
inventing a new one (Jakob's Law / Occam's Razor — one answer per problem, not one
per surface).

## Relationship to the old backlog specs (SKY-2445 / SKY-2471)

SKY-2445/SKY-2471 describe an **earlier, larger design** for the Suggestion Inbox: a
standalone page with a left filter sidebar (agent/status/confidence/search), a
list+detail split pane, batch-select, and TanStack virtualization for 100+ items.
**That shape is superseded.** The current binding design (FULL-SPEC §5.6 + decisions
log B4-8) demotes the inbox to a compact card inside the agent hub (badge + count +
3 rows + `See All Suggestions`), with the full list living on the Coach page. Two
things carry forward from the old specs because nothing since has replaced them —
called out explicitly in §5 and §7 below so they aren't silently lost:
- SKY-2471's keyboard map (Tab / Enter / Ctrl+Enter) and ARIA pattern
  (`role="article"`, `aria-live="assertive"` on status changes) for suggestion rows.
- SKY-2445's confidence-level display on each card (FULL-SPEC never dropped
  confidence from the data model — B4-8's certainty slider gates auto-apply on it —
  but never says whether the **Suggestion Inbox card itself** shows it).

Do not otherwise pull layout, filters, or batch-select from the old specs — those are
intentionally out of scope for the current design.

---

## GAP LIST

Interaction states not covered by FULL-SPEC §5.6/§11/§14.6 or the prototype:

1. Empty states (agent hub sub-surfaces)
2. Loading states (chat response, suggestions, scene analysis)
3. Error states (agent request failure, apply/accept failure)
4. Keyboard nav + focus order (hub list → chat → back; suggestion row actions)
5. Reduced-motion interplay (typing dots, send-button pulse, row dismissal)
6. Narrow-width behavior (280 / 300 / 320px right panel)
7. Readability-mode (dyslexia-friendly) interplay with the hub's compact density
8. Suggestion accept/dismiss confirmation + undo model
9. Status-dot semantics (states, color, icon)
10. Session-list overflow (many sessions)
11. Bell/notification badge vs. Suggestion Inbox badge relationship

Each is spec'd below. Nothing else in FULL-SPEC §5.6/§11 is touched.

---

## 1. Empty states

Reuse the app's existing empty-state pattern (icon + one-line message + where
relevant a primary action) — this is not a new component, just new copy per
sub-surface (Nielsen #1 visibility of system status; Recognition over Recall).

| Surface | Trigger | Copy | Action |
|---|---|---|---|
| Chat feed | Brand-new session, no messages yet | Agent's per-agent greeting (§11) renders as the first bubble — this *is* the empty state, no separate placeholder needed | — |
| Suggestions card | Zero pending suggestions | `No suggestions right now — the team's watching.` | none (card stays, just empty body) |
| Suggestion Inbox (Coach page full list) | Zero pending | `Nothing waiting on you.` + small illustration consistent w/ Coach page tone | `Run a scan` only if an agent scan can be triggered on demand; otherwise omit — don't offer an action that doesn't exist (Postel's Law: don't promise what the system can't do) |
| Scene Analysis card | Scene has 0 words | `Write a little, then check back — analysis needs some text to work with.` | none |
| Scenes / Notes / References tabs | Vault has none yet | Match the existing empty-list pattern used in the left-panel tree (consistency, Jakob's Law) | `New scene` / `New note` per tab, same handlers as their primary surfaces |

## 2. Loading states

Doherty Threshold: anything under ~400ms needs no indicator; anything longer needs
one so the user isn't left wondering if the click registered.

- **Chat response in flight:** typing-dots indicator in the feed (same visual
  language as Brainstorm's typing dots, §7.2) appears the instant the message
  sends; textarea + send button disable until the response starts streaming or
  errors, so a user can't double-fire the same request.
- **Suggestions card / Suggestion Inbox loading:** skeleton rows (3 for the card,
  N for the full list) — same skeleton treatment as everywhere else in the app that
  already does this; do not show a spinner-only state longer than ~1s before
  falling back to skeleton.
- **Scene Analysis computing:** the `COMPUTED · LOCAL · FREE` section (§5.4) is
  synchronous text analysis — effectively instant, no loading state needed. Only
  the `COACH'S READ · AI` section needs one: skeleton lines under the purple badge
  while the model call is in flight.

## 3. Error states

Forgiveness pattern — errors never lose the user's input, and always offer a retry
that doesn't require re-typing.

- **Agent chat request fails** (network, invalid/missing API key, rate limit,
  model error): the outgoing user message stays visible in the feed (not rolled
  back — Loss Aversion: don't make the user re-type it), followed by an inline
  error row (not a bubble): icon + short cause-specific text (`Couldn't reach the
  model — check your connection` / `API key looks invalid — check AI Agents
  settings` / `Rate limited — try again in a moment`) + a `Retry` button that
  re-sends the same message. This is the one new small component this doc
  introduces: an inline chat-error row, styled from existing toast/error tokens
  (glass bg, red-tinted 1px border) so it doesn't need new color decisions.
- **Suggestion accept fails** (snapshot write error, target file locked/missing):
  suggestion row stays in the inbox (not optimistically removed), shows the same
  inline error row inline under that card + `Retry`. Never silently drop a
  suggestion on a failed accept — that would violate CF-10's "dismissed never
  reappears" guarantee by accident (a failed accept must not be confused with a
  dismiss).
- **Session rename/duplicate/delete fails:** toast (§1 rule 6, existing pattern) —
  `Couldn't rename this chat — try again.` No new component.

## 4. Keyboard nav + focus order

WCAG 2.1.1 (keyboard), 2.4.3 (focus order). This is the largest real gap — FULL-SPEC
has a dedicated keyboard/a11y layer for Timeline (`docs/TIMELINE-VIEW-MODES-A11Y-SPEC.md`)
but none for the agent hub, even though it's an equally persistent, always-on
surface.

**AGENTS card → chat, and back:**
- Tab order: AGENTS card rows (top→bottom) → Suggestions card rows → Scene
  Analysis card rows → tab strip (Assistant/Scenes/Notes/References sits above,
  reachable by Shift+Tab back to the top).
- `Enter`/`Space` on a focused agent row opens its chat (same activation as click).
- Inside chat: back button is the **first** focusable element (so keyboard users
  don't have to tab through the whole feed to leave) → session pill → feed
  (individual issue/note cards inside the feed are focusable, `Enter` activates
  their deep-link) → chip row → textarea → send.
- **Focus return on back:** pressing the back button (mouse or `Enter`/`Space`)
  returns focus to the AGENTS row for the agent just exited, not to the top of the
  panel — Zeigarnik/continuity: the user's place in the list is preserved.

**Suggestion Inbox rows** (card's 3 rows, and the full Coach-page list) — carries
forward SKY-2471's keyboard map since nothing newer replaced it:
- `Tab` moves between rows; `Enter` opens/expands a row's detail (target link);
  `Ctrl+Enter` accepts the focused suggestion without opening it (power-user
  shortcut, matches SKY-2471's original intent). `Delete`/`Backspace` is
  deliberately **not** bound to dismiss — dismiss is destructive-ish (CF-10: never
  reappears) and shouldn't be one accidental keystroke away with no confirm; use an
  explicit focusable `Dismiss` button instead.
- Each row is `role="article"` with an accessible name of `<agent> suggestion:
  <summary>`; accepting/dismissing announces via `aria-live="assertive"` (`
  "Suggestion accepted — applied to <target>"` / `"Suggestion dismissed"`) since the
  row disappears from the DOM and a screen-reader user needs to know why their
  focus just moved.
- **Focus after accept/dismiss:** moves to the **next** row in the list (or, if it
  was the last row, to the empty-state message) — never lost to `document.body`.

## 5. Reduced-motion interplay

The app-wide `Reduce motion` toggle (§1 rule 10, §14.9) already pauses ambient +
neon animation. It does not currently say whether it also covers these
hub-specific motions — it should, same switch, no second toggle (Occam's Razor):

- Typing-dots indicator: reduce-motion swaps the bouncing-dot animation for a
  static `Thinking…` label with a subtle opacity pulse (~2s ease, no movement) —
  keeps the "still working" signal without motion.
- Gradient send-button pulse (if any is added to match Brainstorm's send button):
  reduce-motion disables the pulse, gradient stays static.
- Suggestion row accept/dismiss: default is a slide-out + fade; reduce-motion
  drops to a plain fade (no translation), same duration.
- Suggestion-count badge change: default may bounce/scale on increment;
  reduce-motion is a plain number swap, no scale.

## 6. Narrow-width behavior (280 / 300 / 320px)

FULL-SPEC establishes the right panel is user-resizable (a drag-bar is explicit for
Brainstorm's board toggle, §7.2) but never states a floor width or what breaks below
it for the Story right panel. Setting one now avoids an unspecced clipped/overlapping
state (Postel's Law: be defensive about what the layout receives).

- **Floor width: 280px.** Below that, the panel is not resizable further (matches
  the ticket's own probe widths; also roughly the point where a 30px icon tile +
  status text + chevron stop fitting on one line at UI type sizes).
- **At 280–320px**, AGENTS card rows keep the 30px icon tile and name, but the
  status **text** (not the dot) truncates to `…` past available width — the dot
  alone is sufficient signal at a glance, full text is available via the existing
  hover tooltip (§5.6 already specs hover-tooltip-for-description, extend the same
  affordance to status text truncation — one mechanism, not two).
- **Suggestions card** 3 rows: each row's summary text wraps to 2 lines max (same
  2-line-max rule SKY-2445 specified for suggestion cards generally) rather than
  truncating with ellipsis — 2-line wrap keeps the row scannable without hiding
  content a decision depends on.
- **Chat feed bubbles** reflow to the available width (already implied by
  contentEditable/flex feed layout) — no fixed pixel bubble width anywhere, so no
  new behavior needed here beyond confirming this is the existing default.
- **Session dropdown pill:** long chat names truncate with `…` at any panel width
  below ~360px; full name available on hover/focus (title attribute) and in the
  open dropdown list itself, which is not width-constrained the same way.

## 7. Readability-mode (dyslexia-friendly) interplay

Per `plans/Readability-Mode.md`: Readability mode's type bundle (line-height,
letter/word spacing, paragraph spacing) is specced to "apply everywhere — menus,
dialogs, sidebars, settings" and must "not break layouts... nothing clipped or
overlapping." The agent hub's UI type scale (§3: 11.5px body rows, 10px sublabels)
is denser than most of the app, and the hub is stacked with 3 cards in a fixed-height
right panel — the two specs were never checked against each other. Gap-fill:

- Readability mode's spacing bundle applies to AGENTS/Suggestions/Scene Analysis
  card **text** (line-height, letter-spacing) exactly as it does elsewhere — no
  opt-out for this surface (consistency requirement in Readability-Mode.md is
  binding).
- Where increased line-height/paragraph-spacing would push a card's content past
  its current fixed height, the card **grows** (panel becomes independently
  scrollable, same behavior a long AGENTS list or long suggestion set would already
  require) rather than clipping or compressing row spacing to compensate — this
  is the same "don't break layouts" resolution already promised in
  Readability-Mode.md, just naming it for this specific surface.
- **Text size** (the separate always-visible interface-text scaler, distinct from
  Readability mode) applies to hub text too, per its own "applies to interface
  text" definition — at the largest Text size step, the 30px icon tile does not
  scale with it (icons/avatars are fixed chrome, not text) but row height grows to
  keep the tile vertically centered against taller text, same pattern used
  elsewhere for icon+label rows.
- No new settings surface — this section only confirms the existing two settings
  (Readability mode, Text size) reach this surface correctly; it does not add a
  third hub-specific toggle.

## 8. Suggestion accept/dismiss confirmation + undo

FULL-SPEC (B4-8, CF-10) already says accept → snapshot-first apply (undoable) and
dismiss → never reappears, but doesn't say whether either needs a confirm step or
what the undo affordance looks like in-place.

- **Accept:** no confirm dialog (that would defeat the point of a low-friction
  inbox — Hick's Law, don't add a decision to a decision) — apply immediately,
  same "explicit yellow `Undo` chip" pattern §1 rule 7 already defines for
  destructive-adjacent actions (Load-draft uses it; accept-and-apply qualifies the
  same way since it mutates a file). Chip shows in the same toast slot, ~2.5s per
  §1 rule 6, with the accepted row already removed from the list underneath it.
- **Dismiss:** also no confirm dialog — but because CF-10 makes it *permanent*
  (never reappears, unlike accept which is undoable via the snapshot), dismiss
  gets its own brief `Undo` chip too, scoped only to "un-dismiss within this
  toast's ~2.5s window," after which it's final. This is the one place accept and
  dismiss need slightly different undo semantics (accept: undo via snapshot,
  available indefinitely through normal undo history; dismiss: undo only during
  the toast window, then gone) — call this out in dev handoff since it's easy to
  implement both as "the same Undo chip" and get the permanence wrong.

## 9. Status-dot semantics

§5.6 specifies "status dot+text" per agent row without enumerating states. Minimum
set needed for M15 (Beta 4 only ships text chat, not background autonomy, so this
stays small — don't over-spec states that can't occur yet):

| State | Dot | Text | When |
|---|---|---|---|
| Idle | neutral gray/muted | `Ready` | default, no active request |
| Thinking | agent's neon-slot color, pulses (or static under reduce-motion, §5) | `Thinking…` | request in flight |
| Needs attention | warm/amber | `N new` (suggestion count from that agent, if any) | agent has pending suggestions in the inbox |
| Error | red-tinted | `Couldn't connect` | last request to this agent errored and hasn't been retried |

Color-independence (WCAG 1.4.1): text always accompanies the dot, per spec already
— this table just fills in what the text says.

## 10. Session-list overflow

§11 defines session dropdown contents (name, `N messages`, active dot) and actions
but not behavior once a user accumulates many sessions.

- List becomes independently scrollable past ~8 visible rows (matches the app's
  existing dropdown-scroll pattern, same scrollbar tokens §1 rule 8) — no pagination,
  no search box added (Occam's Razor: sessions per agent are expected to stay in the
  tens, not hundreds; add search only if usage data later shows otherwise).
- Newest session sorts to the top (goal-gradient — most likely to be the one you
  want) except the currently-active session, which stays pinned first regardless of
  recency (avoids the active chat jumping position under your cursor while open).

## 11. Bell/notification badge vs. Suggestion Inbox badge

§4 already specs a title-bar bell with an "agent events" feed; §5.6 specs a
Suggestions-card badge with a pending count. Never specified: do they share a
count or double-count the same events?

- **They're separate counters for separate things**, not duplicates: the bell's
  count is all unread agent *events* (chat replies, continuity flags, scan
  results — anything in the notification feed); the Suggestions-card badge counts
  only *pending suggestions awaiting accept/dismiss*, a strict subset. A new
  suggestion increments both (it's both an event and a pending item); accepting or
  dismissing it decrements only the Suggestions badge, not retroactively the bell
  (the event still happened and was seen).
- Don't design a "clear all" that zeroes both from one action — they answer
  different questions ("what happened" vs. "what's waiting on me") and should
  clear independently, or a user who dismisses their suggestions loses their
  event history for free.

---

## Handoff notes for FoundingEngineer / ProductEngineer (M15 build)

- One new component: the inline chat-error row (§3) — style from existing
  toast/error tokens, don't invent new color values.
- Reuse, don't rebuild: typing-dots (from Brainstorm, §7.2), skeleton rows
  (existing app pattern), Undo chip (existing, §1 rule 7), hover-tooltip
  mechanism (existing, §5.6).
- Accept vs. dismiss undo semantics differ (§8) — flag this explicitly in code
  review, it's the easiest gap in this doc to get subtly wrong.
- Floor the right panel at 280px (§6) — add the width guard wherever panel
  resize is implemented today.
- `aria-live="assertive"` on suggestion accept/dismiss (§4) is a new addition to
  the DOM, not decorative — needed for CF-10 (dismissed-forever) to be
  perceivable non-visually.
