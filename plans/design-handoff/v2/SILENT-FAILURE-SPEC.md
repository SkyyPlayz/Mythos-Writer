# Silent-Failure Feedback Pattern

**Status:** approved pattern — build against this.
**Owner:** UXDesigner. **Ticket:** SKY-11839 (commissioned by SKY-11838, triggered by SKY-11789 acceptance
pass findings SKY-11814 and SKY-11816).
**Applies to:** any operation that runs, finishes, and might produce nothing — import, generation,
AI calls, search/filter, sync, export.

If the prototype in `plans/design-handoff/v2/prototype/` shows a conflicting treatment for a
specific surface, the prototype wins for that surface. This spec is the pattern to use
everywhere the prototype hasn't already decided.

## 1. Why this exists

One session, two subsystems, the same bug shape:

- **SKY-11814** — importing a `.docx` manuscript creates a vault with **zero warnings** and the
  Story Vault ends up completely empty. The user's manuscript is gone and nothing told them.
- **SKY-11816** — Beta Reader → Reports → Run shows "Reading…", then reverts to "No beta reads
  yet". The AI model actually returned a full response. The app never showed it.

Both are the same root defect: **a completed operation that produced nothing looks identical to
one that was never run.** The user cannot tell "it worked, there's genuinely nothing to show" from
"it broke." That ambiguity is the bug.

## 2. The three states — they must never collapse into one

Every operation that can come back empty-handed has exactly three possible outcomes. Each one
needs its own visual and textual treatment. None of them may borrow another's UI.

| State | Meaning | Example |
|---|---|---|
| **Empty** | It ran, it worked, there is genuinely nothing to show. | A beta-read search filter matches 0 reactions. |
| **Partial** | It ran, it worked, but part of the input was skipped or part of the output is missing. | Import found 3 chapters and skipped 1 file it couldn't read. |
| **Failed** | It did not complete, or what came back could not be used. | The AI response couldn't be parsed. The file couldn't be read. |

**Rule:** if you are about to render an "empty state" component and you are not 100% sure the
operation actually succeeded, it is not an empty state. Render the failed state instead. This is
the exact mistake in SKY-11816: "no report" was rendered as "no beta reads yet" (empty) when the
report *had* come back — it just failed to parse. Silence is never the default; silence must be
earned by a confirmed, successful, empty result.

## 3. Empty vs. Failed — visual contract

These must be visually distinguishable at a glance, not just by reading the copy.

**Empty state** (existing component: `frontend/src/components/EmptyState/EmptyState.tsx`)
- Neutral tone. Uses `--text-muted` / `--text-primary`, no danger color.
- Icon is the surface's own glyph (e.g. the Beta Reader's 👁), not a warning symbol.
- Heading states the neutral fact ("No beta reads yet"), hint gives the next action.
- Lives in the surface's normal content area — same position the results would occupy.
- Never carries a dismiss control. There is nothing to dismiss; it's not a message, it's a state.

**Failed state** (new: `FailureState`, sibling of `EmptyState`, same content-area position)
- Uses `--state-danger` / `--color-danger-bg` / `--color-danger-border` (existing tokens,
  `frontend/src/tokens.css:208,218,320-322`).
- Icon is a warning glyph, not the surface's neutral icon — icon shape carries the meaning too,
  never color alone (WCAG color-independence).
- Heading states what didn't work, in plain language, not the error class name.
- Body: one line on what the user can do next (retry, pick a different file, contact nothing —
  no dead ends).
- Always carries a retry action when retry is possible without re-entering lost input.
- Renders in the **same content area** the result would have occupied — never a toast for the
  primary signal. A toast alone means a user who glances away sees nothing; the failed state must
  be sitting there when they look back (Postel's law: be visibly clear about what happened, don't
  make the user reconstruct it from a vanished toast).

Never reuse `EmptyState` for a failure by swapping only its copy. Reusing empty-state chrome for a
failure is precisely what produced SKY-11816 — a passive, neutral-toned box sitting where an
error demands visible attention (Von Restorff: failures must stand out from the normal empty
case, not blend into it).

## 4. Partial success — surfacing skipped items

When an operation succeeds for *some* of its input and skips or drops the rest, the user must
learn: **that something was skipped, how much, and which one(s), by name.**

Pattern: a persistent summary banner directly above the result, plus a disclosed list.

```
┌─────────────────────────────────────────────────────────┐
│ ⚠ Imported 3 of 4 files. 1 was skipped.        [Details ▾]│
└─────────────────────────────────────────────────────────┘
```

Expanded (`Details` disclosure, closed by default — Progressive Disclosure, don't force a wall of
text on every user):

```
┌─────────────────────────────────────────────────────────┐
│ ⚠ Imported 3 of 4 files. 1 was skipped.        [Details ▲]│
│                                                             │
│   Skipped                                                  │
│   chapter-7-draft.docx                                     │
│   Could not read this file — it may be password-protected. │
└─────────────────────────────────────────────────────────┘
```

