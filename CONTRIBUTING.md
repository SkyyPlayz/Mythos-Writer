# Contributing to Mythos Writer

## Code Quality Standard

Every change on this repo must meet the **Code Quality Standard — Correct, Clear, Simple, Tested, Bulletproof**.

- **Reviewers:** run the [Code Review Rubric](docs/code-review-rubric.md) on every PR.
- **Authors:** verify the Definition of Done checklist in the PR template before requesting review.
- **Priority order when qualities conflict:** correctness > readability > simplicity > maintainability > performance.

Full details: [`docs/code-review-rubric.md`](docs/code-review-rubric.md) · Source report: [`plans/ProjectGoalOverView/13-Code-Quality.md`](plans/ProjectGoalOverView/13-Code-Quality.md)

---

## Merge Policy

All changes to `main` must go through a pull request that passes every required
CI check **and** is up to date with `main` at the time of merge.

### Required checks

Three jobs must be green before a PR can merge:

| Check name | What it validates |
|---|---|
| `CI / ci (pull_request)` | Lint, type-checks, unit tests, Electron build, Playwright E2E |
| `CI / build-macos (pull_request)` | Same checks + macOS DMG packaging |
| `CI / build-linux (pull_request)` | Same checks + Linux AppImage / .deb / .rpm packaging, artifact verification, and AppImage smoke test |

These are defined in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).
**Do not bypass or skip these checks.**

### Branch must be up to date

Before merging, your branch must include every commit that is currently on
`main`. GitHub enforces this with the **"Require branches to be up to date
before merging"** setting on the protected branch.

If another PR lands while yours is in review, rebase your branch:

```bash
git fetch origin
git rebase origin/main
git push --force-with-lease
```

Wait for CI to re-run on the rebased commit before merging.

### Why this matters

PRs that share a common ancestor but introduce incompatible type changes only
collide at merge time. By requiring every PR to be current with `main` before
merging, type collisions surface inside the PR's own CI run, not after the
merge breaks `main` for everyone else.

### No force-pushing to main

`main` is a protected branch. Direct pushes and force-pushes are blocked.

## Merge queue (recommended for parallel PRs)

When multiple approved PRs are ready at the same time, use GitHub's **merge
queue** (available on GitHub Team/Enterprise plans) rather than racing to merge
first. The queue serialises merges and rebases each PR in order, so only one
CI run is needed per merge slot.

To enqueue a PR: open the PR, click **"Merge when ready"** (or enable it via
the merge queue button). GitHub will rebase, run CI, and merge automatically.

If the merge queue is not available on the current plan, use the manual rebase
workflow above.

## Testing

Read [`docs/testing-strategy.md`](docs/testing-strategy.md) before writing or reviewing any test.
It covers the pyramid shape, Arrange-Act-Assert, boundary-value analysis, regression discipline,
and all other techniques required by the Code Quality Standard.

## Running CI locally

Run the same commands CI runs before pushing:

```bash
npm ci                          # deterministic install
npm run lint -w frontend        # frontend lint
npm run typecheck               # frontend + electron-main type-checks
npm run test                    # unit tests
npm run build:electron          # production build
```

For E2E (requires a display or `xvfb`):

```bash
npm run test:e2e:crud
npm run test:e2e:brainstorm
```

## Branch naming

Use descriptive branch names scoped to the issue:

```
fix/myt-123-short-description
feat/myt-456-short-description
chore/myt-789-short-description
```

## Commit messages

Write imperative, present-tense summaries. Reference the Paperclip issue
identifier in the commit body or footer:

```
fix: prevent snapshot path traversal via sceneId parameter

Refs: MYT-638
```

## Linux packages

The `build-linux` CI job produces three installable artifacts bundled under the
`linux-packages` artifact:

| Format | File | Target distros |
|--------|------|----------------|
| AppImage | `Mythos Writer-*.AppImage` | Any x64 Linux |
| Debian package | `Mythos Writer-*.deb` | Debian, Ubuntu, and derivatives |
| RPM package | `Mythos Writer-*.rpm` | Fedora, RHEL, openSUSE, and derivatives |

### AppImage

No installation required. Download, make executable, and run:

```bash
chmod +x "Mythos Writer-*.AppImage"
./"Mythos Writer-*.AppImage"
```

Configuration is stored in `~/.config/Mythos Writer/`.

**Uninstall:** delete the AppImage file. User data remains in `~/.config/Mythos Writer/`.

### Debian / Ubuntu (.deb)

```bash
# Install
sudo apt install ./"Mythos Writer-*.deb"
# or: sudo dpkg -i "Mythos Writer-*.deb"

# Uninstall (keeps user config)
sudo apt remove mythos-writer

# Uninstall and remove user config
sudo apt purge mythos-writer
```

Install paths:

| Path | Contents |
|------|----------|
| `/opt/Mythos Writer/` | Application binaries and resources |
| `/usr/share/applications/mythos-writer.desktop` | Desktop entry |
| `~/.config/Mythos Writer/` | User configuration and vault index |

### Fedora / RHEL / openSUSE (.rpm)

```bash
# Install (dnf — Fedora 22+, RHEL 8+)
sudo dnf install ./"Mythos Writer-*.rpm"

# Install (rpm — any RPM-based distro)
sudo rpm -i "Mythos Writer-*.rpm"

# Uninstall
sudo dnf remove mythos-writer
# or: sudo rpm -e mythos-writer
```

Install paths mirror the Debian layout above (`/opt/Mythos Writer/` for binaries,
`~/.config/Mythos Writer/` for user data).
