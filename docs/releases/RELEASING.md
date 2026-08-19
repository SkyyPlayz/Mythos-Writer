# Releasing Mythos Writer

Canonical release process as of SKY-10762. The former one-button
`release-prep.yml` workflow is **deleted**: its `commit-version` job pushed a
version-bump commit straight to `main` with the workflow `GITHUB_TOKEN`, which
branch protection rejects (GH006 — required status checks can never pass on a
commit that was never a PR). No workflow may push commits to `main`; the
version bump is a normal reviewed PR, and `release.yml` does everything else.

## Process

### 1. Version-bump PR

Open a normal PR against `main` that sets the new version in `package.json`:

```bash
jq '.version = "0.5.0-beta.2"' package.json > package.json.tmp && mv package.json.tmp package.json
```

The PR goes through regular CI and the standard merge gate like any other
change. (Example: v0.5.0-beta.2 was bumped via PR #1279.)

### 2. Cut the release with `release.yml`

Once the bump is merged, dispatch the **Release** workflow with the matching
tag:

```bash
gh workflow run release.yml \
  -R SkyyPlayz/Mythos-Writer \
  -f tag=v0.5.0-beta.2 \
  -f is-beta=true
```

(Pushing an annotated tag `v*` to the bumped commit triggers the same workflow;
dispatch is preferred because a tag pushed by another workflow's `GITHUB_TOKEN`
would not trigger it at all.)

`release.yml` then, without ever pushing a commit to `main`:

- **validate-version** — fails fast if the tag does not match the
  `package.json` version on the checked-out commit (i.e. the bump PR has not
  merged yet).
- **create-release** — creates/updates the draft GitHub release for the tag.
- **build-windows** — NSIS installer + ZIP on `windows-latest`, signed when
  `WINDOWS_CERTIFICATE_BASE64` is configured; beta tags build with
  `--config.publish.channel=beta --config.publish.releaseType=prerelease` so
  the auto-updater reads the pre-release beta feed.
- **build-linux** — AppImage, same channel handling.
- **build-mac** — currently disabled (`if: false`, Actions budget; see the
  comment in the workflow).
- **publish-release** — regenerates release notes from commits since the
  previous tag and keeps the release as a **draft**.

### 3. Verify and publish

Download the draft-release artifacts, smoke-test the installer, then publish
the draft in the GitHub UI (or `gh release edit <tag> --draft=false`). For
beta releases keep the pre-release flag set — the updater's beta channel feed
depends on it.

## Build-only smoke (old "dry-run")

`release-prep.yml`'s dry-run mode built an installer without tagging or
releasing. Equivalent today: run the packaging locally (`npm run dist:linux`,
or `npx electron-vite build && npx electron-builder --win --publish never` on
Windows) — nothing in CI needs to run to smoke a build.
