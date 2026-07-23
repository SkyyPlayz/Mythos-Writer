# One-Button Release Prep Guide

## Overview

The **Release Prep** workflow (`release-prep.yml`) automates the M30 release pipeline for Mythos Writer. It combines version bumping, changelog generation, Windows installer building, and draft release creation into a single workflow dispatch button.

This eliminates manual work for every beta release (and every stable release after).

## When to Use

Run this workflow when you're ready to prepare a new beta or stable release. For example:
- **v0.5.0-beta.1** → bump from beta.0, generate changelog since beta.0, build installer, create draft
- **v0.5.0** → bump from beta.1, generate changelog, build installer, create draft

## How to Trigger

### Via GitHub UI

1. Go to **Actions** → **Release Prep**
2. Click **Run workflow**
3. Enter the **version** (e.g., `v0.5.0-beta.1` or just `0.5.0-beta.1`)
4. Set **dry-run** to `true` (recommended for first-time testing)
5. Click **Run workflow**

### Via GitHub CLI

```bash
# Dry-run (test mode; no commit/tag/release)
gh workflow run release-prep.yml \
  -f version=v0.5.0-beta.1 \
  -f dry-run=true

# Actual release (commits version, creates tag and draft release)
gh workflow run release-prep.yml \
  -f version=v0.5.0-beta.1 \
  -f dry-run=false
```

## What It Does

### 1. Validate Input
- Parses and normalizes the version (e.g., `0.5.0-beta.1` → `v0.5.0-beta.1`)
- Detects beta/alpha/rc prerelease flags
- Exits if version format is invalid

### 2. Generate Changelog
- Finds the most recent git tag before this release
- Collects all commit messages (PR titles) between that tag and HEAD
- Formats as a markdown list for the release notes

### 3. Bump Version
- Updates `package.json` with the new version
- Uploads the bumped file as an artifact for the build job

### 4. Build Windows Installer
- Checks out the repo
- Downloads the bumped package.json
- Installs Node.js 22 and dependencies
- Runs `npm ci` and `electron-vite build`
- Runs `electron-builder --win` to build NSIS installer + ZIP
- **Installer is unsigned** (per owner spec; signing deferred)
- Uploads artifacts to the workflow run (retention: 7 days)

### 5. Create Draft Release (if not dry-run)
- Creates a GitHub release with the tag name
- Marks it as **draft** (owner will publish manually)
- Includes the auto-generated changelog in the release body

### 6. Commit Version (if not dry-run)
- Commits the version bump to the current branch
- Creates and pushes the git tag
- Pushes the changes to origin

### 7. Summary
- Displays a summary with version, changelog, and mode (dry-run or live)

## Dry-Run Testing Workflow

1. **Trigger with dry-run=true**
   ```bash
   gh workflow run release-prep.yml -f version=v0.5.0-beta.1 -f dry-run=true
   ```

2. **Wait for workflow to complete** (usually ~10-15 minutes for Windows build)

3. **Download artifacts** from the workflow run:
   - `windows-installer-v0.5.0-beta.1/` → contains .exe, .zip, .yml files

4. **Test locally**
   - Extract the ZIP and run the app
   - Verify version is bumped (check app settings or `--version`)
   - Test auto-update mechanism if applicable

5. **Clean up artifacts** (GitHub auto-deletes after 7 days, or delete manually)

6. **If tests pass**, run the workflow again with dry-run=false:
   ```bash
   gh workflow run release-prep.yml -f version=v0.5.0-beta.1 -f dry-run=false
   ```

## Files Modified

- `.github/workflows/release-prep.yml` — the automation workflow

## Constraints

- **Draft-only**: Releases are always created as drafts. Owner publishes manually via GitHub UI.
- **Windows unsigned**: Signing certificates not configured; unsigned installer is intentional.
- **No macOS**: macOS build disabled (platform deferred, high Actions cost).
- **No re-trigger**: If a release is on hold (e.g., waiting for testing), do NOT re-run the workflow with the same version — it will overwrite the draft release.

## What's NOT Automated (by design)

- **Publishing**: The owner manually opens the draft release and clicks "Publish" on GitHub.
- **Installer signing**: Deferred to a future phase (Windows code signing setup).
- **macOS builds**: Deferred (no Mac hardware, 10x Actions cost vs Linux).
- **Announcement**: Release notes are auto-generated but owner writes final summary/highlights.

## Troubleshooting

### Workflow fails at "Build Windows installer"

**Check**: Windows build logs in the workflow run. Common issues:
- `npm ci` fails → check node_modules lock file
- `electron-vite build` fails → TypeScript or build config error
- `electron-builder` fails → missing dependencies or config issue

**Fix**: Push a fix to main, then re-run the workflow.

### Version already exists (tag conflicts)

If you run the workflow twice with the same version in non-dry-run mode, the second run will fail to push the tag. 

**Fix**: Delete the tag from local and remote:
```bash
git tag -d v0.5.0-beta.1
git push origin :refs/tags/v0.5.0-beta.1
```
Then re-run the workflow.

### Changelog is empty or has too few commits

**Check**: Did you merge PRs since the last tag? The workflow looks for commits between the previous tag and HEAD.

**Manual fix**: If the changelog is wrong, edit it directly in the draft release on GitHub.

## For Owner (Ivy)

### Publishing a Release

1. Go to **Releases** on GitHub
2. Find the draft release (e.g., `v0.5.0-beta.1`)
3. Click **Edit**
4. Review the changelog; add any highlights or breaking changes
5. Click **Publish release**
6. Users will see it in the app's auto-update check

### If You Need to Cancel a Release

1. Delete the draft release from GitHub
2. Delete the git tag:
   ```bash
   git tag -d v0.5.0-beta.1
   git push origin :refs/tags/v0.5.0-beta.1
   ```
3. Close/delete any associated pull requests

## Performance

- Workflow runtime: **~10-15 minutes** (mostly Windows build time)
- Artifact size: **~100-150 MB** (NSIS installer + ZIP)
- Actions minutes used: **~15 minutes** (Windows jobs count 10x)

## Future Enhancements

- [ ] Auto-generate detailed release notes (grouping by feature/fix/test/docs)
- [ ] Optionally sign Windows installer (requires cert provisioning)
- [ ] Add macOS build option (when platform ships)
- [ ] Automated changelog review/approval gate
- [ ] Integrated publishing (with manual gate before going live)