- Component: reuse `MigrationBanner` chrome (`frontend/src/components/MigrationBanner/`) — it
  already has this exact shape (persistent bar + expandable detail body). Restyle with
  `--color-warning-bg` / `--color-warning-border` for partial success (not the green "migration
  ok" tint it currently uses, and not danger-red — partial success is its own tone, not a subset
  of failure).
- Every skipped item is named — file name, chapter title, whatever the user gave it. "1 item was
  skipped" with no name forces the user to guess and re-check everything (violates Recognition
  over Recall).
- One line per skipped item on *why*, in plain language, not a stack trace.
- The count in the summary line is always "N of M" — never just "N skipped" — so success and
  loss are both visible in one line (Framing: lead with what worked, not just what didn't).

## 5. Persistence — what times out, what doesn't

Existing primitive: `useToast()` (`frontend/src/hooks/useToast.ts`), 3s default, auto-dismiss.
That primitive is correct for confirmations only. It is wrong for anything data-loss-shaped.

| Outcome shape | UI | Dismiss |
|---|---|---|
| Full success, nothing lost | Toast (`useToast`, info) | Auto, 3–4s |
| Empty result (confirmed success, nothing to show) | In-place `EmptyState` | N/A — not a message |
| Partial success / skipped items | Persistent banner (§4) | Manual only — stays until the user dismisses it or navigates away and back |
| Failure | In-place `FailureState` (§3) + `error`-level toast as a secondary echo | Toast auto-dismisses; the in-place state persists until retried or the surface is closed |

**Rule:** if dismissing the notice would make the user lose the only record that data was
dropped, it cannot be a timed toast. SKY-11814 is exactly that shape — if "1 file skipped" were a
4-second toast, a user who steps away mid-import loses the only warning that their manuscript is
incomplete, permanently, with no other record in the UI. Partial-success and failure notices for
anything vault/manuscript/data-affecting must persist until manually dismissed.

## 6. Copy rules

Dyslexia-friendly by default (per `AGENTS.md` design direction) — every string in this pattern
follows:

1. **Short lines, one idea per line.** No comma-spliced multi-clause sentences.
2. **Label first, detail after.** "Skipped — chapter-7-draft.docx", not "chapter-7-draft.docx
   could not be imported because it was skipped due to a read error."
3. **Say what happened, then what the user can do.** Two clauses max: fact, then action.
   - Good: "Could not read the response. Try running it again."
   - Bad: "An unexpected error occurred while processing the request; please contact support if
     the issue persists." (jargon, no concrete action, dead-end tone)
4. **Never blame the user, never use passive voice to hide the actor.** "This file couldn't be
   read" not "the file was unreadable" — keep the sentence about the thing that happened, not an
   abstract state.
5. **Plain nouns for technical failures.** "Could not read the response" not "Failed to parse
   AI output" — the user doesn't know what "parse" means and doesn't need to.
6. **Never reuse an empty-state heading for a failure**, even under time pressure. "No beta reads
   yet" is a lie if a read was attempted and failed.

## 7. Accessibility

- Any state transition into Failed or Partial must be announced to assistive tech, not conveyed
  by color/icon alone.
  - Failed state container: `role="alert"` (or a live region update), same as the existing
    `Toast` component's `role={level === 'error' ? 'alert' : 'status'}` pattern in
    `frontend/src/components/Toast/Toast.tsx:30-31` — reuse that convention, don't invent a new
    one.
  - Partial-success banner: `role="status"` + `aria-live="polite"` — it's important, not urgent;
    it shouldn't interrupt.
  - Empty state: no live region. It's not an event, it's a resting state.
- Icon + color + text all three carry the state — never color alone (WCAG 1.4.1). A failed state
  rendered in grayscale or by a colorblind user must still read as "failed" from the icon shape
  and heading text alone.
- Retry buttons and "Details" disclosures are real `<button>` elements, keyboard-reachable, with
  visible focus rings (existing focus tokens) — not `onClick` divs.
- Minimum contrast: reuse `--state-danger` (#f88585, 4.5:1+ on `--danger-bg`, already audited per
  the SKY-1597 comment in `tokens.css:208`) and `--state-warning` (#fbbf24) — do not introduce new
  failure/warning colors.

## 8. Worked example A — SKY-11814, `.docx` import with a skipped file

**Before (the bug):** vault created, 0 chapters, 0 scenes, no warning. User opens the Story Vault
and it's empty. No signal anything happened at all.

**After, per this pattern:**

The import pipeline already collects `warnings: string[]` per file
(`electron-main/src/storyImport.ts` — `docxToStoryMarkdown` returns `{ markdown, warnings }`,
and the `.scrivx` path already pushes messages like `'No .scrivx binder found — imported all RTF
documents in folder order'`). The gap is that these warnings are collected but never required to
reach the UI, and a file that fails to parse *before* producing any chapters currently has no path
to surface at all — it just contributes nothing, silently.

Required behavior:

1. If the importer produces **zero chapters** across all selected files, this is not a success —
   render the **Failed** state (§3) in place of the import summary: "Could not import
   `chapter-7-draft.docx`. It may be corrupted or password-protected." with a **Choose a different
   file** retry action. Do not create an empty vault entry silently.
2. If the importer produces chapters from **some but not all** selected files, this is **Partial**
   (§4): a persistent banner reading `Imported 3 of 4 files. 1 was skipped.` with a `Details`
   disclosure naming `chapter-7-draft.docx` and the reason ("Could not read this file — it may be
   password-protected"), sourced directly from that file's entry in `warnings`.
3. If the importer produces chapters but with sub-file warnings (e.g. "No .scrivx binder found —
   imported all RTF documents in folder order"), that is still **Partial** — the story did import,
   but something about the shape of the input was non-standard and the user should know before
   they go looking for a missing chapter.
4. Never advance to "Story Vault" / close the import dialog on a zero-chapter result. The
   surface stays open until the user acknowledges the failure or picks a different file.

## 9. Worked example B — SKY-11816, unparseable AI response in Beta Reader

**Before (the bug):** click Run → button shows "Reading…" → button reverts, main panel reverts to
the `EmptyState` ("No beta reads yet"). The model's response existed; nothing downstream signaled
the mismatch.

**After, per this pattern:**

`BetaReaderPage.tsx`'s `handleRun` (`frontend/src/beta/BetaReaderPage.tsx:187-249`) already has a
`try/catch` that shows an `error`-level toast when `window.api.betaReportRun` throws or resolves
`{ error }`. The gap SKY-11816 exposes is a response that resolves successfully at the IPC layer
but fails a later step (e.g. the report shape doesn't parse, `report.reactions` isn't iterable,
whatever the specific defect turns out to be) *without* throwing — so it falls through to the
success path with a report that was never actually set, leaving `selectedReport` unset and the
empty state render.

Required behavior:

1. Any step between "the model responded" and "a valid report is set in state" that cannot
   proceed must throw (or set an explicit failure state) — never fall through silently to leave
   `selectedReport` unset. Treat "response came back but didn't match the expected shape" as a
   parse failure, same bucket as a network error.
2. On that failure, render the in-place **Failed** state (§3) in the `beta-reader-main` panel —
   not the `beta-reader-empty` block — with heading "Could not read the response." and body "Try
   running it again." plus a **Retry** button that re-invokes `handleRun` with the same scope/focus
   (no need to reselect anything — Tesler's law, keep the complexity on the system's side).
3. Keep the existing `error`-level toast (`frontend/src/beta/BetaReaderPage.tsx:245`) as the
   secondary, transient echo — the in-place Failed state is the record that persists if the user
   looks away mid-run and misses the toast.
4. The distinction from a genuine empty state ("no reads run yet," a first-time user) must remain
   intact: `EmptyState` is for "you haven't tried," `FailureState` is for "you tried and it broke."
   Never let a failed run silently reset back to the "you haven't tried" copy.

## 10. Components and tokens to reuse (do not invent new ones without cause)

| Need | Reuse |
|---|---|
| Neutral empty content area | `frontend/src/components/EmptyState/EmptyState.tsx` |
| Failed content area | **New** `FailureState` — same file/prop shape as `EmptyState` (`icon`, `heading`, `hint`, `action`), danger-toned. Build as a sibling in `frontend/src/components/EmptyState/`, not a one-off per surface. |
| Transient confirmations | `frontend/src/hooks/useToast.ts` + `frontend/src/components/Toast/Toast.tsx` (already has the `role="alert"` vs `role="status"` split — reuse, don't reinvent) |
| Persistent partial-success / skipped-items banner | Restyle `frontend/src/components/MigrationBanner/` chrome — expandable bar + detail list already exists |
| Color tokens | `--state-danger` / `--color-danger-bg` / `--color-danger-border` (failure); `--state-warning` / `--color-warning-bg` / `--color-warning-border` (partial); no new colors |
| Spacing / radius | `--space-*`, `--radius-*` scale in `frontend/src/tokens.css` — no hardcoded px |

## 11. Acceptance checklist for implementers

- [ ] Can you point to the exact branch in code where "empty" vs "failed" is decided? If the
      answer is "we render empty state whenever `report` is falsy regardless of why," that's the
      bug — fix the branch, not just the copy.
- [ ] Does every skipped/dropped item get named, not just counted?
- [ ] Does the partial/failure notice survive the user looking away for 10+ seconds?
- [ ] Does a screen reader announce the state change without the user needing to discover it
      visually?
- [ ] Is there a concrete next action (retry, pick different file, adjust filter) — never a dead
      end?
- [ ] Did you reuse `EmptyState`/`Toast`/`MigrationBanner` chrome and tokens rather than
      hand-rolling new markup?

## 12. Out of scope

This spec does not redesign the Beta Reader or the import wizard. It defines the failure/empty/
partial contract those surfaces (and every future one shaped like them) must implement. SKY-11814
and SKY-11816 were already dispatched before this spec landed and are not blocked on it — they
get reconciled against this pattern as a follow-up if their shipped implementation diverges.
