# Mythos Bugbot rules

Mythos Writer is an Electron, local-first fiction writing app. Weigh local-vault data safety, offline behavior and UI fidelity over cloud-first shortcuts.

- Do not weaken, skip or delete tests to make CI green.
- Do not loosen security, auth, secrets handling, or release/packaging guards.
- Keep diffs minimal: no drive-by refactors, renames or formatting churn outside the task.
- Autofix goes on a new branch or sibling PR. Never commit to a PR tip after TIP FREEZE: a tip push resets the Critic/Shield/Probe gate.
