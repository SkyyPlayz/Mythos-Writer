# Release-Prep Dry-Run Test Plan

## Overview

This test plan verifies that the release-prep workflow (`SKY-8091` PR #1065) works correctly before it's used for actual releases.

## Prerequisites

- PR #1065 is merged to main
- Workflow file `.github/workflows/release-prep.yml` is on main
- You have GitHub CLI (`gh`) installed
- You have read access to the repo

## Test Execution

### Test 1: Dry-Run with Beta Version

**Goal:** Verify version bumping, changelog generation, and artifact creation without committing.

```bash
# Trigger the workflow with dry-run=true
gh workflow run release-prep.yml \
  -R SkyyPlayz/Mythos-Writer \
  -f version=v0.5.0-beta.1 \
  -f dry-run=true
```

**Expected Results:**

1. **Workflow completes in ~15 minutes**
   - Validate input job passes
   - Generate changelog job succeeds
   - Bump version job succeeds
   - Build Windows job succeeds (takes ~10 min)
   - Summary job displays dry-run notice

2. **No commits/tags created**
   - Verify: `git log --oneline | head -1` should NOT show version bump commit
   - Verify: `git tag | grep v0.5.0-beta.1` should return empty (or only old tag)

3. **Artifacts available for download**
   - Artifacts should be available in the workflow run
   - `windows-installer-v0.5.0-beta.1/` artifact contains:
     - `.exe` files (NSIS installers)
     - `.zip` files (portable archives)
     - `.yml` update metadata files

4. **Changelog generated correctly**
   - In workflow run logs, check the "Generate changelog" step
   - Should show commits since the last release tag
   - Format should be markdown bullet list

### Test 2: Verify Built Artifact

**Goal:** Confirm the built Windows installer works and has correct version.

```bash
# Download artifacts from the workflow run
# (via GitHub UI: Actions → Release Prep → latest run → Artifacts)

# Extract the Windows installer ZIP
unzip windows-installer-v0.5.0-beta.1/Mythos-Writer-0.5.0-beta.1.zip

# Run the app (on Windows or via Wine if on Linux)
./Mythos-Writer.exe

# Verify version in app:
# - Go to Settings → About
# - Should show "v0.5.0-beta.1"
# - OR check via command line: ./Mythos-Writer.exe --version
```

**Expected Results:**
- App starts without errors
- App shows correct version (0.5.0-beta.1)
- Auto-update check doesn't error (if MYTHOS_AUTO_UPDATE=1 is set)

### Test 3: Verify Changelog Format

**Goal:** Confirm changelog is correctly formatted for release notes.

Check the workflow run's summary and logs:

```bash
# View workflow run details
gh run view <run-id> -R SkyyPlayz/Mythos-Writer --log
```

**Expected Results:**

Changelog should be in format:
```
- <commit subject line>
- <commit subject line>
- ...
```

Example:
```
- Add real E2E for docx story import (SKY-8002) (#1053)
- ci(SKY-7941): add required screenshot check for UI-milestone PRs (#1046)
- docs(SKY-7936): restore PERFORMANCE.md with packaged-build baselines...
```

## Cleanup After Testing

1. **Delete downloaded artifacts** (or leave them; GitHub auto-deletes after 7 days)
2. **Do NOT publish any draft release** created during testing
3. **Verify no commits pushed** to main

## Common Issues & Solutions

### Workflow fails at "Build Windows installer"

**Check logs:** Look at the Windows build job logs for specific error.

**Common causes:**
- `npm ci` failure → check lock file is valid
- `electron-vite build` error → TypeScript compilation issue
- `electron-builder` error → NSIS configuration issue

**Solution:** Fix the underlying issue in the repo and re-run test.

### Version validation fails

**Check:** Version input format. Should be `X.Y.Z` or `X.Y.Z-prerelease`.

**Examples:**
- ✅ `0.5.0-beta.1`
- ✅ `v0.5.0-beta.1` (leading v is stripped)
- ❌ `0.5.0-beta-1` (use dot, not dash for prerelease)
- ❌ `0.5.0.beta.1` (wrong format)

### Changelog is empty

**Cause:** No commits between the last tag and HEAD.

**Check:** 
```bash
# See what commits exist since last tag
git log v0.5.0-beta.0..HEAD --oneline | head -5
```

**Solution:** Make a test commit on the branch before running workflow, or use a version that has commits since last tag.

### Can't find workflow run

**Check:** Ensure PR #1065 is merged to main first.

```bash
# List recent workflow runs
gh run list -R SkyyPlayz/Mythos-Writer --workflow release-prep.yml --limit 5
```

## Passing Criteria

✅ **All of these must pass:**

- [ ] Workflow completes without errors (dry-run=true)
- [ ] No commits or tags created on main
- [ ] Artifacts successfully built and downloadable
- [ ] Downloaded Windows installer runs and shows correct version
- [ ] Changelog generated and formatted correctly
- [ ] Workflow logs show expected behavior in each job

## After Passing Tests

1. Approve and merge PR #1065
2. Update SKY-8091 issue: "Release-prep workflow tested and ready for production use"
3. Document in team comms that one-button release is now available
4. For v0.5.0-beta.1 release: run workflow with dry-run=false

## References

- PR #1065: One-button release prep automation
- Workflow: `.github/workflows/release-prep.yml`
- Docs: `docs/releases/RELEASE-PREP-ONE-BUTTON.md`
- Issue: SKY-8091 (Paperclip)
