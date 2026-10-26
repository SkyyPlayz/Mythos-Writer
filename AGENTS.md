# Agent instructions

The canonical rules (required checks, test commands, no-touch paths) are in [`CLAUDE.md`](CLAUDE.md). Read it before you change anything.

## Code hygiene

- ARIA: prefer native elements; any role you add follows its full WAI-ARIA pattern; never aria-label a plain span/div; never leave a focusable control inside an aria-hidden subtree; run axe on changed components.
- After deleting, renaming or moving a file, symbol, view or path, rg the repo for the old name and fix every comment, doc and spec that still names it in the same PR.
