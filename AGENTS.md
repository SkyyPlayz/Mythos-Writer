# Agent instructions

This repository is built by autonomous agents. The canonical working rules —
including the non-negotiable CI / merge-readiness contract — live in
[`CLAUDE.md`](CLAUDE.md). Read it before making changes.

Summary: a branch is not done until all three required PR checks pass —
`CI / build-linux`, `CI / build-macos`, and `CI / ci`. CI is part of the spec.
